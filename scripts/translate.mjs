#!/usr/bin/env node
// Fill the machine layer: everything the site can say in English, said in seven languages.
//
// Writes ONLY data/i18n/<lang>.json and data/i18n/status.json. It renders no pages and
// touches no override — running it can change what a later build is ABLE to publish, never
// what is live right now.
//
//   node scripts/translate.mjs                # translate whatever is missing or stale
//   node scripts/translate.mjs --lang de,fr   # only these
//   node scripts/translate.mjs --dry          # report the bill, call nothing
//   node scripts/translate.mjs --max 200000   # stop after this many characters this run
//
// QUOTA IS A BUDGET, NOT A FAILURE MODE
// -------------------------------------
// The free keys allow 500k characters each per month. Running out is an ordinary Tuesday,
// not an error: the run stops translating, records what is still outstanding in status.json,
// and exits 0. The build that follows publishes the strings that DID land and falls back to
// English for the rest, so a half-filled language is a slightly-English site rather than a
// broken one or a failed publish.
//
// WHAT IS DELIBERATELY NOT SENT
// -----------------------------
// See NO_MACHINE. Czech product copy is excluded: it is the home market, and machine Czech
// reads as machine Czech to a Czech reader — SEO-AI-PLAN.md section F7 makes the case at
// length. Czech attribute words (condition, colour) come from Vinted's own Czech storefront
// via sync-vinted.mjs, which is real Czech written by Vinted, not by a translator.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { translate, glossaryHit, KEEP_INLINE, keyUsage } from "./deepl.mjs";
import { LANGS, CODES, ROOT, DIR, hash, loadSources, saveSources, loadMachine, saveMachine, source, coverage } from "./i18n.mjs";
import { strings } from "./extract.mjs";
import { englishPages } from "./build-i18n.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const DRY = argv.includes("--dry");
const MAX_CHARS = Number(flag("--max", Infinity));
// --match "<regex>": only strings whose English matches, anchored. Keeps a run to the few
// strings the owner approved instead of the whole backlog.
const MATCH = flag("--match") ? new RegExp(`^(?:${flag("--match")})$`) : null;
const ONLY = flag("--lang") ? flag("--lang").split(",").map((s) => s.trim()) : CODES;

// DeepL takes up to 50 texts per request; the character ceiling is generous but a single
// enormous body is slower to retry than two medium ones, so batches are capped both ways.
const BATCH_TEXTS = 40;
const BATCH_CHARS = 25000;

// Keys a given language must never machine-translate. Matched against the key prefix.
const NO_MACHINE = {
  // Czech attribute words only. They come from Vinted's own Czech storefront via
  // sync-vinted.mjs (see sourcedCzech below) and would be strictly worse for a round trip
  // through an API. Czech titles and descriptions DO go to DeepL: Vinted turned out to
  // serve one seller-written description to every storefront, so there is no Czech original
  // to prefer — only English, or English put through a translator.
  cs: [/^attr\./],
};
const blocked = (lang, key) => (NO_MACHINE[lang] || []).some((re) => re.test(key));

const slug = (s) =>
  String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ------------------------------------------------------------------- sources ---- */

// Everything translatable in the catalogue. Attribute words (condition, colour) are keyed
// by their own value rather than by item, so "Very good" is translated once for the whole
// shop instead of 140 times — the single largest quota saving available here.
function catalogSources() {
  const file = path.join(ROOT, "data/catalog.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const items = Array.isArray(raw) ? raw : raw.items || Object.values(raw)[0];
  const out = {};
  for (const item of items) {
    if (item.hidden) continue;
    const label = `item ${item.id}`;
    if (item.title) out[`item.${item.id}.title`] = source(item.title, `${label} — title`);
    if (item.description) out[`item.${item.id}.description`] = source(item.description, `${label} — description`);
    for (const field of ["condition", "color"]) {
      const value = item[field]?.en;
      if (value) out[`attr.${field}.${slug(value)}`] = source(value, `${field} — used across the shop`);
    }
  }
  return out;
}

// Everything readable on the built English pages: headings, body copy, nav, buttons, page
// titles, meta descriptions, alt text. Keyed by a hash of the text itself rather than by
// where it sits, for two reasons: the same nav label appears on 95 pages and must be
// translated once, and a paragraph that gets rewritten is a NEW paragraph rather than a
// stale translation of the old one — prose has no identity apart from its words.
//
// Product fields are keyed by item id instead (see catalogSources), because a title IS the
// same thing after an edit, and an override on it should survive with a "the English
// changed" prompt rather than quietly detaching. Strings already carried by a product key
// are skipped here, so nothing is translated twice.
function pageSources(existing) {
  const known = new Set(Object.values(existing).map((s) => s.text));
  const out = {};
  for (const file of englishPages()) {
    for (const text of strings(readFileSync(path.join(ROOT, file), "utf8"))) {
      if (known.has(text) || out[`text.${hash(text)}`]) continue;
      out[`text.${hash(text)}`] = source(text, `page text — first seen on ${file}`);
    }
  }
  return out;
}

/* -------------------------------------------------------------------- sourced ---- */

// The Govinda vendor pipeline translated a Czech shop INTO English: vendors/govinda/data/
// translations.json is a Czech-original -> English map, 2,400 entries deep, and every
// English string on a Govinda product card came out of it. Inverted, it is a ready-made
// Czech translation of that half of the shop — written by the vendor, for Czech customers.
//
// Putting those strings through DeepL back into Czech would be a game of telephone with a
// perfectly good original sitting on disk. Where the same English came from two different
// Czech originals, the first wins and the rest are dropped: an ambiguous back-translation is
// worth less than a consistent one, and the dashboard is where a wrong pick gets fixed.
function govindaCzech(sources) {
  const file = path.join(ROOT, "vendors/govinda/data/translations.json");
  if (!existsSync(file)) return {};
  const pairs = JSON.parse(readFileSync(file, "utf8"));
  const byEnglish = new Map();
  for (const [cs, en] of Object.entries(pairs)) {
    if (typeof en === "string" && en.trim() && !byEnglish.has(en)) byEnglish.set(en, cs);
  }
  const out = {};
  for (const [key, src] of Object.entries(sources)) {
    const cs = byEnglish.get(src.text);
    if (cs && cs !== src.text) out[key] = { text: cs, src: src.src, via: "govinda-cs" };
  }
  return out;
}

// Czech that already exists as Czech, written by someone rather than by an API. Today that
// is Vinted's own attribute vocabulary, carried on the catalogue as condition.cs / color.cs
// by sync-vinted.mjs; Govinda's Czech-native listing copy joins it the same way.
//
// These land in the machine layer like any translation — the renderer should not care where
// a string came from — but carry `via`, so the dashboard can say "Vinted, Czech" instead of
// implying DeepL wrote it, and so a later pass can tell sourced text from generated text.
function sourcedCzech(sources) {
  const out = { ...govindaCzech(sources) };
  const file = path.join(ROOT, "data/catalog.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const items = Array.isArray(raw) ? raw : raw.items || Object.values(raw)[0];
  for (const item of items) {
    if (item.hidden) continue;
    for (const field of ["condition", "color"]) {
      const en = item[field]?.en;
      const cs = item[field]?.cs;
      if (!en || !cs) continue;
      const key = `attr.${field}.${slug(en)}`;
      if (sources[key]) out[key] = { text: cs, src: sources[key].src, via: "vinted-cz" };
    }
  }
  return out;
}

/* ------------------------------------------------------------------- filling ---- */

// Which keys this language still needs: never translated, or translated from English that
// has since changed. Ordered shortest-first so a run that hits the quota ceiling closes the
// largest NUMBER of gaps — a shop with every title translated and some descriptions missing
// reads better than the reverse.
// WHAT GETS TRANSLATED FIRST, WHEN THERE IS NOT ENOUGH QUOTA FOR EVERYTHING (25 Aug 2026).
//
// There was no answer to this before: the list came back in whatever order the sources
// object happened to hold, shortest string first, and a run that ran out of quota stopped
// wherever it stopped. With five languages 1,590 strings behind, that meant this week's new
// arrivals queued behind a backlog of older shelves — and the visitor browsing today is
// looking at the new arrivals, not at the 1,590th string of something listed in July.
//
// So: PRODUCTS BEFORE PAGES, and newest products first.
//
//   · Product strings are keyed `item.<id>.*` and `attr.*` (see catalogSources). They are
//     what a shopper actually reads on a shelf, and they are the ones that keep arriving.
//   · Page copy — headings, nav, body — changes rarely and is already translated. When it
//     does change it is usually a handful of strings, so it loses very little by going
//     second, and gains a complete set of product cards.
//   · Within products, newest first, by the date in data/first-seen.json — the same clock
//     the shelves sort by, so "newest" means the same thing in both places.
//   · Within a tier, shortest first, which is the old behaviour and is simply the cheapest
//     way to convert quota into finished strings.
const firstSeen = (() => {
  try {
    const raw = JSON.parse(readFileSync(path.join(ROOT, "data/first-seen.json"), "utf8"));
    return (id) => raw[id] || "";
  } catch {
    return () => "";
  }
})();

function outstanding(lang, sources, machine) {
  const rank = (key) => (/^(item|attr)\./.test(key) ? 0 : 1);
  // `item.<id>.title` -> `<id>`. Non-product keys never reach this.
  const seenOf = (key) => firstSeen(key.split(".")[1] ?? "");
  return Object.entries(sources)
    .filter(([key, src]) => !blocked(lang, key) && machine[key]?.src !== src.src && (!MATCH || MATCH.test(src.text)))
    .sort((a, b) =>
      rank(a[0]) - rank(b[0]) ||
      (rank(a[0]) === 0 ? seenOf(b[0]).localeCompare(seenOf(a[0])) : 0) ||
      a[1].text.length - b[1].text.length);
}

async function fill(lang, sources, budget) {
  const machine = loadMachine(lang);

  // Adding a term to the glossary's keep-list has to reach translations that were made
  // BEFORE it was added, or the fix only applies to strings nobody has translated yet —
  // which is the opposite of when you notice you need it. A cached entry that disagrees
  // with the glossary is dropped here and refilled below, at no quota cost: a keep-list hit
  // never reaches the API.
  //
  // TWO KINDS OF DISAGREEMENT, and only one of them used to be caught.
  //
  //   whole-string  glossaryHit fires when the term IS the string. The cached translation
  //                 must equal the term exactly.
  //   embedded      a keepInline term inside a longer sentence. Those are protected at send
  //                 time by an ignore_tags marker, so a CORRECT translation always contains
  //                 the term verbatim — and a cached one that does not is therefore known to
  //                 predate the protection. "Vinted Storefront" came back as "Vinted
  //                 Výkladní skříň" on 24 Aug 2026 and survived being added to keepInline,
  //                 because the whole-string check could not see inside the sentence.
  let corrected = 0;
  for (const [key, src] of Object.entries(sources)) {
    if (!machine[key]) continue;
    const hit = glossaryHit(src.text, LANGS[lang].deepl);
    const wrongWhole = hit !== undefined && machine[key].text !== hit;
    const wrongEmbedded = hit === undefined && KEEP_INLINE.some(
      (t) => src.text.includes(t) && !machine[key].text.includes(t));
    if (wrongWhole || wrongEmbedded) {
      delete machine[key];
      corrected++;
    }
  }
  if (corrected) {
    saveMachine(lang, machine);
    console.log(`  ${lang}: ${corrected} entries dropped — the glossary disagrees with them`);
  }
  const todo = outstanding(lang, sources, machine);
  const chars = todo.reduce((n, [, s]) => n + s.text.length, 0);
  if (!todo.length) return { lang, done: 0, chars: 0, remaining: 0, budget, exhausted: false };
  if (DRY) return { lang, done: 0, chars: 0, remaining: todo.length, budget, exhausted: false, wouldCost: chars };

  // Identical English is translated once per run even when it appears under several keys.
  // Nothing in the catalogue duplicates today, but a listing copy-pasted between two items
  // is exactly the sort of thing that happens without anyone deciding it should.
  const seen = new Map();
  let done = 0;
  let spent = 0;
  let exhausted = false;

  for (let i = 0; i < todo.length && !exhausted; ) {
    const batch = [];
    let size = 0;
    while (i < todo.length && batch.length < BATCH_TEXTS && size + todo[i][1].text.length <= BATCH_CHARS) {
      if (spent + size + todo[i][1].text.length > budget) break;
      batch.push(todo[i]);
      size += todo[i][1].text.length;
      i++;
    }
    if (!batch.length) break; // budget reached mid-list, or one string alone exceeds it

    const fresh = batch.filter(([, s]) => !seen.has(s.text));
    try {
      if (fresh.length) {
        const got = await translate(fresh.map(([, s]) => s.text), { to: LANGS[lang].deepl });
        fresh.forEach(([, s], n) => seen.set(s.text, got[n]));
      }
    } catch (err) {
      // Every key spent. Not an error: keep what landed, tell status.json, let the build run.
      console.warn(`  ${lang}: ${err.message} — stopping here, ${todo.length - done} left`);
      exhausted = true;
      break;
    }
    for (const [key, s] of batch) {
      machine[key] = { text: seen.get(s.text), src: s.src };
      done++;
    }
    spent += size;
    saveMachine(lang, machine); // checkpoint: a crash costs the last batch, not the run
  }
  return { lang, done, chars: spent, remaining: todo.length - done, budget, exhausted };
}

/* ---------------------------------------------------------------------- main ---- */

const catalog = catalogSources();
const sources = { ...catalog, ...pageSources(catalog) };
saveSources(sources);
console.log(`${Object.keys(sources).length} source strings`);

// Sourced Czech first: it costs no quota and it must not be overwritten by the fill pass,
// which skips anything already carrying a matching hash.
if (!DRY && ONLY.includes("cs")) {
  const sourced = sourcedCzech(sources);
  const machine = loadMachine("cs");
  let added = 0;
  for (const [key, entry] of Object.entries(sourced)) {
    if (machine[key]?.src === entry.src && machine[key]?.text === entry.text) continue;
    machine[key] = entry;
    added++;
  }
  if (added) saveMachine("cs", machine);
  console.log(`  cs: ${added} strings taken from Czech originals — Govinda listings and Vinted attributes (no quota spent)`);
}

const results = [];
let budget = MAX_CHARS;
for (const lang of ONLY) {
  if (!LANGS[lang]) throw new Error(`unknown language "${lang}" — known: ${CODES.join(", ")}`);
  const r = await fill(lang, sources, budget);
  budget -= r.chars;
  results.push(r);
  const note = r.exhausted ? " (quota exhausted)" : "";
  console.log(
    DRY
      ? `  ${lang}: ${r.remaining} outstanding, ${(r.wouldCost || 0).toLocaleString()} characters`
      : `  ${lang}: +${r.done} translated, ${r.remaining} outstanding${note}`,
  );
}

// How much quota each key has left, recorded on every run.
//
// `exhausted` below only catches a run that DIED with nothing to rotate to. It says nothing
// about a run that finished on its last surviving key, which is the state that actually
// wants a warning: three keys spent is a week's notice, four is a silent stop. Costs nothing
// — DeepL's usage endpoint is metadata, not translation — and carries no key material.
const keys = DRY ? null : await keyUsage().catch(() => null);
if (keys) {
  const dead = keys.filter((k) => k.ok && k.left <= 0).length;
  if (dead) console.log(`  DeepL quota: ${keys.length - dead} of ${keys.length} keys still have characters left`);
}

// status.json is what the dashboard and the weekly checklist read. It is derived state and
// safe to delete; the next run rewrites it.
if (!DRY) {
  writeFileSync(
    path.join(DIR, "status.json"),
    JSON.stringify(
      {
        _comment: "Written by scripts/translate.mjs. Derived — safe to delete, rebuilt each run.",
        generated: new Date().toISOString(),
        sources: Object.keys(sources).length,
        exhausted: results.some((r) => r.exhausted),
        keys,
        languages: CODES.map((c) => ({
          ...coverage(c, sources),
          outstanding: results.find((r) => r.lang === c)?.remaining ?? null,
          // Not a gap to fix — a deliberate exclusion. The dashboard shows it as a note so
          // nobody spends a Sunday wondering why Czech coverage never reaches 100%.
          excluded: (NO_MACHINE[c] || []).map(String),
        })),
      },
      null,
      2,
    ) + "\n",
  );
}
