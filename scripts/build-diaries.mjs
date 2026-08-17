#!/usr/bin/env node
// Render data/posts.json + content/*.html into the Diaries, and into the homepage's strip.
//
// WHAT THIS PAGE IS  (restructured 17 Aug 2026)
// --------------------------------------------
// The Diaries is now ONE page, and it holds the writing rather than pointing at it.
//
// Before: /diaries was a hub of cards, and every card left the page — five of them to
// anchors on /restaurants and one to /article-contemporary-indian-wear. The blog was a table
// of contents for two other pages, which meant a reader who wanted "the writing on this
// site" had three URLs to visit and no single place that was the blog.
//
// Now: two categories, both inline.
//
//   Tram 22 Diaries                     h1
//     Latest                            the four newest, as cards that jump down the page
//     What I wear            #fashion    h2  ← the long-form dispatch, in full
//     Food I love in the city  #food     h2  ← every review, in full
//       Indian restaurants                   h3-group
//       Vegan in Prague       #vegan          h3-group
//
// /restaurants and /article-contemporary-indian-wear are gone, 301'd here (edge/_redirects).
// That consolidation was a deliberate call by the site's owner and it is not free: the
// restaurants page carried the ranking for the Prague Indian-restaurant searches and five
// Review nodes of structured data. Both are preserved rather than dropped — every Review is
// re-emitted below against the same restaurant names, the Article node for the dispatch is
// re-emitted too, and the anchors the old URLs used (#annamalai, #vegan, …) are the anchors
// this page uses, so /restaurants#annamalai lands in the right place after the redirect
// (a browser carries the fragment across a 301; the server never sees it).
//
// Heading levels are load-bearing, not decorative: h1 page, h2 category, h3 post, h4 inside
// a post's prose. content/contemporary-indian-wear.html is written with h4 sections for
// exactly this reason — see the comment at the top of that file.
//
// There is still NO JavaScript on this page.
//
//   node scripts/build-diaries.mjs
//
// Run after sync-chrome.mjs (it lifts the header and footer out of index.html).

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = "https://indianinprague.jains.es";

// How many posts the "Latest" grid shows. Four fills the grid at every breakpoint
// (1 / 2 / 4 columns) without leaving a ragged last row.
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

const CARD_SIZES = "(min-width:801px) 380px, (min-width:521px) 50vw, calc(100vw - 60px)";
const ENTRY_SIZES = "(min-width:801px) 400px, (min-width:521px) 50vw, calc(100vw - 40px)";

function picture(post, manifest, sizes, alt = "") {
  const entry = post.photo && manifest[post.photo];
  if (!entry) return "";
  const jpgs = entry.variants.map((v) => `${v.jpg} ${v.w}w`).join(", ");
  const webps = entry.variants.map((v) => `${v.webp} ${v.w}w`).join(", ");
  const f = entry.variants[0];
  return (
    `<picture><source type="image/webp" srcset="${webps}" sizes="${sizes}">` +
    `<img class="ph" src="${f.jpg}" srcset="${jpgs}" sizes="${sizes}" ` +
    `width="${f.w}" height="${f.h}" alt="${esc(alt)}" loading="lazy" decoding="async"></picture>`
  );
}

/* --------------------------------------------------------------- the cards ---- */

// A card in the Latest grid, or in the homepage strip. `base` is "" on the diaries page
// itself — the card is a jump link to a section further down — and "/diaries" on the
// homepage, where it has to be a real navigation.
//
// Empty alt: the card's heading immediately below is the accessible name, and the photo is a
// decorative crop of a scene the heading already names.
function postCard(post, manifest, base, cls) {
  return (
    `<a class="post${cls ? " " + cls : ""}" href="${base}#${esc(post.id)}">` +
    `<div class="frame ${spice(post.id)}">${picture(post, manifest, CARD_SIZES)}<div class="grain"></div>` +
    (post.kicker ? `<span class="cap">${esc(post.kicker)}</span>` : "") +
    `</div>` +
    `<div class="pbody"><h3>${esc(post.title)}</h3>` +
    `<p>${esc(post.blurb)}</p>` +
    `<span class="more">Read it →</span></div></a>`
  );
}

/* ------------------------------------------------------------- the entries ---- */

const humanDate = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

// A <time> element rather than a bare string, so the date is machine-readable in the page
// and not only inside the JSON-LD.
const byline = (post) =>
  `<p class="entry-meta"><time datetime="${esc(post.date)}">${esc(humanDate(post.date))}</time>` +
  (post.reading ? ` · <span>${post.reading} min read</span>` : "") +
  (post.meta ? ` · <span>${esc(post.meta)}</span>` : "") +
  `</p>`;

// The long-form dispatch. The body arrives as HTML from content/ and is emitted verbatim.
function articleEntry(post, body, manifest) {
  return `<article class="entry entry-article" id="${esc(post.id)}">
      <h3>${esc(post.title)}</h3>
      ${byline(post)}
      <div class="entry-body">
${body}
      </div>
      <div class="shop-cta">
        <h4>Shop the look</h4>
        <p>The pieces I write about here go up on my Vinted closet as I rotate them — block print, handloom, contemporary cuts. Pre-loved, locally available, no slow shipping from India.</p>
        <a class="btn saf" href="https://www.vinted.cz/member/3166447071" target="_blank" rel="noopener">Open my Vinted closet →</a>
      </div>
    </article>`;
}

// A review. The photograph sits beside the text from 721px up and above it on a phone — the
// .rev grid does that, and it is the same rule the old restaurants page used.
function reviewEntry(post, body, manifest) {
  const v = post.verdict;
  return `<article class="entry rev" id="${esc(post.id)}">
      <div class="frame ${spice(post.id)}">${picture(post, manifest, ENTRY_SIZES, post.title)}<div class="grain"></div></div>
      <div class="rev-body">
        <div class="rhead"><h3>${esc(post.title)}</h3>${
          v ? `<span class="rv ${esc(v.tone)}">${esc(v.label)}</span>` : ""}</div>
        ${byline(post)}
${body}
        ${post.order ? `<p class="order"><b>Order:</b> ${esc(post.order)}</p>` : ""}
      </div>
    </article>`;
}

/* ------------------------------------------------------------ the sections ---- */

// One category = one section. Posts inside it are grouped when the category declares groups
// (Food does: Indian restaurants, then the vegan places), and rendered flat when it does not.
function categorySection(cat, posts, bodies, manifest) {
  const render = (p) =>
    p.kind === "article"
      ? articleEntry(p, bodies[p.id], manifest)
      : reviewEntry(p, bodies[p.id], manifest);

  let inner;
  if (cat.groups?.length) {
    inner = cat.groups
      .map((g) => {
        const ps = posts.filter((p) => p.group === g.id);
        if (!ps.length) return "";
        return `<div class="entry-group" id="${esc(g.id)}">
      <h3 class="group-head">${esc(g.name)}</h3>
      ${g.note ? `<p class="group-note">${esc(g.note)}</p>` : ""}
    </div>
    ${ps.map(render).join("\n    ")}`;
      })
      .filter(Boolean)
      .join("\n\n    ");
  } else {
    inner = posts.map(render).join("\n\n    ");
  }

  const all = cat.all
    ? `<a class="rail-all" href="${esc(cat.all.href)}">${esc(cat.all.label)} →</a>`
    : "";

  // The verdict key belongs to Food and nothing else, so it is asked for by id rather than
  // rendered for every category.
  const key = cat.id === "food"
    ? `<div class="key"><span class="real">Tastes like home</span><span class="mild">Toned down</span><span class="trap">Tourist trap</span><span class="vegan">Fully vegan</span></div>`
    : "";

  // The honesty line. It was a floating aside on the old restaurants page; here it belongs to
  // the category, immediately under its heading, where someone deciding whether to trust a
  // review reads it before the reviews rather than after them.
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
        posts.length === 1 ? "dispatch" : "dispatches"}</span>${all}</div>
    </div>
    ${key}
    ${disclosure}
    ${inner}
  </div>
</section>`;
}

/* --------------------------------------------------------------- structured ---- */

const abs = (p) => `${SITE}${p}`;

function jsonLd(posts, cats) {
  const url = (p) => abs(`/diaries#${p.id}`);
  const imageOf = (p, manifest) => {
    const e = p.photo && manifest[p.photo];
    if (!e) return undefined;
    const biggest = e.variants[e.variants.length - 1];
    return abs("/" + biggest.jpg.replace(/^\//, ""));
  };
  return (manifest) => JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Blog",
        "@id": abs("/diaries#blog"),
        url: abs("/diaries"),
        name: "Tram 22 Diaries",
        description:
          "Honest reviews of Prague's Indian and vegan restaurants, notes on contemporary Indian wear, and life between India and the Czech Republic.",
        isPartOf: { "@id": abs("/#website") },
        author: { "@id": abs("/#author") },
        inLanguage: "en",
        // The categories, named where a crawler can see them — the page's two <section>s.
        about: cats.map((c) => ({ "@type": "Thing", name: c.name })),
        blogPost: posts.map((p) => ({
          "@type": "BlogPosting",
          "@id": url(p),
          headline: p.title,
          description: p.blurb,
          datePublished: p.date,
          url: url(p),
          image: imageOf(p, manifest),
          author: { "@id": abs("/#author") },
          isPartOf: { "@id": abs("/diaries#blog") },
        })),
      },
      // The dispatch keeps an Article node of its own. It had one at
      // /article-contemporary-indian-wear#article; the id moves with the content so the
      // markup describes where the words actually are now.
      ...posts.filter((p) => p.kind === "article").map((p) => ({
        "@type": "Article",
        "@id": abs(`/diaries#${p.id}-article`),
        headline: p.title,
        description: p.blurb,
        datePublished: p.date,
        mainEntityOfPage: { "@id": abs("/diaries#webpage") },
        image: imageOf(p, manifest),
        author: { "@id": abs("/#author") },
        publisher: { "@id": abs("/#author") },
        inLanguage: "en",
        wordCount: undefined,
      })),
      // Every Review that used to live on /restaurants, against the same restaurant names.
      // Dropping these on consolidation would have been the single most expensive part of
      // the move; re-emitting them here is what makes it survivable.
      ...posts.filter((p) => p.kind === "review").map((p) => ({
        "@type": "Review",
        "@id": url(p),
        url: url(p),
        itemReviewed: {
          "@type": "Restaurant",
          name: p.title,
          servesCuisine: p.cuisine,
          address: {
            "@type": "PostalAddress",
            addressLocality: "Prague",
            addressRegion: p.region,
            addressCountry: "CZ",
          },
        },
        author: { "@id": abs("/#author") },
        datePublished: p.date,
        name: p.verdict?.label,
        reviewBody: p.blurb,
      })),
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
// No ?v= token is emitted by this file. bump-assets.mjs owns it outright and runs after
// every generator; see the note in build-shop.mjs's chrome() for what having two owners
// cost when the token changed shape.

// The current-page marking the rest of the site gets. Same rule as sync-chrome.mjs.
const chromeHeader = header[0].replace(
  /<a href="\/diaries">/,
  '<a href="/diaries" class="active" aria-current="page">');

const featured = posts.slice(0, FEATURED);
const cats = data.categories
  .map((cat) => [cat, posts.filter((p) => p.cat === cat.id)])
  .filter(([, ps]) => ps.length > 0);

const sections = cats.map(([cat, ps]) => categorySection(cat, ps, bodies, manifest));

// The jump strip under the h1. Two categories today; it is generated, so it stays honest as
// categories are added or run dry.
const catNav =
  `<nav class="cat-jump" aria-label="Categories">` +
  cats.map(([c, ps]) =>
    `<a href="#${esc(c.id)}">${esc(c.name)} <b>${ps.length}</b></a>`).join("") +
  `</nav>`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Indian &amp; Vegan Restaurants in Prague, Reviewed — Tram 22 Diaries</title>
<meta name="description" content="Honest reviews of Prague's Indian restaurants and the best fully vegan spots, by an Indian who grew up eating this food — plus notes on contemporary Indian wear and life between two countries.">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<link rel="canonical" href="${SITE}/diaries">
<meta name="theme-color" content="#4A4433">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Indian in Prague">
<meta property="og:locale" content="en">
<meta property="og:url" content="${SITE}/diaries">
<meta property="og:title" content="Indian &amp; vegan restaurants in Prague, reviewed — Tram 22 Diaries">
<meta property="og:description" content="Which Indian restaurants in Prague are actually authentic, the best fully vegan spots, and how contemporary Indian wear works in a European city.">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:image" content="${SITE}/images/derived/IMG_4126-1200.jpg">
<meta property="og:image:alt" content="Indian in Prague">
<link rel="preload" href="assets/fonts/ibm-plex-mono-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<!-- Plex Sans carries every lede and every paragraph of prose on the site now, so it is
     as much a first-paint font as the mono is. One file: it is a variable face. -->
<link rel="preload" href="assets/fonts/ibm-plex-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/fonts.css">
<link rel="stylesheet" href="assets/site.css">
<link rel="stylesheet" href="assets/diaries.css">
<link rel="stylesheet" href="assets/module.css">
<script type="application/ld+json">
${jsonLd(posts, cats.map(([c]) => c))(manifest)}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${chromeHeader}

<main id="main">
<div class="page-head"><div class="wrap">
  <div class="crumb">Tram 22 · the journal</div>
  <h1>Tram 22 <b>Diaries</b></h1>
  <p class="lede">Notes from the legendary tram number 22, the lifeline of the city. Where I eat, what I wear, and what living between two countries actually feels like — every review and every dispatch, on one page.</p>
  ${catNav}
</div></div>

<section class="latest"><div class="wrap sec-inner">
  <div class="sec-top"><h2>Latest from the 22</h2></div>
  <div class="grid4">
    ${featured.map((p) => postCard(p, manifest, "", "post-lg")).join("\n    ")}
  </div>
</div></section>

${sections.join("\n\n")}

<section class="rail-end"><div class="wrap sec-inner">
  <div class="holding">
    <h2>More is coming</h2>
    <p>Jewellery, home things, brass, and the long one about paperwork and winters. They appear here as they are written — there is no list to join and nothing to unsubscribe from, but if you want a nudge when the next one lands, message me.</p>
    <div class="cta-row">
      <a class="btn saf" href="https://wa.me/420777558262?text=${encodeURIComponent("Hi! Nudge me when there is a new diary on indianinprague.jains.es.")}" target="_blank" rel="noopener">Nudge me when there's a new one →</a>
      <a class="btn" href="/wardrobe">The wardrobe →</a>
    </div>
  </div>
</div></section>
</main>
${footer[0]}
</body>
</html>
`;

await writeFile(path.join(ROOT, "diaries.html"), html);
console.log(
  `  diaries.html — ${posts.length} posts inline in ${cats.length} categor${cats.length === 1 ? "y" : "ies"}, ${featured.length} featured`);

// The homepage strip, between its own markers. These cards DO leave the page, so they carry
// the /diaries base.
const strip =
  `<div class="grid3">\n    ` +
  posts.slice(0, HOME_STRIP).map((p) => postCard(p, manifest, "/diaries")).join("\n    ") +
  `\n  </div>`;
await writeFile(path.join(ROOT, "index.html"), replaceRegion(index, "DIARY:LATEST", strip, "index.html"));
console.log(`  index.html — ${HOME_STRIP} latest posts (diary region replaced)`);
