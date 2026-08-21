import { readFileSync, writeFileSync } from "node:fs";
const cats = JSON.parse(readFileSync("vendors/govinda/data/categories-en.json", "utf8"));

// Govinda top level -> this site's shelf. Their "Fashion" splits three ways, which is the
// only branch that needs looking at per-child rather than wholesale.
const map = {};
for (const c of cats) {
  const p = c.pathEn.map((x) => x.name);
  if (!p.length || /^0\d/.test(p[0])) continue; // the two junk categories
  let shelf, sub;
  switch (p[0]) {
    case "Fashion":
      if (p[1] === "Jewellery") { shelf = "Jewellery"; sub = p[2]; }
      else if (p[1] === "Handbags") { shelf = "Fashion"; sub = "Bags"; }
      else { shelf = "Fashion"; sub = p[1]; }
      break;
    case "Meditation": shelf = "Meditation"; sub = p[1]; break;
    case "Books": shelf = "Books"; sub = p[1]; break;
    case "Home": shelf = "Home Decor"; sub = p[1]; break;
    case "Gift items": shelf = "Gifts"; sub = p[1]; break;
    case "Cosmetics": shelf = "Wellness"; sub = p[1]; break;
    case "Food and supplements": shelf = "Food"; sub = p[1]; break;
    default: shelf = "Uncategorised";
  }
  map[c.id] = { vendorPath: p.join(" > "), shelf, sub: sub || null };
}
writeFileSync("vendors/govinda/data/category-map.json", JSON.stringify(map, null, 2));

const shelves = {};
for (const v of Object.values(map)) {
  shelves[v.shelf] = shelves[v.shelf] || new Set();
  if (v.sub) shelves[v.shelf].add(v.sub);
}
for (const [s, subs] of Object.entries(shelves)) console.log(s + ":", [...subs].join(", "));
