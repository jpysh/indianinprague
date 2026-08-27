// DeepL, across several free-tier keys. Shared by the site translation pass
// (scripts/translate.mjs) and the Govinda vendor pipeline (vendors/govinda/).
//
// A free key allows 500k characters a month and the initial site fill is roughly 1.2-1.5M,
// so the keys are used in rotation: on 456 (quota exceeded) the next key takes over. This is
// against DeepL's terms for free accounts and a key can be disabled mid-run — which is why
// exhausting every key raises rather than silently returning untranslated text. The caller
// decides what an exhausted run means; the site build treats it as a gap to carry, not a
// failure, and reports it on the dashboard.
//
// WHY THIS LIVES IN scripts/ AND NOT vendors/govinda/
// --------------------------------------------------
// It started as Govinda's, then the site needed the same client and the same glossary. Two
// copies of a key-rotating API client is two places to fix a bug in, and two glossaries is a
// proper noun translated correctly on one page and mangled on the next. One client, one
// glossary (data/i18n/glossary.json), one .env at the repo root.
//
//   node scripts/deepl.mjs --check     # offline: glossary loads, lookups resolve, keys found
import { readFileSync } from "node:fs";
import path from "node:path";

// Keys live in .env at the REPO ROOT, not beside a vendor script: they are now a site-wide
// secret, not Govinda's. The file is gitignored — it holds credentials and nothing else.
const KEYS = (() => {
  let env = "";
  try {
    env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch {
    throw new Error(
      ".env not found at the repo root. Copy .env.example to .env and " +
        "fill in DEEPL_KEY_1= (add DEEPL_KEY_2=, _3= to spread the monthly free quota).",
    );
  }
  return [...env.matchAll(/^DEEPL_KEY_\d+=(.+)$/gm)].map((m) => m[1].trim()).filter(Boolean);
})();

let current = 0;

const GLOSSARY = JSON.parse(
  readFileSync(new URL("../data/i18n/glossary.json", import.meta.url), "utf8"),
);

// What the glossary says about one string, or undefined if it has nothing to say.
// `keep` wins over `terms`: a name that must survive intact survives intact everywhere,
// and a per-language entry for it would be a contradiction rather than a refinement.
export function glossaryHit(text, to) {
  const key = text.trim();
  if (GLOSSARY.keep.includes(key)) return key;
  return GLOSSARY.terms[to]?.[key];
}

// Keep-terms EMBEDDED in a longer string (24 Aug 2026).
//
// glossaryHit only fires when the term IS the whole string, which protects a bare
// "Guldaar Bazaar" and nothing else. The list used here is glossary.keepInline, NOT keep:
// keep holds Prague and Praha, and freezing those mid-sentence would leave Czech prose
// saying Prague where it should say Praha. The rebrand exposed the gap: "Page not found: Guldaar
// Bazaar" went to DeepL as ordinary prose and came back as "Страница не найдена:
// Гульдар-Базар" — the brand transliterated into Cyrillic on a page title. A brand name is
// the one thing on a page that must read identically in every language.
//
// The fix is DeepL's own ignore_tags: wrap each keep-term in a marker element and name that
// element as ignored, and the API returns its contents byte-for-byte while still translating
// and re-ordering the prose around it. Cheaper and more reliable than trying to detect a
// transliteration after the fact — there is no general test for "this is my brand, spelled
// differently".
//
// The marker is <x> because it must not collide with anything in the site's own HTML
// fragments, which this pass also translates.
const MARK = "x";
// Exported so translate.mjs can spot a CACHED translation that predates a term being added
// here — see the two-kinds-of-disagreement note there.
export const KEEP_INLINE = GLOSSARY.keepInline ?? [];
const protectKeep = (text) => {
  let out = text;
  for (const term of KEEP_INLINE) {
    if (out.includes(term)) out = out.split(term).join(`<${MARK}>${term}</${MARK}>`);
  }
  return out;
};
const unprotect = (text) =>
  text.replaceAll(`<${MARK}>`, "").replaceAll(`</${MARK}>`, "");

// source_lang is deliberately NOT sent. The Govinda catalogue is mostly Czech but not
// entirely: the foreign-language book branch carries Ukrainian, Russian and Vietnamese
// editions, and forcing CS on those returns transliterated nonsense. DeepL detects per
// request. The site pass sends English, which detects reliably.
//
// Returns one entry per input, in order. `tagHandling: "html"` sends markup through intact
// — the site pass translates HTML fragments, not bare strings.
export async function translate(texts, { to = "EN-GB", tagHandling } = {}) {
  const out = texts.map((t) => glossaryHit(t, to) ?? null);
  const pending = texts.map((t, i) => [i, t]).filter(([i]) => out[i] === null);
  if (!pending.length) return out;

  // Wrap keep-terms before sending. Marking the request as HTML is required for ignore_tags
  // to mean anything; it is a no-op for the plain strings that carry no markup, and the site
  // pass already sends tag_handling html for its fragments.
  const wrapped = pending.map(([, t]) => protectKeep(t));
  const guarded = wrapped.some((t, i) => t !== pending[i][1]);

  // 429 IS NOT 456, AND CONFLATING THEM COST FIVE LANGUAGES A DAY'S TRANSLATION.
  //
  // 456 means the key's monthly quota is spent: the key is finished until the billing period
  // rolls over, and rotating to the next one is the only thing that can help.
  //
  // 429 means TOO MANY REQUESTS — a temporary throttle on an account that is otherwise fine.
  // Until 25 Aug 2026 both statuses rotated, so a throttle that arrived mid-run was read as
  // four dead keys in under a second and the run gave up. Measured on the morning of the
  // 25th: Russian finished 1,589 strings at full speed, DeepL throttled, and French stopped
  // 269 short while German, Italian, Spanish, Polish and Czech got nothing at all. Every key
  // still had quota — the same key translated 23,112 characters by hand two hours later.
  //
  // So a 429 now WAITS on the same key instead of spending the pool on it. DeepL sends
  // Retry-After on these; where it does not, the backoff doubles from one second. Only a 456
  // rotates, which is what rotation was for.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MAX_THROTTLE_WAITS = 5;
  let waits = 0;

  // `attempt` counts KEYS tried, so a wait-and-retry must not consume one — otherwise a
  // throttled run still walks the pool, just more slowly.
  for (let attempt = 0; attempt < KEYS.length; attempt++) {
    const key = KEYS[current];
    const body = new URLSearchParams();
    body.set("target_lang", to);
    if (tagHandling || guarded) body.set("tag_handling", tagHandling || "html");
    if (guarded) body.set("ignore_tags", MARK);
    for (const t of wrapped) body.append("text", t);

    const res = await fetch("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (res.status === 429 && waits < MAX_THROTTLE_WAITS) {
      // Retry-After is in seconds when present. The fallback doubles: 1s, 2s, 4s, 8s, 16s,
      // which is 31 seconds of patience in total before this key is treated as unusable.
      const after = Number(res.headers.get("retry-after"));
      const ms = Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** waits;
      waits++;
      console.warn(`  DeepL rate-limited (HTTP 429) — waiting ${Math.round(ms / 1000)}s and retrying key ${current + 1}/${KEYS.length} (${waits}/${MAX_THROTTLE_WAITS})`);
      await sleep(ms);
      attempt--; // this was not a key attempt; the same key is about to be tried again
      continue;
    }
    if (res.status === 456 || res.status === 429) {
      const why = res.status === 456 ? "quota spent" : "still rate-limited after backoff";
      console.warn(`  DeepL key ${current + 1}/${KEYS.length} unusable (HTTP ${res.status}, ${why}) — rotating`);
      current = (current + 1) % KEYS.length;
      waits = 0;   // the next key gets its own patience, not this one's leftovers
      continue;
    }
    if (!res.ok) throw new Error(`DeepL HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { translations } = await res.json();
    pending.forEach(([i], n) => (out[i] = unprotect(translations[n].text)));
    return out;
  }
  throw new Error(`all ${KEYS.length} DeepL keys exhausted`);
}

/* ---------------------------------------------------------------- self-check ---- */
// True only when this file is the script node was asked to run. Without it, importing a
// module for one exported helper also executes its command line — translate.mjs imports
// englishPages() from build-i18n.mjs, and unguarded that import would rebuild every
// language tree as a side effect of asking what the pages are.
const isMain = process.argv[1] && import.meta.filename === path.resolve(process.argv[1]);

// Offline. Proves the glossary parses, both lookup paths resolve, and keys were read —
// the three ways this module fails silently at 07:15 with nobody watching.
if (isMain && process.argv[2] === "--check") {
  const assert = (cond, msg) => {
    if (!cond) throw new Error("FAIL: " + msg);
  };
  assert(Array.isArray(GLOSSARY.keep), "glossary.keep must be an array");
  assert(GLOSSARY.terms && typeof GLOSSARY.terms === "object", "glossary.terms must be an object");
  assert(glossaryHit("Meditace", "EN-GB") === "Meditation", "EN-GB term lookup");
  assert(glossaryHit("  Meditace  ", "EN-GB") === "Meditation", "lookup trims");
  assert(glossaryHit("Meditace", "DE") === undefined, "term does not leak across languages");
  assert(glossaryHit("no-such-string-here", "EN-GB") === undefined, "miss returns undefined");
  GLOSSARY.keep.forEach((k) =>
    assert(glossaryHit(k, "PL") === k, `keep entry passes through unchanged: ${k}`),
  );
  // The embedded-keep-term guard. The bare-string path is covered above; this is the one
  // that regressed a brand name into Cyrillic before it existed.
  const brand = GLOSSARY.keepInline[0];
  const sentence = `Page not found: ${brand}`;
  assert(protectKeep(sentence) === `Page not found: <x>${brand}</x>`, "embedded keep term is wrapped");
  assert(unprotect(protectKeep(sentence)) === sentence, "wrap/unwrap round-trips");
  assert(protectKeep("nothing to protect here") === "nothing to protect here", "untouched when no keep term");
  // The narrowing itself, so a later edit cannot quietly widen it back: place names stay
  // translatable inside a sentence even though they are whole-string keep entries.
  assert(!protectKeep("shipping across Europe from Prague").includes("<x>"),
    "place names are NOT frozen mid-sentence");
  assert(unprotect("Stránka nenalezena: <x>" + brand + "</x>") === `Stránka nenalezena: ${brand}`,
    "markers stripped from a translated result");
  assert(KEYS.length > 0, "no DEEPL_KEY_n found in .env");
  const counts = Object.entries(GLOSSARY.terms).map(([l, t]) => `${l}:${Object.keys(t).length}`);
  console.log(`ok — ${KEYS.length} key(s), keep:${GLOSSARY.keep.length}, terms ${counts.join(" ")}`);
}

/* ---------------------------------------------------------------- key health ---- */

// How much of each key's monthly free quota is gone, from DeepL's own /v2/usage endpoint.
//
// This costs NO quota — usage is metadata, not a translation — which is what makes it safe to
// call from the dashboard on demand and from every nightly run.
//
// It exists because "all keys spent" was only ever noticed the hard way. status.json's
// `exhausted` flag is set when a run dies MID-WAY with nothing left to rotate to; a run that
// limps home on the last surviving key reports plain success. On 27 Aug 2026 three of four
// keys were spent and every run looked fine — the only symptom would have been the day the
// fourth ran out and new copy silently stopped being translated.
//
// NO KEY MATERIAL IS RETURNED. The index and the numbers, nothing else: this feeds a file in
// the repo (data/i18n/status.json) and a page in the dashboard, and a secret that reaches
// either is a secret that reaches a commit.
export async function keyUsage() {
  return Promise.all(
    KEYS.map(async (key, i) => {
      const n = i + 1;
      try {
        const res = await fetch("https://api-free.deepl.com/v2/usage", {
          headers: { Authorization: `DeepL-Auth-Key ${key}` },
        });
        if (!res.ok) return { n, ok: false, why: `HTTP ${res.status}` };
        const { character_count: used, character_limit: limit } = await res.json();
        return { n, ok: true, used, limit, left: Math.max(0, limit - used), pct: limit ? used / limit : 1 };
      } catch (err) {
        // A key that cannot be reached is not a key that is spent, and saying so matters:
        // one is "top me up", the other is "your wifi is down".
        return { n, ok: false, why: err.message.slice(0, 60) };
      }
    }),
  );
}
