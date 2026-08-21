// Vendor listings -> the item shape build-shop.mjs already renders.
//
// Kept OUT of data/catalog.json deliberately. That file is regenerated wholesale by
// sync-vinted.mjs, so anything merged into it is destroyed on the next sync. The two
// vendors stay separate all the way to the page, and only the grid sees them together.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const CSV = "vendors/govinda/data/listings.csv";

// Enough CSV for a file this pipeline writes itself: quoted fields with embedded commas
// and doubled quotes, which is all build-listings.mjs ever emits.
function rows(text) {
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
      return {
        id: `govinda-${sku}`,
        vendor: "Govinda",
        title: r[col.title],
        description: r[col.description],
        // Priced in euro only: this is retail stock, not a koruna listing converted for
        // display, and the CZK figure is the vendor's, not ours. data-price wants a number
        // for the range filter, so it carries the euro figure.
        priceEur: Number(r[col.price_eur]) || null,
        priceCzk: Number(r[col.price_eur]) || null,
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
        sold: false,
        inStock: r[col.availability] === "in stock",
        delivery: r[col.delivery],
        photo: photos[0] || null,
        photos,
      };
    });
}
