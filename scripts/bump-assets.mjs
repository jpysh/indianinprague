#!/usr/bin/env node
// Stamp every stylesheet and script reference with a hash of that file's own contents.
//
// Why any of this exists: the files under assets/ have stable URLs, and a stable URL
// behind Cloudflare is a stale URL. A palette fix once shipped correctly to the origin and
// then sat invisible behind `cf-cache-status: HIT` — the edge kept serving the previous
// site.css and would have done so for a day. Changing the query string changes the cache
// key, so a release reaches everyone at once: the HTML revalidates on every request
// (max-age=0), and points at a URL neither Cloudflare nor the browser has ever seen. That
// is what makes it safe to serve the assets themselves with a one-year immutable lifetime.
//
// Why a content hash rather than the global counter this used to be
// ----------------------------------------------------------------
// The counter moved every asset to ?v=N+1 on every run, and publish.sh runs unconditionally
// every morning. A sync that added two photos and touched no CSS still invalidated
// site.css, fonts.css, shop.css and shop.js for every returning visitor — roughly 55 KB
// re-downloaded daily to deliver nothing. The immutable header was, in practice, buying us
// 24 hours instead of a year.
//
// Hashing each file separately fixes both halves at once: a file that did not change keeps
// its URL and stays in cache, and a file that did change gets a URL that has never been
// served. Correctness is strictly better than the counter's, too — the counter could not
// distinguish "shipped" from "edited", so a hand-edited stylesheet published without a bump
// would go out stale.
//
// The hash is a query string rather than a rename (site.a3f19c2b.css) on purpose:
// assets/fonts.css references its woff2 files with relative urls, and renaming would either
// break those or require rewriting CSS as well. The cache key includes the query string, so
// the effect is identical.
//
// Run it whenever anything under assets/ changes, before staging dist/:
//
//   node scripts/bump-assets.mjs

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// 8 hex characters of sha256. Collisions are not a concern at ~11 assets; the failure mode
// of one would be a stale stylesheet, not a wrong one.
const hashes = new Map();
for (const f of await readdir(path.join(ROOT, "assets"))) {
  if (!/\.(css|js)$/.test(f)) continue;
  const bytes = await readFile(path.join(ROOT, "assets", f));
  hashes.set(f, createHash("sha256").update(bytes).digest("hex").slice(0, 8));
}

// Root pages, plus diaries/ — the Diaries index and its post pages are written into a
// directory of their own (see build-diaries.mjs), and they load the same stylesheets under
// the same immutable cache headers. Left out of this list they would be the only pages on
// the site serving an unversioned /assets/site.css.
const pages = (await readdir(ROOT))
  .filter((f) => f.endsWith(".html"))
  .concat(
    existsSync(path.join(ROOT, "diaries"))
      ? (await readdir(path.join(ROOT, "diaries")))
          .filter((f) => f.endsWith(".html"))
          .map((f) => path.join("diaries", f))
      : [],
  );

let touched = 0;

// Two different things get reported separately, because conflating them makes the daily log
// lie. build-shop.mjs and build-diaries.mjs rewrite their pages from scratch every run, so
// those arrive carrying an OLD stamp or none at all and always need writing — that is not
// evidence the stylesheet changed. Only a page that carried a different, non-empty stamp
// tells us the file's bytes actually moved.
const reversioned = new Set();
const stamped = new Set();

for (const page of pages) {
  const p = path.join(ROOT, page);
  const before = await readFile(p, "utf8");

  // src= as well as href=, because assets/shop.js is served with the same immutable
  // caching as the stylesheets — a filter fix would otherwise sit behind a Cloudflare HIT
  // exactly the way the CSS one did. The existing ?v=<digits> from the counter era is
  // matched too, so the first run after this change migrates every page.
  const after = before.replace(
    /((?:href|src)="\/?assets\/([a-z0-9-]+\.(?:css|js)))(\?v=[0-9a-f]+)?"/g,
    (whole, head, file, existing) => {
      const h = hashes.get(file);
      if (!h) return whole; // referenced file is missing — leave it alone and let the 404 show
      if (!existing) stamped.add(file);
      else if (existing !== `?v=${h}`) reversioned.add(file);
      return `${head}?v=${h}"`;
    },
  );

  if (after !== before) {
    await writeFile(p, after);
    touched++;
  }
}

if (reversioned.size === 0) {
  console.log(
    `assets unchanged — every URL keeps its cache entry` +
      (touched ? ` (${touched} regenerated page(s) re-stamped)` : ""),
  );
} else {
  console.log(
    `re-versioned ${reversioned.size} asset(s): ${[...reversioned].sort().join(", ")} ` +
      `— visitors will re-download only these (${touched} pages updated)`,
  );
}
if (stamped.size && reversioned.size === 0) {
  // Not a warning: a generated page with no stamp is the normal case, since build-shop
  // writes the reference without one and this script is what adds it.
  console.log(`  first stamp on this run for: ${[...stamped].sort().join(", ")}`);
}
