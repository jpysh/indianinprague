// Pull the translatable text out of a finished HTML page, and put it back translated.
//
// Shared by translate.mjs (which needs to know WHAT to send to DeepL) and build-i18n.mjs
// (which needs to put the answers back). One tokenizer, used both ways, so the set of
// strings that get translated and the set that get substituted cannot drift apart.
//
// WHY NOT A REAL HTML PARSER
// --------------------------
// Because there isn't one here, deliberately: every script in scripts/ imports node
// builtins only (see package.json). A parser would mean a dependency, a build-container
// install, and a supply chain — for the job of finding text between angle brackets in HTML
// that THIS repo generated and therefore controls. The tokenizer below splits on tags and
// never tries to build a tree, which is enough because we only ever put a string back
// exactly where we found it.
//
//   node scripts/extract.mjs --check
//   node scripts/extract.mjs <file>   # list what would be translated
import { readFileSync } from "node:fs";
import path from "node:path";

// Text inside these never means anything to a reader.
const OPAQUE = new Set(["script", "style", "svg", "code", "pre"]);

// Elements that close themselves. Needed to keep the nesting count honest when tracking a
// translate="no" subtree — an <img> that pushed a level would never pop one.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

// Attributes a person actually reads. `content` is only translatable on the meta tags that
// carry prose — a meta[property="og:type"] content="website" must not be translated, and
// neither must a viewport or a charset.
const TEXT_ATTRS = new Set(["alt", "title", "placeholder", "aria-label"]);
const META_PROSE = /(name|property)="(description|og:title|og:description|og:image:alt|twitter:title|twitter:description|apple-mobile-web-app-title)"/;

// A string worth sending: has a letter in it, and is not a bare number, a URL, or a figure
// with a unit stuck to it. "1 200 Kč" and "L / 40 / 12" are data — DeepL would happily
// reformat the thousands separator and the size, and a translated price is a wrong price.
// The test for those is "contains a digit and almost no letters", which keeps "12 items"
// (five letters) and drops "1 200 Kč" (two).
export const translatable = (s) => {
  if (!/\p{L}/u.test(s)) return false;
  if (/^https?:\/\//.test(s.trim())) return false;
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (/\d/.test(s) && letters.length <= 3) return false;
  return true;
};

// Split into tags and text, in order. Everything the page contains is in exactly one piece,
// so joining the pieces back together reproduces the input byte for byte — which the
// self-check asserts, because a lossy tokenizer would silently eat markup on every page.
function tokenize(html) {
  const out = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out.push({ tag: false, raw: html.slice(i) });
      break;
    }
    if (lt > i) out.push({ tag: false, raw: html.slice(i, lt) });
    // Comments and CDATA-ish blocks run to their own terminator, not to the next ">".
    const isComment = html.startsWith("<!--", lt);
    const end = isComment ? html.indexOf("-->", lt) + 3 : html.indexOf(">", lt) + 1;
    if (end <= lt) {
      out.push({ tag: false, raw: html.slice(lt) });
      break;
    }
    out.push({ tag: true, raw: html.slice(lt, end), comment: isComment });
    i = end;
  }
  return out;
}

const tagName = (raw) => (/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(raw) || [, ""])[1].toLowerCase();

// Walk a page, calling back with every translatable string. `fn` returns a replacement, or
// null/undefined to leave the string alone. Returns the rebuilt HTML.
//
// Entities are NOT decoded: "Jain&nbsp;family" goes to DeepL with the entity in it, comes
// back with it intact, and is written back unchanged. Decoding would mean re-encoding, and
// re-encoding is where markup gets mangled.
export function walk(html, fn) {
  const tokens = tokenize(html);
  let opaque = 0;
  // translate="no" — the HTML standard's own "leave this alone", honoured by browser
  // translation features and by us. The language switcher carries it: "Deutsch" is the
  // point of the link and translating it into German twice over would be nonsense. Tracked
  // by nesting depth rather than by tree, which is enough for markup this repo generates.
  let depth = 0;
  let noTranslateAt = -1;
  const out = tokens.map((t) => {
    if (!t.tag) {
      if (opaque || noTranslateAt >= 0) return t.raw;
      const value = t.raw.trim();
      if (!value || !translatable(value)) return t.raw;
      const got = fn({ kind: "text", value });
      if (got == null) return t.raw;
      // Whitespace around the text is layout, not content: put it back exactly.
      const [, lead, , trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(t.raw);
      return lead + got + trail;
    }
    const name = tagName(t.raw);
    if (!t.comment && name && !VOID.has(name) && !t.raw.endsWith("/>")) {
      if (t.raw.startsWith("</")) {
        depth--;
        if (noTranslateAt >= 0 && depth <= noTranslateAt) noTranslateAt = -1;
      } else {
        if (noTranslateAt < 0 && /\btranslate="no"/i.test(t.raw)) noTranslateAt = depth;
        depth++;
      }
    }
    if (noTranslateAt >= 0) return t.raw;
    if (!t.comment && OPAQUE.has(name)) {
      if (t.raw.startsWith("</")) opaque = Math.max(0, opaque - 1);
      else if (!t.raw.endsWith("/>")) opaque++;
    }
    if (t.comment || opaque > (t.raw.startsWith("<") && !t.raw.startsWith("</") ? 1 : 0)) {
      // Inside an opaque element: attributes there are not prose either.
      if (opaque && !OPAQUE.has(name)) return t.raw;
    }
    return t.raw.replace(/([a-zA-Z-]+)="([^"]*)"/g, (whole, attr, value) => {
      const a = attr.toLowerCase();
      const wanted = TEXT_ATTRS.has(a) || (a === "content" && name === "meta" && META_PROSE.test(t.raw));
      if (!wanted || !value.trim() || !translatable(value)) return whole;
      const got = fn({ kind: "attr", attr: a, value });
      return got == null ? whole : `${attr}="${got}"`;
    });
  });
  return out.join("");
}

// Every distinct translatable string on the page, in document order.
export function strings(html) {
  const seen = new Set();
  walk(html, ({ value }) => {
    seen.add(value);
    return null;
  });
  return [...seen];
}

/* ------------------------------------------------------------------ self-check ---- */
// True only when this file is the script node was asked to run. Without it, importing a
// module for one exported helper also executes its command line — translate.mjs imports
// englishPages() from build-i18n.mjs, and unguarded that import would rebuild every
// language tree as a side effect of asking what the pages are.
const isMain = process.argv[1] && import.meta.filename === path.resolve(process.argv[1]);

if (isMain && process.argv[2] === "--check") {
  const assert = (c, m) => {
    if (!c) throw new Error("FAIL: " + m);
  };
  const page = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="description" content="Indian clothes in Prague">
<meta property="og:type" content="website">
<title>Wardrobe</title><style>.a{content:"Not text"}</style></head>
<body><h1>Hello there</h1><p>Buy <b>now</b> &mdash; 12 items</p>
<img src="/a.jpg" alt="A silk scarf"><a href="/x" aria-label="Open the shop">→</a>
<script>var t = "Do not translate me";</script>
<svg viewBox="0 0 2 2"><path d="M6 2 3 6"/></svg>
<p>1 200 Kč</p></body></html>`;

  const found = strings(page);
  assert(found.includes("Hello there"), "heading found");
  assert(found.includes("Wardrobe"), "title found");
  assert(found.includes("A silk scarf"), "alt found");
  assert(found.includes("Open the shop"), "aria-label found");
  assert(found.includes("Indian clothes in Prague"), "meta description found");
  assert(!found.includes("website"), "og:type is not prose");
  assert(!found.some((s) => s.includes("Do not translate me")), "script contents skipped");
  assert(!found.some((s) => s.includes("Not text")), "style contents skipped");
  assert(!found.includes("1 200 Kč"), "a price is not translatable text");
  assert(found.includes("Buy") && found.includes("now"), "inline markup splits, both halves kept");

  // The identity property: a walk that changes nothing must return the input byte for byte.
  assert(walk(page, () => null) === page, "walk is lossless when it substitutes nothing");

  // translate="no" keeps a subtree — and only that subtree — out of both passes.
  const withSwitcher = `<div><p>Translate me</p><details translate="no"><summary>EN</summary>
<div><a href="/de">Deutsch</a><a href="/fr">Français</a></div></details><p>And me</p></div>`;
  const s2 = strings(withSwitcher);
  assert(s2.includes("Translate me") && s2.includes("And me"), "text outside the subtree still found");
  assert(!s2.includes("Deutsch") && !s2.includes("Français") && !s2.includes("EN"),
    "nothing inside translate=\"no\" is offered for translation");
  assert(walk(withSwitcher, ({ value }) => value.toUpperCase()).includes("Deutsch"),
    "and nothing inside it is substituted either");

  const upper = walk(page, ({ value }) => value.toUpperCase());
  assert(upper.includes("<h1>HELLO THERE</h1>"), "text substituted in place");
  assert(upper.includes('alt="A SILK SCARF"'), "attribute substituted in place");
  assert(upper.includes('var t = "Do not translate me"'), "script untouched by substitution");
  assert(upper.includes('<path d="M6 2 3 6"/>'), "svg path data untouched");
  assert(upper.includes('href="/x"'), "hrefs untouched");
  console.log(`ok — ${found.length} strings from the sample page, tokenizer lossless`);
} else if (isMain && process.argv[2]) {
  const html = readFileSync(process.argv[2], "utf8");
  const found = strings(html);
  console.log(found.map((s) => (s.length > 100 ? s.slice(0, 100) + "…" : s)).join("\n"));
  console.error(`\n${found.length} strings, ${found.reduce((n, s) => n + s.length, 0)} characters`);
}
