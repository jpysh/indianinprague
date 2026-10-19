#!/usr/bin/env node
// Stage the public site into dist/ — the exact set of files uploaded to Cloudflare.
//
// Why a staging directory instead of pointing the asset server at the repo root
// ----------------------------------------------------------------------------
// The repo root is not the web root and never was. Deploying it verbatim would upload
// scripts/ (including sync-vinted.mjs and its Vinted session logic), data/ (the whole
// product master plus the enrichment cache), nginx/, .cloudflared/, .sync.log, DEPLOY.md,
// UX-AUDIT.md — and images/, which is 408 MB of straight-off-the-camera originals that no
// page references. The Dockerfile solved this with an explicit COPY list; this script is
// that same list, and it is the only definition of what is public.
//
// One deliberate difference from the Dockerfile: inventory.html is NOT staged. It is the
// local stock-taking view — cost prices, unlisted items, internal notes — and the
// Dockerfile's `COPY *.html` glob has been quietly shipping it to the live site. Moving
// hosts is the moment to stop, not to carry the exposure across. Nothing in the site's
// navigation, sitemap or JSON-LD links to it; build-inventory.mjs still writes it to the
// repo root, where it is opened locally.
//
// Copies are incremental (rsync), so the 171 MB of derived images move once and then only
// the day's new photos travel. --delete means a file removed from the source disappears
// from the deployment too, rather than lingering forever the way an append-only upload
// directory would.
//
//   node scripts/build-dist.mjs                 # regenerates the site, then stages it
//   node scripts/build-dist.mjs --no-generate   # stage only; the caller already built
//
// Run it before `wrangler deploy`. It now runs the pure-node generators itself — see the
// GENERATORS block below for why that moved here from publish.sh.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, rm, mkdir, cp, stat, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { CODES } from "./i18n.mjs";

const run = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

// ---------------------------------------------------------------------------
// Directory sync, with a fallback, because this script now runs in two places.
//
// On this Mac, rsync is the right tool and stays the default: -a --delete moves the day's
// new photos and nothing else, which is what keeps a 171 MB image tree from being recopied
// every morning.
//
// Cloudflare's build container has no rsync. When the repo was connected to Workers Builds
// on 16 Aug 2026 the first build died on `spawn rsync ENOENT`, and the container is not
// ours to install into. So: probe once, and fall back to node's own recursive copy.
//
// The fallback drops the destination first, which is how it earns the --delete guarantee —
// a file removed from the source cannot survive in dist/ as a stale URL. That costs a full
// copy every time, which is the wrong trade on the Mac (hence rsync first) and free in the
// cloud, where the checkout starts empty anyway.
let hasRsync = null;
async function syncDir(src, dest) {
  if (hasRsync === null) {
    try {
      await run("rsync", ["--version"]);
      hasRsync = true;
    } catch {
      hasRsync = false;
      console.log("rsync not found — using node's recursive copy (expected on Cloudflare)");
    }
  }
  if (hasRsync) {
    await run("rsync", ["-a", "--delete", `${src}/`, `${dest}/`]);
    return;
  }
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true });
}

// ---------------------------------------------------------------------------
// Regenerate before staging, unless the caller already did it.
//
// WHY THIS IS HERE AND NOT ONLY IN publish.sh (added 17 Aug 2026)
// ---------------------------------------------------------------
// Two publish paths, and until now only one of them built anything. `publish.sh` runs ten
// steps; a push to `main` runs Cloudflare Workers Builds, whose build command is
// `npm ci && node scripts/build-dist.mjs` — this file and nothing else. So a push deployed
// whatever HTML happened to be committed, and every generator was skipped.
//
// That failed quietly, in the worst way available. Edit a stylesheet, push: the new CSS
// uploads, the HTML still carries yesterday's `?v=` token, and the edge keeps serving the
// old file from cache. The deploy is green, the change is invisible, and the next morning's
// 07:15 run fixes it by accident — so the symptom is "I pushed it and nothing happened,
// and then it worked overnight", which is nearly impossible to attribute.
//
// Running the generators HERE fixes both paths at once and needs no change to the
// Cloudflare dashboard, because the existing build command already calls this file. An
// intraday push now deploys exactly what a 07:15 run would.
//
// Only the four PURE-NODE generators are listed. The other three cannot run in Cloudflare's
// container and must not be attempted:
//   sync-vinted     needs a residential IP (DataDome) and ~500 subrequests
//   build-images    shells out to ImageMagick and cwebp
//   build-inventory writes a local-only page that is never staged anyway
// Everything the four below read is committed: data/*.json and images/derived/manifest.json.
// That is what makes a cloud build reproduce a Mac build exactly.
//
// A generator that throws fails the build, deliberately. The alternative — carry on with
// stale committed HTML — is the silent divergence this whole block exists to end. A red
// build is visible and costs one push; a green build serving the wrong bytes is not.
const GENERATORS = [
  // FIRST: it copies index.html's header and footer into the hand-written pages that no
  // generator owns (404.html, clothes.html). Missing from both pipelines until 17 Aug 2026,
  // so those two drifted every time the chrome changed and nobody remembered the command.
  "sync-chrome.mjs",   // index.html's chrome -> 404.html, wardrobe/fashion.html
  "build-shop.mjs",    // catalog + vendor listings -> shelf pages, and the SHOP:* regions
  // Added 17 Aug 2026, and it was overdue. It reads data/posts.json, content/*.html and the
  // image manifest — all committed — so it belongs in exactly the same category as
  // build-shop. It was missing from this list AND from publish.sh, which was survivable
  // while diaries.html was a hub of cards nobody edited; it stopped being survivable when
  // that page became the whole blog. A push that changed a post would have deployed the
  // previously committed HTML and looked green doing it.
  // AFTER build-shop: it lifts the header and footer out of index.html, which build-shop
  // rewrites. Both only ever replace their own <!-- REGION --> markers, so neither clobbers
  // the other.
  "build-diaries.mjs", // posts.json + content/ -> diaries.html, and index's DIARY:LATEST
  "build-jsonld.mjs",  // structured data, including the SKUs
  // The seven language trees, mirrored from the English pages the generators above just
  // wrote. It reads data/i18n/*.json and nothing else — no network, no API key — which is
  // what lets a cloud build produce them from committed translations exactly as this Mac
  // does. scripts/translate.mjs, which DOES need a DeepL key, is deliberately not here: it
  // runs on the Mac only, and its output is committed for this step to read.
  //
  // AFTER build-jsonld (it mirrors the finished pages, structured data and all) and BEFORE
  // build-sitemap (which lists the language URLs it writes).
  "build-i18n.mjs",
  "build-sitemap.mjs", // URL list, which depends on which pages build-shop just wrote
  "bump-assets.mjs",   // MUST BE LAST: it hashes the assets and stamps ?v= into the HTML
];

// publish.sh passes --no-generate: it has already run all six, in this order, and
// re-running them would be several seconds of identical work on every publish.
if (process.argv.includes("--no-generate")) {
  console.log("--no-generate: staging the tree as-is (caller already built it)");
} else {
  for (const g of GENERATORS) {
    const { stdout } = await run(process.execPath, [path.join(ROOT, "scripts", g)], { cwd: ROOT });
    const last = stdout.trim().split("\n").filter(Boolean).pop() || "ok";
    console.log(`  ${g} — ${last}`);
  }
}

// Pages that exist in the repo root but must never be served.
const PRIVATE_PAGES = new Set(["inventory.html", "dashboard.html"]);

// Read from i18n.mjs rather than repeated here: a language added there must not need a
// second edit in this file to reach the deployment.
const I18N_LANGS = CODES;

// Start clean at the top level so a page deleted from the repo cannot survive in dist/ as
// a stale URL. images/derived and assets are rsync'd rather than recreated, so this costs
// nothing — it only removes the ~50 small root files.
if (existsSync(DIST)) {
  for (const entry of await readdir(DIST)) {
    if (entry === "images" || entry === "assets") continue;
    await rm(path.join(DIST, entry), { recursive: true, force: true });
  }
}
await mkdir(DIST, { recursive: true });

// ---------------------------------------------------------------------------
// Root files: every page except the private ones, the IndexNow key file (<32-hex>.txt)
// alongside robots.txt and llms.txt, and the sitemap.
const rootFiles = (await readdir(ROOT)).filter(
  // .cards are the shelf card fragments the filters fetch — content, not pages, which is
  // why they are not .html and why they must still be staged.
  (f) =>
    (f.endsWith(".html") || f.endsWith(".txt") || f.endsWith(".cards") || f === "sitemap.xml") &&
    !PRIVATE_PAGES.has(f),
);

for (const f of rootFiles) {
  await cp(path.join(ROOT, f), path.join(DIST, f));
}

// ---------------------------------------------------------------------------
// assets/ and images/derived/. Only the derivatives ship — the markup points exclusively
// at images/derived/, which scripts/build-images.mjs generates from the originals.
await syncDir(path.join(ROOT, "assets"), path.join(DIST, "assets"));

// diaries/ — the Diaries index and one page per post, written by build-diaries.mjs. It is a
// directory rather than a root .html file so that /diaries resolves exactly one way: to
// diaries/index.html. A root diaries.html sitting beside it would leave the asset server
// choosing between two candidates for the same URL.
if (existsSync(path.join(ROOT, "diaries"))) {
  await syncDir(path.join(ROOT, "diaries"), path.join(DIST, "diaries"));
}

// wardrobe/ — the storefront index and one page per shelf, written by build-shop.mjs. The
// shelves moved under /wardrobe on 21 Aug 2026: they are what is inside the wardrobe, not
// siblings of it, and a second vendor's catalogue would otherwise have claimed a fresh
// top-level path per shelf. Same directory-not-root-file reasoning as diaries/ above.
if (existsSync(path.join(ROOT, "wardrobe"))) {
  await syncDir(path.join(ROOT, "wardrobe"), path.join(DIST, "wardrobe"));
}
// partner/ — one hand-written page per audience plus two printable posters, since the
// /partner split on 26 Sep 2026.
if (existsSync(path.join(ROOT, "partner"))) {
  await syncDir(path.join(ROOT, "partner"), path.join(DIST, "partner"));
}
// The language trees — /de, /fr, /ru, /it, /es, /pl, /cs — written by build-i18n.mjs from
// the English pages above. One directory per language, mirroring the whole site; assets and
// images are NOT duplicated into them, so seven languages cost HTML and nothing else.
for (const lang of I18N_LANGS) {
  if (existsSync(path.join(ROOT, lang))) {
    await syncDir(path.join(ROOT, lang), path.join(DIST, lang));
  }
}

await mkdir(path.join(DIST, "images"), { recursive: true });
await syncDir(path.join(ROOT, "images", "derived"), path.join(DIST, "images", "derived"));

// manifest.json is build input, not content. Nothing on the page fetches it — build-shop.mjs
// reads it from the repo — and at 1.24 MB it was both the largest file in the deployment and
// a public listing of every image the build knows about.
const manifest = path.join(DIST, "images", "derived", "manifest.json");
if (existsSync(manifest)) await rm(manifest);

// ---------------------------------------------------------------------------
// Edge behaviour. These two configure the asset server and are never served as content —
// verified: /_headers and /_redirects both 404. They live in edge/ rather than at the repo
// root so that the root stays "the pages of the site" and nothing else.
for (const f of ["_headers", "_redirects"]) {
  await cp(path.join(ROOT, "edge", f), path.join(DIST, f));
}

// ---------------------------------------------------------------------------
// Guard rails, checked rather than assumed — this script is the only thing standing
// between the repo and a public URL.
for (const f of PRIVATE_PAGES) {
  if (existsSync(path.join(DIST, f))) throw new Error(`private page reached dist/: ${f}`);
}
for (const leaked of ["scripts", "data", "nginx", ".cloudflared", "images/9309067629.jpg"]) {
  if (existsSync(path.join(DIST, leaked))) throw new Error(`non-public path reached dist/: ${leaked}`);
}

// The free tier allows 20,000 files per version and 25 MiB per file. Neither is close
// today (~1,975 files, largest derivative well under the cap), but a runaway image build
// should fail here rather than half-way through an upload.
let count = 0;
let biggest = { file: "", size: 0 };
const walk = async (dir) => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else {
      count++;
      const { size } = await stat(p);
      if (size > biggest.size) biggest = { file: path.relative(DIST, p), size };
    }
  }
};
await walk(DIST);

if (count > 20000) throw new Error(`${count} files exceeds the free-tier limit of 20,000 files per version`);
if (biggest.size > 25 * 1024 * 1024) {
  throw new Error(`${biggest.file} is ${(biggest.size / 1048576).toFixed(1)} MiB, over the 25 MiB per-file limit`);
}

// ---------------------------------------------------------------------------
// Every internal link resolves, and every anchor it points at exists.
//
// Added 17 Aug 2026, the day /restaurants and /article-contemporary-indian-wear were folded
// into /diaries. Eleven files linked to those two URLs — a footer on every page, the homepage
// strip, the 404 link list, llms.txt, the sitemap — and each one had to be found by hand. Get
// one wrong and the site ships a link to a page that no longer exists, which no test here
// would have noticed and no visitor would report.
//
// This is deliberately checked against dist/ rather than the repo, because dist/ IS the site:
// it is the only place where "does this URL exist" has a single answer. A link is satisfied by
// a real file, by the extensionless form of one, or by a rule in _redirects — that last one
// matters, because /restaurants is now a legitimate link target that is not a file.
const redirectSources = new Set(
  (await readFile(path.join(DIST, "_redirects"), "utf8"))
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => l.trim().split(/\s+/)[0]),
);

// Root pages plus diaries/ and wardrobe/. They were outside this check for as long as the
// Diaries was a single root file; between them they are most of the site's internal linking
// now, so leaving them out would check the least link-dense pages and skip the rest.
// Recursive: the shelves paginate into wardrobe/<shelf>/<n>.html, so a single level of
// readdir would check page 1 of every shelf and none of the rest.
const subdirPages = async (dir) => {
  if (!existsSync(path.join(DIST, dir))) return [];
  const out = [];
  for (const e of await readdir(path.join(DIST, dir), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...(await subdirPages(`${dir}/${e.name}`)));
    else if (e.name.endsWith(".html")) out.push(`${dir}/${e.name}`);
  }
  return out;
};
const htmlFiles = [
  ...(await readdir(DIST)).filter((f) => f.endsWith(".html")),
  ...(await subdirPages("diaries")),
  ...(await subdirPages("wardrobe")),
  // The language trees too. build-i18n.mjs rewrites every internal href to add a /<lang>
  // prefix, and only for pages that were actually mirrored — a rule with an exception in it
  // (spirituality.html is not mirrored) and therefore a rule worth checking rather than
  // trusting. The first build got exactly this wrong and pointed every language at a
  // /de/spirituality that was never written.
  ...(await Promise.all(CODES.map((c) => subdirPages(c)))).flat(),
];
const pageText = new Map();
for (const f of htmlFiles) pageText.set(f, await readFile(path.join(DIST, f), "utf8"));

// Resolve a site path to a file in dist/, the way the asset server does.
const resolves = (p) =>
  existsSync(path.join(DIST, p)) ||
  existsSync(path.join(DIST, p + ".html")) ||
  existsSync(path.join(DIST, p, "index.html")) ||
  redirectSources.has(p);

const dead = [];
const badAnchor = [];
for (const [file, html] of pageText) {
  for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const raw = m[1];
    // External, in-page, and non-navigational schemes are not this check's business.
    if (/^(https?:|mailto:|tel:|data:|#)/.test(raw)) continue;
    const [pathPart, frag] = raw.split("#");
    const clean = pathPart.split("?")[0];
    const target = clean === "" ? file : (clean.startsWith("/") ? clean : "/" + clean);
    if (clean !== "" && !resolves(target)) { dead.push(`${file} -> ${raw}`); continue; }
    // The anchor half. The Diaries now depends on these completely: every review and the
    // dispatch is reached by fragment, so a typo'd id is a broken link with no 404 to show it.
    if (!frag) continue;
    // A trailing slash is part of the URL but never part of the filename: /de/ is served by
    // de/index.html. Without stripping it here every anchor into a language homepage fell
    // through to null and went unchecked — silently, which is the failure mode this whole
    // block exists to remove.
    const bare = target.replace(/\/$/, "");
    const targetFile =
      clean === "" ? file
      : htmlFiles.includes(bare.slice(1)) ? bare.slice(1)
      : htmlFiles.includes(bare.slice(1) + ".html") ? bare.slice(1) + ".html"
      : target === "/" ? "index.html"
      // /diaries and /wardrobe are directory indexes, so their anchors live in <dir>/index.html.
      : htmlFiles.includes(bare.slice(1) + "/index.html") ? bare.slice(1) + "/index.html"
      : null;
    if (!targetFile) continue; // a redirect target, or not an html page — nothing to check
    const body = pageText.get(targetFile);
    if (body && !new RegExp(`\\sid="${frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(body)) {
      badAnchor.push(`${file} -> ${raw} (no id="${frag}" in ${targetFile})`);
    }
  }
}

if (dead.length || badAnchor.length) {
  throw new Error(
    "dist/ contains links that do not resolve:\n" +
      [...dead.map((d) => `  dead link:   ${d}`), ...badAnchor.map((a) => `  dead anchor: ${a}`)]
        .join("\n"),
  );
}
console.log(`  links checked: ${pageText.size} pages, every internal href and anchor resolves`);

// Duplicate ids: an anchor lands on whichever comes first, and assistive tech loses its
// label. Two shop ids once clashed on every shelf (issue 12).
const dupIds = [];
for (const [file, body] of pageText) {
  const seen = new Set();
  for (const [, id] of body.matchAll(/\sid="([^"]+)"/g)) {
    if (seen.has(id)) { dupIds.push(`${file}: id="${id}"`); break; }
    seen.add(id);
  }
}
if (dupIds.length) throw new Error("duplicate ids:\n  " + dupIds.slice(0, 20).join("\n  "));
console.log(`  ids checked: no page repeats an id`);

// The Vinted rating line (DESIGN.md §7.5) must never show a rating under 4.5.
for (const [file, body] of pageText) {
  const m = /class="sheet-trust"[^>]*>[\s\S]*?<b>([\d.]+)<\/b>/.exec(body);
  if (m && Number(m[1]) < 4.5) throw new Error(`${file}: Vinted rating ${m[1]} shown; it must be hidden under 4.5`);
}

// THE BUILD MARKER: which commit these bytes were built from, served at /build-id.txt.
//
// publish.sh used to confirm a deploy by asking guldaarbazaar.com for a 200 and calling it
// "live origin healthy". A 200 says the site is up, not that it is THIS site: on 26 and 27
// Aug 2026 the Workers build failed both mornings, the edge kept serving the 25th happily,
// and the run reported healthy and pinged three search engines about it. Two days of
// catalogue updates sat in git, live never moved, and nothing anywhere said so.
//
// A marker the edge can be asked for closes that. It is one line of text and it is written
// LAST, after every check above has passed, so its presence at a URL means a build that
// satisfied all of them produced the bytes being served.
//
// The SHA comes from git, with the CI environment as the fallback — in Workers Builds the
// clone is shallow but real, so git wins there too; the env vars are belt and braces for a
// container that ever ships without git. "unknown" is not fatal here: it makes the poll in
// publish.sh time out and report, which is the correct outcome for a build that cannot say
// what it is.
const buildSha = await new Promise((resolve) => {
  execFile("git", ["rev-parse", "HEAD"], { cwd: ROOT }, (err, out) =>
    resolve(err ? (process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || "unknown") : out.trim()),
  );
});
await writeFile(path.join(DIST, "build-id.txt"), buildSha + "\n");
console.log(`  build-id.txt: ${buildSha.slice(0, 7)}`);

console.log(
  `dist/ staged: ${count} files, largest ${biggest.file} ` +
    `(${(biggest.size / 1048576).toFixed(2)} MiB). inventory.html withheld.`,
);
