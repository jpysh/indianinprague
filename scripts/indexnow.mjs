#!/usr/bin/env node
// Push the site's URLs to IndexNow.
//
// Why this rather than "resubmitting the sitemap": Google retired its sitemap ping
// endpoint in 2023 and Bing followed, so there is no longer any way to *push* a sitemap
// to Google — that is Search Console only, and Search Console needs the owner's login.
// IndexNow is the one push mechanism still operating, and one submission fans out to
// every participant.
//
// Bing matters most in principle, because Bing's index is what ChatGPT search reads, which
// makes this the fastest route into AI answers. Seznam matters most in practice right now,
// because it is the one participant that accepts this host today (see the note above
// ENDPOINTS) and it is the Czech search engine, in the city the shop ships from. Yandex
// comes along for free.
//
// Usage:
//   node scripts/indexnow.mjs          # submit the URLs whose bytes changed
//   node scripts/indexnow.mjs --all    # submit every URL in sitemap.xml
//   node scripts/indexnow.mjs --dry    # print what would be sent, send nothing
//
// CHANGED URLS ONLY (added 24 Aug 2026, with the language trees)
// --------------------------------------------------------------
// This used to submit every URL in the sitemap on every run. At 94 URLs that was merely
// wasteful; at 741 — the same site in eight languages — it is a daily announcement that 741
// pages changed, when on most days about three did. Participants rate-limit and, eventually,
// stop believing a host that cries wolf, and this site is on Seznam's good side by a thread
// already (see ENDPOINTS below).
//
// So each run hashes the bytes actually staged in dist/ and submits only what differs from
// the last accepted submission. The state is data/indexnow-state.json, and deleting it is
// how you force a full resubmission — as is --all.
//
// The cap is not about the protocol (10,000 URLs per request are allowed) but about the
// first run after a change like this one, where everything looks new at once. Whatever does
// not fit is simply left unhashed and goes out tomorrow.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const HOST = "indianinprague.jains.es";
// path.resolve(import.meta.dirname, ...), matching every other script here. It used to be
// `new URL("..", import.meta.url).pathname`, which is a URL pathname: percent-ENCODED. A repo
// checked out to a directory with a space in it resolves to ".../my%20repo" and every read
// fails. Same family of bug as the absolute path that was hardcoded in build-jsonld.mjs until
// 17 Aug 2026 and broke the Cloudflare build — resolve from the module, always.
const ROOT = path.resolve(import.meta.dirname, "..");
const DRY = process.argv.includes("--dry");
const ALL = process.argv.includes("--all");

// How many URLs one run may announce. Small enough to look like a site publishing its
// changes, large enough that a full eight-language rebuild drains in a few days.
const CAP = 200;
const STATE = path.join(ROOT, "data/indexnow-state.json");

// The key is proved by hosting <key>.txt at the site root containing the key itself;
// that is what authorises submissions for this host. Discovered rather than hardcoded so
// rotating it is just a matter of replacing the file.
const keyFile = (await readdir(ROOT)).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) {
  console.error("No IndexNow key file found in the project root (expected <32-hex>.txt).");
  process.exit(1);
}
const key = keyFile.replace(/\.txt$/, "");

const sitemap = await readFile(`${ROOT}/sitemap.xml`, "utf8");
const allUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

if (allUrls.length === 0) {
  console.error("sitemap.xml contained no <loc> entries — run build-sitemap.mjs first.");
  process.exit(1);
}

// The file dist/ serves for a URL. dist/ rather than the repo root because dist/ is what was
// actually uploaded — the point of the hash is "did the bytes a visitor receives change",
// and build-dist.mjs is the only thing that decides what those bytes are.
function fileFor(url) {
  const p = new URL(url).pathname.replace(/\/$/, "");
  for (const candidate of [`${p}.html`, `${p}/index.html`, p || "/index.html"]) {
    const abs = path.join(ROOT, "dist", candidate);
    if (candidate && existsSync(abs) && !abs.endsWith("/")) return abs;
  }
  return null;
}

const hashOf = (file) => createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16);

const previous = existsSync(STATE) ? JSON.parse(await readFile(STATE, "utf8")).urls || {} : {};
const current = {};
let unresolved = 0;
for (const url of allUrls) {
  const file = fileFor(url);
  if (!file) {
    // In the sitemap but not in dist/. Worth submitting rather than swallowing: it means
    // the two disagree, and a crawler asking for it is how that surfaces.
    unresolved++;
    current[url] = "unknown-" + Date.now();
    continue;
  }
  current[url] = hashOf(file);
}

const changed = allUrls.filter((u) => previous[u] !== current[u]);
const urlList = (ALL ? allUrls : changed).slice(0, CAP);

if (!urlList.length) {
  console.log(`nothing changed since the last submission (${allUrls.length} URLs checked) — nothing to announce`);
  process.exit(0);
}

console.log(`host      ${HOST}`);
console.log(`key       ${key}`);
console.log(`keyfile   https://${HOST}/${keyFile}`);
console.log(`urls      ${urlList.length} of ${allUrls.length}` +
  (ALL ? " (--all)" : ` changed${changed.length > CAP ? `, ${changed.length - CAP} held for the next run` : ""}`) +
  (unresolved ? `, ${unresolved} not found in dist/` : ""));
urlList.forEach((u) => console.log(`  ${u}`));

if (DRY) {
  console.log("\n--dry: nothing submitted.");
  process.exit(0);
}

// Sanity check before announcing anything: if the key file is not actually reachable,
// every participant will reject the submission, and it is better to say so here than to
// report a success that silently did nothing.
const probe = await fetch(`https://${HOST}/${keyFile}`);
const probeBody = (await probe.text()).trim();
if (!probe.ok || probeBody !== key) {
  console.error(
    `\nKey file is not serving correctly (HTTP ${probe.status}, body "${probeBody.slice(0, 40)}").`,
  );
  console.error("Deploy first: docker compose up -d --build");
  process.exit(1);
}
console.log("\nkey file verified");

// Submitted to each participant SEPARATELY rather than to api.indexnow.org.
//
// The spec says one submission to api.indexnow.org fans out to every participant, and that
// is true — but api.indexnow.org IS Bing, and when Bing refuses the host it answers 403
// before any fan-out happens. Measured 22 Aug 2026, same payload, same key:
//
//   api.indexnow.org   403 UserForbiddedToAccessSite
//   www.bing.com       403 UserForbiddedToAccessSite   <- the same refusal, unsurprisingly
//   search.seznam.cz   200
//   yandex.com         202 {"success":true}
//
// So Bing's own opinion of this host was silently deciding whether Seznam heard anything,
// and Seznam is the participant that matters most here. Fanning out locally costs two extra
// HTTPS requests and removes that coupling entirely.
const ENDPOINTS = [
  ["Bing", "https://www.bing.com/indexnow"],
  ["Seznam", "https://search.seznam.cz/indexnow"],
  ["Yandex", "https://yandex.com/indexnow"],
];

const payload = JSON.stringify({
  host: HOST,
  key,
  keyLocation: `https://${HOST}/${keyFile}`,
  urlList,
});

console.log("");
const results = await Promise.all(
  ENDPOINTS.map(async ([name, endpoint]) => {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: payload,
      });
      const body = (await res.text()).trim();
      // 200 = accepted, 202 = accepted but the key is still being validated. Both are wins.
      const ok = res.status === 200 || res.status === 202;
      console.log(
        `${name.padEnd(7)} ${ok ? "ok" : "FAILED"}  HTTP ${res.status}` +
          (body && !ok ? `  ${body.slice(0, 160)}` : ""),
      );
      return ok;
    } catch (err) {
      // A network failure to one participant is not a reason to hide the others.
      console.log(`${name.padEnd(7)} FAILED  ${err.message}`);
      return false;
    }
  }),
);

// Non-zero only when NOBODY accepted. One participant refusing this host must not read as a
// failed publish — publish.sh steps over this either way now, but the exit code is also what
// a human reads when they run it by hand.
if (!results.some(Boolean)) {
  console.error("\nno participant accepted the submission");
  process.exit(1);
}

// Record ONLY what was actually submitted and accepted. A URL held back by the cap, or one
// in a run that nobody accepted, keeps its old hash and goes out again next time — which is
// what makes the cap a queue rather than a way to silently drop pages.
const saved = { ...previous };
for (const url of urlList) saved[url] = current[url];
// Drop URLs that have left the sitemap, or the file grows forever with pages that no longer
// exist and every one of them counts as "unchanged" against a page that may come back.
for (const url of Object.keys(saved)) if (!(url in current)) delete saved[url];
await writeFile(
  STATE,
  JSON.stringify(
    {
      _comment: "Written by scripts/indexnow.mjs: the content hash of each URL at its last accepted submission. Derived — delete to force a full resubmission.",
      submitted: new Date().toISOString(),
      urls: saved,
    },
    null,
    2,
  ) + "\n",
);
console.log(`\nstate recorded for ${urlList.length} URL${urlList.length === 1 ? "" : "s"}`);
