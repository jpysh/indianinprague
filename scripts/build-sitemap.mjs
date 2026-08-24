#!/usr/bin/env node
// Generate sitemap.xml from the pages that actually exist, including an image entry per
// page.
//
// The image extension matters more here than on a typical site: the subject is clothing
// and food, and Google Images is a real discovery channel for both. Listing the images
// with captions gives the crawler the alt text and the page context together, which is
// what it uses to decide whether a photo is worth showing.
//
// Regenerate after adding or removing a page:
//
//   node scripts/build-sitemap.mjs && docker compose up -d --build

import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { CODES } from "./i18n.mjs";

const SITE = "https://guldaarbazaar.com";
// path.resolve(import.meta.dirname, ...), matching every other script here. It used to be
// `new URL("..", import.meta.url).pathname`, which is a URL pathname: percent-ENCODED. A repo
// checked out to a directory with a space in it resolves to ".../my%20repo" and every read
// fails. Same family of bug as the absolute path that was hardcoded in build-jsonld.mjs until
// 17 Aug 2026 and broke the Cloudflare build — resolve from the module, always.
const ROOT = path.resolve(import.meta.dirname, "..");

// Priority reflects how much of the site's reason to exist each page carries, not a wish.
const PAGES = [
  { file: "index.html", loc: "/", priority: "1.0", changefreq: "weekly" },
  { file: "wardrobe.html", loc: "/wardrobe", priority: "0.9", changefreq: "daily" },
  // wellness.html and buddy.html were removed on 16 Aug 2026 (unfinished holding pages),
  // so neither belongs in the sitemap. Their URLs now return the site's 404.
  // Spirituality is a hand-written module page (yoga, ayurveda, meditation, trips), not a
  // shop shelf. The shelf that briefly held this URL is /wardrobe/meditation now.
  { file: "spirituality.html", loc: "/spirituality", priority: "0.8", changefreq: "monthly" },
  { file: "wardrobe/fashion.html", loc: "/wardrobe/fashion", priority: "0.9", changefreq: "daily" },
  // /restaurants and /article-contemporary-indian-wear were folded into /diaries on
  // 17 Aug 2026 and both 301 to it (edge/_redirects). A sitemap must not list a URL that
  // redirects — it tells a crawler the redirect target is not the canonical one — so the
  // Diaries carries their priority now as well as its own. It holds every review and the
  // long-form dispatch inline, which is why it went 0.7 -> 0.9.
  { file: "diaries.html", loc: "/diaries", priority: "0.9", changefreq: "weekly" },
  // Rarely edited, but it answers the transactional questions ("do you ship to Germany",
  // "what if it does not fit") that both a search engine and an assistant get asked, so it
  // is not a low-priority afterthought.
  { file: "how-it-works.html", loc: "/how-it-works", priority: "0.7", changefreq: "monthly" },
];

// Every post now has a page of its own (17 Aug 2026 — see the header of build-diaries.mjs),
// and each one is a URL a crawler should know about in its own right. Read from disk rather
// than from posts.json so the sitemap can only ever list a file that was actually written.
for (const file of existsSync(`${ROOT}/diaries`) ? readdirSync(`${ROOT}/diaries`) : []) {
  if (!file.endsWith(".html") || file === "index.html") continue;
  PAGES.push({
    file: `diaries/${file}`,
    loc: `/diaries/${file.replace(/\.html$/, "")}`,
    // Below the index, above a shop shelf: these are the writing, but the index is the page
    // that collects them and the one worth entering the site through.
    priority: "0.8",
    changefreq: "monthly",
  });
}

// The category pages build-shop.mjs emits. Which of them exist depends on what is actually
// in the closet this week — a category with nothing in it is not written — so they are
// discovered from disk rather than listed, and vanish from the sitemap when they empty
// out rather than becoming 404s a crawler keeps retrying.
// changefreq is daily because these turn over with the closet, not with the writing.
for (const file of ["wardrobe/home-decor.html", "wardrobe/jewellery.html", "wardrobe/meditation.html", "wardrobe/books.html", "wardrobe/wellness.html", "wardrobe/keepsakes.html", "wardrobe/food.html", "wardrobe/others.html", "wardrobe/sold.html"]) {
  if (existsSync(`${ROOT}/${file}`)) {
    PAGES.push({ file, loc: `/${file.replace(/\.html$/, "")}`, priority: "0.8", changefreq: "daily" });
  }
}

// Paginated shelves. Every page of a series is its own URL with its own canonical, so each
// one belongs in the sitemap — a crawler that only ever sees page 1 indexes a tenth of the
// catalogue. Discovered from disk rather than listed by hand, because the page count moves
// every time stock does.
// Everything under wardrobe/ that is a page: numbered pages of a series, subcategory pages,
// and the numbered pages of those. Walked rather than listed, because the set changes every
// time stock does — a shelf gains a division, a division outgrows one page.
//
// Priority says what it is, not how good it is: a subcategory page is the most specific
// thing here and the one most likely to answer a search ("kanthi mala", "gopi dress"), so
// it ranks above a numbered continuation of a shelf.
const walk = (rel) => {
  const abs = `${ROOT}/${rel}`;
  if (!existsSync(abs)) return;
  for (const f of readdirSync(abs, { withFileTypes: true })) {
    if (f.isDirectory()) { walk(`${rel}/${f.name}`); continue; }
    if (!f.name.endsWith(".html")) continue;
    const stem = f.name.replace(/\.html$/, "");
    const n = Number(stem);
    // NUMBERED CONTINUATION PAGES ARE NOT LISTED (24 Aug 2026).
    //
    // /wardrobe/fashion/2 and its siblings were 264 of this file's 745 URLs — 35% of the
    // sitemap, once the seven language trees are counted. They are not broken and not
    // duplicates: each self-canonicalises, which is the correct modern shape for
    // pagination, and every one stays crawlable through the links on page 1. Google's
    // documentation does not forbid listing them.
    //
    // They come out anyway, because a sitemap is a statement of what matters, and this is a
    // hostname with NO crawl history at all — guldaarbazaar.com was first served on
    // 24 Aug 2026. Every unit of early crawl attention spent on page 7 of a shelf is a unit
    // not spent on the shelf itself or on a category page, which are the pages that can
    // actually rank. Once the site has an established crawl pattern this matters far less,
    // and adding them back is deleting this block.
    if (n) continue;
    const loc = `/${rel}/${stem}`;
    PAGES.push({
      file: `${rel}/${f.name}`,
      loc,
      priority: "0.7",
      changefreq: "daily",
    });
  }
};
walk("wardrobe"); // recursive: shelves, their pages, their subcategories, and those pages

// The shelves themselves are listed explicitly further up, and walk() finds them again as
// wardrobe/<shelf>.html. Same URL twice in a sitemap is not fatal, but it is a signal that
// the file was assembled without anyone checking — and a crawler reading two entries with
// different priorities for one URL has to pick one.
const seen = new Set();
for (let i = PAGES.length - 1; i >= 0; i--) {
  if (seen.has(PAGES[i].loc)) PAGES.splice(i, 1);
  else seen.add(PAGES[i].loc);
}


// The alt text is read straight out of the HTML, so it arrives already entity-encoded
// ("Black &amp; Red"). Decode first, or escaping again yields "&amp;amp;" and the crawler
// sees a literal "&amp;" in the caption.
const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const esc = (s) =>
  decode(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Pull the images a page actually renders, with their alt text, straight from the markup. */
async function imagesOf(file) {
  const html = await readFile(`${ROOT}/${file}`, "utf8");
  const out = new Map();
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    const src = /src="([^"]+)"/.exec(tag)?.[1];
    const alt = /alt="([^"]*)"/.exec(tag)?.[1] ?? "";
    // Both forms. The markup used to be written with repo-relative paths ("images/..."),
    // and this test was written against that. Shelf pages moved into /wardrobe/ and started
    // emitting root-absolute paths ("/images/..."), at which point this quietly matched
    // nothing and the sitemap lost EVERY image entry — 93 pages, 0 images, no error.
    if (!src) continue;
    const rel = src.startsWith("/") ? src.slice(1) : src;
    if (!rel.startsWith("images/")) continue;
    // De-duplicate: the same garment can appear on more than one page.
    if (!out.has(rel)) out.set(rel, alt);
  }
  return [...out.entries()];
}

/* ------------------------------------------------------------------ languages ---- */

// Which languages a given page is actually offered in, and offered means INDEXABLE: the
// mirrored file exists and build-i18n.mjs did not mark it noindex for leaning too heavily
// on English. Listing a noindexed URL in the sitemap would be the file contradicting the
// page — inviting a crawler to a URL whose own markup tells it to go away.
function languagesFor(page) {
  return CODES.filter((code) => {
    const file = path.join(ROOT, code, page.file);
    if (!existsSync(file)) return false;
    return !/<meta name="robots" content="noindex/.test(readFileSync(file, "utf8"));
  });
}

// The <xhtml:link> block a URL carries: every language this page exists in, INCLUDING the
// one the entry is for. A page that omits itself from its own alternates is the single most
// common way to have hreflang ignored altogether — the set has to be reciprocal and complete
// or search engines drop it whole.
function alternates(page, langs) {
  // A page with no translations gets no block at all. A single self-referencing alternate
  // says nothing a crawler did not already know, and an hreflang set of one is a common way
  // to look like a misconfiguration.
  if (!langs.length) return [];
  const rows = [`    <xhtml:link rel="alternate" hreflang="en" href="${SITE}${page.loc}"/>`];
  for (const code of langs) {
    // Trailing slash on the homepage: /de/ is what the server actually serves, /de 307s to
    // it. Same reason as langUrl() in build-i18n.mjs — a sitemap must not list a redirect.
    rows.push(`    <xhtml:link rel="alternate" hreflang="${code}" href="${SITE}/${code}${page.loc === "/" ? "/" : page.loc}"/>`);
  }
  rows.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${page.loc}"/>`);
  return rows;
}


// ---------------------------------------------------------------------------
// lastmod: the date the page's CONTENT last changed, not the date it was last written.
//
// This used to be the file's mtime, and mtime is worthless here: every generator rewrites
// every HTML file on every build, so all 745 URLs carried the same date — today's — on
// every publish. A page untouched since 15 Aug claimed to have changed this morning.
// Google's documentation is explicit that it uses lastmod "if it's consistently and
// verifiably accurate" and that the value should mark "the last significant update"; a
// field that says today for everything, every day, is neither, so the whole signal was
// being discarded. Bytes spent, nothing bought — and worse on a hostname with no history,
// where freshness signals are exactly what has not been established yet.
//
// git is the right clock. publish.sh commits the generated tree every morning with a
// pathspec, and git records a file only when its BYTES changed — so the last commit
// touching a page is, by construction, the last time its content moved.
//
// THE SHALLOW-CLONE FALLBACK. Cloudflare Workers Builds may check out with a truncated
// history, in which case `git log` reports one commit date for every path and every URL
// would carry a confident wrong date. The test for that is the REPOSITORY's depth, not the
// spread of the dates it returns: on 24 Aug 2026 the rebrand touched all 94 pages in one
// commit, so every page honestly shared a date, and a "fewer than two distinct dates"
// heuristic read that as a broken clone. Depth answers the actual question — does this
// checkout know more than one commit — and a repository with real history whose files all
// changed on the same day is then reported as what it is.
const gitDate = (file) => {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", file],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;   // no git, no history for this path, or a file never committed
  }
};

// Resolved once, over the English pages, before anything is written.
const GIT_DATES = new Map();
let gitUsable = false;
{
  let depth = 0;
  try {
    depth = Number(execFileSync("git", ["rev-list", "--count", "HEAD"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()) || 0;
  } catch { depth = 0; }
  // `.git/shallow` exists only in a truncated clone, and it is the direct answer where the
  // commit count alone could still be misleading.
  const truncated = existsSync(path.join(ROOT, ".git/shallow"));
  gitUsable = depth > 1 && !truncated;

  if (gitUsable) {
    for (const page of PAGES) {
      const d = gitDate(page.file);
      if (d) GIT_DATES.set(page.file, d);
    }
    const distinct = new Set(GIT_DATES.values());
    console.log(`  lastmod: git (${depth} commits), ${distinct.size} distinct date(s) across ${GIT_DATES.size} pages`);
  } else {
    console.log(`  lastmod: mtime — ${truncated ? "shallow clone" : `history is ${depth} commit(s)`}, git cannot date a page here`);
  }
}

const lastmodFor = async (file) => {
  if (gitUsable) {
    const d = GIT_DATES.get(file);
    if (d) return d;
  }
  const { mtime } = await stat(`${ROOT}/${file}`);
  return mtime.toISOString().slice(0, 10);
};

const lines = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<!-- Generated by scripts/build-sitemap.mjs — do not hand-edit. -->",
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
  '        xmlns:xhtml="http://www.w3.org/1999/xhtml"',
  '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
];

for (const page of PAGES) {
  const lastmod = await lastmodFor(page.file);
  const imgs = await imagesOf(page.file);

  const langs = languagesFor(page);
  const alt = alternates(page, langs);

  lines.push("  <url>");
  lines.push(`    <loc>${SITE}${page.loc}</loc>`);
  lines.push(`    <lastmod>${lastmod}</lastmod>`);
  lines.push(`    <changefreq>${page.changefreq}</changefreq>`);
  lines.push(`    <priority>${page.priority}</priority>`);
  lines.push(...alt);
  // Cap at 12 per page: the limit is 1000, but a long tail of near-identical garment
  // shots dilutes rather than helps.
  for (const [src, alt2] of imgs.slice(0, 12)) {
    lines.push("    <image:image>");
    lines.push(`      <image:loc>${SITE}/${esc(src)}</image:loc>`);
    if (alt2) lines.push(`      <image:title>${esc(alt2)}</image:title>`);
    lines.push("    </image:image>");
  }
  lines.push("  </url>");

  // One entry per translated page, carrying the SAME reciprocal alternates block. Priority
  // and changefreq are inherited: it is the same page, in another language, and nothing
  // about its importance to this site changes with the language it is read in.
  //
  // No <image:image> here, deliberately. The photograph at /de/wardrobe is the identical
  // file at the identical URL as the one at /wardrobe — eight entries for one image is not
  // eight images, it is the same dilution this file already avoids by capping at 12. The
  // captions differ, but the image belongs to the English page it was first listed under.
  for (const code of langs) {
    const loc = `/${code}${page.loc === "/" ? "/" : page.loc}`;

    lines.push("  <url>");
    lines.push(`    <loc>${SITE}${loc}</loc>`);
    // Same date as the English page it mirrors: build-i18n rewrites the whole tree from
    // that page, so a translation's content changes exactly when its source does. Reading
    // the mirrored file's own mtime just reported the last build again.
    lines.push(`    <lastmod>${lastmod}</lastmod>`);
    lines.push(`    <changefreq>${page.changefreq}</changefreq>`);
    lines.push(`    <priority>${page.priority}</priority>`);
    lines.push(...alt);
    lines.push("  </url>");
  }
}

lines.push("</urlset>", "");
await writeFile(`${ROOT}/sitemap.xml`, lines.join("\n"));

const total = (await Promise.all(PAGES.map((p) => imagesOf(p.file)))).reduce(
  (n, a) => n + Math.min(a.length, 12),
  0,
);
const urls = (await readFile(`${ROOT}/sitemap.xml`, "utf8")).match(/<loc>/g)?.length ?? 0;
console.log(`sitemap.xml: ${PAGES.length} English pages, ${urls} URLs across all languages, ${total} images`);
