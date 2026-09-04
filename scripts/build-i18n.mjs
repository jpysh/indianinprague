#!/usr/bin/env node
// Mirror the finished English site into /ru/ /fr/ /de/ /it/ /es/ /pl/ /cs/.
//
//   node scripts/build-i18n.mjs             # every language
//   node scripts/build-i18n.mjs --lang de   # one, for checking
//   node scripts/build-i18n.mjs --clean     # remove the language trees and stop
//
// WHY A MIRROR PASS AND NOT EIGHT-LANGUAGE GENERATORS
// --------------------------------------------------
// build-shop.mjs is 1,200 lines of layout, pagination and JSON-LD, and build-diaries.mjs is
// not far behind. Teaching each of them to emit eight of everything would mean eight ways
// for a template change to go wrong, forever. This script runs AFTER them and treats their
// output as what it is: finished English pages. It substitutes text, rewrites internal
// links, and writes a copy. Neither generator knows this exists, and a change to either one
// arrives in all eight languages for free.
//
// It also owns the language switcher — including on the ENGLISH pages, which is why it
// rewrites those in place. The switcher's links differ per page (each one points at the
// same page in another language), so no static header can carry them, and this is the only
// pass that knows the path of the page it is looking at.
//
// WHAT MAKES A PAGE PUBLISHABLE IN A LANGUAGE
// -------------------------------------------
// Nothing. Every page is mirrored into every language whatever its coverage — an untranslated
// string simply renders in English, so a visitor always gets a working page (Q17). What
// coverage decides is INDEXING: a page still leaning on English fallback is written with
// <meta name="robots" content="noindex,follow"> and kept out of the sitemap, because eight
// URLs of the same English text is the duplicate-content shape this site's SEO plan exists
// to avoid. The noindex lifts by itself the moment the translations land.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { LANGS, CODES, ROOT, DEFAULT_LANG, loadSources, resolve } from "./i18n.mjs";
import { walk } from "./extract.mjs";

const argv = process.argv.slice(2);
const ONLY = argv.includes("--lang") ? argv[argv.indexOf("--lang") + 1].split(",") : CODES;
const SITE = "https://guldaarbazaar.com";

// How much English a page may still contain and stay indexable. A tenth is generous enough
// to ignore a stray attribute word and strict enough that a page which is mostly English
// never competes with the English original.
const NOINDEX_ABOVE = 0.1;

// Pages that are not mirrored, and why.
//
//   spirituality.html  A self-contained design imported whole, with its own header, footer
//                      and stylesheet — sync-chrome.mjs already refuses to touch it for the
//                      same reason. Substituting text inside someone else's markup without
//                      owning that markup is how a page quietly breaks. It stays English
//                      until it is ported onto the site's own chrome.
//   inventory.html     Never public.
//   dashboard.html     Never public.
// partner.html WAS English-only (3 Sep 2026), on the argument that a machine-translated
// commercial and regulatory page is a liability rather than a courtesy: a mistranslated
// compliance obligation is a claim we did not make. That rule was lifted by an explicit
// owner decision on 4 Sep 2026, and the page now mirrors like every other.
//
// What guards it instead: every legal term of art on that page — Responsible Person, GPSR,
// REACH, EORI, IOSS, TARIC, EPR, RoDTEP, IEC, LUT, e-BRC, DGFT, EDPMS — is in glossary.json
// under keepInline, so DeepL never sees them and cannot paraphrase a named instrument into
// a description of one. The prose around them still translates and reorders normally.
//
// What is still true, and is the reason this comment is long: nobody who speaks these seven
// languages has read the result. The page states who carries GPSR liability, that it does
// not transfer to a buyer, how reverse-charge VAT applies, payment terms and a returns
// remedy. If one of those drifts in translation it is a claim in a language we cannot check.
// A native reading, per language, is the outstanding work — not a rebuild.
const SKIP = new Set(["spirituality.html", "inventory.html", "dashboard.html"]);

// Directories holding generated English pages. Language trees live beside them and are
// skipped here so a second run never mirrors a mirror.
const PAGE_DIRS = ["wardrobe", "diaries"];

export function englishPages() {
  const out = readdirSync(ROOT).filter((f) => f.endsWith(".html") && !SKIP.has(f));
  const walkDir = (dir) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walkDir(rel);
      else if (entry.name.endsWith(".html")) out.push(rel);
    }
  };
  for (const dir of PAGE_DIRS) if (existsSync(path.join(ROOT, dir))) walkDir(dir);
  return out.sort();
}

// The public URL a page file answers on. wardrobe.html is /wardrobe, index.html is /.
const urlFor = (file) => {
  const bare = file.replace(/\.html$/, "");
  return bare === "index" ? "/" : "/" + bare;
};

// The URL a page answers on in a given language.
//
// The homepage keeps its trailing slash — /de/ and not /de — because /de is not the URL the
// site actually serves. A language tree's homepage is de/index.html, a DIRECTORY INDEX, and
// Cloudflare's html_handling redirects /de to /de/ with a 307 (measured on the live site,
// 24 Aug 2026). /wardrobe returns 200 directly only because it is wardrobe.html, a file.
//
// Naming the pre-redirect form was wrong in four places at once: every switcher link cost a
// hop, the hreflang alternates pointed at a redirect, the canonical inside de/index.html
// disagreed with the URL being served, and the sitemap listed a redirecting URL — which
// build-sitemap.mjs's own header calls out as telling a crawler the target is not canonical.
// One function, because all four read it from here.
const langUrl = (lang, url) => (lang === DEFAULT_LANG ? url : `/${lang}${url === "/" ? "/" : url}`);

/* ------------------------------------------------------------------ switcher ---- */

// A <details> disclosure holding real links. No JavaScript, works with scripting off, and
// every alternate is an <a href> a crawler can follow.
//
// No flags: a flag is a country, and Spanish is not Spain. Each language is named in
// ITSELF — someone who cannot read English cannot find "Czech" in an English list.
function switcher(lang, url) {
  const here = lang === DEFAULT_LANG ? "English" : LANGS[lang].name;
  const code = (lang === DEFAULT_LANG ? "en" : lang).toUpperCase();

  // A globe, not a flag. Flags are countries — Spanish is not Spain, German is not only
  // Germany — and this is the one pictogram for "language" that a visitor from anywhere
  // recognises. Inline rather than a font or an image so it inherits currentColor and costs
  // no request.
  const globe =
    '<svg class="lang-globe" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false" ' +
    'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>' +
    '<path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/></svg>';

  // The caret is what says "this opens" rather than "this navigates". Without it a word
  // sitting in a header reads as one more nav link, which is the failure this replaces.
  const caret =
    '<svg class="lang-caret" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" focusable="false" ' +
    'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 9l6 6 6-6"/></svg>';

  // Both labels are always in the markup and CSS picks one: the full name on a laptop, the
  // code on a phone, where the header has three other things to fit inside 375px. Doing it
  // in CSS rather than by user agent means it responds to the actual width available.
  const label = `<span class="lang-name">${here}</span><span class="lang-code">${code}</span>`;

  // The CURRENT language is listed too, highlighted rather than hidden. A menu that omits
  // where you are makes you infer it from the button; showing all eight with one lit is a
  // model you read in one glance, and the list stops changing length as you move between
  // languages. It is a <span>, not an <a>: a link to the page you are already on is a
  // dead control, and screen readers announce aria-current as "current page" anyway.
  const options = [[DEFAULT_LANG, "English"], ...CODES.map((c) => [c, LANGS[c].name])]
    .map(([c, name]) =>
      c === lang
        ? `<span class="lang-here" aria-current="true" lang="${c}">${name}</span>`
        : `<a href="${langUrl(c, url)}" hreflang="${c}" lang="${c}">${name}</a>`)
    .join("");

  return (
    `<details class="lang" translate="no"><summary aria-label="Language: ${here}. Choose another.">` +
    `${globe}${label}${caret}</summary>` +
    `<div class="lang-menu">${options}</div></details>`
  );
}

const SWITCH_MARK = "<!-- I18N:SWITCH -->";
const SWITCH_RE = /<!-- I18N:SWITCH -->|<details class="lang"[\s\S]*?<\/details>/;

/* ----------------------------------------------------------------- head bits ---- */

// hreflang, canonical and og:url. Every page in every language names every sibling AND
// itself — a set of alternates that does not include the page you are on is the single most
// common way to get hreflang ignored altogether. x-default points at English.
function head(html, lang, url) {
  let out = html.replace(/\n?<link rel="alternate" hreflang="[^"]*"[^>]*>/g, "");
  out = out.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${SITE}${langUrl(lang, url)}">`);
  out = out.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${SITE}${langUrl(lang, url)}">`);
  out = out.replace(/<meta property="og:locale" content="[^"]*">/, `<meta property="og:locale" content="${lang}">`);
  return out.replace(/<html lang="[^"]*"/, `<html lang="${lang}"`);
}

// The alternates block for one URL, listing only the languages that page is INDEXABLE in.
//
// hreflang is reciprocal or it is nothing: every page in the set names every other page AND
// itself, or search engines drop the relationship entirely. Which is why this cannot be
// written during rendering — whether Czech is indexable for a given page is only known once
// that page has been rendered in Czech, so the whole set is stamped in afterwards.
//
// A page nobody has translated yet gets no block: one self-referencing alternate tells a
// crawler nothing and reads as a misconfiguration.
function alternatesFor(url, langs) {
  if (!langs.length) return "";
  return (
    [DEFAULT_LANG, ...langs]
      .map((code) => `<link rel="alternate" hreflang="${code}" href="${SITE}${langUrl(code, url)}">`)
      .join("\n") + `\n<link rel="alternate" hreflang="x-default" href="${SITE}${url}">`
  );
}

// Replace whatever alternates a file currently carries with the correct set.
function stampAlternates(file, url, langs) {
  const html = readFileSync(file, "utf8");
  const block = alternatesFor(url, langs);
  let next = html.replace(/\n?<link rel="alternate" hreflang="[^"]*"[^>]*>/g, "");
  if (block) next = next.replace("</head>", block + "\n</head>");
  if (next !== html) writeFileSync(file, next);
}

// Root-absolute internal links get the language prefix. Assets, images and external links
// do not: there is one copy of the CSS and one copy of every photo, and prefixing them
// would 404 on every page.
const SHARED = /^\/(assets|images|_|favicon|robots\.txt|sitemap\.xml|llms\.txt|.*\.(?:css|js|jpg|jpeg|png|webp|svg|ico|xml|txt|json))/;

// `known` is every URL that actually exists in the language tree. A link is only prefixed
// when its target was mirrored — otherwise /de/spirituality would be offered to a German
// reader as a page that was never written, and the switcher would hand every visitor a 404
// on the one page this build deliberately leaves alone. Unmirrored targets keep pointing at
// the English original, which is a real page in a language they may not read: worse than a
// translation, much better than nothing.
function relink(html, lang, known) {
  // Root pages link their assets relatively (assets/site.css), which is correct where they
  // sit and wrong the moment the page is written one directory deeper — the browser asks
  // for /de/assets/site.css and gets a 404, and the page renders as unstyled text. Same fix
  // sync-chrome.mjs and build-diaries.mjs apply when they move chrome into a subdirectory.
  html = html.replace(/(href|src)="(assets\/|images\/)/g, '$1="/$2');
  html = html.replace(/(srcset|content)="((?:assets|images)\/[^"]*)"/g, '$1="/$2"');
  return html.replace(/(href|action)="(\/[^"]*)"/g, (whole, attr, url) => {
    if (SHARED.test(url) || url.startsWith("//")) return whole;
    const [, base, rest = ""] = /^([^#?]*)([#?][\s\S]*)?$/.exec(url);
    if (!known.has(base.replace(/\/$/, "") || "/")) return whole;
    return `${attr}="${langUrl(lang, base)}${rest}"`;
  });
}

/* -------------------------------------------------------------------- render ---- */

function renderPage(html, lang, url, byText) {
  let missing = 0;
  let translated = 0;
  const out = walk(html, ({ value }) => {
    const key = byText.get(value);
    const hit = key ? byText.resolved[key] : null;
    if (hit?.text) {
      translated++;
      return hit.text;
    }
    missing++;
    return null; // leave the English in place — a working page beats a blank one
  });
  return { html: out, missing, translated };
}

/* ---------------------------------------------------------------------- main ---- */
// True only when this file is the script node was asked to run. Without it, importing a
// module for one exported helper also executes its command line — translate.mjs imports
// englishPages() from build-i18n.mjs, and unguarded that import would rebuild every
// language tree as a side effect of asking what the pages are.
const isMain = process.argv[1] && import.meta.filename === path.resolve(process.argv[1]);

if (isMain) {
  if (argv.includes("--clean")) {
    for (const code of CODES) rmSync(path.join(ROOT, code), { recursive: true, force: true });
    console.log(`removed ${CODES.length} language trees`);
    process.exit(0);
  }

  const sources = loadSources();
  // English text -> key. Product fields win over page text when the same string is both, so
  // an edit to a product title in the dashboard reaches the shelf pages too.
  const byText = new Map();
  for (const [key, src] of Object.entries(sources)) {
    if (!byText.has(src.text) || key.startsWith("item.") || key.startsWith("attr.")) byText.set(src.text, key);
  }

  const pages = englishPages();
  const known = new Set(pages.map(urlFor));
  console.log(`${pages.length} English pages, ${byText.size} known strings`);

  // The English pages get the switcher AND their own hreflang block, in place.
  //
  // The alternates have to be on the English page too. hreflang is only honoured when the
  // set is reciprocal: if /de/wardrobe points at /wardrobe and /wardrobe does not point back,
  // search engines discard the relationship rather than infer it. Declaring it in the
  // sitemap as well is belt and braces, not a substitute — and a site where the translated
  // pages carry tags and the originals do not is the asymmetric case that gets dropped.
  //
  // Canonical and og:url are deliberately left alone here: an English page is canonical to
  // itself and always was.
  for (const file of pages) {
    const p = path.join(ROOT, file);
    const html = readFileSync(p, "utf8");
    const next = html.replace(SWITCH_RE, switcher(DEFAULT_LANG, urlFor(file)));
    if (next !== html) writeFileSync(p, next);
  }

  // file -> the languages it is INDEXABLE in, filled in as each language renders and used
  // afterwards to stamp the hreflang sets. A language whose page went out noindexed is left
  // out of every set, including its own page's: an alternate pointing at a page that asks
  // not to be indexed is a contradiction a crawler resolves by ignoring the whole set.
  const indexable = new Map(pages.map((f) => [f, []]));

  const report = {};
  for (const lang of ONLY) {
    if (!LANGS[lang]) throw new Error(`unknown language "${lang}"`);
    byText.resolved = resolve(lang, sources);
    rmSync(path.join(ROOT, lang), { recursive: true, force: true });

    let noindexed = 0;
    let totalMissing = 0;
    for (const file of pages) {
      const url = urlFor(file);
      const english = readFileSync(path.join(ROOT, file), "utf8");
      const { html, missing, translated } = renderPage(english, lang, url, byText);

      let out = head(relink(html, lang, known), lang, url);
      out = out.replace(SWITCH_RE, switcher(lang, url));

      // A machine-translated page says so, in the language it was translated into, and gives
      // the reader a way to ask. The block is written into the English source carrying
      // `hidden` — so it never shows on the English page, and so its text is an ordinary
      // source string that gets translated with everything else — and the attribute is
      // dropped here, on the copies where it is true. It matters most on /partner, where the
      // sentences around it are commercial and regulatory, but it is honest on any page.
      out = out.replace(/(<div class="p-i18n" data-i18n-note) hidden>/, "$1>");

      // Any MEANINGFUL amount of English left on the page keeps it out of the index.
      // `follow` so the links on it still carry weight to the pages that ARE translated.
      //
      // A ratio, not a count. The rule exists to stop eight near-identical English pages
      // being offered to Google as eight languages; it was never meant to catch a Czech page
      // that is 99% Czech with the word "Beige" still in English. Measured on the first full
      // build: 27 untranslated attribute words held 55 completely Czech pages out of the
      // index, which is the opposite of what this is for.
      const englishShare = missing / Math.max(1, missing + translated);
      if (englishShare > NOINDEX_ABOVE) {
        noindexed++;
        totalMissing += missing;
        out = out.replace("</head>", '<meta name="robots" content="noindex,follow">\n</head>');
      }

      else indexable.get(file).push(lang);

      const dest = path.join(ROOT, lang, file);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, out);
    }
    report[lang] = { pages: pages.length, noindexed, totalMissing };
    console.log(
      `  ${lang}: ${pages.length} pages` +
        (noindexed ? `, ${noindexed} noindexed (${totalMissing} English strings left)` : ", fully translated"),
    );
  }

  // Every page now knows which languages it exists in, so the reciprocal hreflang sets can
  // be written — English original and every translation, all naming the same set.
  //
  // Only for the languages built this run: `--lang de` must not strip Russian's alternates
  // out of the English pages just because Russian was not rebuilt.
  if (ONLY.length === CODES.length) {
    let stamped = 0;
    for (const file of pages) {
      const langs = indexable.get(file);
      const url = urlFor(file);
      stampAlternates(path.join(ROOT, file), url, langs);
      for (const lang of langs) stampAlternates(path.join(ROOT, lang, file), url, langs);
      if (langs.length) stamped++;
    }
    console.log(`  hreflang: ${stamped} pages carry a reciprocal set of alternates`);
  } else {
    console.log("  hreflang: skipped — a partial build cannot compute a complete set");
  }

  writeFileSync(
    path.join(ROOT, "data/i18n/pages.json"),
    JSON.stringify({ _comment: "Written by build-i18n.mjs. Derived — safe to delete.", generated: new Date().toISOString(), report }, null, 2) + "\n",
  );
}
