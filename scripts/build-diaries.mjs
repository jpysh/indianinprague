#!/usr/bin/env node
// Render data/posts.json into the Diaries hub, and into the homepage's diary strip.
//
// What this page is
// -----------------
// Diaries used to be one featured article and an empty <div class="diary"> waiting for a
// list that was never built. It is now the site's editorial home, and the restaurant
// reviews moved into it — Restaurants is gone from the top nav, and "Food I love in the
// city" is simply the first shelf here.
//
// The shape is a stack of horizontal rails, one per category:
//
//   Tram 22        — the four most recent posts, whatever they are about, as a grid
//   Food           — ← swipe →
//   What I wear    — ← swipe →
//   …
//
// Two decisions worth spelling out, because both look like omissions:
//
//   1. A category with no posts is NOT rendered. Six shelves of which four say "nothing
//      here yet" makes a site look abandoned, which is the opposite of what the page is for.
//      The vocabulary lives in posts.json and the page grows into it. Today that means two
//      rails, Food and What I wear.
//
//   2. The rails are real overflow containers with scroll-snap, not a JavaScript carousel.
//      Touch swipe, trackpad scroll, shift-wheel and keyboard tabbing all work with no
//      script at all — the arrows added by the CSS-free markup below are ordinary links, and
//      there is no JS on this page. A carousel would have added a dependency to reproduce
//      behaviour the browser already has, and would break with script disabled.
//
//   node scripts/build-diaries.mjs
//
// Run after sync-chrome.mjs (it lifts the header and footer out of index.html).

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = "https://indianinprague.jains.es";

// How many posts the Tram 22 grid shows. It replaced a single hero article: one post is a
// thin front page for a journal, and four fills the grid at every breakpoint (1 / 2 / 4
// columns) without leaving a ragged last row.
const FEATURED = 4;

// The homepage strip is narrower — three fits its three-column grid exactly.
const HOME_STRIP = 3;

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SPICE = ["sp-oli", "sp-mag", "sp-pap", "sp-saf", "sp-chi", "sp-plum"];
// Deterministic from the id, so a card without a photograph keeps the same tint between
// builds rather than flickering to a new colour on every deploy.
const spice = (id) =>
  SPICE[[...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % SPICE.length];

const IMG_SIZES = "(min-width:801px) 380px, (min-width:521px) 50vw, calc(100vw - 60px)";

function picture(post, manifest) {
  const entry = post.photo && manifest[post.photo];
  if (!entry) return "";
  const jpgs = entry.variants.map((v) => `${v.jpg} ${v.w}w`).join(", ");
  const webps = entry.variants.map((v) => `${v.webp} ${v.w}w`).join(", ");
  const fallback = entry.variants[0];
  // Empty alt: the card's heading immediately below is the accessible name, and these are
  // decorative crops of a scene the heading already names. Duplicating it would make a
  // screen reader read every rail twice.
  return (
    `<picture><source type="image/webp" srcset="${webps}" sizes="${IMG_SIZES}">` +
    `<img class="ph" src="${fallback.jpg}" srcset="${jpgs}" sizes="${IMG_SIZES}" ` +
    `width="${fallback.w}" height="${fallback.h}" alt="" loading="lazy" decoding="async"></picture>`
  );
}

// A post card. Same .frame / .grain vocabulary as the product cards, so the rails look like
// they belong to the same site as the wardrobe without a single new colour.
function postCard(post, manifest, cls) {
  return (
    `<a class="post${cls ? " " + cls : ""}" href="${esc(post.href)}">` +
    `<div class="frame ${spice(post.id)}">${picture(post, manifest)}<div class="grain"></div>` +
    (post.kicker ? `<span class="cap">${esc(post.kicker)}</span>` : "") +
    `</div>` +
    `<div class="pbody"><h3>${esc(post.title)}</h3>` +
    `<p>${esc(post.blurb)}</p>` +
    `<span class="more">Read it →</span></div></a>`
  );
}

// One category = one rail.
//
// The heading, the count and the "all" link sit in a row above the track rather than inside
// it, so they stay put while the cards move — a title that scrolls away with its own content
// leaves you unable to tell what you are looking at halfway along.
function rail(cat, posts, manifest) {
  const cards = posts.map((p) => postCard(p, manifest)).join("\n      ");
  const all = cat.all
    ? `<a class="rail-all" href="${esc(cat.all.href)}">${esc(cat.all.label)} →</a>`
    : "";
  return `<section class="rail" aria-labelledby="rail-${esc(cat.id)}">
    <div class="wrap rail-top">
      <div>
        <h2 id="rail-${esc(cat.id)}">${esc(cat.name)}</h2>
        <p class="rail-note">${esc(cat.note)}</p>
      </div>
      <div class="rail-meta"><span class="rail-cs" lang="cs">${esc(cat.cs)}</span>${all}</div>
    </div>
    <!-- tabindex="0" makes the track itself focusable, which is what lets a keyboard user
         scroll it with the arrow keys. role/aria-label give that stop a name, so it is not
         announced as an unlabelled group. Without these the rail is reachable by tabbing
         through the cards but cannot be panned deliberately. -->
    <div class="rail-track" tabindex="0" role="group" aria-label="${esc(cat.name)}, scrollable">
      ${cards}
    </div>
  </section>`;
}

function jsonLd(posts) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Blog",
        "@id": `${SITE}/diaries.html#blog`,
        url: `${SITE}/diaries.html`,
        name: "Tram 22 Diaries",
        description:
          "A journal about Indian food in Prague, contemporary Indian clothing, and life between India and the Czech Republic.",
        isPartOf: { "@id": `${SITE}/#website` },
        author: { "@id": `${SITE}/#author` },
        inLanguage: "en",
        blogPost: posts.map((p) => ({
          "@type": "BlogPosting",
          headline: p.title,
          description: p.blurb,
          datePublished: p.date,
          url: `${SITE}/${p.href}`,
          author: { "@id": `${SITE}/#author` },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: "Tram 22 Diaries", item: `${SITE}/diaries.html` },
        ],
      },
    ],
  }, null, 2);
}

/* -------------------------------------------------------------------- main ---- */

function replaceRegion(html, name, body, file) {
  const re = new RegExp(`(<!-- ${name}:START -->)[\\s\\S]*?(<!-- ${name}:END -->)`);
  if (!re.test(html)) throw new Error(`${file} has no <!-- ${name}:START --> / :END --> markers`);
  return html.replace(re, `$1\n  ${body}\n  $2`);
}

const data = JSON.parse(await readFile(path.join(ROOT, "data/posts.json"), "utf8"));
const manifestPath = path.join(ROOT, "images/derived/manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : {};

const byDate = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
const posts = [...data.posts].sort(byDate);

const index = await readFile(path.join(ROOT, "index.html"), "utf8");
const header = /<header class="site">[\s\S]*?<\/header>/.exec(index);
const footer = /<footer>[\s\S]*?<\/footer>/.exec(index);
if (!header || !footer) throw new Error("could not lift <header>/<footer> out of index.html");
// No ?v= token is emitted by this file. bump-assets.mjs owns it outright and runs after
// every generator; see the note in build-shop.mjs's chrome() for what having two owners
// cost when the token changed shape.

// The current-page marking the rest of the site gets. Same rule as sync-chrome.mjs.
const chromeHeader = header[0].replace(
  /<a href="\/diaries\.html">/,
  '<a href="/diaries.html" class="active" aria-current="page">');

const featured = posts.slice(0, FEATURED);
const rails = data.categories
  .map((cat) => [cat, posts.filter((p) => p.cat === cat.id)])
  .filter(([, ps]) => ps.length > 0)
  .map(([cat, ps]) => rail(cat, ps, manifest));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tram 22 Diaries — Indian food, clothes and life in Prague | Indian in Prague</title>
<meta name="description" content="Honest reviews of Prague's Indian restaurants, notes on contemporary Indian wear, and life between two countries. The Tram 22 journal.">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<link rel="canonical" href="${SITE}/diaries.html">
<meta name="theme-color" content="#4A4433">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Indian in Prague">
<meta property="og:locale" content="en">
<meta property="og:url" content="${SITE}/diaries.html">
<meta property="og:title" content="Tram 22 Diaries — an Indian in Prague">
<meta property="og:description" content="Honest reviews of Prague's Indian restaurants, contemporary Indian wear, and life between two countries.">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:image" content="${SITE}/images/derived/IMG_5564-1200.jpg">
<meta property="og:image:alt" content="Indian in Prague">
<link rel="preload" href="assets/fonts/ibm-plex-mono-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/fonts.css">
<link rel="stylesheet" href="assets/site.css">
<link rel="stylesheet" href="assets/diaries.css">
<link rel="stylesheet" href="assets/module.css">
<script type="application/ld+json">
${jsonLd(posts)}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${chromeHeader}

<main id="main">
<div class="page-head"><div class="wrap">
  <div class="crumb">Tram 22 · the journal</div>
  <h1>Tram 22 <b>Diaries</b></h1>
  <p class="lede">Notes from the legendary tram number 22, the lifeline of the city. Where I eat, what I wear, and what living between two countries actually feels like.</p>
</div></div>

<section class="latest"><div class="wrap sec-inner">
  <div class="sec-top"><h2>Latest from the 22</h2><div class="expo">THE JOURNAL<br>food · fashion · life<br>${posts.length} dispatches</div></div>
  <div class="grid4">
    ${featured.map((p) => postCard(p, manifest, "post-lg")).join("\n    ")}
  </div>
</div></section>

${rails.join("\n\n")}

<section class="rail-end"><div class="wrap sec-inner">
  <div class="holding">
    <h2>More shelves are coming</h2>
    <p>Jewellery, home things, brass, and the long one about paperwork and winters. They appear here as they are written — there is no list to join and nothing to unsubscribe from, but if you want a nudge when the next one lands, message me.</p>
    <div class="cta-row">
      <a class="btn saf" href="https://wa.me/420777558262?text=${encodeURIComponent("Hi! Nudge me when there is a new diary on indianinprague.jains.es.")}" target="_blank" rel="noopener">Nudge me when there's a new one →</a>
      <a class="btn" href="/wardrobe.html">The wardrobe →</a>
    </div>
  </div>
</div></section>
</main>
${footer[0]}
</body>
</html>
`;

await writeFile(path.join(ROOT, "diaries.html"), html);
console.log(`  diaries.html — ${featured.length} featured, ${rails.length} rail${rails.length === 1 ? "" : "s"}, ${posts.length} posts`);

// The homepage strip, between its own markers.
const strip =
  `<div class="grid3">\n    ` +
  posts.slice(0, HOME_STRIP).map((p) => postCard(p, manifest)).join("\n    ") +
  `\n  </div>`;
await writeFile(path.join(ROOT, "index.html"), replaceRegion(index, "DIARY:LATEST", strip, "index.html"));
console.log(`  index.html — ${HOME_STRIP} latest posts (diary region replaced)`);
