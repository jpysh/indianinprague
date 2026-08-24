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

  for (let attempt = 0; attempt < KEYS.length; attempt++) {
    const key = KEYS[current];
    const body = new URLSearchParams();
    body.set("target_lang", to);
    if (tagHandling) body.set("tag_handling", tagHandling);
    for (const [, t] of pending) body.append("text", t);

    const res = await fetch("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (res.status === 456 || res.status === 429) {
      console.warn(`  DeepL key ${current + 1}/${KEYS.length} exhausted (HTTP ${res.status}) — rotating`);
      current = (current + 1) % KEYS.length;
      continue;
    }
    if (!res.ok) throw new Error(`DeepL HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { translations } = await res.json();
    pending.forEach(([i], n) => (out[i] = translations[n].text));
    return out;
  }
  throw new Error(`all ${KEYS.length} DeepL keys exhausted`);
}

/* ---------------------------------------------------------------- self-check ---- */
// Offline. Proves the glossary parses, both lookup paths resolve, and keys were read —
// the three ways this module fails silently at 07:15 with nobody watching.
if (process.argv[2] === "--check") {
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
  assert(KEYS.length > 0, "no DEEPL_KEY_n found in .env");
  const counts = Object.entries(GLOSSARY.terms).map(([l, t]) => `${l}:${Object.keys(t).length}`);
  console.log(`ok — ${KEYS.length} key(s), keep:${GLOSSARY.keep.length}, terms ${counts.join(" ")}`);
}
