#!/usr/bin/env node
// Stage the public site into dist/ — the exact set of files that goes to Cloudflare Pages.
//
// Why a staging directory instead of `wrangler pages deploy .`
// -----------------------------------------------------------
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
//   node scripts/build-dist.mjs
//
// Run it after every generator and before `wrangler pages deploy dist`.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, rm, mkdir, cp, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const run = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

// Pages that exist in the repo root but must never be served.
const PRIVATE_PAGES = new Set(["inventory.html"]);

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
  (f) => (f.endsWith(".html") || f.endsWith(".txt") || f === "sitemap.xml") && !PRIVATE_PAGES.has(f),
);

for (const f of rootFiles) {
  await cp(path.join(ROOT, f), path.join(DIST, f));
}

// ---------------------------------------------------------------------------
// assets/ and images/derived/. Only the derivatives ship — the markup points exclusively
// at images/derived/, which scripts/build-images.mjs generates from the originals.
await run("rsync", ["-a", "--delete", `${ROOT}/assets/`, `${DIST}/assets/`]);
await mkdir(path.join(DIST, "images"), { recursive: true });
await run("rsync", ["-a", "--delete", `${ROOT}/images/derived/`, `${DIST}/images/derived/`]);

// ---------------------------------------------------------------------------
// Pages' own control files. These configure the deployment and are not served as content.
for (const f of ["_headers", "_redirects"]) {
  await cp(path.join(ROOT, "pages", f), path.join(DIST, f));
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

// Pages free allows 20,000 files per deployment and 25 MiB per file. Neither is close
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

if (count > 20000) throw new Error(`${count} files exceeds the Pages free limit of 20,000`);
if (biggest.size > 25 * 1024 * 1024) {
  throw new Error(`${biggest.file} is ${(biggest.size / 1048576).toFixed(1)} MiB, over the 25 MiB Pages limit`);
}

console.log(
  `dist/ staged: ${count} files, largest ${biggest.file} ` +
    `(${(biggest.size / 1048576).toFixed(2)} MiB). inventory.html withheld.`,
);
