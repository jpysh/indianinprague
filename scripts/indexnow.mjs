#!/usr/bin/env node
// Push the site's URLs to IndexNow.
//
// Why this rather than "resubmitting the sitemap": Google retired its sitemap ping
// endpoint in 2023 and Bing followed, so there is no longer any way to *push* a sitemap
// to Google — that is Search Console only, and Search Console needs the owner's login.
// IndexNow is the one push mechanism still operating, and one submission fans out to
// every participant.
//
// The participant that matters most here is Seznam.cz. It is the Czech search engine, it
// takes a meaningful share of Czech-language queries, and this site is explicitly
// targeting Czech searches ("indické oblečení Praha", "indická restaurace Praha"). Bing
// and Yandex come along for free — and Bing's index is what ChatGPT search reads, so this
// is also the fastest route into AI answers.
//
// Usage:
//   node scripts/indexnow.mjs          # submit every URL in sitemap.xml
//   node scripts/indexnow.mjs --dry    # print what would be sent, send nothing

import { readFile, readdir } from "node:fs/promises";

const HOST = "indianinprague.jains.es";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
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

const res = await fetch("https://api.indexnow.org/IndexNow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${keyFile}`, urlList }),
});

const body = await res.text();
// 200 = accepted, 202 = accepted but key still being validated. Both are successes.
if (res.status === 200 || res.status === 202) {
  console.log(`submitted: HTTP ${res.status}${res.status === 202 ? " (key pending validation)" : ""}`);
} else {
  console.error(`submission failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  process.exit(1);
}
