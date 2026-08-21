// Put Govinda's book covers on the same cloth the closet is photographed on.
//
// WHY THIS EXISTS
// Govinda render every book as a fixed 700px-tall cover pasted onto a white 1100x1422
// canvas. Measured across the pilot: the artwork occupies 49% of the height and about 40%
// of the width, and the rest is white. Dropped into a grid beside photographs shot on a
// block-print quilt, those cards read as catalogue scans rather than things for sale.
//
// So the cover is trimmed out of its white canvas, scaled up, given a shadow and set on a
// crop of the same quilt the Vinted photographs use. The output is 900x1600 — the shape of
// every Vinted photo — so rows in the grid stay even.
//
// Books only, for now. If vendor images in other categories turn out to be white-padded
// the same way, the fix is to widen the shelf test below rather than to write a second
// script.
//
// The composite REPLACES the download in vendors/govinda/images/. Re-styling therefore
// means re-fetching those images from Govinda (fetch-images.mjs skips what it already has,
// so delete first). That is deliberate and was the explicit call: the raw scans have no
// other use.
import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const DIR = "vendors/govinda/images";
const BACKDROP = "vendors/govinda/backdrop.jpg";
const CANVAS = { w: 900, h: 1600 };

// The cover is fitted inside this box rather than to a single dimension: these covers vary
// in aspect (0.62 to 0.72), and scaling on height alone would let a wide one run to 89% of
// the frame width and swallow the margin that makes the cloth read as a setting.
const FIT = { w: 620, h: 1240 };

const magick = (args) => run("magick", args);

// A composited file has cloth in its corners; a raw download has paper-white. That is the
// test, and it doubles as the re-run guard — this script is safe to run twice.
async function isWhitePadded(file) {
  const { stdout } = await magick([file, "-format", "%[fx:mean.r*255]", "-crop", "24x24+0+0", "+repage", "info:"]);
  return Number(stdout.trim()) > 246;
}

async function backdrop(out) {
  // Blurred and gently vignetted, imitating what the camera did for free on the Vinted
  // photographs: shallow depth of field, light falling off at the edges. Without it a sharp
  // quilt competes with a sharp cover and the eye settles on neither.
  await magick([
    BACKDROP, "-auto-orient",
    "-resize", `${CANVAS.w}x${CANVAS.h}^`, "-gravity", "center", "-extent", `${CANVAS.w}x${CANVAS.h}`,
    "-blur", "0x4", out,
  ]);
  await magick([
    out,
    "(", "-size", `${CANVAS.w}x${CANVAS.h}`, "radial-gradient:white-black",
    "-resize", `${CANVAS.w}x${CANVAS.h}!`, "+level", "62%,100%", "-blur", "0x40", ")",
    "-compose", "multiply", "-composite", "-modulate", "104", out,
  ]);
}

const bookSkus = () => {
  const csv = readFileSync("vendors/govinda/data/listings.csv", "utf8").replace(/^﻿/, "");
  const [head, ...lines] = csv.trim().split("\n");
  const cols = head.split(",");
  const iSku = cols.indexOf("sku"), iShelf = cols.indexOf("shelf");
  const out = new Set();
  for (const l of lines) {
    // shelf is never a quoted field, and sku is the first column.
    const parts = l.split(",");
    if (parts[iShelf] === "Books") out.add(parts[iSku]);
  }
  return out;
};

const skus = bookSkus();
const tmp = "/tmp/govinda-compose";
mkdirSync(tmp, { recursive: true });
const bd = path.join(tmp, "backdrop.jpg");
await backdrop(bd);

let done = 0, skipped = 0;
const files = (await import("node:fs")).readdirSync(DIR).filter((f) => /^govinda-\d+-\d+\.jpg$/.test(f));
for (const file of files.sort()) {
  const sku = file.match(/^govinda-(\d+)-/)[1];
  if (!skus.has(sku)) continue;
  const src = path.join(DIR, file);
  if (!(await isWhitePadded(src))) { skipped++; continue; }

  const cover = path.join(tmp, "cover.png");
  // -fuzz 8%: the "white" is JPEG-compressed and not uniformly 255. Anything tighter leaves
  // a ragged white fringe around the trim.
  await magick([src, "-fuzz", "8%", "-trim", "+repage", "-resize", `${FIT.w}x${FIT.h}`, cover]);

  const out = path.join(tmp, "out.jpg");
  await magick([
    bd,
    "(", cover,
    // The shadow is what stops this reading as two flat layers pasted together. Offset down
    // and slightly right, matching where the light falls in the closet photographs.
    "(", "+clone", "-background", "black", "-shadow", "55x18+6+16", ")",
    "+swap", "-background", "none", "-layers", "merge", "+repage", ")",
    "-gravity", "center", "-compose", "over", "-composite",
    "-quality", "92", out,
  ]);
  writeFileSync(src, readFileSync(out));
  unlinkSync(cover);
  done++;
  process.stderr.write(`\r  ${done} composited`);
}
console.error(`\n${done} book covers composited, ${skipped} already done or not white-padded`);
