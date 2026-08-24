#!/usr/bin/env node
// Render data/posts.json + content/*.html into the Diaries: one index page and one page per
// post. Also refreshes the homepage's three-card strip.
//
// WHAT THIS PAGE IS  (restructured again 17 Aug 2026)
// --------------------------------------------------
// The Diaries is an INDEX, and every post has a page of its own.
//
//   /diaries                    the index — every post once, as a card, grouped by category
//   /diaries/<id>               the post itself
//
// It has now been all three shapes, so the reasoning is worth keeping:
//
//   1. A hub of cards pointing at /restaurants and /article-contemporary-indian-wear. Three
//      URLs, and no single place that was "the blog".
//   2. One page holding everything inline (16 Aug). That fixed the scatter and immediately
//      bought a worse problem: every post appeared TWICE — once as a card in "Latest", once
//      in full below — and the page grew without limit as posts were added. A reader looking
//      for one restaurant scrolled past a 2,000-word fashion dispatch to reach it.
//   3. This. Each post appears exactly once on the index, as a card, and lives at a URL of
//      its own.
//
// Why per-post pages are the right shape here, beyond the duplication:
//   · A post can be linked, shared and ranked on its own terms — its own <title>, its own
//     description, its own canonical, its own Article/Review node. On one page, six posts
//     compete for a single title and a single description.
//   · The index stays a constant size as the journal grows.
//   · Structured data stops being a pile of nodes on one URL and becomes one node per URL,
//     which is what both search engines and LLM crawlers actually expect from a blog.
//
// URL SHAPE, and why the index stays at the repo root
// ---------------------------------------------------
// The index is diaries.html (served at /diaries); the posts are diaries/<id>.html (served at
// /diaries/<id>). A root file and a directory of the same name coexisting looks like a
// conflict and is not one: the asset server resolves /diaries to the FILE and only uses the
// directory for paths beneath it. Measured with `wrangler dev` against dist/, which is the
// same asset server the deployment runs.
//
// The obvious alternative — diaries/index.html and no root file — was built first and
// rejected on measurement: `/diaries` then answers **307 Temporary Redirect** to `/diaries/`.
// That URL is the most linked page on the site, it is the canonical in every tag and the
// sitemap, and edge/_redirects exists precisely because a 307 on an indexed URL tells Google
// the old form is still the right one. A redirect on the canonical is not a cosmetic detail.
//
// OLD ANCHORS STILL LAND
// ----------------------
// /diaries#annamalai was public for a day and /restaurants#annamalai 301s onto it. A server
// cannot redirect a fragment — the browser never sends it — so every card on the index keeps
// id="<post-id>". An old link scrolls to the card for that post, which links to the post. The
// destination changed; nobody arrives nowhere.
//
// Heading levels: on the index, h1 page > h2 category > h3 card. On a post page the post
// title is the h1, so bodies in content/ use h2 for their own sections.
//
// There is still NO JavaScript on any of these pages.
//
//   node scripts/build-diaries.mjs
//
// Run after sync-chrome.mjs (it lifts the header and footer out of index.html).

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = "https://indianinprague.jains.es";
const OUT = path.join(ROOT, "diaries");

// Two cards on the homepage (was three, changed 17 Aug 2026 at the owner's request). They go
// into a two-column grid rather than the three-column one — two cards in a three-track grid
// leaves an empty cell, which reads as a card that failed to load rather than as a choice.
const HOME_STRIP = 2;
// A category becomes a horizontal rail at three cards. Below that a rail is a lie: one card
// in a scroll track reads as a row that failed to load, and there is nothing to swipe.
const RAIL_MIN = 3;
// How many cards live in a rail before the "all posts" tile takes over. At a post a day the
// Food rail would otherwise carry a year of images on the most-linked page of the site.
// Twelve is about three desktop screens of swipe.
const RAIL_MAX = 12;

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SPICE = ["sp-oli", "sp-mag", "sp-pap", "sp-saf", "sp-chi", "sp-plum"];
// Deterministic from the id, so a card without a photograph keeps the same tint between
// builds rather than flickering to a new colour on every deploy.
const spice = (id) =>
  SPICE[[...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % SPICE.length];

const CARD_SIZES = "(min-width:801px) 380px, (min-width:521px) 50vw, calc(100vw - 60px)";
const HERO_SIZES = "(min-width:801px) 760px, calc(100vw - 40px)";

// Post pages sit one directory down, so every asset and internal link on them is written
// absolute. The index is at /diaries/ and does the same, for one rule rather than two.
const asset = (p) => "/" + String(p).replace(/^\//, "");

function picture(post, manifest, sizes, alt = "", eager = false) {
  const entry = post.photo && manifest[post.photo];
  if (!entry) return "";
  const jpgs = entry.variants.map((v) => `${asset(v.jpg)} ${v.w}w`).join(", ");
  const webps = entry.variants.map((v) => `${asset(v.webp)} ${v.w}w`).join(", ");
  const f = entry.variants[0];
  return (
    `<picture><source type="image/webp" srcset="${webps}" sizes="${sizes}">` +
    `<img class="ph" src="${asset(f.jpg)}" srcset="${jpgs}" sizes="${sizes}" ` +
    `width="${f.w}" height="${f.h}" alt="${esc(alt)}" ` +
    (eager ? `fetchpriority="high" decoding="async"` : `loading="lazy" decoding="async"`) +
    `></picture>`
  );
}

const humanDate = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

const postUrl = (p) => `/diaries/${p.id}`;
// A category archive lives in the same flat namespace as the posts, on purpose: /diaries/food
// is the URL a reader would guess, and the id is already the anchor on the index. The build
// throws if a post ever claims a category's id, which is the only way the two can collide.
const catUrl = (c) => `/diaries/${c.id}`;

/* --------------------------------------------------------------- the cards ---- */

// One card = one post, and a post gets exactly one card. Every card carries its date: on an
// index of dated writing that is the single most useful thing after the title, and the old
// cards had nothing but a blurb.
//
// Empty alt on the photograph: the heading immediately below is the accessible name, and the
// image is a decorative crop of a scene the heading already names.
function postCard(post, manifest, cls) {
  // On a review the kicker reads "Nové Město · tastes like home" — district and verdict. The
  // verdict is also a coloured chip on the meta line, and the colour is the scanning aid the
  // key at the top of the category explains, so the chip wins and the kicker keeps only the
  // district. Without this the card said the same thing twice, in two type styles.
  const kickerText = post.verdict && post.kicker
    ? post.kicker.split("·")[0].trim()
    : post.kicker;
  // The verdict rides the meta line rather than sitting between the title and the blurb,
  // where it broke the one read the card exists for. post.meta is dropped when the kicker
  // already says it — it is burned into the photograph directly above.
  const bits = [
    `<time datetime="${esc(post.date)}">${esc(humanDate(post.date))}</time>`,
    post.reading ? `<span>${post.reading} min read</span>` : "",
    // The kicker is burned into the photograph directly above the meta line, and on a review
    // it already carries the district and the verdict. Repeating either underneath gave a
    // card three lines of small caps saying the same thing twice.
    !post.kicker && post.meta ? `<span>${esc(post.meta)}</span>` : "",
    post.verdict ? `<span class="rv ${esc(post.verdict.tone)}">${esc(post.verdict.label)}</span>` : "",
  ].filter(Boolean);

  return (
    `<article class="post${cls ? " " + cls : ""}" id="${esc(post.id)}">` +
    `<a class="post-link" href="${postUrl(post)}">` +
    `<div class="frame ${spice(post.id)}">${picture(post, manifest, CARD_SIZES)}<div class="grain"></div>` +
    (kickerText ? `<span class="cap">${esc(kickerText)}</span>` : "") +
    `</div>` +
    `<div class="pbody">` +
    `<p class="post-meta">${bits.join(" · ")}</p>` +
    `<h3>${esc(post.title)}</h3>` +
    `<p class="post-blurb">${esc(post.blurb)}</p>` +
    `<span class="more">Read it →</span>` +
    `</div></a></article>`
  );
}

// The homepage strip keeps the old markup shape (a bare <a class="post">) because index.css
// styles it, and it now points at the post rather than at an anchor on the index.
function homeCard(post, manifest) {
  return (
    `<a class="post" href="${postUrl(post)}">` +
    `<div class="frame ${spice(post.id)}">${picture(post, manifest, CARD_SIZES)}<div class="grain"></div>` +
    (post.kicker ? `<span class="cap">${esc(post.kicker)}</span>` : "") +
    `</div>` +
    `<div class="pbody"><h3>${esc(post.title)}</h3>` +
    `<p>${esc(post.blurb)}</p>` +
    `<span class="more">Read it →</span></div></a>`
  );
}

/* ------------------------------------------------------------ the index page ---- */

function categorySection(cat, posts, manifest) {
  // One flat grid, newest first. Food used to split into "Indian restaurants" and "Vegan in
  // Prague" — that grouping was inherited from the old /restaurants page, where every review
  // was rendered full-length and the sub-headings were the only way to find anything. On a
  // grid of dated cards it just fragmented five items into two short rows, and the vegan
  // places are already marked by their verdict chip. The category is the level of grouping
  // this page needs.
  // Three or more posts and the category becomes a horizontal rail: browse across categories
  // by scrolling down, across a category by scrolling sideways. Below three it stays a grid —
  // see RAIL_MIN. The rail is CSS only (scroll-snap + overflow-x); there is still no
  // JavaScript on this page, so the track is given a tabindex and a label, which is what
  // makes an overflowing scroll container reachable and announced for a keyboard reader.
  const isRail = posts.length >= RAIL_MIN;
  const shown = isRail ? posts.slice(0, RAIL_MAX) : posts;

  const allTile =
    `<a class="rail-tile" href="${catUrl(cat)}">` +
    `<span class="rail-tile-count">${posts.length}</span>` +
    `<span class="rail-tile-label">See all posts →</span>` +
    `</a>`;

  const inner = isRail
    ? `<div class="rail" tabindex="0" role="group" aria-label="${esc(cat.name)}, horizontal list">
      <div class="rail-track">
        ${shown.map((p) => postCard(p, manifest)).join("\n        ")}
        ${allTile}
      </div>
    </div>`
    : `<div class="grid3">
      ${shown.map((p) => postCard(p, manifest)).join("\n      ")}
    </div>`;

  // The shelf cross-link stays in the header; the archive link is the tile at the end of the
  // rail. Two "see more" controls in the same header competed with each other. A grid
  // category has no tile, so its archive link goes here instead.
  const all =
    (cat.all ? `<a class="rail-all" href="${esc(cat.all.href)}">${esc(cat.all.label)} →</a>` : "") +
    (isRail ? "" : `<a class="rail-all" href="${catUrl(cat)}">All posts →</a>`);

  // The verdict key belongs to Food and nothing else, so it is asked for by id rather than
  // rendered for every category.
  const key = cat.id === "food"
    ? `<div class="key"><span class="real">Tastes like home</span><span class="mild">Toned down</span><span class="trap">Tourist trap</span><span class="vegan">Fully vegan</span></div>`
    : "";

  // The honesty line, immediately under the category heading — someone deciding whether to
  // trust a review reads it before the reviews rather than after them.
  const disclosure = cat.disclosure
    ? `<div class="note"><p>${esc(cat.disclosure)}</p></div>`
    : "";

  return `<section class="cat" id="${esc(cat.id)}" aria-labelledby="cat-${esc(cat.id)}">
  <div class="wrap">
    <div class="cat-head">
      <div>
        <h2 id="cat-${esc(cat.id)}">${esc(cat.name)}</h2>
        <p class="cat-note">${esc(cat.note)}</p>
      </div>
      <div class="cat-meta"><span class="cat-count">${posts.length} ${
        posts.length === 1 ? "post" : "posts"}</span>${all}</div>
    </div>
    ${key}
    ${disclosure}
    ${inner}
  </div>
</section>`;
}

/* ------------------------------------------------------------ structured data ---- */

const abs = (p) => `${SITE}${p}`;

const imageOf = (p, manifest) => {
  const e = p.photo && manifest[p.photo];
  if (!e) return undefined;
  const biggest = e.variants[e.variants.length - 1];
  return abs(asset(biggest.jpg));
};

// The index describes the blog and lists what is in it. The posts themselves are described on
// their own pages — one node per URL, rather than every node on one URL.
function indexJsonLd(posts, cats, manifest) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Blog",
        "@id": abs("/diaries#blog"),
        url: abs("/diaries"),
        name: "Tram 22 Diaries",
        description:
          "Honest reviews of Prague's Indian and vegan restaurants, notes on contemporary Indian wear, mindfulness practice, and life between India and the Czech Republic.",
        isPartOf: { "@id": abs("/#website") },
        author: { "@id": abs("/#author") },
        inLanguage: "en",
        about: cats.map((c) => ({ "@type": "Thing", name: c.name })),
        blogPost: posts.map((p) => ({
          "@type": "BlogPosting",
          "@id": abs(postUrl(p) + "#post"),
          headline: p.title,
          description: p.blurb,
          datePublished: p.date,
          url: abs(postUrl(p)),
          image: imageOf(p, manifest),
          author: { "@id": abs("/#author") },
          isPartOf: { "@id": abs("/diaries#blog") },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: abs("/") },
          { "@type": "ListItem", position: 2, name: "Tram 22 Diaries", item: abs("/diaries") },
        ],
      },
    ],
  }, null, 2);
}

// A category archive: a CollectionPage listing the posts it holds, plus its own crumb. The
// posts themselves are still described once each, on their own pages.
function catJsonLd(cat, posts, manifest) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": abs(catUrl(cat) + "#page"),
        url: abs(catUrl(cat)),
        name: cat.name,
        description: cat.note,
        isPartOf: { "@id": abs("/diaries#blog") },
        inLanguage: "en",
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: posts.length,
          itemListElement: posts.map((p, n) => ({
            "@type": "ListItem",
            position: n + 1,
            url: abs(postUrl(p)),
            name: p.title,
          })),
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: abs("/") },
          { "@type": "ListItem", position: 2, name: "Tram 22 Diaries", item: abs("/diaries") },
          { "@type": "ListItem", position: 3, name: cat.name, item: abs(catUrl(cat)) },
        ],
      },
    ],
  }, null, 2);
}

// A post page carries the node for its own content, and nothing else's. Reviews keep the
// Review type they had on the old /restaurants page — against the same restaurant names, so
// the entity a search engine already knows survives every move this content has made.
function postJsonLd(post, cat, manifest) {
  const url = abs(postUrl(post));
  const isReview = post.kind === "review";

  const main = isReview
    ? {
        "@type": "Review",
        "@id": `${url}#post`,
        url,
        itemReviewed: {
          "@type": "Restaurant",
          name: post.title,
          servesCuisine: post.cuisine,
          address: {
            "@type": "PostalAddress",
            addressLocality: "Prague",
            addressRegion: post.region,
            addressCountry: "CZ",
          },
        },
        author: { "@id": abs("/#author") },
        publisher: { "@id": abs("/#author") },
        datePublished: post.date,
        name: post.verdict?.label,
        reviewBody: post.blurb,
        image: imageOf(post, manifest),
        isPartOf: { "@id": abs("/diaries#blog") },
        mainEntityOfPage: { "@id": `${url}#webpage` },
      }
    : {
        "@type": ["BlogPosting", "Article"],
        "@id": `${url}#post`,
        url,
        headline: post.title,
        description: post.blurb,
        datePublished: post.date,
        image: imageOf(post, manifest),
        author: { "@id": abs("/#author") },
        publisher: { "@id": abs("/#author") },
        inLanguage: "en",
        isPartOf: { "@id": abs("/diaries#blog") },
        mainEntityOfPage: { "@id": `${url}#webpage` },
        articleSection: cat.name,
      };

  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      main,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: abs("/") },
          { "@type": "ListItem", position: 2, name: "Tram 22 Diaries", item: abs("/diaries") },
          { "@type": "ListItem", position: 3, name: cat.name, item: abs(catUrl(cat)) },
          { "@type": "ListItem", position: 4, name: post.title, item: url },
        ],
      },
    ],
  }, null, 2);
}

/* -------------------------------------------------------------------- shell ---- */

function shell({ title, description, canonical, image, jsonld, header, footer, body, extraCss = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#4A4433">
<meta property="og:type" content="${canonical.includes("/diaries/") ? "article" : "website"}">
<meta property="og:site_name" content="Indian in Prague">
<meta property="og:locale" content="en">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${esc(description)}">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:image" content="${image}">
<meta property="og:image:alt" content="Indian in Prague">
<link rel="preload" href="/assets/fonts/ibm-plex-mono-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/ibm-plex-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/assets/diaries.css">
<link rel="stylesheet" href="/assets/module.css">${extraCss}
<script type="application/ld+json">
${jsonld}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${header}

<main id="main">
${body}
</main>
${footer}
</body>
</html>
`;
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

// Every post's body, read up front so a missing content file fails the build loudly rather
// than emitting a page with a hole in it.
const bodies = {};
for (const p of posts) {
  const file = path.join(ROOT, "content", p.body);
  if (!existsSync(file)) throw new Error(`posts.json: ${p.id} names content/${p.body}, which does not exist`);
  bodies[p.id] = (await readFile(file, "utf8")).trim();
}

const index = await readFile(path.join(ROOT, "index.html"), "utf8");
const header = /<header class="site">[\s\S]*?<\/header>/.exec(index);
const footer = /<footer>[\s\S]*?<\/footer>/.exec(index);
if (!header || !footer) throw new Error("could not lift <header>/<footer> out of index.html");

// The chrome is lifted from a page at the repo root, so its relative asset hrefs
// (assets/site.css) resolve one directory too high from /diaries/. Absolute them.
const absolutise = (html) =>
  html
    .replace(/(href|src)="(assets\/)/g, '$1="/$2')
    .replace(/(href|src)="(images\/)/g, '$1="/$2');

const chromeHeader = absolutise(header[0]).replace(
  /<a href="\/diaries">/,
  '<a href="/diaries" class="active" aria-current="page">');
const chromeFooter = absolutise(footer[0]);

const cats = data.categories
  .map((cat) => [cat, posts.filter((p) => p.cat === cat.id)])
  .filter(([, ps]) => ps.length > 0);

const catById = Object.fromEntries(data.categories.map((c) => [c.id, c]));

// Posts and category archives share one flat namespace under /diaries/. A post whose id is
// also a category id would overwrite that category's archive silently — the page would keep
// appearing in the sitemap and answering with the wrong content. Fail the build instead.
for (const p of posts) {
  if (catById[p.id]) {
    throw new Error(`posts.json: post id "${p.id}" collides with the category of the same id — /diaries/${p.id} cannot be both`);
  }
}

/* ---- the index ---- */

const catNav =
  `<nav class="cat-jump" aria-label="Categories">` +
  cats.map(([c, ps]) =>
    `<a href="#${esc(c.id)}">${esc(c.name)} <b>${ps.length}</b></a>`).join("") +
  `</nav>`;

const indexBody = `<div class="page-head"><div class="wrap">
  <div class="crumb">Tram 22 · the journal</div>
  <h1>Tram 22 <b>Diaries</b></h1>
  <p class="lede">Notes from the legendary tram number 22, the lifeline of the city. Where I eat, what I wear, and what a practice looks like on an ordinary weekday — ${posts.length} posts, newest first in each shelf.</p>
  ${catNav}
</div></div>

${cats.map(([cat, ps]) => categorySection(cat, ps, manifest)).join("\n\n")}

<section class="rail-end"><div class="wrap sec-inner">
  <div class="holding">
    <h2>More is coming</h2>
    <p>Jewellery, home things, brass, and the long one about paperwork and winters. They appear here as they are written — there is no list to join and nothing to unsubscribe from, but if you want a nudge when the next one lands, message me.</p>
    <div class="cta-row">
      <a class="btn saf" href="https://wa.me/420777558262?text=${encodeURIComponent("Hi! Nudge me when there is a new diary on indianinprague.jains.es.")}" target="_blank" rel="noopener">Nudge me when there's a new one →</a>
      <a class="btn" href="/wardrobe">The wardrobe →</a>
    </div>
  </div>
</div></section>`;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await writeFile(path.join(ROOT, "diaries.html"), shell({
  title: "Tram 22 Diaries: Indian and vegan restaurants in Prague",
  description:
    "Honest reviews of Prague's Indian restaurants and the best fully vegan spots, notes on contemporary Indian wear, and mindfulness practice — by an Indian living in Prague.",
  canonical: abs("/diaries"),
  image: abs("/images/derived/IMG_4126-1200.jpg"),
  jsonld: indexJsonLd(posts, cats.map(([c]) => c), manifest),
  header: chromeHeader,
  footer: chromeFooter,
  body: indexBody,
}));

/* ---- one page per category ---- */

// The archive is a plain vertical grid of everything in the category, newest first. Vertical
// is the right shape for "show me all of it"; horizontal is for browsing across categories,
// which is the index's job and not this page's.
// ponytail: no pagination — 7 posts today. Lift the pager out of build-shop.mjs when a
// category passes about 60.
for (const [cat, ps] of cats) {
  const body = `<div class="page-head"><div class="wrap">
  <nav class="crumb crumb-nav" aria-label="Breadcrumb">
    <a href="/diaries">Tram 22 Diaries</a> <span aria-hidden="true">/</span> <span>${esc(cat.name)}</span>
  </nav>
  <h1>${esc(cat.name)}</h1>
  <p class="lede">${esc(cat.note)}</p>
  <p class="cat-count">${ps.length} ${ps.length === 1 ? "post" : "posts"}, newest first</p>
</div></div>

<section class="cat"><div class="wrap">
  ${cat.disclosure ? `<div class="note"><p>${esc(cat.disclosure)}</p></div>` : ""}
  ${cat.id === "food" ? `<div class="key"><span class="real">Tastes like home</span><span class="mild">Toned down</span><span class="trap">Tourist trap</span><span class="vegan">Fully vegan</span></div>` : ""}
  <div class="grid3">
    ${ps.map((p) => postCard(p, manifest)).join("\n    ")}
  </div>
  <div class="cta-row">
    <a class="btn" href="/diaries">← All of the Diaries</a>${
      cat.all ? `<a class="btn saf" href="${esc(cat.all.href)}">${esc(cat.all.label)} →</a>` : ""}
  </div>
</div></section>`;

  await writeFile(path.join(OUT, `${cat.id}.html`), shell({
    title: `${esc(cat.name)}: Tram 22 Diaries`,
    description: cat.note,
    canonical: abs(catUrl(cat)),
    image: imageOf(ps[0], manifest) || abs("/images/derived/IMG_4126-1200.jpg"),
    jsonld: catJsonLd(cat, ps, manifest),
    header: chromeHeader,
    footer: chromeFooter,
    body,
  }));
}

/* ---- one page per post ---- */

for (const post of posts) {
  const cat = catById[post.cat];
  if (!cat) throw new Error(`posts.json: ${post.id} has cat "${post.cat}", which is not a category`);

  // Previous and next WITHIN the category: "more like this one" is more useful at the end of
  // a restaurant review than whatever happened to be written the same week.
  const siblings = posts.filter((p) => p.cat === post.cat);
  const i = siblings.findIndex((p) => p.id === post.id);
  const newer = siblings[i - 1];
  const older = siblings[i + 1];

  const meta = [
    `<time datetime="${esc(post.date)}">${esc(humanDate(post.date))}</time>`,
    post.reading ? `<span>${post.reading} min read</span>` : "",
    post.meta ? `<span>${esc(post.meta)}</span>` : "",
  ].filter(Boolean).join(" · ");

  const hero = post.photo
    ? `<div class="post-hero frame ${spice(post.id)}">${picture(post, manifest, HERO_SIZES, post.title, true)}<div class="grain"></div></div>`
    : "";

  const shopCta = post.cat === "fashion"
    ? `<div class="shop-cta">
        <h2>Shop the look</h2>
        <p>The pieces I write about here go up on my Vinted closet as I rotate them — block print, handloom, contemporary cuts. Pre-loved, locally available, no slow shipping from India.</p>
        <a class="btn saf" href="https://www.vinted.cz/member/3166447071" target="_blank" rel="noopener">Open my Vinted closet →</a>
      </div>`
    : "";

  const orderLine = post.order
    ? `<p class="order"><b>Order:</b> ${esc(post.order)}</p>`
    : "";

  const nav = (newer || older)
    ? `<nav class="post-nav" aria-label="More in ${esc(cat.name)}">
      ${older ? `<a class="prev" href="${postUrl(older)}"><span>← Older in ${esc(cat.name)}</span><b>${esc(older.title)}</b></a>` : "<span></span>"}
      ${newer ? `<a class="next" href="${postUrl(newer)}"><span>Newer in ${esc(cat.name)} →</span><b>${esc(newer.title)}</b></a>` : "<span></span>"}
    </nav>`
    : "";

  const related = siblings.filter((p) => p.id !== post.id).slice(0, 3);
  const relatedBlock = related.length
    ? `<section class="post-related"><div class="wrap sec-inner">
    <div class="sec-top"><h2>More in ${esc(cat.name)}</h2><a class="rail-all" href="${catUrl(cat)}">All posts →</a></div>
    <div class="grid3">
      ${related.map((p) => postCard(p, manifest)).join("\n      ")}
    </div>
  </div></section>`
    : "";

  const body = `<article class="post-page">
  <div class="post-head"><div class="wrap">
    <nav class="crumb crumb-nav" aria-label="Breadcrumb">
      <a href="/diaries">Tram 22 Diaries</a> <span aria-hidden="true">/</span> <a href="${catUrl(cat)}">${esc(cat.name)}</a>
    </nav>
    <h1>${esc(post.title)}</h1>
    <p class="post-byline">${meta}${
      post.verdict ? ` · <span class="rv ${esc(post.verdict.tone)}">${esc(post.verdict.label)}</span>` : ""}</p>
    <p class="lede">${esc(post.blurb)}</p>
  </div></div>

  <div class="wrap post-main">
    ${hero}
    <div class="entry-body">
${bodies[post.id]}
    </div>
    ${orderLine}
    ${shopCta}
    ${nav}
  </div>
</article>

${relatedBlock}`;

  await writeFile(path.join(OUT, `${post.id}.html`), shell({
    title: `${esc(post.title)}: ${esc(cat.name)}, Tram 22 Diaries`,
    description: post.blurb,
    canonical: abs(postUrl(post)),
    image: imageOf(post, manifest) || abs("/images/derived/IMG_4126-1200.jpg"),
    jsonld: postJsonLd(post, cat, manifest),
    header: chromeHeader,
    footer: chromeFooter,
    body,
  }));
}

console.log(
  `  diaries.html + diaries/ — index, ${cats.length} categor${cats.length === 1 ? "y" : "ies"} and ${posts.length} post page${posts.length === 1 ? "" : "s"}`);

// The homepage strip. These cards point at the post pages.
const strip =
  `<div class="grid2">\n    ` +
  posts.slice(0, HOME_STRIP).map((p) => homeCard(p, manifest)).join("\n    ") +
  `\n  </div>`;
await writeFile(path.join(ROOT, "index.html"), replaceRegion(index, "DIARY:LATEST", strip, "index.html"));
console.log(`  index.html — ${HOME_STRIP} latest posts (diary region replaced)`);
