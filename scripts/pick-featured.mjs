#!/usr/bin/env node
// Choose a featured photograph for every node of the product tree that has none.
//
//   node scripts/pick-featured.mjs            # fill the gaps, leave every choice alone
//   node scripts/pick-featured.mjs --dry-run  # print what it would do
//   node scripts/pick-featured.mjs --repick   # redo the AUTO picks; hand-picked stay
//
// THE RULE: the most-favourited piece on the node that is available and has a photograph,
// ties broken by newest. Favourites are the only outside opinion in this data — a few
// thousand Vinted browsers have voted with a heart, and the picture is most of what they
// were voting on. Newest-first, which is what the homepage tiles used before this existed,
// keeps the front page fresh but says nothing about whether the photo is any good.
//
// A HAND PICK IS NEVER OVERWRITTEN. Every entry records `by: "you"` or `by: "auto"`, and a
// normal run only fills empty nodes. That is what makes this safe to leave in the daily
// pipeline: new stock arrives, new subcategories appear, they get a face, and nothing you
// chose yourself is touched. --repick redoes the automatic ones and still leaves yours.
//
// Vendor items have no `favourites` (govindashop has no such notion) so their nodes are
// decided by the newest tie-break, which is the honest answer to "no signal here".

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { buildTree, flatten } from "./tree.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const FILE = path.join(ROOT, "data/featured.json");
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const REPICK = argv.includes("--repick");

// The whole wardrobe is a node too — the root of the tree, and the one a future "featured
// image of the shop" would hang from. It has no name in the taxonomy, so it gets a reserved
// key that cannot collide with a shelf.
export const ROOT_KEY = "__wardrobe__";

// Newest first, by Vinted id: the ids ascend, so a bigger number is a later listing. Vendor
// SKUs are their own sequence and only ever compared with each other, which is why this is a
// string-aware numeric compare rather than a date — there are no reliable dates on either side.
const byNewest = (a, b) => (Number(b.id) || 0) - (Number(a.id) || 0);

// A card can only show a photograph the build actually produced. `photo` is the repo-relative
// original; images/derived carries what gets served, and build-shop's own picture() resolves
// one from the other, so storing the original path keeps this consistent with every other
// place a photo is named.
const usable = (i) => i.photo && !i.sold && i.inStock !== false;

export function bestPhoto(items) {
  const pool = items.filter(usable);
  if (!pool.length) return null;
  const top = pool.sort((a, b) => (b.favourites || 0) - (a.favourites || 0) || byNewest(a, b))[0];
  return { photo: top.photo, itemId: String(top.id), title: top.title, favourites: top.favourites || 0 };
}

function main() {
  const { tree, totals } = buildTree(ROOT);
  const current = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
  const nodes = [{ path: ROOT_KEY, name: "The whole wardrobe", items: totals.items }, ...flatten(tree)];

  let filled = 0;
  let kept = 0;
  for (const node of nodes) {
    const held = current[node.path];
    if (held && (held.by === "you" || !REPICK)) { kept++; continue; }
    const pick = bestPhoto(node.items);
    if (!pick) continue;
    if (DRY) {
      console.log(`  ${node.path} -> ${pick.photo}  (${pick.favourites} fav) ${pick.title.slice(0, 48)}`);
    } else {
      current[node.path] = { ...pick, by: "auto", at: new Date().toISOString() };
    }
    filled++;
  }

  if (!DRY) writeFileSync(FILE, JSON.stringify(current, null, 2) + "\n");
  console.log(
    `featured: ${filled} node(s) ${DRY ? "would be" : ""} picked automatically, ${kept} left as they were ` +
      `(${nodes.length} nodes in the tree)`,
  );
}

if (import.meta.filename === path.resolve(process.argv[1])) main();
