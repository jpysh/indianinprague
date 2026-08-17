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
import path from "node:path";

const SITE = "https://indianinprague.jains.es";
// Resolved from this file's own location, the way every other script in here does it.
//
// It was hardcoded to /Users/webserver/code/indianinprague until 17 Aug 2026, which worked
// for as long as the only thing that ran it was publish.sh on the Mac. It is not: the repo is
// connected to Cloudflare Workers Builds, whose build command is
// `npm ci && node scripts/build-dist.mjs`, and build-dist runs the generators itself when it
// is not passed --no-generate. So a plain `git push` executes this file with the repo at
// /opt/buildhome/repo and it died on ENOENT trying to open a path from someone's laptop —
// after build-shop had already succeeded, which is what made the failure look like a data
// problem rather than a path one.
const ROOT = path.resolve(import.meta.dirname, "..");

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

// The site models its author as a Person, which is right for the wardrobe and the diaries:
// those ARE one person's closet and one person's opinions. /spirituality is not — it sells
// services (courses, treatments, guided trips) and ships physical goods across Europe, and
// an answer engine asked "who runs Ayurvedic consultations in Prague" is looking for a
// business entity, not a blogger. Both nodes therefore exist and are linked to each other
// with sameAs, so the two reconcile as one operation rather than reading as two unrelated
// parties who happen to share a domain. Entity coherence across sources is the thing AI
// engines actually check.
const ORG = {
  "@type": "Organization",
  "@id": `${SITE}/#org`,
  name: "Indian in Prague",
  url: `${SITE}/spirituality`,
  description:
    "Yoga, Ayurveda, meditation and wellbeing taught from source knowledge in Prague, guided journeys to India, and authentic Ayurvedic goods shipped across Europe.",
  founder: { "@id": `${SITE}/#author` },
  sameAs: [VINTED],
  areaServed: [
    { "@type": "Country", name: "Czech Republic" },
    { "@type": "Place", name: "Europe" },
  ],
  address: {
    "@type": "PostalAddress",
    addressLocality: "Prague",
    addressCountry: "CZ",
  },
  knowsAbout: [
    "Ayurveda",
    "Panchakarma",
    "Yoga",
    "Meditation",
    "Marma therapy",
    "Chakras",
  ],
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer service",
    url: WHATSAPP,
    availableLanguage: ["en", "cs"],
  },
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

  // /spirituality was a design export that never got wired in here, so the largest page on
  // the site — 15k words of services, retreats, products and a real FAQ — carried no
  // structured data at all until 17 Aug 2026. It was the single biggest gap on the site:
  // everything on it was invisible as machine-readable entities.
  "spirituality.html": async () => [
    ORG,
    {
      "@type": "WebPage",
      "@id": `${SITE}/spirituality#webpage`,
      url: `${SITE}/spirituality`,
      name: "Yoga, Ayurveda and Spirituality — Indian in Prague",
      description:
        "Yoga, Ayurveda, meditation and wellbeing traditions taught from genuine source knowledge in Prague, guided journeys to India, and authentic Ayurvedic products shipped across Europe.",
      isPartOf: { "@id": `${SITE}/#website` },
      about: [
        { "@type": "Thing", name: "Ayurveda" },
        { "@type": "Thing", name: "Yoga" },
        { "@type": "Thing", name: "Meditation" },
        { "@type": "Thing", name: "Panchakarma" },
      ],
      inLanguage: "en",
    },
    breadcrumb([
      ["Home", `${SITE}/`],
      ["Spirituality", `${SITE}/spirituality`],
    ]),

    // The five Q&As below are verbatim from the visible "Good to know." section. That is not
    // a nicety: Google requires FAQ markup to mirror question-and-answer content actually
    // present on the page, and a verbatim answer is also the single most citable unit of
    // text there is for an answer engine. If the section is edited, edit these to match.
    {
      "@type": "FAQPage",
      "@id": `${SITE}/spirituality#faq`,
      inLanguage: "en",
      mainEntity: [
        [
          "Do I need any experience to start?",
          "No — classes and introductory sessions suit complete beginners as well as more experienced practitioners.",
        ],
        [
          "Is this connected to a particular religion?",
          "No. These are universal practices for health, calm and self-understanding, open to people of any or no religious background.",
        ],
        [
          "Can I just buy products without taking a course?",
          "Yes — the shop and services are independent; take whichever pieces are useful to you.",
        ],
        [
          "Do you organise trips to India for individuals, not just groups?",
          "Yes — both small-group and individually tailored trips are available.",
        ],
        [
          "Where do treatments and classes take place?",
          "Get in touch for current locations and formats in Prague, including any online options.",
        ],
      ].map(([q, a]) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },

    // The three things the page actually offers, as Services rather than prose. "Ayurvedic
    // consultation in Prague" and "marma therapy" are the queries these exist to answer.
    ...[
      {
        id: "learn",
        name: "Courses, Treatments & Personal Sessions",
        serviceType: "Yoga, Ayurveda and meditation instruction",
        description:
          "Yoga, Ayurveda and meditation from authentic, source-based knowledge — in group classes, or one-to-one.",
        offers: [
          "Yoga classes and meditation, in-person in Prague",
          "Workshops and structured courses",
          "Ayurvedic consultations, treatments and marma therapy",
        ],
      },
      {
        id: "travel",
        name: "Journeys to India",
        serviceType: "Guided yoga and Ayurveda travel",
        description:
          "Small-group, carefully guided trips for yoga, Ayurveda and genuine cultural immersion — not a package tour.",
        offers: [
          "Yoga and Ayurveda retreats",
          "Panchakarma — Ayurvedic detox — journeys",
          "Cultural and sightseeing trips",
          "Private and small-group itineraries",
        ],
      },
      {
        id: "products",
        name: "Authentic Indian & Ayurvedic Goods",
        serviceType: "Ayurvedic and yoga goods retail",
        description:
          "Genuine products sourced from trusted producers in India, shipped across Europe.",
        offers: [
          "Ayurvedic oils, herbs and teas",
          "Copper vessels and ritual items",
          "Yoga mats and accessories",
          "Books and gift sets",
        ],
      },
    ].map((s) => ({
      "@type": "Service",
      "@id": `${SITE}/spirituality#${s.id}`,
      name: s.name,
      serviceType: s.serviceType,
      description: s.description,
      provider: { "@id": `${SITE}/#org` },
      areaServed: [
        { "@type": "City", name: "Prague" },
        { "@type": "Place", name: "Europe" },
      ],
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: s.name,
        itemListElement: s.offers.map((o) => ({
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: o },
        })),
      },
    })),

    {
      "@type": "ItemList",
      "@id": `${SITE}/spirituality#journeys`,
      name: "Journeys to India",
      description:
        "Six guided trips to India and Nepal for yoga, Ayurveda, Panchakarma and cultural immersion, led by people who know these places from the inside.",
      numberOfItems: 6,
      itemListElement: [
        [
          "Panchakarma & Ayurveda Retreat",
          "Full Ayurvedic detox and rejuvenation, guided by experienced local practitioners, from coastal Kerala to the quiet Himalayas.",
          ["Kerala", "Himalayas"],
        ],
        [
          "Yoga at the Source",
          "A classical yoga intensive in the town where modern yoga tourism began, on the banks of the Ganges.",
          ["Rishikesh"],
        ],
        [
          "Jog Sadhana",
          "Deep classical-yoga sadhana balanced with study of classical texts, set against Himalayan scenery.",
          ["Rishikesh", "Chopta"],
        ],
        [
          "Golden Triangle & Goa",
          "Delhi, Agra and Jaipur's culture and history, followed by rest and recovery on Goa's beaches.",
          ["Delhi", "Agra", "Jaipur", "Goa"],
        ],
        [
          "Himalayan Spiritual Journey",
          "Trekking, monasteries and mountain energy across the Himalayan foothills, for those seeking scale and quiet together.",
          ["Nepal"],
        ],
        [
          "Private & Corporate Retreats",
          "Tailored itineraries built around a group's own purpose, pace and dates.",
          ["India"],
        ],
      ].map(([name, description, places], i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "TouristTrip",
          name,
          description,
          provider: { "@id": `${SITE}/#org` },
          itinerary: places.map((p) => ({ "@type": "Place", name: p })),
        },
      })),
    },

    {
      "@type": "ItemList",
      "@id": `${SITE}/spirituality#goods`,
      name: "Authentic Indian and Ayurvedic goods",
      numberOfItems: 8,
      itemListElement: [
        ["Ayurvedic Oils", "Massage, hair, nasal and dropper oils."],
        ["Skincare & Cosmetics", "Natural face and body care."],
        ["Copper Vessels", "Bottles, jugs, neti pots, Shirodhara bowls."],
        ["Herbs, Spices & Teas", "Turmeric, ghee, basmati rice, herbal blends."],
        ["Yoga Mats & Accessories", "Mats, covers, props."],
        ["Rituals & Meditation", "Oil warmers, incense, ritual sets."],
        ["Books & Learning", "Ayurveda and yoga reference titles."],
        ["Gift Sets", "Curated bundles for newcomers or gifting."],
      ].map(([name, description], i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: { "@type": "ProductCollection", name, description },
      })),
    },

    // DefinedTermSet rather than FAQPage, for exactly the reason spelled out over the
    // clothes glossary above: these are statement headings, not questions, and rewriting
    // them into questions to satisfy a schema would be tail-wagging the dog. An LLM asked
    // "what is the Anahata chakra" extracts this just as readily, with no guideline risk.
    {
      "@type": "DefinedTermSet",
      "@id": `${SITE}/spirituality#chakras`,
      name: "The seven chakras",
      description:
        "The seven energy centres, their positions in the body and the qualities associated with each.",
      inLanguage: "en",
      hasDefinedTerm: [
        ["Root — Mooladhara", "Base of spine", "Innocence, groundedness"],
        ["Sacral — Swadisthana", "Lower abdomen", "Creativity, focus"],
        ["Navel — Nabhi", "Abdomen", "Contentment, generosity"],
        ["Heart — Anahat", "Chest", "Compassion, confidence"],
        ["Throat — Vishuddhi", "Throat", "Communication, diplomacy"],
        ["Third Eye — Agnya", "Between the brows", "Forgiveness, clarity"],
        ["Crown — Sahastrara", "Top of the head", "Integration, connection"],
      ].map(([name, where, qualities]) => ({
        "@type": "DefinedTerm",
        name,
        inDefinedTermSet: { "@id": `${SITE}/spirituality#chakras` },
        description: `${where}. Associated with: ${qualities.toLowerCase()}.`,
      })),
    },
  ],

  // restaurants.html, diaries.html and article-contemporary-indian-wear.html were handled
  // here until 17 Aug 2026. The first and third no longer exist — their content was folded
  // into /diaries and both URLs 301 to it (edge/_redirects). The Diaries is deliberately NOT
  // in this table either: scripts/build-diaries.mjs writes that page from data/posts.json and
  // emits its own graph — Blog, one BlogPosting per dispatch, an Article for the long read,
  // and the five Review nodes the restaurants page used to carry.
  //
  // That is not a style preference, it is a collision. The loop below STRIPS every
  // application/ld+json block from a page before inserting its own, so listing diaries.html
  // here would silently delete the graph the diaries generator had just written. One owner
  // per page.
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
