// Rescue Govinda's product photography for a grid built around full-bleed photographs.
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
// EVERY category is padded this way, not just books — measured across incense, statues,
// bracelets, bowls and pictures: all of them are a 700x700 (occasionally 800x800) shot on
// the same white 1100x1422 canvas. So there are two treatments, and which one applies is
// decided by what the picture IS:
//
//   Books      a cover, shot flat against nothing, so it gets the closet's own cloth
//              behind it and reads like the rest of the shelf.
//   Everything a photograph that already has its own setting — a table, a cloth, a
//   else     surface. Putting a second background behind one of those would be two
//              backdrops in one frame. These are trimmed and enlarged instead.
//
// The frame is 900x1600 either way and the CSS crops with object-fit:cover, so a square
// photo left at its own aspect would have its sides cut off. The portrait canvas is filled
// with the photograph's OWN edge colour — sampled from the outer ring, which is the surface
// the object was shot on. Not white, which would leave the photo floating in a bright block
// on a dark page, and not a blur, which duplicates the object and reads as a mistake.
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
  // Vignetted, not blurred. The vignette imitates light falling off at the edges of the
  // closet photographs and keeps the eye on the cover; a blur was tried and dropped, because
  // it read as a defect at thumbnail size rather than as depth of field — the block print is
  // the point of the cloth, and softening it threw away the detail that makes it recognisably
  // the same fabric the Vinted photographs are shot on.
  await magick([
    BACKDROP, "-auto-orient",
    "-resize", `${CANVAS.w}x${CANVAS.h}^`, "-gravity", "center", "-extent", `${CANVAS.w}x${CANVAS.h}`,
    out,
  ]);
  await magick([
    out,
    "(", "-size", `${CANVAS.w}x${CANVAS.h}`, "radial-gradient:white-black",
    "-resize", `${CANVAS.w}x${CANVAS.h}!`, "+level", "62%,100%", "-blur", "0x40", ")",
    "-compose", "multiply", "-composite", "-modulate", "104", out,
  ]);
}

const shelfSkus = () => {
  const csv = readFileSync("vendors/govinda/data/listings.csv", "utf8").replace(/^﻿/, "");
  const [head, ...lines] = csv.trim().split("\n");
  const cols = head.split(",");
  const iSku = cols.indexOf("sku"), iShelf = cols.indexOf("shelf");
  const out = new Map();
  for (const l of lines) {
    // shelf is never a quoted field, and sku is the first column.
    const parts = l.split(",");
    if (parts[iSku]) out.set(parts[iSku], parts[iShelf]);
  }
  return out;
};

const shelves = shelfSkus();
const tmp = "/tmp/govinda-compose";
mkdirSync(tmp, { recursive: true });
const bd = path.join(tmp, "backdrop.jpg");
await backdrop(bd);

// The surface the object was photographed on, read from the outer ring of the trimmed
// picture rather than from a corner: a corner can land on the object itself in a tightly
// cropped shot, and one stray pixel would tint the whole frame.
async function edgeColour(file) {
  const { stdout } = await magick([
    file, "-fuzz", "8%", "-trim", "+repage",
    "-gravity", "south", "-crop", "100%x8%+0+0", "+repage",
    "-resize", "1x1!", "-format", "%[pixel:p{0,0}]", "info:",
  ]);
  return stdout.trim();
}

let books = 0, goods = 0, skipped = 0;
const files = (await import("node:fs")).readdirSync(DIR).filter((f) => /^govinda-\d+-\d+\.jpg$/.test(f));
for (const file of files.sort()) {
  const sku = file.match(/^govinda-(\d+)-/)[1];
  const shelf = shelves.get(sku);
  if (!shelf) continue;
  const src = path.join(DIR, file);
  if (!(await isWhitePadded(src))) { skipped++; continue; }
  const out = path.join(tmp, "out.jpg");

  if (shelf === "Books") {
    const cover = path.join(tmp, "cover.png");
    // -fuzz 8%: the "white" is JPEG-compressed and not uniformly 255. Anything tighter
    // leaves a ragged white fringe around the trim.
    await magick([src, "-fuzz", "8%", "-trim", "+repage", "-resize", `${FIT.w}x${FIT.h}`, cover]);
    await magick([
      bd,
      "(", cover,
      // The shadow is what stops this reading as two flat layers pasted together. Offset
      // down and slightly right, matching where the light falls in the closet photographs.
      "(", "+clone", "-background", "black", "-shadow", "55x18+6+16", ")",
      "+swap", "-background", "none", "-layers", "merge", "+repage", ")",
      "-gravity", "center", "-compose", "over", "-composite",
      "-quality", "92", out,
    ]);
    unlinkSync(cover);
    books++;
  } else {
    // Trimmed and enlarged to 92% of the frame width — the zoom — then the portrait canvas
    // is filled out with the photograph's own surface colour.
    const fill = await edgeColour(src);
    await magick([
      src, "-fuzz", "8%", "-trim", "+repage",
      "-resize", `${Math.round(CANVAS.w * 0.92)}x${Math.round(CANVAS.h * 0.88)}`,
      "-background", fill, "-gravity", "center", "-extent", `${CANVAS.w}x${CANVAS.h}`,
      "-quality", "92", out,
    ]);
    goods++;
  }

  writeFileSync(src, readFileSync(out));
  process.stderr.write(`\r  ${books} covers, ${goods} product shots`);
}
console.error(`\n${books} book covers on cloth, ${goods} product shots zoomed, ${skipped} already done or not white-padded`);
