// The product tree: Shelf > Category > Subcategory, with the numbers for each node.
//
// One definition of the taxonomy, read by the admin dashboard (the Product Tree tab) and by
// pick-featured.mjs. It is DERIVED, never stored: catalog.json is rewritten wholesale by
// every sync, so a tree written to disk would be wrong by the next morning. The only thing
// that persists is data/featured.json, which keys a chosen photograph to a node path.
//
// WHY THREE LEVELS WHEN THE SITE RENDERS TWO
// ------------------------------------------
// The pages have shelves (/wardrobe/fashion) and one level below them
// (/wardrobe/fashion/womens-clothing). The vendor's own catalogue is three deep —
// "Fashion > Women's clothing > Saris" — and so is Vinted's — "Women > Clothing >
// Tops & t-shirts > Tunics". Both were being flattened on the way in.
//
// This module keeps the third level. NOTHING ABOUT THE SITE'S URLS CHANGES: level 1 and 2
// are exactly what build-shop.mjs already renders, and level 3 exists here, in the
// dashboard, and as a place to hang a featured image. Turning level 3 into pages is a
// separate decision with a sitemap and a redirect map attached to it.
//
//   import { buildTree } from "./tree.mjs";
//   const { tree, totals } = buildTree(ROOT);

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { vendorItems } from "./vendor-items.mjs";

const read = (root, rel, fallback) => {
  const p = path.join(root, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback;
};

/* ------------------------------------------------------------ vinted map ---- */

// Vinted's taxonomy is not ours and never will be: it is built for a marketplace selling
// everything, so an Indian cotton tunic arrives as "Women > Clothing > Tops & t-shirts >
// Tunics". The shelf is already decided elsewhere (taxonomy.json, then overrides.json); what
// is needed here is the two rungs below it, in the vocabulary the vendor side already uses,
// or the tree reads as two different shops bolted together.
//
// The rules below cover every crumb tail the closet actually contains — there are about
// twenty-five distinct ones across 141 items, not a long tail. Anything they miss falls
// through to `[last crumb, null]`, which is always defensible: it is what Vinted itself
// calls the thing, and it shows up in the dashboard where a wrong guess is visible and
// correctable rather than silently wrong.
const GENDER = { Women: "Women's clothing", Men: "Men's clothing", Kids: "Children's clothing", Children: "Children's clothing" };

const VINTED_RULES = {
  Fashion(c) {
    if (c.includes("Clothing")) return [GENDER[c[0]] || "Women's clothing", c[c.length - 1]];
    if (c.includes("Bags")) return ["Bags", c[c.length - 1]];
    if (c.some((x) => /Scarves|Shawls/i.test(x))) return ["Scarves", null];
    return [c[c.length - 1], null];
  },
  // Vinted's leaf here IS our category: "Accessories > Jewellery > Necklaces" and the
  // vendor's "Jewellery > Necklaces" agree on the word, which is the whole point of mapping
  // rather than passing Vinted's tree through.
  Jewellery(c) {
    const leaf = c[c.length - 1];
    const known = ["Necklaces", "Bracelets", "Earrings", "Pendants", "Bindi", "Anklets"];
    if (known.includes(leaf)) return [leaf, null];
    if (/pendant|charm/i.test(leaf)) return ["Pendants", leaf];
    return ["Other adornments", leaf];
  },
  // Everything on this shelf from Vinted is out of my own bookcase, which is exactly what
  // the vendor side calls "Second-hand books". Fiction/Non-fiction then has somewhere to be.
  Books: (c) => ["Second-hand books", c[c.length - 1]],
  "Home Decor"(c) {
    const leaf = c[c.length - 1];
    if (/bowl|plate|dinner|dish|serving|kitchen|table/i.test(leaf)) return ["Table and dining", leaf];
    if (/tapestr|textile|throw|cushion/i.test(leaf)) return ["Cushions and throws", leaf];
    if (/light|lamp/i.test(leaf)) return ["Decorative accessories", leaf];
    return ["Decorative accessories", leaf];
  },
  Wellness: (c) => ["Body care", c[c.length - 1]],
  // Spirituality is folded into the Meditation shelf by build-shop.mjs (see its CATEGORIES
  // block), so its items land here under Meditation's vocabulary.
  Meditation(c) {
    const leaf = c[c.length - 1];
    if (/ornament|figurine|sculpture|statue/i.test(leaf)) return ["Deities", leaf];
    if (/necklace|bead|mala/i.test(leaf)) return ["Kanthi malas", leaf];
    if (/scarf|scarves|shawl/i.test(leaf)) return ["Worship items", leaf];
    return ["Worship items", leaf];
  },
};

// Vinted items carry `crumbs` (objects with a name) and no subcategory of their own — the
// site has always filed them straight onto a shelf. This is the backfill.
function vintedPlace(item, shelf) {
  const c = (item.crumbs || []).map((x) => x.name).filter(Boolean);
  if (!c.length) return [null, null];
  const rule = VINTED_RULES[shelf];
  const [cat, sub] = rule ? rule(c) : [c[c.length - 1], null];
  // A category identical to its own subcategory is noise, not a level.
  return [cat, sub && sub !== cat ? sub : null];
}

/* ----------------------------------------------------------------- shelves ---- */

// The shelf an item sits on, in the same two-names-for-one-shelf way build-shop.mjs treats
// its CATEGORIES: "Spirituality" in the data is the Meditation shelf on the site, and
// "Uncategorised" is the More shelf. Kept deliberately small — build-shop owns the real
// list, and duplicating it here would be a second place to forget to edit.
const SHELF_ALIAS = { Spirituality: "Meditation", Others: "Uncategorised" };
const shelfOf = (item) => SHELF_ALIAS[item.category] || item.category || "Uncategorised";

/* -------------------------------------------------------------------- tree ---- */

// Metrics, in the order the dashboard prints them:
//   listed    every SKU on the node, live or sold — what has ever been offered here
//   inStock   available today and orderable (a vendor item out of stock at the supplier is
//             neither sold nor buyable, and counting it as stock would overstate the shelf)
//   asp       average selling price in EUR across the listed items that carry one
//   withFav   how many have been favourited at least once — the only outside signal here
//   sold      archived items
const blank = () => ({ listed: 0, inStock: 0, sumEur: 0, priced: 0, withFav: 0, sold: 0, items: [] });

function tally(node, item, { sold }) {
  node.listed++;
  if (sold) node.sold++;
  else if (item.inStock !== false) node.inStock++;
  if (item.priceEur != null) { node.sumEur += item.priceEur; node.priced++; }
  if ((item.favourites || 0) > 0) node.withFav++;
  node.items.push(item);
}

const finish = (node) => {
  node.asp = node.priced ? Math.round(node.sumEur / node.priced) : null;
  delete node.sumEur;
  delete node.priced;
  return node;
};

export function buildTree(root) {
  const live = read(root, "data/catalog.json", { items: [] }).items || [];
  const archived = read(root, "data/archive.json", { items: [] }).items || [];
  const vendor = vendorItems(root);

  const shelves = new Map();
  const totals = blank();

  const place = (item, sold) => {
    const shelf = shelfOf(item);
    // Vendor rows arrive with a real subcategory already (level 2). Their level 3 lives only
    // in the scraper's category-map, which is keyed by a vendor category id that the
    // committed listings.csv does not carry — so vendor nodes stop at two levels for now.
    // ponytail: level 3 for vendor items needs one extra CSV column from the next scrape.
    const [cat, sub] = item.vendor
      ? [item.subcategory || null, null]
      : vintedPlace(item, shelf);

    if (!shelves.has(shelf)) shelves.set(shelf, { name: shelf, path: shelf, ...blank(), children: new Map() });
    const s = shelves.get(shelf);
    tally(s, item, { sold });
    tally(totals, item, { sold });
    if (!cat) return;

    if (!s.children.has(cat)) s.children.set(cat, { name: cat, path: `${shelf}/${cat}`, ...blank(), children: new Map() });
    const c = s.children.get(cat);
    tally(c, item, { sold });
    if (!sub) return;

    if (!c.children.has(sub)) c.children.set(sub, { name: sub, path: `${shelf}/${cat}/${sub}`, ...blank(), children: new Map() });
    tally(c.children.get(sub), item, { sold });
  };

  for (const i of live) place(i, false);
  for (const i of vendor) place(i, false);
  for (const i of archived) place(i, true);

  // Biggest first, at every level: the tree is read to answer "where is the weight", and
  // alphabetical order buries a 488-item shelf under a 1-item one.
  const bySize = (a, b) => b.listed - a.listed;
  const shape = (node) => {
    const kids = [...node.children.values()].map(shape).sort(bySize);
    return { ...finish(node), children: kids };
  };

  return { tree: [...shelves.values()].map(shape).sort(bySize), totals: finish(totals) };
}

// Every node flattened, parents before children — for anything that walks the whole tree
// (the featured-image picker, the dashboard's node list) without caring about the shape.
export function flatten(tree, depth = 0, out = []) {
  for (const n of tree) {
    out.push({ ...n, depth });
    flatten(n.children, depth + 1, out);
  }
  return out;
}

/* --------------------------------------------------------------------- check ---- */
// The smallest thing that fails if the mapping or the tallies break:
//   node scripts/tree.mjs --check
// Not a framework and not a suite — three assertions over the real catalogue, which is the
// only data this module will ever see.
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1]) && process.argv.includes("--check")) {
  const assert = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); process.exit(1); } };
  const root = path.resolve(import.meta.dirname, "..");
  const { tree, totals } = buildTree(root);
  const all = flatten(tree);

  // A parent must hold at least what its children hold: every item tallied into a
  // subcategory was tallied into its category and shelf on the way down.
  for (const n of all) {
    const kids = n.children.reduce((s, c) => s + c.listed, 0);
    assert(n.listed >= kids, `${n.path} lists ${n.listed} but its children hold ${kids}`);
  }
  // The shelves must account for every item exactly once.
  const shelfSum = tree.reduce((s, n) => s + n.listed, 0);
  assert(shelfSum === totals.listed, `shelves total ${shelfSum}, tree total ${totals.listed}`);
  // The Vinted backfill must actually place items: a regression in the crumb rules would
  // silently flatten the tree back to one level, which is the failure this whole module undoes.
  const withDepth3 = all.filter((n) => n.depth === 2).length;
  assert(withDepth3 > 10, `only ${withDepth3} third-level nodes — the crumb mapping is not placing items`);

  console.log(`tree check: ${all.length} nodes, ${totals.listed} items, ${withDepth3} third-level nodes — all consistent`);
}
