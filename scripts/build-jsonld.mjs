#!/usr/bin/env node
// Inject JSON-LD into each page, just before </head>.
//
// Two audiences: search engines (rich results for the products and the article) and LLM
// crawlers, which lean on schema.org far more heavily than on prose because it is
// unambiguous. Product/Restaurant/Article types are what make "what Indian clothes are
// for sale in Prague" answerable from this site.
//
// The product list is generated FROM the markup rather than hand-written so the two
// cannot drift: if a garment sells and its <a class="piece"> is deleted, re-running this
// drops it from the structured data too.

import { readFile, writeFile } from "node:fs/promises";

const SITE = "https://indianinprague.jains.es";
const ROOT = "/Users/webserver/code/indianinprague";

// Real dates, not invented ones. 2026-07-05 is when the pages were actually written (the
// original file mtimes before any of the deployment work touched them); MODIFIED is the
// optimisation pass. datePublished is the single most valuable missing field for a piece
// of writing in search results, so it is worth being accurate about.
const PUBLISHED = "2026-07-05";
const MODIFIED = "2026-08-05";

const VINTED = "https://www.vinted.cz/member/3166447071";
const WHATSAPP = "https://wa.me/420777558262";

const PERSON = {
  "@type": "Person",
  "@id": `${SITE}/#author`,
  name: "Indian in Prague",
  description:
    "An Indian living in Prague, writing about contemporary Indian clothing, Indian restaurants in the city, and life between two countries.",
  url: `${SITE}/`,
  // sameAs is how a search engine or an LLM reconciles "the person who writes this site"
  // with "the person selling these garments on Vinted" — it is the difference between two
  // unrelated pages and one entity with a presence in two places.
  sameAs: [VINTED],
  knowsAbout: [
    "Contemporary Indian fashion",
    "Block printing",
    "Handloom textiles",
    "Indian cuisine",
    "Prague",
  ],
  knowsLanguage: ["en", "cs", "hi"],
  homeLocation: {
    "@type": "Place",
    name: "Prague",
    address: { "@type": "PostalAddress", addressLocality: "Prague", addressCountry: "CZ" },
  },
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer service",
    url: WHATSAPP,
    availableLanguage: ["en", "cs"],
  },
};

const WEBSITE = {
  "@type": "WebSite",
  "@id": `${SITE}/#website`,
  url: `${SITE}/`,
  name: "Indian in Prague",
  alternateName: "Indian in Prague",
  description:
    "Contemporary Indian clothes for sale in Prague, honest reviews of Prague's Indian restaurants, vegan spots, and a journal about life between India and the Czech Republic.",
  inLanguage: ["en", "cs"],
  publisher: { "@id": `${SITE}/#author` },
};

const breadcrumb = (trail) => ({
  "@type": "BreadcrumbList",
  itemListElement: trail.map(([name, url], i) => ({
    "@type": "ListItem",
    position: i + 1,
    name,
    item: url,
  })),
});

/** The garments on clothes.html, straight from the catalog.
 *
 * This used to scrape the rendered cards out of clothes.html with a regex, because the
 * page was hand-written and there was nowhere else for the data to live. Now that
 * sync-vinted.mjs maintains data/catalog.json, that is the source — which also means the
 * schema carries the real description, brand, colour and condition per item instead of
 * the card's one-line tag string, and cannot drift out of step with the markup. */
async function products() {
  const catalog = JSON.parse(await readFile(`${ROOT}/data/catalog.json`, "utf8"));
  return catalog.items
    .filter((i) => i.category === "Fashion" && !i.hidden)
    .map((i) => ({
      "@type": "Product",
      name: i.title,
      // The Vinted item id IS the SKU, deliberately — no second identifier is minted here.
      // Every piece is a one-off, listed exactly once, and the id already keys the photos
      // on disk, the overrides file, the enrich cache and the archive. Inventing a parallel
      // scheme would mean maintaining a mapping whose only job is to disagree with this one
      // eventually. If the site ever sells multi-unit stock of its own, THAT is when a
      // locally-issued SKU earns its keep; until then this is the identifier Google, Bing
      // and any feed reader should see.
      //
      // Caveat worth knowing: delete and re-list a piece on Vinted and it gets a new id, so
      // the SKU changes for what is physically the same object. Acceptable here — a relist
      // is a new listing at a new URL, which is what search engines will see regardless.
      sku: i.id,
      productID: i.id,
      description: i.description
        ? i.description.replace(/\s+/g, " ").trim().slice(0, 400)
        : [i.condition.en, i.color.en, i.size].filter(Boolean).join(" · "),
      category: "Apparel > Indian clothing",
      ...(i.brand ? { brand: { "@type": "Brand", name: i.brand } } : {}),
      ...(i.color.en ? { color: i.color.en } : {}),
      ...(i.size ? { size: i.size } : {}),
      url: i.urls.cz,
      offers: {
        "@type": "Offer",
        price: i.priceCzk,
        priceCurrency: "CZK",
        // Vinted's own condition, rather than assuming every piece is used — a good part
        // of this closet is listed new or new-without-tags.
        itemCondition: /^New/.test(i.condition.en)
          ? "https://schema.org/NewCondition"
          : "https://schema.org/UsedCondition",
        availability: i.reserved
          ? "https://schema.org/PreOrder"
          : "https://schema.org/InStock",
        url: i.urls.cz,
        seller: { "@id": `${SITE}/#author` },
      },
    }));
}

const restaurantReview = (name, area, cuisine, verdict, body) => ({
  "@type": "Review",
  itemReviewed: {
    "@type": "Restaurant",
    name,
    servesCuisine: cuisine,
    address: {
      "@type": "PostalAddress",
      addressLocality: "Prague",
      addressRegion: area,
      addressCountry: "CZ",
    },
  },
  author: { "@id": `${SITE}/#author` },
  reviewBody: body,
  name: verdict,
});

const graphs = {
  "index.html": async () => [
    WEBSITE,
    PERSON,
    {
      "@type": "CollectionPage",
      "@id": `${SITE}/#webpage`,
      url: `${SITE}/`,
      name: "Indian in Prague — modern Indian clothes, real food, life between two countries",
      isPartOf: { "@id": `${SITE}/#website` },
      about: [
        { "@type": "Thing", name: "Contemporary Indian fashion" },
        { "@type": "Thing", name: "Indian restaurants in Prague" },
        { "@type": "Thing", name: "Vegan restaurants in Prague" },
      ],
      inLanguage: "en",
    },
  ],

  "clothes.html": async () => [
    {
      "@type": "CollectionPage",
      "@id": `${SITE}/clothes#webpage`,
      url: `${SITE}/clothes`,
      name: "Modern Indian clothes in Prague",
      isPartOf: { "@id": `${SITE}/#website` },
      inLanguage: "en",
    },
    breadcrumb([
      ["Home", `${SITE}/`],
      ["Clothes", `${SITE}/clothes`],
    ]),
    {
      "@type": "ItemList",
      name: "Indian clothes for sale in Prague",
      description:
        "Block-printed and handloom cotton Indian clothing from the author's own wardrobe, sold second-hand on Vinted.",
      numberOfItems: (await products()).length,
      itemListElement: (await products()).map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: p,
      })),
    },
    // The buyer's guide is a glossary, so it is marked up as one.
    //
    // FAQPage was the obvious alternative and is deliberately not used: Google requires
    // FAQ markup to mirror question-and-answer content that is actually visible on the
    // page, and these are statement headings ("Block print"), not
    // questions. Rewriting them into questions to satisfy a schema would be tail-wagging
    // the dog. DefinedTerm describes what this genuinely is, carries no such guideline
    // risk, and is just as extractable by an LLM answering "what is Ajrakh block print".
    {
      "@type": "DefinedTermSet",
      "@id": `${SITE}/clothes#glossary`,
      name: "A quick guide to modern Indian labels",
      description:
        "What the terms on Indian clothing labels actually mean, for buyers who have only met Indian clothing through European ethno shops.",
      inLanguage: "en",
      hasDefinedTerm: [
        {
          "@type": "DefinedTerm",
          name: "Block print",
          inDefinedTermSet: { "@id": `${SITE}/clothes#glossary` },
          description:
            "Hand-carved wooden blocks stamped by hand onto cotton. The tiny irregularities are the point — no two metres are identical. The best of it is done slowly and ethically in Jaipur workshops, and it is the opposite of printed-mandala fast fashion.",
        },
        {
          "@type": "DefinedTerm",
          name: "Handloom",
          inDefinedTermSet: { "@id": `${SITE}/clothes#glossary` },
          description:
            "Fabric woven on a non-powered loom by a weaver rather than a machine. It breathes differently, drapes differently and lasts longer. Good makers work directly with artisan communities, so a piece carries a maker rather than just a label.",
        },
      ],
    },
  ],

  "restaurants.html": async () => [
    {
      "@type": "CollectionPage",
      "@id": `${SITE}/restaurants#webpage`,
      url: `${SITE}/restaurants`,
      name: "Indian restaurants in Prague — honest reviews",
      isPartOf: { "@id": `${SITE}/#website` },
      inLanguage: "en",
    },
    breadcrumb([
      ["Home", `${SITE}/`],
      ["Restaurants", `${SITE}/restaurants`],
    ]),
    {
      "@type": "ItemList",
      name: "Indian and vegan restaurants in Prague, reviewed",
      itemListElement: [
        restaurantReview(
          "Annamalai",
          "Nové Město",
          "South Indian",
          "Tastes like home",
          "South Indian sit-down restaurant in Nové Město. The closest thing in Prague to food as it is actually cooked in South India.",
        ),
        restaurantReview(
          "INDelicious Bistro",
          "Nusle",
          "Indian",
          "Street food",
          "North and South Indian street food in Nusle — quick bites and full meals.",
        ),
        restaurantReview(
          "Pastva",
          "Anděl",
          "Vegan",
          "Fully vegan",
          "Fully vegan restaurant in Anděl.",
        ),
        restaurantReview(
          "Palo Verde Bistro",
          "Žitná",
          "Vegan",
          "Fully vegan",
          "Fully vegan bistro on Žitná.",
        ),
        restaurantReview(
          "Dosa Dosa",
          "Újezd",
          "South Indian vegan",
          "Fully vegan",
          "Fully vegan South Indian dosa specialist on Újezd.",
        ),
      ].map((r, i) => ({ "@type": "ListItem", position: i + 1, item: r })),
    },
  ],

  "diaries.html": async () => [
    {
      "@type": "Blog",
      "@id": `${SITE}/diaries#blog`,
      url: `${SITE}/diaries`,
      name: "Tram 22 Diaries",
      description:
        "A journal about modern Indian fashion, curated Vinted finds, and life between India and Prague.",
      isPartOf: { "@id": `${SITE}/#website` },
      author: { "@id": `${SITE}/#author` },
      inLanguage: "en",
      // Points at the dispatch's own @id rather than restating it, so the two pages
      // describe one article between them instead of two competing copies.
      blogPost: [{ "@id": `${SITE}/article-contemporary-indian-wear#article` }],
    },
    breadcrumb([
      ["Home", `${SITE}/`],
      ["Tram 22 Diaries", `${SITE}/diaries`],
    ]),
  ],

  "article-contemporary-indian-wear.html": async () => [
    {
      "@type": "Article",
      "@id": `${SITE}/article-contemporary-indian-wear#article`,
      url: `${SITE}/article-contemporary-indian-wear`,
      headline: "Contemporary Indian wear on the streets of Prague",
      description:
        "Not Goa-hippie, not festival sari. The new age of Indian wear — and exactly how to style it into a European wardrobe.",
      image: `${SITE}/images/derived/IMG_5564-1200.jpg`,
      author: { "@id": `${SITE}/#author` },
      publisher: { "@id": `${SITE}/#author` },
      isPartOf: { "@id": `${SITE}/diaries#blog` },
      datePublished: PUBLISHED,
      dateModified: MODIFIED,
      inLanguage: "en",
      articleSection: "Fashion",
      keywords:
        "contemporary Indian wear, modern Indian fashion Prague, block print, slow fashion, handloom",
      wordCount: 0, // filled in below from the actual body copy
    },
    breadcrumb([
      ["Home", `${SITE}/`],
      ["Tram 22 Diaries", `${SITE}/diaries`],
      ["Contemporary Indian wear", `${SITE}/article-contemporary-indian-wear`],
    ]),
  ],
};

for (const [file, build] of Object.entries(graphs)) {
  const p = `${ROOT}/${file}`;
  let html = await readFile(p, "utf8");

  // Idempotent: strip any block this script wrote before re-inserting.
  html = html.replace(
    /\n<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
    "",
  );

  const graph = await build();

  // Count the real words for the Article, rather than asserting a number.
  const art = graph.find((n) => n["@type"] === "Article");
  if (art) {
    const text = html
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]+>/g, " ");
    art.wordCount = text.split(/\s+/).filter(Boolean).length;
  }

  const ld = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2);
  html = html.replace("</head>", `<script type="application/ld+json">\n${ld}\n</script>\n</head>`);
  await writeFile(p, html);
  console.log(`${file}: ${graph.length} nodes, ${ld.length}B`);
}
