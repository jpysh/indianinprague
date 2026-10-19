#!/usr/bin/env node
// Shopper checks on a phone, in WebKit (iPhone Safari's engine), with reduced motion.
// The checks every ship run repeats by hand (CLAUDE.md "iOS Safari", DESIGN.md §2):
//   - no sideways scroll at 100% and at 200% text
//   - visible tap targets at least 44 x 44 px
//   - text contrast at least 4.5:1 against what is behind it (photos skipped)
// It prints problems and exits 1 if any, and saves a screenshot per page.
//
//   cd tools/check && npm ci && npx playwright install webkit     # once
//   node tools/check/check-mobile.mjs /wardrobe/jewellery /cs/wardrobe /
//   BASE=https://guldaarbazaar.com node tools/check/check-mobile.mjs /wardrobe
//
// BASE defaults to the site-root preview server (.claude/launch.json, port 4322).
import { webkit, devices } from "playwright";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE || "http://localhost:4322";
const pages = process.argv.slice(2);
if (!pages.length) { console.error("usage: check-mobile.mjs <path> [path...]"); process.exit(2); }
const shots = process.env.SHOTS || os.tmpdir();

// Runs in the page. Returns a list of problem strings.
const audit = () => {
  const out = [];
  const W = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > W + 1) out.push(`sideways scroll: ${document.documentElement.scrollWidth}px on ${W}px`);
  const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bg = (e) => { for (; e; e = e.parentElement) { const v = rgb(getComputedStyle(e).backgroundColor); if (v.length < 4 || v[3] > 0.5) return v; } return [255, 255, 255]; };
  const seen = new Set();
  for (const e of document.querySelectorAll("body *")) {
    if (!e.offsetParent || e.closest(".frame,[hidden],.vh")) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || r.bottom < 0) continue;
    const name = `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]}`;
    if (e.matches("a,button,summary,select,input") && (r.width < 44 || r.height < 44) && getComputedStyle(e).position !== "absolute") {
      const k = "t" + name; if (!seen.has(k)) { seen.add(k); out.push(`target ${Math.round(r.width)}x${Math.round(r.height)}: ${name} "${e.textContent.trim().slice(0, 30)}"`); }
    }
    if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      const a = lum(rgb(getComputedStyle(e).color)), b = lum(bg(e));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const k = "c" + name; if (ratio < 4.5 && !seen.has(k)) { seen.add(k); out.push(`contrast ${ratio.toFixed(1)}:1: ${name} "${e.textContent.trim().slice(0, 30)}"`); }
    }
  }
  return out;
};

const browser = await webkit.launch();
let failed = 0;
for (const p of pages) {
  const page = await browser.newPage({ ...devices["iPhone 13"], reducedMotion: "reduce" });
  await page.goto(BASE + p, { waitUntil: "load" });
  await page.waitForTimeout(800);
  const normal = await page.evaluate(audit);
  await page.screenshot({ path: path.join(shots, `check-${p.replace(/\W+/g, "_") || "home"}.png`) });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.waitForTimeout(300);
  const big = (await page.evaluate(audit)).filter((s) => s.startsWith("sideways")).map((s) => "at 200% text, " + s);
  const all = [...normal, ...big];
  console.log(`${all.length ? "✗" : "✓"} ${p}`);
  for (const s of all) console.log("   " + s);
  failed += all.length;
  await page.close();
}
await browser.close();
console.log(`screenshots: ${shots}`);
process.exit(failed ? 1 : 0);
