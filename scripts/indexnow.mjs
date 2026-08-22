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
//   node scripts/indexnow.mjs          # submit every URL in sitemap.xml
//   node scripts/indexnow.mjs --dry    # print what would be sent, send nothing

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const HOST = "indianinprague.jains.es";
// path.resolve(import.meta.dirname, ...), matching every other script here. It used to be
// `new URL("..", import.meta.url).pathname`, which is a URL pathname: percent-ENCODED. A repo
// checked out to a directory with a space in it resolves to ".../my%20repo" and every read
// fails. Same family of bug as the absolute path that was hardcoded in build-jsonld.mjs until
// 17 Aug 2026 and broke the Cloudflare build — resolve from the module, always.
const ROOT = path.resolve(import.meta.dirname, "..");
const DRY = process.argv.includes("--dry");

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
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

if (urlList.length === 0) {
  console.error("sitemap.xml contained no <loc> entries — run build-sitemap.mjs first.");
  process.exit(1);
}

console.log(`host      ${HOST}`);
console.log(`key       ${key}`);
console.log(`keyfile   https://${HOST}/${keyFile}`);
console.log(`urls      ${urlList.length}`);
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
