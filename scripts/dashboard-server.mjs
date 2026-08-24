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
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
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
    tab("/inventory", "Inventory", "inventory") +
    tab("/translations", "Translations", "translations") +
    `</nav>`
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
      const html = readFileSync(file, "utf8").replace(/<body([^>]*)>/, `<body$1>${tabBar(page.tab, dark)}`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(html);
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
