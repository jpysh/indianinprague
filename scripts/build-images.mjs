#!/usr/bin/env node
// Derive responsive, web-sized images from the originals in images/.
//
// The originals are straight off a camera — IMG_5564.JPG alone is 3.4 MB, and the page
// displays it in a box a few hundred pixels wide. This script writes a set of widths in
// both WebP and JPEG into images/derived/, which the markup consumes through <picture>
// with srcset, so a phone downloads roughly a hundredth of the original bytes.
//
// Idempotent: a derivative is only re-encoded when it is missing or older than its
// source, so re-running after adding one photo is cheap. Run it after adding or replacing
// anything in images/, then rebuild the container:
//
//   node scripts/build-images.mjs && docker compose up -d --build
//
// Uses ImageMagick (`magick`) and `cwebp`, both already on this host. Deliberately no npm
// dependencies — this project has no package.json and does not need one for five pages.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const run = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "images");
const OUT_DIR = path.join(SRC_DIR, "derived");

// Widths chosen for how the images are actually laid out: the grid is 3-up on desktop
// (~400px per cell within the 1280px wrap), 2-up on tablet and 1-up on phones (~375px,
// ~750px at 2x DPR). 1600 covers the article's full-bleed use and 2x on a wide grid cell.
const WIDTHS = [400, 800, 1200, 1600];

// Product photos are only ever shown in a grid cell that tops out at 400 CSS pixels, so
// 400 (1x) and 800 (2x and better) are the whole useful range. Deriving the wider two as
// well was actively harmful rather than merely wasteful: the browser picks from srcset by
// device pixel ratio, so a DPR-3 phone computed 335px x 3 = 1005 and downloaded the 1200
// variant — 437 KB to fill a thumbnail, against 26 KB for the 400.
//
// The editorial photographs (IMG_*.JPG) keep all four: the article uses them full-bleed
// and the home page hero is 1600 wide.
const GRID_WIDTHS = [400, 800];
const isProductPhoto = (f) => /^vinted-/.test(f);

const QUALITY_JPEG = 80;
const QUALITY_WEBP = 78;

// Product photos are viewed at 400 CSS pixels in a grid, never full screen, so they carry
// a lower quality than the editorial photographs. Measured on the worst case in the closet
// (a fine white block print on black, over a patterned ground — about as incompressible as
// this catalog gets): 78 -> 72 costs nothing visible at thumbnail scale and takes the 800px
// variant from 216 KB to 190 KB.
//
// Worth recording what did NOT work, so nobody re-tries it: encoding WebP straight from the
// original rather than through the JPEG intermediate saved 0%, and dropping to q62 saved
// only a further 3% for a visible cost. These photographs are simply detailed.
const QUALITY_JPEG_GRID = 74;
const QUALITY_WEBP_GRID = 72;

const isSource = (f) => /\.(jpe?g)$/i.test(f);

async function newerThan(target, source) {
  if (!existsSync(target)) return false;
  const [t, s] = await Promise.all([stat(target), stat(source)]);
  return t.mtimeMs >= s.mtimeMs;
}

async function dimensions(file) {
  const { stdout } = await run("magick", ["identify", "-format", "%w %h", file]);
  const [w, h] = stdout.trim().split(/\s+/).map(Number);
  return { w, h };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(SRC_DIR)).filter(isSource).sort();
  if (files.length === 0) {
    console.error("no source images found in images/");
    process.exit(1);
  }

  // Consumed by the HTML build step so the markup can emit correct width/height (which is
  // what stops the layout shifting as images arrive) without re-probing every file.
  const manifest = {};
  let encoded = 0;
  let skipped = 0;

  for (const file of files) {
    const src = path.join(SRC_DIR, file);
    const base = file.replace(/\.[^.]+$/, "");
    const { w: srcW, h: srcH } = await dimensions(src);

    // Never upscale: a 400px-wide source gets only the 400 variant. Upscaling would cost
    // bytes and add nothing a browser could not do itself.
    const isGrid = isProductPhoto(file);
    const ladder = isGrid ? GRID_WIDTHS : WIDTHS;
    const qJpeg = isGrid ? QUALITY_JPEG_GRID : QUALITY_JPEG;
    const qWebp = isGrid ? QUALITY_WEBP_GRID : QUALITY_WEBP;
    const widths = ladder.filter((w) => w <= srcW);
    if (widths.length === 0) widths.push(srcW);

    const variants = [];
    for (const w of widths) {
      const h = Math.round((srcH / srcW) * w);
      const jpg = path.join(OUT_DIR, `${base}-${w}.jpg`);
      const webp = path.join(OUT_DIR, `${base}-${w}.webp`);

      if (await newerThan(jpg, src)) {
        skipped++;
      } else {
        // -strip drops EXIF. That matters beyond file size: phone photos carry GPS
        // coordinates and camera serial numbers, and this is a personal site whose
        // author lives in the city being photographed.
        await run("magick", [
          src, "-auto-orient", "-strip",
          "-resize", `${w}x`,
          "-interlace", "Plane",
          "-sampling-factor", "4:2:0",
          "-quality", String(qJpeg),
          jpg,
        ]);
        encoded++;
      }

      if (await newerThan(webp, src)) {
        skipped++;
      } else {
        await run("cwebp", ["-quiet", "-q", String(qWebp), "-m", "6", jpg, "-o", webp]);
        encoded++;
      }

      variants.push({ w, h, jpg: path.relative(ROOT, jpg), webp: path.relative(ROOT, webp) });
    }

    manifest[`images/${file}`] = {
      width: srcW,
      height: srcH,
      aspect: +(srcW / srcH).toFixed(4),
      variants,
    };
    process.stdout.write(`${file} ${srcW}x${srcH} -> ${variants.map((v) => v.w).join(",")}\n`);
  }

  await writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  console.log(`\n${files.length} sources, ${encoded} encoded, ${skipped} already current`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
