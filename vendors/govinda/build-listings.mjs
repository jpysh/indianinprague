// products-raw.json -> data/listings.csv, the file you review and edit.
//
// Everything here is derived and regenerable. Your decisions live in data/overrides.json,
// keyed by SKU, and are applied on top — so a weekly re-scrape never overwrites a price you
// set or copy you rewrote.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { translate } from "./deepl.mjs";
import { rows as parseCsv } from "../../scripts/vendor-items.mjs";

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
// Whole euros read cleanly and are what the closet has always shown — but this catalogue
// reaches down to 10 CZK, where rounding to the nearest euro turns a 41-cent bracelet into
// "€0" and a 74-item band between 50c and €1.49 all into "€1". Under €2 the cents are the
// price; above it they are noise.
const eur = (czk) => {
  const exact = czk / rate.czkPerEur;
  return exact < 2 ? Math.round(exact * 100) / 100 : Math.round(exact);
};

const COLS = [
  "sku", "list", "shelf", "subcategory", "title", "description", "brand",
  "price_czk_vendor", "price_eur_vendor", "markup_pct", "price_eur",
  "availability", "ships_from", "delivery", "images", "translated", "url",
  // "yes" once Govinda has stopped selling the product altogether. Invisible to a shopper —
  // the card just says out of stock — but the dashboard needs the difference: something they
  // have merely run out of will come back, something they no longer sell is a candidate for
  // you to drop.
  "retired",
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
    // In stock at Govinda means live here — including items they have run out of, which
    // are published as out of stock rather than hidden, so a shopper sees the range rather
    // than a shelf that quietly shrinks.
    //
    // Two things are never listed, on separate grounds:
    //   E-books   — free downloads. There is no margin on one, no fulfilment, and no reason
    //               for a buyer to come through us rather than to Govinda directly.
    //   €0        — the safety net for a free item filed anywhere else. One bracelet is
    //               priced at nothing, which is either an error at Govinda or a thing we
    //               would never want auto-listed at 15% of zero.
    o.list ?? (cat.sub === "E-books" || !Number(p.priceCzk) ? "no" : "yes"),
    shelf,
    o.subcategory ?? cat.sub ?? "",
    o.title ?? title(p, shelf),
    o.description ?? en(p.descriptionCs),
    p.brand,
    p.priceCzk,
    vendorEur,
    markup,
    o.price_eur ?? eur(p.priceCzk * (1 + markup / 100)),
    inStock ? "in stock" : "out of stock",
    o.ships_from ?? SHIPS_FROM,
    o.delivery ?? DELIVERY,
    p.images.join(" | "),
    o.title || o.description ? "edited" : shelf === "Books" ? "machine (title original)" : "machine",
    p.url,
    "",
  ].map(cell).join(",");
});

/* --------------------------------------------------------------- retired rows ---- */

// Nothing is ever removed from this file.
//
// Out of stock has never removed anything — that is the `availability` column above, and 107
// items are currently published as out of stock rather than hidden, deliberately, so the
// shelf does not quietly shrink. But there was a second case with no handling at all: when
// Govinda deletes a product from their catalogue, the scrape stops returning it, no row gets
// written, and it disappears from the site. It was reported in changes.json and shown on the
// dashboard, but the item was already gone before anyone read that.
//
// So the previous file is read back and any SKU missing from this scrape is written out
// again, exactly as it was, with two edits: availability forced to out of stock, and retired
// set. Every other field survives untouched — description, shelf, images, URL — because the
// row is the only place they exist; snapshot.json keeps just the title, price and stock. The
// photographs are safe on their own: nothing in the pipeline prunes vendors/govinda/images.
//
// A retired row is carried forward again on every subsequent run, and only ever leaves by
// hand or by `"list": "no"` in data/overrides.json. There is no automatic expiry: this file
// is small, each disappearance is already a thing a person reviews, and a rule with a number
// in it deletes something you wanted on a morning you were not watching.
//
// If Govinda relists the SKU, the fresh scrape wins and the row is rebuilt from live data
// with retired empty again — nothing to undo.
const live = new Set(raw.map((p) => String(p.sku)));
const retired = [];
if (existsSync(OUT)) {
  const [head, ...body] = parseCsv(readFileSync(OUT, "utf8").replace(/^\ufeff/, ""));
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  for (const r of body) {
    if (r.length < 2 || live.has(String(r[col.sku]))) continue;
    // Written against the CURRENT column list, not the old one, so adding a column later
    // cannot shift a carried row's fields out of alignment.
    const row = COLS.map((c) => (col[c] === undefined ? "" : r[col[c]] ?? ""));
    row[COLS.indexOf("availability")] = "out of stock";
    row[COLS.indexOf("retired")] = "yes";
    retired.push(row.map(cell).join(","));
  }
}

writeFileSync(OUT, "﻿" + [COLS.join(","), ...rows, ...retired].join("\n") + "\n");
if (retired.length) console.error(`carried ${retired.length} retired row(s) forward`);

/* ------------------------------------------------------------------ what changed ---- */

// What moved since the last run, written for the dashboard to read.
//
// The sync has both states in hand at exactly this moment and has been throwing the old one
// away. Without it the weekly check is a scan of 1,483 rows looking for nothing in
// particular; with it, it is "11 new, 4 price changes, 6 gone" and a two-minute review.
//
// Snapshot rather than diffing the CSV: the CSV is a rendering, and comparing renderings
// would report a change every time a column was added or a rate moved.
const SNAP = "vendors/govinda/data/snapshot.json";
const CHANGES = "vendors/govinda/data/changes.json";

const now = Object.fromEntries(raw.map((p) => [p.sku, {
  title: en(p.titleCs),
  priceCzk: p.priceCzk,
  availability: p.availability,
}]));

const prev = existsSync(SNAP) ? JSON.parse(readFileSync(SNAP, "utf8")) : null;
const changes = { at: new Date().toISOString(), first: !prev, added: [], gone: [], price: [], stock: [] };

if (prev) {
  for (const [sku, p] of Object.entries(now)) {
    const was = prev[sku];
    if (!was) { changes.added.push({ sku, title: p.title }); continue; }
    if (was.priceCzk !== p.priceCzk) {
      changes.price.push({ sku, title: p.title, from: was.priceCzk, to: p.priceCzk });
    }
    if (was.availability !== p.availability) {
      changes.stock.push({ sku, title: p.title, from: was.availability, to: p.availability });
    }
  }
  // Gone from their catalogue entirely — not merely out of stock, which is the `stock`
  // list above. This is the one that needs a person: an item we may have promised, that
  // the vendor no longer sells at all.
  for (const sku of Object.keys(prev)) if (!now[sku]) changes.gone.push({ sku, title: prev[sku].title });
}

writeFileSync(CHANGES, JSON.stringify(changes, null, 2) + "\n");
writeFileSync(SNAP, JSON.stringify(now, null, 2) + "\n");
console.error(
  prev
    ? `changes: ${changes.added.length} new, ${changes.price.length} price, ${changes.stock.length} stock, ${changes.gone.length} gone`
    : "changes: first snapshot, nothing to compare",
);
console.error(`wrote ${OUT}: ${rows.length} rows, rate ${rate.czkPerEur} CZK/EUR (${rate.fetched})`);
