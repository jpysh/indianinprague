// Vendor listings -> the item shape build-shop.mjs already renders.
//
// Kept OUT of data/catalog.json deliberately. That file is regenerated wholesale by
// sync-vinted.mjs, so anything merged into it is destroyed on the next sync. The two
// vendors stay separate all the way to the page, and only the grid sees them together.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const CSV = "vendors/govinda/data/listings.csv";
const OVERRIDES = "vendors/govinda/data/overrides.json";

// Enough CSV for a file this pipeline writes itself: quoted fields with embedded commas
// and doubled quotes, which is all build-listings.mjs ever emits.
//
// Exported because build-listings.mjs reads its own previous output now, to carry retired
// rows forward. One parser, so the reader and the writer cannot disagree about quoting.
export function rows(text) {
  const out = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

export function vendorItems(root) {
  const file = path.join(root, CSV);
  if (!existsSync(file)) return [];
  // Your decisions, keyed by SKU. sold is the one the vendor cannot tell us: their stock
  // level says whether THEY have it, never whether we have promised it to someone.
  const ovFile = path.join(root, OVERRIDES);
  const overrides = existsSync(ovFile) ? JSON.parse(readFileSync(ovFile, "utf8")) : {};
  const [head, ...body] = rows(readFileSync(file, "utf8").replace(/^﻿/, ""));
  const col = Object.fromEntries(head.map((h, i) => [h, i]));

  return body
    .filter((r) => r.length > 1 && r[col.list] === "yes")
    .map((r) => {
      const sku = r[col.sku];
      const photos = r[col.images]
        .split(" | ")
        .filter(Boolean)
        .map((_, n) => `images/govinda-${sku}-${n + 1}.jpg`);
      const o = overrides[sku] || {};
      return {
        id: `govinda-${sku}`,
        vendor: "Govinda",
        title: r[col.title],
        description: r[col.description],
        // Priced in euro only: this is retail stock, not a koruna listing converted for
        // display, and the CZK figure is the vendor's, not ours. data-price wants a number
        // for the range filter, so it carries the euro figure.
        // Number(x) || null turns a legitimate 0 into null, and card() renders a null
        // price as the word "Sold" — the convention borrowed from Vinted, where a sold
        // listing has its price stripped. Eighteen free e-books were therefore advertised
        // as sold. A blank cell is unknown; a zero is a price.
        priceEur: r[col.price_eur] === "" ? null : Number(r[col.price_eur]),
        priceCzk: r[col.price_eur] === "" ? null : Number(r[col.price_eur]),
        brand: r[col.brand],
        category: r[col.shelf],
        subcategory: r[col.subcategory],
        // New retail stock. It maps onto the existing condition filter rather than adding
        // a parallel control — "New with tags" is the value the closet already uses.
        condition: { en: "New with tags" },
        color: { en: "" },
        size: "", sizeGroup: "",
        favourites: 0,
        reserved: false,
        // A manual mark, and it outranks the vendor's stock level in one direction only:
        // restocking does not un-sell something we have already promised. Clearing it is a
        // decision, not a side effect of a sync.
        sold: !!o.sold,
        soldAt: o.sold || "",
        inStock: r[col.availability] === "in stock",
        // Govinda no longer sells it at all, as opposed to being temporarily out of stock.
        // The card cannot tell the difference and should not — both mean "not today" — but
        // the inventory dashboard can.
        retired: r[col.retired] === "yes",
        delivery: r[col.delivery],
        photo: photos[0] || null,
        photos,
      };
    });
}
