#!/usr/bin/env node
// Translate the full product descriptions that the detail sheet shows.
//
//   node scripts/translate-desc.mjs            # translate whatever is missing or stale
//   node scripts/translate-desc.mjs --dry      # report the bill, call nothing
//   node scripts/translate-desc.mjs --max 200000 --lang de,fr
//
// Source: wardrobe/desc/<id>.txt, written by build-shop.mjs (run that first).
// Store:  data/i18n/desc/<lang>.json  {id: {src: hash-of-English, text}}  — committed.
// Output: wardrobe/desc/<lang>/<id>.txt, which shop.js fetches on pages in that language.
//
// Kept apart from translate.mjs on purpose: the site-string store is keyed by page copy, and
// these texts appear on no page, so they would only be pruned as orphans there.
// Quota behaves as in translate.mjs: running out stops the run, exits 0, and the rest stay
// English-less (the sheet keeps the translated short text) until the next run.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { translate } from "./deepl.mjs";
import { LANGS, CODES, ROOT, hash } from "./i18n.mjs";

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const DRY = argv.includes("--dry");
const MAX = Number(flag("--max", Infinity));
const ONLY = flag("--lang") ? flag("--lang").split(",") : CODES;
const BATCH_TEXTS = 40, BATCH_CHARS = 25000;

const SRC = path.join(ROOT, "wardrobe/desc");
const STORE = path.join(ROOT, "data/i18n/desc");
mkdirSync(STORE, { recursive: true });

const english = new Map(readdirSync(SRC).filter((f) => f.endsWith(".txt"))
  .map((f) => [f.slice(0, -4), readFileSync(path.join(SRC, f), "utf8")]));

let spent = 0, stopped = false;
for (const lang of ONLY) {
  const file = path.join(STORE, lang + ".json");
  const have = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  for (const id of Object.keys(have)) if (!english.has(id)) delete have[id];
  const todo = [...english].filter(([id, t]) => have[id]?.src !== hash(t));
  const chars = todo.reduce((n, [, t]) => n + t.length, 0);
  console.log(`${lang}: ${todo.length} to translate, ${chars} chars`);
  if (!DRY) {
    for (let i = 0; i < todo.length && !stopped;) {
      const batch = []; let n = 0;
      while (i < todo.length && batch.length < BATCH_TEXTS && n + todo[i][1].length <= BATCH_CHARS) { n += todo[i][1].length; batch.push(todo[i++]); }
      if (!batch.length) { i++; continue; }
      if (spent + n > MAX) { stopped = true; break; }
      try {
        const out = await translate(batch.map(([, t]) => t), { to: LANGS[lang].deepl });
        batch.forEach(([id, t], k) => { have[id] = { src: hash(t), text: out[k] }; });
        spent += n;
      } catch (e) { console.warn(`  ${lang}: ${e.message} — stopping, rest next run`); stopped = true; }
    }
    writeFileSync(file, JSON.stringify(have) + "\n");
  }
  // Publish what the store holds, current entries only.
  if (!DRY) {
    const dir = path.join(SRC, lang);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [id, t] of english) if (have[id]?.src === hash(t)) writeFileSync(path.join(dir, id + ".txt"), have[id].text);
  }
  if (stopped) break;
}
console.log(DRY ? "dry run, nothing called" : `${spent} chars sent`);
