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
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const SITE = "https://indianinprague.jains.es";
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
for (const file of ["wardrobe/home-decor.html", "wardrobe/jewellery.html", "wardrobe/meditation.html", "wardrobe/books.html", "wardrobe/others.html", "wardrobe/sold.html"]) {
  if (existsSync(`${ROOT}/${file}`)) {
    PAGES.push({ file, loc: `/${file.replace(/\.html$/, "")}`, priority: "0.8", changefreq: "daily" });
  }
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
    if (!src || !src.startsWith("images/")) continue;
    // De-duplicate: the same garment can appear on more than one page.
    if (!out.has(src)) out.set(src, alt);
  }
  return [...out.entries()];
}

const lines = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<!-- Generated by scripts/build-sitemap.mjs — do not hand-edit. -->",
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
  '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
];

for (const page of PAGES) {
  const { mtime } = await stat(`${ROOT}/${page.file}`);
  const lastmod = mtime.toISOString().slice(0, 10);
  const imgs = await imagesOf(page.file);

  lines.push("  <url>");
  lines.push(`    <loc>${SITE}${page.loc}</loc>`);
  lines.push(`    <lastmod>${lastmod}</lastmod>`);
  lines.push(`    <changefreq>${page.changefreq}</changefreq>`);
  lines.push(`    <priority>${page.priority}</priority>`);
  // Cap at 12 per page: the limit is 1000, but a long tail of near-identical garment
  // shots dilutes rather than helps.
  for (const [src, alt] of imgs.slice(0, 12)) {
    lines.push("    <image:image>");
    lines.push(`      <image:loc>${SITE}/${esc(src)}</image:loc>`);
    if (alt) lines.push(`      <image:title>${esc(alt)}</image:title>`);
    lines.push("    </image:image>");
  }
  lines.push("  </url>");
}

lines.push("</urlset>", "");
await writeFile(`${ROOT}/sitemap.xml`, lines.join("\n"));

const total = (await Promise.all(PAGES.map((p) => imagesOf(p.file)))).reduce(
  (n, a) => n + Math.min(a.length, 12),
  0,
);
console.log(`sitemap.xml: ${PAGES.length} pages, ${total} images`);
