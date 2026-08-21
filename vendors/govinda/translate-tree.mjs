// Translate the scraped Govinda category names into British English, once, into
// data/categories-en.json. Cheap — 138 short strings, a fraction of one key's allowance.
import { readFileSync, writeFileSync } from "node:fs";
import { translate } from "./deepl.mjs";

const cats = JSON.parse(readFileSync("vendors/govinda/data/categories.json", "utf8"));

// One request for the whole vocabulary, not one per category: the same node name appears
// at several points in the tree and DeepL is billed per character.
const names = [...new Set(cats.flatMap((c) => c.path.map((p) => p.name)))];
console.error(`${names.length} distinct names, ${names.join("").length} characters`);

const en = await translate(names);
const map = Object.fromEntries(names.map((n, i) => [n, en[i]]));

const out = cats.map((c) => ({
  ...c,
  pathEn: c.path.map((p) => ({ ...p, name: map[p.name] })),
}));
writeFileSync("vendors/govinda/data/categories-en.json", JSON.stringify(out, null, 2));
writeFileSync("vendors/govinda/data/category-names.json", JSON.stringify(map, null, 2));
console.error("wrote categories-en.json");
