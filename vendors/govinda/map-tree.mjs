// Map Govinda's category tree onto this site's shelves -> data/category-map.json.
import { readFileSync, writeFileSync } from "node:fs";

const cats = JSON.parse(readFileSync("vendors/govinda/data/categories-en.json", "utf8"));

// Their "Gift items" branch is not kept as a shelf: opened up, it is not gifting but
// devotional goods filed by object type. The statues are murtis (Damodar, Nrsimhadev), the
// stickers are Krishna and Durga, the pendants are tilak and kavaca. Each part goes where
// its contents belong, which is also what stops a "Gifts" shelf from becoming the place
// everything awkward falls into.
const GIFTS = {
  "Small statues": ["Meditation", "Deities"], // murtis — merges with the 5 already there
  "Stickers and posters": ["Meditation", "Stickers and posters"],
  Pendants: ["Jewellery", "Pendants"],
  Boxes: ["Home Decor", "Boxes"],
  "Key rings": ["Others", "Key rings"],
  "Greetings cards": ["Others", "Greetings cards"],
  Notebooks: ["Others", "Notebooks"],
  Badges: ["Others", "Badges"],
  "Children’s gifts and dolls": ["Others", "Dolls and children's gifts"],
  "Children's gifts and dolls": ["Others", "Dolls and children's gifts"],
};

const map = {};
for (const c of cats) {
  const p = c.pathEn.map((x) => x.name);
  if (!p.length || /^0\d/.test(p[0])) continue; // the two junk categories in their own data
  let shelf, sub;
  switch (p[0]) {
    case "Fashion":
      if (p[1] === "Jewellery") { shelf = "Jewellery"; sub = p[2]; }
      else if (p[1] === "Handbags") { shelf = "Fashion"; sub = "Bags"; }
      else { shelf = "Fashion"; sub = p[1]; }
      break;
    case "Meditation":
      shelf = "Meditation";
      // The "Japa bead bags" node itself holds bead counters, not bags — its children are
      // the actual bags. Only the items directly on the node move.
      sub = p.length === 2 && p[1] === "Japa bead bags" ? "Bead counters" : p[1];
      break;
    case "Books": shelf = "Books"; sub = p[1]; break;
    case "Home": shelf = "Home Decor"; sub = p[1]; break;
    case "Gift items": [shelf, sub] = GIFTS[p[1]] || ["Others", null]; break;
    case "Cosmetics": shelf = "Wellness"; sub = p[1]; break;
    case "Food and supplements": shelf = "Food"; sub = p[1]; break;
    default: shelf = "Others";
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
