// DeepL, across several free-tier keys.
//
// A free key allows 500k characters a month and the full product pass is roughly 1.2M, so
// the keys are used in rotation: on 456 (quota exceeded) the next key takes over. This is
// against DeepL's terms for free accounts and a key can be disabled mid-run — which is why
// exhausting every key raises rather than silently returning Czech.
import { readFileSync } from "node:fs";

const KEYS = (() => {
  const env = readFileSync(new URL("./.env", import.meta.url), "utf8");
  return [...env.matchAll(/^DEEPL_KEY_\d+=(.+)$/gm)].map((m) => m[1].trim()).filter(Boolean);
})();

let current = 0;

// Terms DeepL has no business guessing at. Czech transliterations of Sanskrit are read as
// Czech words and come back as nonsense ("Kantimály" -> "Cantimals"), so they are resolved
// here before the text is ever sent and DeepL never sees them.
export const GLOSSARY = JSON.parse(
  readFileSync(new URL("./data/glossary.json", import.meta.url), "utf8"),
);

// source_lang is deliberately NOT sent. The catalogue is mostly Czech but not entirely:
// the foreign-language book branch carries Ukrainian, Russian and Vietnamese editions, and
// forcing CS on those returns transliterated nonsense. DeepL detects per request.
export async function translate(texts, { to = "EN-GB" } = {}) {
  const out = [];
  for (const text of texts) {
    const hit = GLOSSARY[text.trim()];
    out.push(hit === undefined ? null : hit);
  }
  const pending = texts.map((t, i) => [i, t]).filter(([i]) => out[i] === null);
  if (!pending.length) return out;

  for (let attempt = 0; attempt < KEYS.length; attempt++) {
    const key = KEYS[current];
    const body = new URLSearchParams();
    body.set("target_lang", to);
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
