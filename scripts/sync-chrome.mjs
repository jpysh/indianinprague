#!/usr/bin/env node
// Copy the header and footer out of index.html into every hand-written page, and mark the
// top-level module each page belongs to.
//
// Why this exists
// ---------------
// build-shop.mjs already lifts the chrome out of index.html for the pages it GENERATES, so
// editing the nav in one file updated those for free. The hand-written pages had no such
// arrangement: index.html, clothes.html, restaurants.html, diaries.html, the article and
// 404.html each carried their own copy of the same 3 KB of header and footer markup. Adding
// a nav item meant six identical edits, and the first time one was missed the site would
// disagree with itself about what its own navigation is.
//
// So: index.html is the single source of the chrome, for hand-written and generated pages
// alike. Edit the nav there, run this, and every page agrees.
//
//   node scripts/sync-chrome.mjs
//
// Run it before build-shop.mjs and build-diaries.mjs (both read index.html's chrome, and
// neither should be reading a stale copy).

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// Which top-level module owns each hand-written page.
//
// Every shelf of the wardrobe marks "wardrobe", and restaurants + the article mark
// "diaries", because the module is where the visitor IS — not the exact file they are on.
// Marking only exact matches would leave the nav blank on most of the site, which is the
// bug this whole mechanism exists to fix.
//
// null means "no module is current": the homepage is not inside any of the five, and 404 is
// nowhere at all.
const PAGES = {
  "index.html": null,
  "404.html": null,
  // Reached from the footer, from every module, and belonging to none of them — buying,
  // shipping, returns and privacy are not the wardrobe any more than they are the diaries.
  "how-it-works.html": null,
  "partner.html": null,
  "wardrobe/fashion.html": "wardrobe",
  // spirituality.html is DELIBERATELY NOT LISTED, and this is a landmine if you add it
  // without reading this first.
  //
  // That page is a self-contained design imported whole: it carries its OWN <header
  // class="site"> and <footer class="site">, styled by its own rules, which happen to use
  // the same class name this file's regex matches. Listing it here would replace that
  // header with the site's — silently, on the next build — leaving the page's stylesheet
  // targeting an element that is no longer there.
  //
  // Add it once the page has been ported onto the site's own chrome and stylesheet. Until
  // then its navigation is its own, which is also why it currently has no links back to the
  // rest of the site.
  // diaries.html is NOT listed: scripts/build-diaries.mjs writes that page from scratch and
  // lifts the header and footer out of index.html itself, marking "diaries" as it goes. It
  // used to be here alongside restaurants.html and the article — both of those were folded
  // into the Diaries on 17 Aug 2026 and no longer exist.
};

const HEADER = /<header class="site">[\s\S]*?<\/header>/;
const FOOTER = /<footer>[\s\S]*?<\/footer>/;

// aria-current is what a screen reader announces; .active is what carries the colour.
// site.css styles `nav.main a.active`, and that rule sat unused for the life of the site
// because nothing ever set the class.
function markNav(header, module) {
  if (!module) return header;
  return header.replace(
    new RegExp(`<a href="/${module}">`),
    `<a href="/${module}" class="active" aria-current="page">`);
}

const index = await readFile(path.join(ROOT, "index.html"), "utf8");
const header = HEADER.exec(index);
const footer = FOOTER.exec(index);
if (!header || !footer) throw new Error("could not lift <header>/<footer> out of index.html");

// The ?v= cache token is owned by bump-assets.mjs. Read the one index.html is using rather
// than hardcoding one here, or every sync would quietly revert the other pages to whatever
// number was current when this file was written.
const v = /assets\/site\.css\?v=(\d+)/.exec(index);

let touched = 0;
for (const [file, module] of Object.entries(PAGES)) {
  const p = path.join(ROOT, file);
  if (!existsSync(p)) {
    console.warn(`  ${file} — missing, skipped`);
    continue;
  }
  let html = await readFile(p, "utf8");
  const before = html;

  // index.html is the source of the chrome, so it only needs the asset token normalising —
  // replacing its own header with itself is a no-op, and marking a module on it would be
  // wrong (the homepage is not inside any of them).
  if (file !== "index.html") {
    // Pages below the root (wardrobe/fashion.html) need the chrome's relative asset hrefs
    // absoluted, or assets/site.css resolves to /wardrobe/assets/site.css. Same fix as
    // build-diaries.mjs and build-shop.mjs.
    const nested = file.includes("/");
    const fix = (h) =>
      nested ? h.replace(/(href|src)="(assets\/|images\/)/g, '$1="/$2') : h;
    html = html.replace(HEADER, fix(markNav(header[0], module)));
    html = html.replace(FOOTER, fix(footer[0]));
  }
  if (v) html = html.replace(/(assets\/[a-z0-9-]+\.css\?v=)\d+/g, `$1${v[1]}`);

  if (html !== before) {
    await writeFile(p, html);
    console.log(`  ${file} — chrome synced${module ? ` (nav: ${module})` : ""}`);
    touched++;
  }
}

console.log(`\n${touched} page${touched === 1 ? "" : "s"} updated from index.html`);
