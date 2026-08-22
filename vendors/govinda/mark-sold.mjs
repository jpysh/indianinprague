// Mark Govinda items sold, or clear the mark.
//
//   node vendors/govinda/mark-sold.mjs 1473 1512      # sold today
//   node vendors/govinda/mark-sold.mjs --clear 1473   # back on sale
//
// Writes data/overrides.json, which is the only file in this vendor's directory that is
// not disposable: the scrape and the CSV are rewritten wholesale every week, and anything
// hand-set has to live somewhere the rewrite cannot reach.
//
// Sold is a fact only you have. Govinda's stock level says whether THEY have one; it can
// never say whether you have promised one to somebody. That is why a restock does not clear
// this and why the weekly sync never writes it.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FILE = "vendors/govinda/data/overrides.json";
const args = process.argv.slice(2);
const clear = args.includes("--clear");
const skus = args.filter((a) => /^\d+$/.test(a));

if (!skus.length) {
  console.error("usage: node vendors/govinda/mark-sold.mjs [--clear] <sku> [sku...]");
  process.exit(2);
}

const overrides = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const today = new Date().toISOString().slice(0, 10);

for (const sku of skus) {
  overrides[sku] ||= {};
  if (clear) {
    delete overrides[sku].sold;
    if (!Object.keys(overrides[sku]).length) delete overrides[sku];
  } else {
    // Dated, not just flagged: "sold" with no date cannot be sorted, cannot age out of a
    // recent-sales view, and cannot answer "when did that go".
    overrides[sku].sold = today;
  }
}

writeFileSync(FILE, JSON.stringify(overrides, null, 2) + "\n");
console.log(`${clear ? "cleared" : "marked sold"}: ${skus.join(", ")}`);
console.log("run ./scripts/publish.sh to put it live, or leave it for the nightly job");
