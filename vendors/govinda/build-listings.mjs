// products-raw.json -> data/listings.csv, the file you review and edit.
//
// Everything here is derived and regenerable. Your decisions live in data/overrides.json,
// keyed by SKU, and are applied on top — so a weekly re-scrape never overwrites a price you
// set or copy you rewrote.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { translate } from "./deepl.mjs";

const RAW = "vendors/govinda/data/products-raw.json";
const CACHE = "vendors/govinda/data/translations.json";
const OUT = "vendors/govinda/data/listings.csv";

const MARKUP_PCT = 15;        // agreed with the vendor; they permit listing above retail
const DELIVERY = "5-10 business days, Europe";
const SHIPS_FROM = "govinda-prague";

const rate = JSON.parse(readFileSync("data/fxrate.json", "utf8"));
const raw = Object.values(JSON.parse(readFileSync(RAW, "utf8")));
const map = JSON.parse(readFileSync("vendors/govinda/data/category-map.json", "utf8"));
const overrides = existsSync("vendors/govinda/data/overrides.json")
  ? JSON.parse(readFileSync("vendors/govinda/data/overrides.json", "utf8")) : {};

// Translations are cached per source string, not per SKU: the same phrase recurs across
// hundreds of products, and DeepL bills per character. This is what keeps the weekly run
// inside a free-tier allowance once the first pass is paid for.
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

const need = [...new Set(raw.flatMap((p) => [p.titleCs, p.descriptionCs]).filter((t) => t && !(t in cache)))];
if (need.length) {
  console.error(`translating ${need.length} strings, ${need.join("").length} characters`);
  // DeepL caps a request at 50 texts.
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50);
    const done = await translate(chunk);
    chunk.forEach((t, n) => (cache[t] = done[n]));
    writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  }
}

const en = (t) => (t ? cache[t] ?? t : "");

// Book titles are NOT translated. They are the names of specific editions, and machine
// translation turns them into ordinary words — "Návraty" came back as "Returns" when the
// book is Prabhupada's "Coming Back". The original text is what a buyer searching for that
// edition will type. Descriptions are still translated; only the title is left alone.
const title = (p, shelf) => (shelf === "Books" ? p.titleCs : en(p.titleCs));
const eur = (czk) => Math.round(czk / rate.czkPerEur);

const COLS = [
  "sku", "list", "shelf", "subcategory", "title", "description", "brand",
  "price_czk_vendor", "price_eur_vendor", "markup_pct", "price_eur",
  "availability", "ships_from", "delivery", "images", "translated", "url",
];

const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = raw.map((p) => {
  const o = overrides[p.sku] || {};
  const cat = map[p.categoryId] || {};
  const markup = o.markup_pct ?? MARKUP_PCT;
  const vendorEur = eur(p.priceCzk);
  const shelf = o.shelf ?? cat.shelf ?? "Others";
  const inStock = p.availability === "InStock";
  return [
    p.sku,
    // In stock at Govinda means live here. An item they have pulled is not something we
    // can sell, so it goes out of the shop on the same signal, without waiting for a human.
    o.list ?? (inStock ? "yes" : "no"),
    shelf,
    o.subcategory ?? cat.sub ?? "",
    o.title ?? title(p, shelf),
    o.description ?? en(p.descriptionCs),
    p.brand,
    p.priceCzk,
    vendorEur,
    markup,
    o.price_eur ?? Math.round((p.priceCzk * (1 + markup / 100)) / rate.czkPerEur),
    inStock ? "in stock" : "out of stock",
    o.ships_from ?? SHIPS_FROM,
    o.delivery ?? DELIVERY,
    p.images.join(" | "),
    o.title || o.description ? "edited" : shelf === "Books" ? "machine (title original)" : "machine",
    p.url,
  ].map(cell).join(",");
});

writeFileSync(OUT, "﻿" + [COLS.join(","), ...rows].join("\n") + "\n");
console.error(`wrote ${OUT}: ${rows.length} rows, rate ${rate.czkPerEur} CZK/EUR (${rate.fetched})`);
