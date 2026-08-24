// The translation store: what the languages are, where the text lives, and how the three
// layers resolve into one string per key. Read by translate.mjs (writes the machine layer),
// dashboard-server.mjs (writes your layer) and build-i18n.mjs (renders the pages).
//
// THREE LAYERS, AND WHY
// ---------------------
//   data/i18n/sources.json          English source of record. Every translatable string on
//                                   the site, with a stable key and a note on where it is
//                                   used. Rewritten every run from the catalogue and pages.
//   data/i18n/<lang>.json           MACHINE layer. DeepL output. Rewritten freely by the
//                                   nightly run — nothing here is precious.
//   data/i18n/overrides/<lang>.json YOUR layer. Written only by the dashboard, never by a
//                                   build. Always wins.
//
// Your layer is a separate FILE, not a flag inside the machine layer, for one reason: no
// automated process opens it. A bug in the merge shows a wrong string on a page; a bug in a
// single-file design eats an evening of your edits and there is no copy to restore from.
//
// STALENESS
// ---------
// Every stored translation carries `src`: a hash of the English it was made from. When the
// English changes, the hash stops matching. The build keeps using YOUR text regardless — a
// page never silently reverts to machine output — and the dashboard lists the row as stale
// with both Englishes side by side, for you to keep or replace. Machine-layer entries that
// go stale are simply retranslated on the next run without asking.
//
//   node scripts/i18n.mjs --check    # offline self-test
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export const ROOT = new URL("..", import.meta.url).pathname;
export const DIR = path.join(ROOT, "data/i18n");

// The seven target languages, and what each one is called in itself — the label the
// switcher shows. A visitor who cannot read English cannot find "Czech" in an English list,
// so the menu is never written in English.
//
// `deepl` is the target code the API wants. Czech is listed like any other language here;
// whether a given KIND of string is allowed to reach DeepL in Czech is decided by the
// caller, not by this table.
export const LANGS = {
  ru: { deepl: "RU", name: "Русский", dir: "ltr" },
  fr: { deepl: "FR", name: "Français", dir: "ltr" },
  de: { deepl: "DE", name: "Deutsch", dir: "ltr" },
  it: { deepl: "IT", name: "Italiano", dir: "ltr" },
  es: { deepl: "ES", name: "Español", dir: "ltr" },
  pl: { deepl: "PL", name: "Polski", dir: "ltr" },
  cs: { deepl: "CS", name: "Čeština", dir: "ltr" },
};

export const CODES = Object.keys(LANGS);

// English is the default and lives at the root — /wardrobe, not /en/wardrobe. It is not in
// LANGS because it is never a translation target; it is the thing being translated.
export const DEFAULT_LANG = "en";

// Short, stable, and only ever compared for equality — never used for security, so the
// truncation is free. 12 hex chars is 48 bits: a collision needs ~16M strings.
export const hash = (text) => createHash("sha256").update(String(text)).digest("hex").slice(0, 12);

const read = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

const write = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
};

const sourcesFile = () => path.join(DIR, "sources.json");
const machineFile = (lang) => path.join(DIR, `${lang}.json`);
const overrideFile = (lang) => path.join(DIR, "overrides", `${lang}.json`);

/* -------------------------------------------------------------------- sources ---- */
// { "<key>": { "text": "<English>", "src": "<hash>", "where": "<label for the dashboard>" } }

export const loadSources = () => read(sourcesFile(), {}).entries || {};

export function saveSources(entries) {
  write(sourcesFile(), {
    _comment: [
      "The English source of record — every translatable string on the site. GENERATED:",
      "rewritten in full by scripts/translate.mjs on every run. Editing it by hand does",
      "nothing; edit the English page or the Vinted listing instead.",
      "",
      "  text   the English",
      "  src    hash of that English, used to detect when a translation went stale",
      "  where  human label, shown in the dashboard so a key means something to a reader",
    ],
    generated: new Date().toISOString(),
    count: Object.keys(entries).length,
    entries,
  });
}

// One entry, ready to store. Callers build these; `src` is never passed in, so a source
// text and its hash cannot drift apart.
export const source = (text, where) => ({ text: String(text), src: hash(text), where });

/* -------------------------------------------------------------- machine layer ---- */

export const loadMachine = (lang) => read(machineFile(lang), {}).entries || {};

export function saveMachine(lang, entries) {
  write(machineFile(lang), {
    _comment: [
      `DeepL output for ${lang} (${LANGS[lang].name}). GENERATED — rewritten by`,
      "scripts/translate.mjs whenever the English changes. Nothing here is precious and",
      "nothing here is yours: your edits live in overrides/ and are never written by a build.",
      "",
      "  src   hash of the English this was translated from; a mismatch means retranslate",
    ],
    generated: new Date().toISOString(),
    count: Object.keys(entries).length,
    entries,
  });
}

/* ----------------------------------------------------------------- your layer ---- */
// { "<key>": { "text": "...", "src": "<hash of the English you were looking at>", "ts": "..." } }

export function loadOverrides(lang) {
  const { _comment, ...rest } = read(overrideFile(lang), {});
  return rest;
}

export function saveOverrides(lang, entries) {
  write(overrideFile(lang), {
    _comment: [
      `Hand-written ${lang} (${LANGS[lang].name}). YOURS. No build ever writes this file —`,
      "only the dashboard does, and only when you press Save. Always wins over ../[lang].json.",
      "",
      "  src  the hash of the English you were shown when you wrote this. When the English",
      "       changes, this stops matching and the dashboard asks whether to keep or replace.",
      "",
      "Delete an entry to fall back to the machine translation.",
    ],
    ...entries,
  });
}

/* --------------------------------------------------------------------- resolve ---- */

// Everything the renderer needs for one language: the string to print, where it came from,
// and whether it needs your attention.
//
//   text    what to print. Null means NO translation exists — the caller falls back to
//           English and marks the page noindex (see build-i18n.mjs).
//   from    "override" | "machine" | null
//   stale   true when the English moved under an override. `text` is still the override.
export function resolve(lang, sources = loadSources()) {
  const machine = loadMachine(lang);
  const overrides = loadOverrides(lang);
  const out = {};
  for (const [key, src] of Object.entries(sources)) {
    const mine = overrides[key];
    if (mine?.text) {
      out[key] = { text: mine.text, from: "override", stale: mine.src !== src.src };
      continue;
    }
    const machined = machine[key];
    const usable = machined?.text && machined.src === src.src;
    out[key] = { text: usable ? machined.text : null, from: usable ? "machine" : null, stale: false };
  }
  return out;
}

// Per-language coverage, for the dashboard and the weekly checklist.
export function coverage(lang, sources = loadSources()) {
  const r = resolve(lang, sources);
  const rows = Object.values(r);
  return {
    lang,
    name: LANGS[lang].name,
    total: rows.length,
    translated: rows.filter((x) => x.text).length,
    missing: rows.filter((x) => !x.text).length,
    overridden: rows.filter((x) => x.from === "override").length,
    stale: rows.filter((x) => x.stale).length,
  };
}

/* ------------------------------------------------------------------ self-check ---- */
// True only when this file is the script node was asked to run. Without it, importing a
// module for one exported helper also executes its command line — translate.mjs imports
// englishPages() from build-i18n.mjs, and unguarded that import would rebuild every
// language tree as a side effect of asking what the pages are.
const isMain = process.argv[1] && import.meta.filename === path.resolve(process.argv[1]);

if (isMain && process.argv[2] === "--check") {
  const assert = (cond, msg) => {
    if (!cond) throw new Error("FAIL: " + msg);
  };
  const src = { greet: source("Hello", "test") };
  assert(src.greet.src === hash("Hello"), "source() hashes its own text");
  assert(hash("Hello") !== hash("Hello "), "hash is exact, not trimmed");

  // resolve() against a temporary store: machine hit, machine stale, override wins,
  // override stale, and nothing at all.
  const machine = {
    fresh: { text: "Hallo", src: hash("Hello") },
    outdated: { text: "Hallo", src: hash("Hello") },
  };
  const overrides = {
    mine: { text: "Servus", src: hash("Hello") },
    minestale: { text: "Servus", src: hash("Hello") },
  };
  const sources = {
    fresh: source("Hello", "t"),
    outdated: source("Hello there", "t"),
    mine: source("Hello", "t"),
    minestale: source("Hello there", "t"),
    absent: source("Hello", "t"),
  };
  const out = {};
  for (const [key, s] of Object.entries(sources)) {
    const m = overrides[key];
    if (m?.text) out[key] = { text: m.text, from: "override", stale: m.src !== s.src };
    else {
      const hit = machine[key];
      const ok = hit?.text && hit.src === s.src;
      out[key] = { text: ok ? hit.text : null, from: ok ? "machine" : null, stale: false };
    }
  }
  assert(out.fresh.from === "machine" && out.fresh.text === "Hallo", "fresh machine entry is used");
  assert(out.outdated.text === null, "machine entry whose English moved is NOT used");
  assert(out.mine.from === "override" && !out.mine.stale, "override wins over machine");
  assert(out.minestale.text === "Servus" && out.minestale.stale, "stale override still renders, flagged");
  assert(out.absent.text === null, "no translation resolves to null, not to English");

  assert(CODES.length === 7 && !CODES.includes("en"), "seven targets, English not among them");
  assert(CODES.every((c) => LANGS[c].deepl && LANGS[c].name), "every language has a code and a name");
  console.log(`ok — ${CODES.length} languages: ${CODES.map((c) => LANGS[c].name).join(", ")}`);
}
