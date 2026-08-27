#!/usr/bin/env node
// The dashboard: one local page for the weekly pass over translations and inventory.
//
//   node scripts/dashboard-server.mjs        # http://127.0.0.1:8093
//
// Normally it is not started by hand — com.jains.indianinprague-dashboard.plist keeps it
// running, so the bookmark always answers. See that file for enabling it.
//
// BOUND TO 127.0.0.1, DELIBERATELY
// --------------------------------
// This process writes files in the repo and can trigger a live deploy. It listens on the
// loopback interface only, so nothing on the network — or on the café wifi this laptop
// joins — can reach it. The Host header is checked too: a hostile web page you happen to
// visit can point a DNS name at 127.0.0.1 and have your browser POST here, and a Host
// check is what stops that (the browser sends the attacker's name, not localhost).
//
// It has no authentication, and it does not need any as long as both of those hold. Do not
// "just expose it for a minute" through the tunnel.
//
// WHAT IT MAY WRITE
// -----------------
// data/i18n/overrides/<lang>.json, and nothing else. The machine layer, the catalogue and
// the pages are all read-only from here — Save can only ever change your own text, so the
// worst outcome of a bug in this file is a bad translation on a page, never lost catalogue
// data or a half-written build.
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildTree, flatten } from "./tree.mjs";
import { LANGS, CODES, ROOT, loadSources, loadMachine, loadOverrides, saveOverrides, resolve, coverage, englishSummary } from "./i18n.mjs";

const PORT = Number(process.env.DASHBOARD_PORT || 8093);
const HOST = "127.0.0.1";
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

const run = promisify(execFile);

/* ---------------------------------------------------------------------- pages ---- */

// Two tools, one bookmark. The inventory view and the translation view are separate pages
// with separate code — this only makes them share an origin and a tab bar, because the
// alternative was reimplementing 200 lines of working filter-and-sort UI inside the other
// page and then keeping two renderers of the same catalogue in step forever.
//
// Inventory is the landing page: translations are quiet most weeks, stock is not.
const PAGES = {
  "/": { file: "inventory.html", tab: "inventory" },
  "/inventory": { file: "inventory.html", tab: "inventory" },
  "/translations": { file: "dashboard.html", tab: "translations" },
  // The path this page answered on before the two were joined. Kept so an existing bookmark
  // does not break.
  "/dashboard.html": { file: "dashboard.html", tab: "translations" },
};

// The tab bar, injected as the page is served rather than baked into either file.
//
// scripts/inventory-page.html must keep working when double-clicked off disk with the agent
// stopped — that is its whole character, inline everything, no server — and a tab linking to
// a server that is not running is a dead control. Injecting on serve means the bar exists in
// exactly the context where it works.
//
// Deliberately NOT sticky. Both pages already have their own sticky header at top:0, and the
// inventory's table headers stick at a hardcoded top:104px measured from it. A second sticky
// bar would either overlap that or require changing an offset in a file this feature has no
// business touching.
function tabBar(current, dark) {
  const ink = dark ? "#F2EFE6" : "#1c1a17";
  const bg = dark ? "#353022" : "#efeae0";
  const on = dark ? "#DCE775" : "#1c1a17";
  const tab = (href, label, name) =>
    `<a href="${href}" style="padding:7px 14px;border-radius:6px;text-decoration:none;` +
    `font:600 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.08em;` +
    `text-transform:uppercase;color:${current === name ? (dark ? "#2a2519" : "#fff") : ink};` +
    `background:${current === name ? on : "transparent"};opacity:${current === name ? 1 : 0.72}"` +
    `${current === name ? ' aria-current="page"' : ""}>${label}</a>`;
  return (
    `<nav aria-label="Views" style="display:flex;gap:6px;align-items:center;padding:8px 16px;` +
    `background:${bg};border-bottom:1px solid rgba(128,128,128,.25)">` +
    // The wordmark names what this is: the ADMIN DASHBOARD, one bookmark covering stock,
    // translations and — since 27 Aug 2026 — whether the site actually published today.
    // It is not a link: there is no third page for it to go to, and a control that only
    // reloads the page you are on is a control that teaches you to distrust the others.
    `<span style="font:700 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
    `letter-spacing:.1em;text-transform:uppercase;color:${ink};opacity:.55;margin-right:6px">Admin</span>` +
    tab("/inventory", "Inventory", "inventory") +
    tab("/tree", "Product Tree", "tree") +
    tab("/translations", "Translations", "translations") +
    `</nav>`
  );
}

// THE BANNER: did this morning's publish reach the live site? (27 Aug 2026)
//
// This is the reason to open the admin dashboard at all — one line, at the top of whichever
// view you land on, answering "is my attention needed today". Everything else on both pages
// is work you choose to do; this is the only thing that comes and finds you.
//
// It exists because for two days nothing did. The 07:15 job pushed, Cloudflare's build
// failed, the edge went on serving the 25th, and the run wrote "live origin healthy" into a
// 116,000-line log. publish.sh now verifies the deployed commit and records its verdict in
// .publish-status.json; this renders it.
//
// GREEN IS SHOWN, not just red. A dashboard that is blank when things are fine teaches you
// nothing about whether it is working — the absence of a warning and the absence of a run
// look identical. Today's success says so, in the past tense, with the time.
//
// Rendered server-side into static HTML rather than fetched: both pages must keep working
// when opened straight off disk, and a banner that needs an API call would be a permanent
// spinner in that context.
// The message is written by publish.sh from a failing command's own words, so it reaches
// here as text of unknown shape. It is going into HTML: escape it.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function publishBanner(dark) {
  const file = path.join(ROOT, ".publish-status.json");
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local, matches publish.sh
  let s = null;
  try {
    if (existsSync(file)) s = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    s = null; // a truncated write mid-run is not worth an error page
  }

  // Yesterday's success is not today's. A run that never fired — Mac off, launchd missed,
  // the failure mode DEPLOY.md records for 17 Aug — leaves a stale `ok` behind, and showing
  // it in green would be the same lie in a nicer colour.
  const stale = s && s.date !== today;
  const state = !s ? "none" : stale ? "stale" : s.state;

  const tone = {
    ok:     { bg: "#1f7a3f", ink: "#fff", lead: "All good.", },
    failed: { bg: "#a8321f", ink: "#fff", lead: "Needs you.", },
    stale:  { bg: "#8a6d16", ink: "#fff", lead: "No run today.", },
    none:   { bg: dark ? "#3a3529" : "#e6e0d2", ink: dark ? "#F2EFE6" : "#1c1a17", lead: "No publish recorded yet.", },
  }[state];

  const when = s?.at ? new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const detail =
    state === "ok"     ? `Today's publish went out at ${when} and the live site is serving it.`
    : state === "failed" ? `${s.message} (stopped at ${s.step}, ${when})`
    : state === "stale"  ? `The last run was on ${s.date}. Today's has not finished — if the Mac was off, the next hourly trigger picks it up.`
    : "Nothing has published since this was set up. The first 07:15 run will fill this in.";

  return (
    `<div role="status" style="padding:10px 16px;background:${tone.bg};color:${tone.ink};` +
    `font:600 13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
    `display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">` +
    `<b>${tone.lead}</b><span style="font-weight:400;opacity:.95">${esc(detail)}</span></div>`
  );
}

// inventory.html is generated once a day by publish.sh, so opened in the afternoon it shows
// the morning's closet. Regenerating it when the catalogue is newer costs one stat and, at
// most, a sub-second node call — and removes the whole category of "why does this say 140
// when I sold one an hour ago".
async function freshInventory() {
  const page = path.join(ROOT, "inventory.html");
  const catalog = path.join(ROOT, "data/catalog.json");
  try {
    if (existsSync(page) && statSync(page).mtimeMs >= statSync(catalog).mtimeMs) return;
    await run(process.execPath, [path.join(ROOT, "scripts/build-inventory.mjs")], { cwd: ROOT });
  } catch (err) {
    // A stale page is far better than no page: serve what is on disk and say why in the log.
    console.warn(`inventory rebuild failed, serving the existing file: ${err.message}`);
  }
}

const readJson = (rel, fallback) => {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
  } catch {
    return fallback;
  }
};

/* ----------------------------------------------------------------- inventory ---- */

// The numbers build-inventory.mjs puts on screen, computed from the same files rather than
// scraped out of its HTML: stock, value, what sold recently. This is the "is the shop OK"
// half of the weekly pass, and it sits beside the translation half so there is one page to
// open rather than two.
function inventory() {
  const raw = readJson("data/catalog.json", []);
  const items = Array.isArray(raw) ? raw : raw.items || Object.values(raw)[0] || [];
  const archive = readJson("data/archive.json", { items: [] });
  const live = items.filter((i) => !i.hidden && !i.sold);
  const rate = readJson("data/fxrate.json", { czkPerEur: 25 }).czkPerEur || 25;
  const czk = live.reduce((n, i) => n + (i.priceCzk || 0), 0);
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const sold30 = (archive.items || []).filter((i) => (i.soldAt || "") >= since);
  return {
    live: live.length,
    reserved: live.filter((i) => i.reserved).length,
    featured: live.filter((i) => i.featured).length,
    noPhoto: live.filter((i) => !i.photo).length,
    needsEnrich: live.filter((i) => i.needsEnrich).length,
    valueCzk: czk,
    valueEur: Math.round(czk / rate),
    sold30: sold30.length,
    sold30Czk: sold30.reduce((n, i) => n + (i.priceCzk || 0), 0),
    archived: (archive.items || []).length,
  };
}

/* ------------------------------------------------------------------- publish ---- */

// The last runs of publish.sh, read out of the log launchd writes. Split on the banner the
// script prints, newest first. This is how a silent 3am failure becomes visible on Sunday
// instead of a month later.
function publishLog(limit = 8) {
  const file = path.join(ROOT, ".sync.log");
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8").slice(-400_000);
  const runs = [];
  // Every run starts with step "1/N sync from Vinted"; anything before the first one is the
  // tail of a run that has already scrolled out of the window we read.
  const parts = text.split(/(?=\n?== 1\/\d+ sync from Vinted)/);
  for (const part of parts.slice(-limit - 1)) {
    if (!/== 1\/\d+ sync from Vinted/.test(part)) continue;
    const lines = part.split("\n").filter(Boolean);
    // A run is judged by whether it REACHED THE LAST STEP, not by whether it printed a
    // warning. publish.sh runs under `set -e`, so a real failure stops the script dead and
    // the step counter never reaches its total — while ⚠ lines are routine: a taxonomy gap
    // or a missed IndexNow ping is worth reading on Sunday and is not a broken publish.
    // Treating every ⚠ as a failure made the dashboard cry wolf on a perfectly good run.
    const steps = [...part.matchAll(/== (\d+)\/(\d+) /g)];
    const reached = steps.length ? Number(steps[steps.length - 1][1]) : 0;
    const total = steps.length ? Number(steps[steps.length - 1][2]) : 0;
    runs.push({
      steps: reached,
      total,
      failed: !total || reached < total,
      deployed: /Deployment complete|Uploaded|✨/i.test(part),
      warnings: [...new Set(lines.filter((l) => l.includes("⚠")).map((l) => l.trim()))].slice(0, 5),
      last: lines[lines.length - 1]?.slice(0, 160) || "",
    });
  }
  return runs.reverse();
}

let publishing = null; // { started, out: [], code }

function startPublish() {
  if (publishing?.code === undefined && publishing) return publishing;
  const out = [];
  const child = spawn(path.join(ROOT, "scripts/publish.sh"), [], { cwd: ROOT });
  publishing = { started: new Date().toISOString(), out, code: undefined };
  const push = (b) => {
    out.push(...String(b).split("\n").filter(Boolean));
    if (out.length > 400) out.splice(0, out.length - 400);
  };
  child.stdout.on("data", push);
  child.stderr.on("data", push);
  child.on("close", (code) => {
    publishing.code = code;
  });
  return publishing;
}

/* ----------------------------------------------------------------- checklist ---- */

// Generated from actual state every time the page loads, never a stored list. A checklist
// that can go out of date is a checklist that gets ignored.
function checklist() {
  const sources = loadSources();
  const items = [];
  const status = readJson("data/i18n/status.json", {});
  const inv = inventory();

  for (const code of CODES) {
    const c = coverage(code, sources);
    if (c.stale) {
      items.push({ level: "act", text: `${c.name}: ${c.stale} of your edits have stale English — keep or replace`, lang: code });
    }
    if (c.missing) {
      items.push({
        level: c.missing > c.total / 2 ? "act" : "note",
        text: `${c.name}: ${c.missing} of ${c.total} strings untranslated — run translate.mjs`,
        lang: code,
      });
    }
  }
  if (status.exhausted) items.push({ level: "act", text: "DeepL quota ran out mid-run — add a key to .env or wait for the monthly reset" });
  if (inv.needsEnrich) items.push({ level: "act", text: `${inv.needsEnrich} items never enriched from Vinted — they show without a description` });
  if (inv.noPhoto) items.push({ level: "act", text: `${inv.noPhoto} live items have no photo` });

  // What the English did this week. Not a task in itself — the nightly run translates new
  // and changed strings on its own — but it is the number that explains everything below it:
  // seven languages moving at once is what a rewritten paragraph looks like from here.
  const en = englishSummary(sources);
  if (en.added || en.edited) {
    const parts = [];
    if (en.added) parts.push(`${en.added} new`);
    if (en.edited) parts.push(`${en.edited} rewritten`);
    items.push({
      level: "note",
      text: `English: ${parts.join(", ")} in the last ${en.days} days — already translated unless a language shows a gap above`,
    });
  }

  const runs = publishLog(3);
  if (runs[0]?.failed) {
    items.push({ level: "act", text: `The last publish stopped at step ${runs[0].steps} of ${runs[0].total || "?"} — see the log below` });
  }
  // Warnings from the most recent run, verbatim. These are the things publish.sh noticed
  // and carried on past: a taxonomy rule missing, an IndexNow ping refused. Exactly the
  // material a weekly pass exists for.
  for (const w of runs[0]?.warnings || []) items.push({ level: "note", text: w.replace(/^⚠\s*/, "") });
  if (!runs.length) items.push({ level: "note", text: "No publish runs in the log yet" });

  const glossary = readJson("data/i18n/glossary.json", { keep: [] });
  if (!glossary.keep?.length) {
    items.push({
      level: "note",
      text: "The glossary's keep-list is empty — add brand names and book titles that must never be translated",
    });
  }
  if (!items.some((i) => i.level === "act")) {
    items.push({
      level: "ok",
      text: items.length ? "Nothing needs a decision — the notes above are for information" : "Nothing needs you this week",
    });
  }
  return items;
}

/* --------------------------------------------------------------------- state ---- */

function state(lang) {
  const sources = loadSources();
  const machine = loadMachine(lang);
  const overrides = loadOverrides(lang);
  const merged = resolve(lang, sources);
  const rows = Object.entries(sources).map(([key, src]) => {
    const r = merged[key];
    const mine = overrides[key];
    return {
      key,
      where: src.where,
      english: src.text,
      text: r.text,
      from: r.from,
      stale: r.stale,
      via: machine[key]?.via || null,
      // What you were translating FROM when you wrote your version. Shown beside the
      // current English so a stale row is a diff you can read, not a warning you must trust.
      wasEnglish: r.stale ? mine?.wasEnglish || null : null,
      machine: machine[key]?.src === src.src ? machine[key].text : null,
    };
  });
  return {
    lang,
    english: englishSummary(sources),
    languages: CODES.map((c) => ({ code: c, ...coverage(c, sources), ...LANGS[c] })),
    checklist: checklist(),
    inventory: inventory(),
    publishes: publishLog(),
    publishing: publishing ? { started: publishing.started, code: publishing.code, out: publishing.out.slice(-60) } : null,
    rows,
  };
}

/* --------------------------------------------------------------- product tree ---- */

// THE PRODUCT TREE: Shelf > Category > Subcategory, with the five numbers per node and the
// photograph that node leads with.
//
// Why this page exists as a page rather than a section of Inventory: Inventory answers "what
// do I have and what is it worth", one row per piece. This answers "how is it arranged and
// where is the weight", one row per node — and it is the only place a featured photograph
// can be chosen, because choosing one is a statement about a shelf, not about an item.
//
// Rendered by the server rather than generated by a build step. The tree is derived from
// catalog.json + the vendor CSV + archive.json on every request (~30ms for 1,671 items), so
// it cannot go stale between the morning sync and the moment it is read — the failure mode
// that inventory.html needs freshInventory() to work around.
const FEATURED = () => path.join(ROOT, "data/featured.json");
const readFeatured = () => {
  try {
    return existsSync(FEATURED()) ? JSON.parse(readFileSync(FEATURED(), "utf8")) : {};
  } catch {
    return {};
  }
};

// The thumbnail for a stored pick. featured.json holds the ORIGINAL path
// (images/vinted-123-1.jpg) because that is what every other part of this codebase names;
// the derived 400px WebP is what a browser should actually load, and it is what the site
// itself serves. Falls back to the original if the derivative is missing.
const thumb = (photo) => {
  if (!photo) return null;
  const base = path.basename(photo).replace(/\.[a-z]+$/i, "");
  return existsSync(path.join(ROOT, "images/derived", `${base}-400.webp`))
    ? `/img/${base}-400.webp`
    : `/img/${path.basename(photo)}`;
};

const num = (n) => (n == null ? "—" : String(n));

// One row per node. Depth drives the indent and nothing else: a subcategory is not a
// different kind of thing from a shelf, it is the same thing further in, and giving each
// level its own layout would make the tree harder to scan rather than easier.
function treeRow(node, featured, depth) {
  const pick = featured[node.path];
  const img = thumb(pick?.photo);
  const shade = ["#DCE775", "#9CCC65", "#6f7a52"][depth] || "#6f7a52";
  return (
    `<tr data-path="${esc(node.path)}" class="d${depth}">` +
    `<td class="face">` +
    (img
      ? `<img src="${esc(img)}" alt="" width="34" height="34" loading="lazy">`
      : `<span class="nopic" title="no photograph chosen">—</span>`) +
    `</td>` +
    `<td class="name" style="padding-left:${8 + depth * 22}px">` +
    `<span class="dot" style="background:${shade}"></span>${esc(node.name)}` +
    (pick?.by === "you" ? `<span class="tag">yours</span>` : "") +
    `</td>` +
    `<td class="n">${num(node.listed)}</td>` +
    `<td class="n">${num(node.inStock)}</td>` +
    `<td class="n">${node.asp == null ? "—" : "€" + node.asp}</td>` +
    `<td class="n">${num(node.withFav)}</td>` +
    `<td class="n">${num(node.sold)}</td>` +
    `<td class="act"><button type="button" data-pick="${esc(node.path)}">Choose photo</button></td>` +
    `</tr>`
  );
}

function treePage() {
  const { tree, totals } = buildTree(ROOT);
  const featured = readFeatured();

  const rows = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      rows.push(treeRow(n, featured, depth));
      walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);

  // The whole wardrobe is a node too, and it is the first row: it carries the totals and it
  // is where a "face of the shop" image would hang. pick-featured.mjs uses the same key.
  const rootRow = treeRow({ ...totals, name: "The whole wardrobe", path: "__wardrobe__" }, featured, 0);

  const stat = (label, value, note) =>
    `<div class="stat"><span class="sv">${esc(String(value))}</span>` +
    `<span class="sl">${esc(label)}</span><span class="sn">${esc(note)}</span></div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin dashboard — Product Tree</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#241f16;color:#F2EFE6;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  main{padding:18px 16px 60px}
  h1{margin:0 0 4px;font-size:19px;letter-spacing:.02em}
  .sub{margin:0 0 18px;color:#b8b0a0;font-size:13px}
  .stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
  .stat{flex:1 1 150px;background:#2e2819;border:1px solid rgba(220,231,117,.18);border-radius:9px;padding:11px 13px}
  .sv{display:block;font-size:23px;font-weight:700;color:#DCE775;line-height:1.15}
  .sl{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:#F2EFE6}
  .sn{display:block;font-size:11px;color:#9e9686;margin-top:2px}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th{position:sticky;top:0;background:#241f16;text-align:left;font-size:11px;text-transform:uppercase;
     letter-spacing:.08em;color:#9e9686;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.14)}
  td{padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:middle}
  td.n{text-align:right;font-variant-numeric:tabular-nums;width:74px}
  td.face{width:44px}
  td.face img{border-radius:5px;object-fit:cover;display:block}
  .nopic{color:#6d6656}
  .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:8px;vertical-align:middle}
  tr.d0 .name{font-weight:700}
  tr.d1{background:rgba(255,255,255,.015)}
  tr.d2 .name{color:#c9c2b2}
  .tag{margin-left:8px;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#241f16;
       background:#DCE775;border-radius:3px;padding:1px 5px}
  button{background:transparent;color:#DCE775;border:1px solid rgba(220,231,117,.4);border-radius:6px;
         padding:4px 9px;font:600 11px/1 inherit;text-transform:uppercase;letter-spacing:.06em;cursor:pointer}
  button:hover{background:rgba(220,231,117,.12)}
  dialog{background:#2e2819;color:#F2EFE6;border:1px solid rgba(220,231,117,.25);border-radius:11px;
         max-width:min(1000px,92vw);width:100%;padding:0}
  dialog::backdrop{background:rgba(0,0,0,.62)}
  .dhead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:14px 16px;
         border-bottom:1px solid rgba(255,255,255,.12)}
  .dhead h2{margin:0;font-size:15px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:9px;padding:14px 16px;
        max-height:64vh;overflow:auto}
  .opt{border:2px solid transparent;border-radius:8px;background:none;padding:0;cursor:pointer;position:relative}
  .opt img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;display:block}
  .opt.on{border-color:#DCE775}
  .opt .fav{position:absolute;top:5px;right:5px;background:rgba(0,0,0,.66);border-radius:4px;
            font-size:10px;padding:1px 5px;color:#F2EFE6}
</style></head><body>
<main>
  <h1>Product Tree</h1>
  <p class="sub">Shelf › Category › Subcategory. The photograph on the left is what that node leads with —
     shelf photos are on the homepage tiles today, the rest are stored ready for the pages that will use them.</p>
  <div class="stats">
    ${stat("SKUs listed", totals.listed, "everything ever offered")}
    ${stat("In stock", totals.inStock, "available and orderable")}
    ${stat("ASP", totals.asp == null ? "—" : "€" + totals.asp, "average selling price")}
    ${stat("With favourites", totals.withFav, "hearted at least once")}
    ${stat("Sold", totals.sold, "archived pieces")}
  </div>
  <table>
    <thead><tr><th></th><th>Node</th><th style="text-align:right">Listed</th><th style="text-align:right">In stock</th>
      <th style="text-align:right">ASP</th><th style="text-align:right">Fav</th><th style="text-align:right">Sold</th><th></th></tr></thead>
    <tbody>${rootRow}${rows.join("")}</tbody>
  </table>
</main>
<dialog id="picker"><div class="dhead"><h2 id="ptitle"></h2><button id="pclose" type="button">Close</button></div>
  <div class="grid" id="pgrid"></div></dialog>
<script src="/assets/tree.js"></script>
</body></html>`;
}

// The photographs offerable for one node: every piece filed under it that has a picture.
// Available first and most-favourited first within that, so the likely choice is on the
// first row and nobody scrolls 488 thumbnails to find it.
function nodePhotos(nodePath) {
  const { tree, totals } = buildTree(ROOT);
  const node =
    nodePath === "__wardrobe__" ? { items: totals.items } : flatten(tree).find((n) => n.path === nodePath);
  if (!node) return null;
  return node.items
    .filter((i) => i.photo)
    .sort((a, b) => {
      const buyable = (x) => (!x.sold && x.inStock !== false ? 0 : 1);
      return buyable(a) - buyable(b) || (b.favourites || 0) - (a.favourites || 0);
    })
    .slice(0, 400) // a node with 488 pieces does not need every one in a dialog
    .map((i) => ({
      id: String(i.id),
      title: i.title,
      photo: i.photo,
      thumb: thumb(i.photo),
      favourites: i.favourites || 0,
      sold: !!i.sold,
    }));
}

/* -------------------------------------------------------------------- server ---- */

const json = (res, body, code = 200) => {
  const text = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
};

const body = (req) =>
  new Promise((ok, bad) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 4e6) return bad(new Error("body too large"));
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        bad(e);
      }
    });
  });

const server = createServer(async (req, res) => {
  if (!ALLOWED_HOSTS.has(req.headers.host || "")) return json(res, { error: "bad host" }, 403);
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  try {
    const page = req.method === "GET" ? PAGES[url.pathname] : null;
    if (page) {
      if (page.file === "inventory.html") await freshInventory();
      const file = path.join(ROOT, page.file);
      if (!existsSync(file)) {
        return json(res, { error: `${page.file} has not been generated yet — run node scripts/build-inventory.mjs` }, 503);
      }
      const dark = page.file === "inventory.html";
      const html = readFileSync(file, "utf8")
        .replace(/<body([^>]*)>/, `<body$1>${tabBar(page.tab, dark)}${publishBanner(dark)}`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(html);
    }

    // The Product Tree page. Rendered in full here rather than read from a file: it has no
    // off-disk life the way inventory.html deliberately does, and a generated page cannot
    // drift from the data it describes.
    if (req.method === "GET" && url.pathname === "/tree") {
      const html = treePage().replace(/<body([^>]*)>/, `<body$1>${tabBar("tree", true)}${publishBanner(true)}`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(html);
    }

    // Thumbnails for that page. The dashboard serves no static files at all otherwise, so
    // this is deliberately the narrowest possible door: one directory, and a filename that
    // must be a plain basename — no slashes, no dots leading anywhere. images/derived is
    // already public on the live site, so nothing here is newly exposed.
    if (req.method === "GET" && url.pathname.startsWith("/img/")) {
      const name = url.pathname.slice(5);
      if (!/^[A-Za-z0-9._-]+\.(webp|jpg|jpeg|png)$/.test(name) || name.includes("..")) {
        return json(res, { error: "bad image name" }, 400);
      }
      const file = path.join(ROOT, "images/derived", name);
      const alt = path.join(ROOT, "images", name);
      const found = existsSync(file) ? file : existsSync(alt) ? alt : null;
      if (!found) return json(res, { error: "not found" }, 404);
      const type = name.endsWith(".webp") ? "image/webp" : name.endsWith(".png") ? "image/png" : "image/jpeg";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "max-age=300" });
      return res.end(readFileSync(found));
    }

    // The page's own script. Same narrow door as the images: one named file, served from
    // scripts/, because a <script> tag beats inlining 60 lines into the generated HTML where
    // no editor would ever format it.
    if (req.method === "GET" && url.pathname === "/assets/tree.js") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(readFileSync(path.join(ROOT, "scripts/tree-page.js")));
    }

    if (req.method === "GET" && url.pathname === "/api/tree/photos") {
      const photos = nodePhotos(url.searchParams.get("path") || "");
      if (!photos) return json(res, { error: "unknown node" }, 404);
      return json(res, { photos });
    }

    // Save a choice. `by: "you"` is the whole point of the field: pick-featured.mjs fills
    // empty nodes on every run and must never overwrite a decision made here.
    if (req.method === "POST" && url.pathname === "/api/featured") {
      const { path: nodePath, itemId } = await body(req);
      const photos = nodePhotos(nodePath || "");
      if (!photos) return json(res, { error: "unknown node" }, 400);
      const chosen = photos.find((p) => p.id === String(itemId));
      if (!chosen) return json(res, { error: "that piece is not on this node" }, 400);
      const featured = readFeatured();
      featured[nodePath] = {
        photo: chosen.photo, itemId: chosen.id, title: chosen.title,
        favourites: chosen.favourites, by: "you", at: new Date().toISOString(),
      };
      writeFileSync(FEATURED(), JSON.stringify(featured, null, 2) + "\n");
      return json(res, { ok: true, thumb: chosen.thumb });
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const lang = url.searchParams.get("lang") || CODES[0];
      if (!LANGS[lang]) return json(res, { error: "unknown language" }, 400);
      return json(res, state(lang));
    }

    // The only write in the whole server. `edits` is { key: text }; an empty string deletes
    // the override, which is how you go back to the machine translation.
    if (req.method === "POST" && url.pathname === "/api/save") {
      const { lang, edits } = await body(req);
      if (!LANGS[lang]) return json(res, { error: "unknown language" }, 400);
      const sources = loadSources();
      const overrides = loadOverrides(lang);
      let saved = 0;
      let cleared = 0;
      for (const [key, text] of Object.entries(edits || {})) {
        if (!sources[key]) continue; // a key that no longer exists on the site
        if (!String(text).trim()) {
          if (overrides[key]) cleared++;
          delete overrides[key];
          continue;
        }
        overrides[key] = {
          text: String(text),
          src: sources[key].src,
          // Kept so a future staleness prompt can show what you were reading at the time,
          // not just that something changed.
          wasEnglish: sources[key].text,
          ts: new Date().toISOString(),
        };
        saved++;
      }
      saveOverrides(lang, overrides);
      return json(res, { ok: true, saved, cleared, ...coverage(lang, sources) });
    }

    if (req.method === "POST" && url.pathname === "/api/publish") {
      const run = startPublish();
      return json(res, { ok: true, started: run.started });
    }

    if (req.method === "GET" && url.pathname === "/api/publish") {
      return json(res, publishing ? { started: publishing.started, code: publishing.code, out: publishing.out.slice(-200) } : { idle: true });
    }

    return json(res, { error: "not found" }, 404);
  } catch (err) {
    return json(res, { error: err.message }, 500);
  }
});

if (process.argv[2] === "--check") {
  // Offline: the state the page renders can be built from the files on disk right now.
  const s = state(CODES[0]);
  const assert = (c, m) => {
    if (!c) throw new Error("FAIL: " + m);
  };
  assert(s.languages.length === 7, "seven languages in state");
  assert(s.english.total > 0 && s.english.characters > 0, "English summary counted");
  assert(s.english.added + s.english.edited <= s.english.total, "churn cannot exceed the corpus");
  assert(Array.isArray(s.rows), "rows is an array");
  assert(Array.isArray(s.checklist) && s.checklist.length, "checklist is generated");
  assert(typeof s.inventory.live === "number", "inventory counted");
  assert(ALLOWED_HOSTS.size === 3 && !ALLOWED_HOSTS.has("evil.test"), "host allow-list is closed");
  assert(PAGES["/"].file === "inventory.html", "inventory is the landing page");
  assert(PAGES["/dashboard.html"].file === "dashboard.html", "the old bookmark still resolves");
  assert(tabBar("inventory", false).includes('aria-current="page"'), "the current tab is marked");
  assert(!tabBar("translations", true).includes("undefined"), "tab bar renders in the dark theme");
  console.log(`ok — ${s.rows.length} rows, ${s.inventory.live} live items, ${s.checklist.length} checklist entries`);
} else {
  server.listen(PORT, HOST, () => console.log(`dashboard → http://${HOST}:${PORT}`));
}
