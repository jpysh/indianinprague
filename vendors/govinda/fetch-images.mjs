// Download the photos for every list=yes product into vendors/govinda/images/.
//
// Only list=yes: fetching all ~2,400 photos for a catalogue where some products will never
// be listed is bandwidth spent on their server for nothing. Already-downloaded files are
// skipped, so the weekly run costs one request per genuinely new product.
//
// Originals are gitignored. scripts/build-images.mjs derives the 400/800 grid sizes that
// actually ship.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const UA = "IndianInPrague-reseller/1.0 (+https://guldaarbazaar.com; authorised reseller sync)";
const DELAY = 1000;
const DIR = "vendors/govinda/images";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(DIR, { recursive: true });

const csv = readFileSync("vendors/govinda/data/listings.csv", "utf8").replace(/^﻿/, "");
const [head, ...lines] = csv.trim().split("\n");
const cols = head.split(",");
const iList = cols.indexOf("list"), iSku = cols.indexOf("sku"), iImg = cols.indexOf("images");

// Minimal CSV reader — enough for the columns this file needs, which are never quoted.
const parseRow = (line) => {
  const out = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
};

let got = 0, skipped = 0, failed = 0;
for (const line of lines) {
  const r = parseRow(line);
  if (r[iList] !== "yes") continue;
  const urls = r[iImg].split(" | ").filter(Boolean);
  for (const [n, url] of urls.entries()) {
    const file = path.join(DIR, `govinda-${r[iSku]}-${n + 1}.jpg`);
    if (existsSync(file)) { skipped++; continue; }
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      got++;
    } catch (err) {
      console.error(`  ${url}: ${err.message}`);
      failed++;
    }
    await sleep(DELAY);
  }
}
console.error(`${got} downloaded, ${skipped} already present, ${failed} failed`);
