#!/usr/bin/env node
// Render data/catalog.json into the shop pages.
//
// Nothing here invents markup. The cards use the same class vocabulary the hand-built
// pages already use — .piece / .frame / .meta / .nm / .pr / .tags / .grid3 — so the
// generated grid is visually identical to the one it replaces and assets/site.css needed
// no rewrite. Only three genuinely new things are styled (assets/shop.css): the EUR/Kč
// price pair, the favourite count, and the filter toolbar.
//
// Two kinds of output, deliberately:
//
//   1. Whole pages, generated from scratch — shop.html and one page per category that has
//      items in it. These have no hand-written content to protect.
//
//   2. Regions inside hand-written pages, replaced between HTML comment markers:
//        <!-- SHOP:GRID:START --> … <!-- SHOP:GRID:END -->
//      clothes.html and index.html carry real editorial prose (the block-print manifesto,
//      the handloom guide, the hero) that is worth more than any grid. So the generator
//      never rewrites those files, it only swaps the region between the markers. Edit the
//      prose freely; the next build will leave it alone.
//
// clothes.html is the Fashion category page and keeps its URL. It is the page with the
// site's existing search rankings — do not "tidy" it into fashion.html.
//
//   node scripts/build-shop.mjs
//
// Run after sync-vinted.mjs and build-images.mjs (it reads the image manifest the latter
// writes, to emit width/height and stop the grid reflowing as photos arrive).

import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = "https://indianinprague.jains.es";

// Which storefront the "buy" links point at. The catalog stores cz/es/com for every item,
// so switching this — or making it per-visitor once the Spanish shop opens — is a
// one-line change here rather than a re-sync.
const STOREFRONT = "cz";

// Order is display order: the nav, and the sequence of sections on shop.html.
const CATEGORIES = [
  {
    name: "Fashion", slug: "fashion", page: "wardrobe/fashion.html", managed: true,
    sub: "kurtas · sarees · sets",
    title: "Modern Indian Clothes in Prague — Buy on Vinted",
  },
  {
    name: "Home Decor", slug: "home-decor", page: "wardrobe/home-decor.html",
    sub: "textiles · ceramics",
    title: "Indian Home Decor in Prague — Textiles, Ceramics, Handmade | Indian in Prague",
    h1: ["Home things,", "carried back"],
    lead: "Block-printed textiles, hand-painted ceramics, and small objects that make a Prague flat feel less like a rental. Most of it came back in a suitcase.",
    expo: ["HOME", "textiles · ceramics", "handmade · block print"],
  },
  {
    name: "Jewellery", slug: "jewellery", page: "wardrobe/jewellery.html",
    sub: "silver · handmade",
    title: "Indian Jewellery in Prague — Silver, Beads, Handmade | Indian in Prague",
    h1: ["Jewellery,", "mostly silver"],
    lead: "Pieces picked up across India and worn, not collected. Oxidised silver, glass beads, and the kind of thing you cannot find on Wenceslas Square.",
    expo: ["JEWELLERY", "silver · brass", "handmade · oxidised"],
  },
  {
    // The catalog still says "Spirituality" — that is the Vinted branch name, and renaming
    // it in the data would break the sync. Only the shelf's public face moved: /spirituality
    // is the Spirituality MODULE now (yoga, ayurveda, meditation, trips — its own nav slot
    // and its own hand-written page), so the shelf of brass and beads took the name it
    // always actually described and gave up the URL.
    name: "Spirituality", label: "Meditation", slug: "meditation", page: "wardrobe/meditation.html",
    sub: "brass · sandalwood",
    title: "Indian Ritual Objects in Prague — Incense, Brass, Prayer Beads | Indian in Prague",
    h1: ["Objects that", "hold something"],
    lead: "Brass, sandalwood, prayer beads. Sold plainly, without the incense-shop mysticism — these are ordinary household things in India, and they are good objects on their own terms.",
    expo: ["RITUAL OBJECTS", "altar & puja", "brass · sandalwood"],
  },
  // Wellness was a top-level module page here until 16 Aug 2026, when it was removed along
  // with Buddy: both were holding pages with no products on them, and an unfinished shelf
  // advertised on the homepage costs more trust than it earns. The single catalog item
  // still carrying category "Wellness" is unaffected — it keeps its category, still appears
  // on wardrobe.html and still says "Wellness" on the card. Only the dedicated page is gone.
  // Re-adding it means restoring an entry here with managed:true and module:true, plus its
  // sitemap line and its nav slot in index.html.
  {
    name: "Books", slug: "books", page: "wardrobe/books.html",
    sub: "second-hand books",
    title: "Indian Books in Prague — Fiction, Cookery, Second-hand | Indian in Prague",
    h1: ["Books I have", "finished with"],
    lead: "Fiction, cookery and the odd art book — read once, kept well, and taking up shelf space I do not have.",
    expo: ["BOOKS", "second-hand", "fiction · cookery"],
  },
  {
    // The data keeps saying "Uncategorised" — that is the signal sync-vinted.mjs prints
    // when a Vinted branch has no rule yet, and softening it in the data would hide the
    // work. The shopper just sees "More".
    name: "Uncategorised", label: "Others", slug: "others", page: "wardrobe/others.html",
    sub: "odds and ends",
    title: "More from my closet | Indian in Prague",
    h1: ["Everything", "else"],
    lead: "The pieces that do not fit a shelf label yet.",
    expo: ["MORE", "everything else", "odds and ends"],
  },
];

// Deterministic so a card keeps the same placeholder tint between builds — the tint shows
// while the photo decodes, and one that changed on every deploy would flicker.
const SPICE = ["sp-oli", "sp-mag", "sp-pap", "sp-saf", "sp-chi", "sp-plum"];
const spice = (id) => SPICE[Number(id) % SPICE.length];

// The site serves extensionless URLs (see wrangler.jsonc html_handling). Every URL this
// file writes — canonical, og:url, tiles, breadcrumbs — goes through here, so the .html
// form exists only as a filename on disk and never as a link. index.html is the site root.
const url = (page) =>
  page === "index.html" ? "/"
  : page === "wardrobe/index.html" ? "/wardrobe"
  : "/" + String(page).replace(/\.html$/, "");

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const IMG_SIZES = "(min-width:801px) 400px, (min-width:521px) 50vw, calc(100vw - 40px)";

/* ------------------------------------------------------------------ pieces ---- */

// What a category is called on screen, which is not always what it is called in the data.
const label = (name) => CATEGORIES.find((c) => c.name === name)?.label || name;

function picture(item, manifest, eager) {
  const entry = item.photo && manifest[item.photo];
  const alt = esc(item.title);
  if (!entry) {
    // No derivative yet (build-images.mjs not run since the last sync). Emit the original
    // so the page is still correct, just heavier.
    const src = "/" + esc(item.photo || "images/derived/IMG_5630-400.jpg");
    return `<img class="ph" src="${src}" alt="${alt}" loading="${eager ? "eager" : "lazy"}" decoding="async">`;
  }
  // Root-absolute: the manifest stores repo-relative paths and shelf pages are a directory
  // down, where "images/…" would resolve to /wardrobe/images/….
  const jpgs = entry.variants.map((v) => `/${v.jpg} ${v.w}w`).join(", ");
  const webps = entry.variants.map((v) => `/${v.webp} ${v.w}w`).join(", ");
  // src is the SMALLEST variant, not the largest. srcset decides what a modern browser
  // actually fetches, so src is only the fallback — and pointing it at the 800 meant any
  // client that ignored srcset pulled 120 KB to fill a 400px cell. width/height come from
  // the same variant so the intrinsic ratio matches what src refers to.
  const fallback = entry.variants[0];
  const load = eager ? 'fetchpriority="high"' : 'loading="lazy"';
  return (
    `<picture><source type="image/webp" srcset="${webps}" sizes="${IMG_SIZES}">` +
    `<img class="ph" src="/${fallback.jpg}" srcset="${jpgs}" sizes="${IMG_SIZES}" ` +
    `width="${fallback.w}" height="${fallback.h}" alt="${alt}" ${load} decoding="async"></picture>`
  );
}

// The photos AFTER the first, encoded compactly for shop.js to build on demand:
//
//   vinted-9644821969-2:400|800,vinted-9644821969-3:400|800
//
// Only the first photo ships as real <picture> markup. Emitting all seven would have put
// roughly 1,000 <picture> blocks into shop.html and taken it past 2 MB — for images most
// visitors never scroll to. The rest are built by the browser the first time someone
// actually interacts with that card, which is also when the bytes are worth spending.
function extraShots(item, manifest) {
  return (item.photos || [])
    .slice(1)
    .map((p) => {
      const entry = manifest[p];
      if (!entry) return null;
      const base = entry.variants[0].jpg.replace(/-\d+\.jpg$/, "");
      return `${base.replace("images/derived/", "")}:${entry.variants.map((v) => v.w).join("|")}`;
    })
    .filter(Boolean)
    .join(",");
}

// A one-line taste of the listing, revealed over the bottom of the photo on hover or
// keyboard focus. Deliberately an enhancement, never the only home for anything: condition,
// colour, size and price all live in the card's own text below the image, where a touch
// visitor (who has no hover) and a screen reader both get them regardless.
function blurb(item) {
  const d = (item.description || "").replace(/\s+/g, " ").trim();
  if (!d) return "";
  const cut = d.length > 150 ? d.slice(0, 149).replace(/\s+\S*$/, "") + "…" : d;
  return `<p class="blurb">${esc(cut)}</p>`;
}

/* --------------------------------------------------------------- WhatsApp ---- */

// One number, one place to change it.
const WA = "https://wa.me/420777558262?text=";
const wa = (body) => WA + encodeURIComponent(body);

// The per-card "ask" link, prefilled.
//
// This is the whole point of the control. A bare wa.me link opens an EMPTY chat: the
// visitor has to compose the question themselves, and what arrives at the other end is
// "hi" with no indication which of 150 pieces it is about. Prefilling turns an intention
// into a message that is already answerable — the title, the price, and the listing URL so
// the reply can be specific without any back-and-forth.
//
// A sold piece asks a different question, because the answer to "is this available" is
// already no. "Do you have anything similar" is the only useful thing left to ask, and it
// is often a real sale.
function askUrl(item) {
  if (item.sold) {
    return wa(`Hi! "${item.title}" has sold — do you have anything similar?`);
  }
  const price = item.priceEur == null ? "" : ` (€${item.priceEur})`;
  return wa(`Hi! I'd like to ask about "${item.title}"${price} — ${item.urls[STOREFRONT]}`);
}

// The data-* attributes are what assets/shop.js filters on. They are on the card rather
// than in a JS blob so that filtering needs no parallel copy of the catalog, and so the
// page is still correct and complete with JavaScript switched off.
function card(item, manifest, eager, showCat) {
  const sold = !!item.sold;
  const caption = showCat ? label(item.category) : item.brand;
  const tags = [item.condition?.en, item.color?.en, item.sizeGroup].filter(Boolean).join(" · ");

  // The favourite count is the strongest social proof on the page — these are real people
  // saving the piece on Vinted — so it sits ON the photograph rather than in the small print
  // under it. Still suppressed below 3: "♥ 1" argues against the item.
  const favBadge = item.favourites >= 3
    ? `<span class="fav-badge" title="${item.favourites} people have saved this on Vinted">` +
      `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false" fill="currentColor">` +
      `<path d="M12 21s-8-4.9-8-10.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 3.6C20 16.1 12 21 12 21Z"/></svg>` +
      `${item.favourites}<span class="vh"> people saved this on Vinted</span></span>`
    : "";

  const shots = sold ? "" : extraShots(item, manifest);
  const data =
    ` data-cat="${esc(item.category)}" data-size="${esc(item.sizeGroup || "")}"` +
    ` data-color="${esc(item.color?.en || "")}" data-brand="${esc(item.brand || "")}"` +
    ` data-cond="${esc(item.condition?.en || "")}" data-price="${item.priceCzk ?? ""}"` +
    ` data-fav="${item.favourites || 0}" data-avail="${sold ? "sold" : "available"}"` +
    ` data-title="${esc((item.title || "").toLowerCase())}"` +
    (shots ? ` data-shots="${esc(shots)}"` : "");

  // Euro only. The shop reads as one currency, and the koruna figure was competing with it
  // for the same slot at half the size. Vinted still charges in the buyer's own currency at
  // checkout — the note under the grid says so, and data/catalog.csv keeps the Kč value.
  //
  // Price is omitted entirely on a recovered sold item: Vinted strips it from a sold
  // listing, and inventing one would misstate what the piece actually fetched.
  const price = item.priceEur == null
    ? `<span class="pr sold-pr">Sold</span>`
    : `<span class="pr">€${item.priceEur}</span>`;

  const badges =
    (sold ? `<span class="cap flag sold-flag">Sold</span>` : "") +
    (item.reserved ? `<span class="cap flag res">Reserved</span>` : "");

  const inner =
    `<div class="frame ${spice(item.id)}">` +
    `<div class="shots" data-track><div class="shot">${picture(item, manifest, eager)}</div></div>` +
    `<div class="grain"></div>` +
    (sold ? "" : `<span class="ext" aria-hidden="true">↗</span>`) +
    `${caption ? `<span class="cap">${esc(caption)}</span>` : ""}${badges}${favBadge}` +
    blurb(item) +
    `</div>` +
    `<div class="meta"><span class="nm">${esc(item.title)}</span>${price}</div>` +
    `<div class="tags">${esc(tags) || (sold ? "No longer available" : "")}</div>`;

  // Every card is a <div>, never an <a>. It carries TWO destinations now — the Vinted
  // listing and a WhatsApp message about this specific piece — and an anchor cannot legally
  // contain another anchor. Browsers "recover" from nested anchors by splitting the markup,
  // which breaks the grid in ways that differ per engine.
  //
  // So the Vinted link is a bare <a class="go"> that CSS stretches over the whole card
  // (.go::after { inset: 0 }), which keeps the entire card clickable exactly as it was, and
  // .ask sits above it on the z axis so it stays independently clickable. This is the
  // standard "stretched link" pattern; assets/shop.css carries the two rules.
  //
  // A sold card gets no .go: Vinted 307s a sold listing to a page with its structured data
  // stripped, so every one of those would be a dead end. It keeps .ask, because "do you have
  // anything like this?" is the single most useful thing a sold card can be asked.
  const go = sold
    ? ""
    : `<a class="go" href="${esc(item.urls[STOREFRONT])}" target="_blank" rel="noopener"` +
      ` aria-label="${esc(item.title)} — open the Vinted listing in a new tab"></a>`;

  // No WhatsApp glyph here, deliberately. The icon's path data is ~700 bytes and there are
  // 157 cards on wardrobe.html — the mark alone would have added ~110 KB to the page to
  // decorate a link whose label already says what it does. The green carries the recognition.
  const ask =
    `<a class="ask" href="${esc(askUrl(item))}" target="_blank" rel="noopener">` +
    `${sold ? "Ask for something similar" : "Ask about this piece"}` +
    `<span class="vh"> — opens WhatsApp in a new tab</span></a>`;

  return `<div class="piece${sold ? " sold" : ""}"${data}>${inner}${go}${ask}</div>`;
}

// The first three cards are the ones above the fold on a desktop grid, so they load eagerly
// and everything below them lazily.
const grid = (items, manifest, showCat) =>
  `<div class="grid3" id="grid">\n` +
  items.map((it, i) => "    " + card(it, manifest, i < 3, showCat)).join("\n") +
  `\n  </div>`;

/* ----------------------------------------------------------------- toolbar ---- */

// Price bands in euro, because that is the currency shown first. Only bands that actually
// contain something are offered — an empty "over €50" on a page of second-hand paperbacks
// is a control that can only disappoint.
const PRICE_BANDS = [
  { id: "0-10", label: "Under €10", min: 0, max: 10 },
  { id: "10-25", label: "€10 – €25", min: 10, max: 25 },
  { id: "25-50", label: "€25 – €50", min: 25, max: 50 },
  { id: "50+", label: "Over €50", min: 50, max: Infinity },
];

// Vinted's five conditions, ordered best-first rather than alphabetically — "Good" sorting
// above "New with tags" would be nonsense to a shopper.
const CONDITION_ORDER = ["New with tags", "New without tags", "Very good", "Good", "Satisfactory"];

// Progressive enhancement: this markup is inert without assets/shop.js, and the full grid
// below it is already rendered, so a visitor without JS sees every item — just unfiltered.
// The toolbar ships hidden and shop.js reveals it, so nobody is offered a dead control.
//
// Every control below is suppressed unless the items ON THIS PAGE give it at least two
// options. Two thirds of this closet has no size at all (books, decor, jewellery), so a
// size dropdown on those pages would be pure noise — and a filter that cannot change the
// result is worse than no filter, because it invites a click that does nothing.
function toolbar(items) {
  const uniq = (fn) => [...new Set(items.map(fn).filter(Boolean))];
  const opts = (vals) => vals.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  const sel = (id, allLabel, vals, name) =>
    vals.length < 2 ? "" :
    `<label class="sb-sel"><span class="vh">${esc(name)}</span>` +
    `<select id="${id}" data-filter="${id}" data-name="${esc(name)}">` +
    `<option value="">${esc(allLabel)}</option>${opts(vals)}</select></label>`;

  const conditions = CONDITION_ORDER.filter((c) => items.some((i) => i.condition?.en === c));
  const sizes = uniq((i) => i.sizeGroup).sort();
  const colors = uniq((i) => i.color?.en).sort();
  const bands = PRICE_BANDS.filter((b) =>
    items.some((i) => i.priceEur != null && i.priceEur >= b.min && i.priceEur < b.max));
  const soldCount = items.filter((i) => i.sold).length;

  // Availability is a mode, not a value — you are browsing what you can buy, or looking at
  // what sold. A segmented control says that; a fourth dropdown would bury it.
  const avail = soldCount && soldCount < items.length ? `<div class="sb-seg" role="group" aria-label="Availability">
      <button type="button" data-avail="" aria-pressed="true">All ${items.length}</button>
      <button type="button" data-avail="available" aria-pressed="false">Available ${items.length - soldCount}</button>
      <button type="button" data-avail="sold" aria-pressed="false">Sold ${soldCount}</button>
    </div>` : "";

  return `<div class="shop-bar" data-shop-bar hidden>
    <div class="sb-top">
      <label class="sb-search"><span class="vh">Search the closet</span>
        <input type="search" id="sb-q" placeholder="Search title or brand…" autocomplete="off"></label>
      ${avail}
    </div>
    <details class="sb-refine" data-refine>
    <summary><span class="sb-refine-label">Refine &amp; sort</span><span class="sb-refine-n" data-refine-count></span></summary>
    <div class="sb-controls">
      ${sel("sb-cond", "Any condition", conditions, "Condition")}
      ${sel("sb-size", "All sizes", sizes, "Size")}
      ${bands.length < 2 ? "" : `<label class="sb-sel"><span class="vh">Price</span>
        <select id="sb-price" data-filter="sb-price" data-name="Price"><option value="">Any price</option>${
          bands.map((b) => `<option value="${b.id}">${esc(b.label)}</option>`).join("")}</select></label>`}
      ${sel("sb-color", "All colours", colors, "Colour")}
      <label class="sb-sel sb-sort"><span class="vh">Sort by</span>
        <select id="sb-sort">
          <option value="new">Newest first</option>
          <option value="loved">Most loved</option>
          <option value="asc">Price: low to high</option>
          <option value="desc">Price: high to low</option>
        </select></label>
    </div>
    </details>
    <div class="sb-status">
      <div class="sb-chips" id="sb-chips"></div>
      <p class="sb-count" id="sb-count" role="status" aria-live="polite"></p>
    </div>
  </div>`;
}

const catNav = (active, counts) =>
  `<nav class="cat-nav" aria-label="Wardrobe shelves">` +
  `<a href="/wardrobe"${active === "Everything" ? ' aria-current="page"' : ""}>Everything <b>${counts.__all}</b></a>` +
  // `module` categories are excluded: Wellness has its own slot in the TOP nav now, and
  // listing it here as well would put the same word in two navigations on the same screen,
  // pointing at the same page, one of them implying it is a shelf inside the wardrobe.
  CATEGORIES.filter((c) => counts[c.name] && !c.module)
    .map((c) => `<a href="${url(c.page)}"${active === c.name ? ' aria-current="page"' : ""}>${esc(label(c.name))} <b>${counts[c.name]}</b></a>`)
    .join("") +
  // Its own page as well as the availability toggle, because "what has already sold" is a
  // thing a shopper goes looking for deliberately — and a page has a URL you can link to,
  // which a filter state does not.
  (counts.__sold ? `<a href="/wardrobe/sold" class="sold-tab"${active === "Sold" ? ' aria-current="page"' : ""}>Sold <b>${counts.__sold}</b></a>` : "") +
  `</nav>`;

/* ------------------------------------------------------------------- pages ---- */

// Chrome comes out of index.html rather than being duplicated here, so editing the nav or
// the footer in one hand-written file updates every generated page on the next build.
function chrome(indexHtml) {
  const header = /<header class="site">[\s\S]*?<\/header>/.exec(indexHtml);
  const footer = /<footer>[\s\S]*?<\/footer>/.exec(indexHtml);
  if (!header || !footer) throw new Error("could not lift <header>/<footer> out of index.html");

  // Shelf pages are written to /wardrobe/, so the chrome's relative hrefs (assets/site.css)
  // would resolve a directory too high. Same fix, same reason, as build-diaries.mjs.
  const absolutise = (html) =>
    html
      .replace(/(href|src)="(assets\/)/g, '$1="/$2')
      .replace(/(href|src)="(images\/)/g, '$1="/$2');
  header[0] = absolutise(header[0]);
  footer[0] = absolutise(footer[0]);
  // No ?v= token is emitted here. bump-assets.mjs owns it outright and runs after every
  // generator, stamping each asset with a hash of its own contents. This function used to
  // scrape the token out of index.html and echo it onto the generated pages, which broke
  // silently when the token stopped being a decimal counter: the /(\d+)/ match missed a hex
  // hash, fell back to "1", and every regenerated page shipped ?v=1 until bump-assets
  // corrected it moments later. One owner is the fix; a second reader was never buying
  // anything.
  return { header: header[0], footer: footer[0] };
}

// Mark the top-level module the current page belongs to.
//
// The primary nav had no current-page state at all: `nav.main a.active` was styled in
// site.css and nothing ever set it, so on every page of the site the four modules looked
// identical and "where am I" was answerable only by reading the URL. Every shelf of the
// wardrobe (clothes, jewellery, books…) marks Wardrobe, because that is the module the
// visitor is inside — matching only the exact page would leave the nav blank on six of the
// wardrobe's own pages.
//
// aria-current is the part that matters for a screen reader; .active is what carries the
// colour. Both, because neither does the other's job.
function markNav(header, module) {
  return header.replace(
    new RegExp(`<a href="/${module}">`),
    `<a href="/${module}" class="active" aria-current="page">`);
}

function jsonLd(cat, items) {
  const pageUrl = `${SITE}${url(cat.page)}`;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: cat.title.split(" — ")[0],
        isPartOf: { "@id": `${SITE}/#website` },
        inLanguage: "en",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: cat.name, item: pageUrl },
        ],
      },
      {
        "@type": "ItemList",
        "@id": `${pageUrl}#items`,
        numberOfItems: items.length,
        itemListElement: items.map((it, i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "Product",
            name: it.title,
            // The Vinted item id doubles as the SKU — see the note in build-jsonld.mjs.
            // Emitted on sold items too: an identifier is how a crawler recognises that
            // the SoldOut product it sees today is the one it indexed as InStock last week,
            // rather than a different piece that happens to share a title.
            sku: it.id,
            productID: it.id,
            description: it.description ? it.description.slice(0, 400) : undefined,
            image: it.photo ? `${SITE}/${it.photo}` : undefined,
            brand: it.brand ? { "@type": "Brand", name: it.brand } : undefined,
            color: it.color?.en || undefined,
            category: it.category,
            // A sold piece is declared SoldOut with no price and no url, rather than
            // quietly left out. Omitting it would misrepresent the page (the item IS on
            // it), and marking it InStock would put an unbuyable product into search
            // results — which is both a poor result and a structured-data violation.
            offers: {
              "@type": "Offer",
              ...(it.sold
                ? { availability: "https://schema.org/SoldOut" }
                : {
                    url: it.urls[STOREFRONT],
                    // EUR, matching the price printed on the card. Structured data is
                    // supposed to agree with what the visitor can see; quoting CZK here
                    // while the page says euro is exactly the mismatch that gets a feed
                    // flagged. The Kč figure is preserved in data/catalog.csv.
                    price: it.priceEur,
                    priceCurrency: "EUR",
                    availability: it.reserved
                      ? "https://schema.org/PreOrder"
                      : "https://schema.org/InStock",
                  }),
              ...(it.condition?.en
                ? {
                    itemCondition: /^New/.test(it.condition.en)
                      ? "https://schema.org/NewCondition"
                      : "https://schema.org/UsedCondition",
                  }
                : {}),
            },
          },
        })),
      },
    ],
  }, null, 2);
}

// The block that used to sit here said only "everything's live on Vinted" and pointed at
// the closet. That answers a question nobody was asking. The questions someone actually has
// before spending €29 with a stranger are: how does it reach me, can I ask something first,
// and what happens if it does not fit — and the site answered none of them.
//
// Three plain steps and a way to ask. No claims that cannot be kept: the returns line says
// what Vinted's policy is rather than inventing a friendlier one.
const HOW_IT_WORKS =
  `<div class="how" id="how">
    <h2>How buying works</h2>
    <ol class="how-steps">
      <li><b>Ask first, if you want.</b> Measurements, fabric, how something actually fits — message me and I will tell you straight, including when a piece is not right for you.</li>
      <li><b>Buy it on Vinted.</b> Every piece links to its listing. Payment, postage and buyer protection are all handled there, so there is no separate checkout on this site and I never see your card details.</li>
      <li><b>It posts from Prague.</b> Usually within a day or two of the order. Vinted's buyer protection covers the return if the item is not as described.</li>
    </ol>
    <p class="how-note">Everything is second-hand or one-of-a-kind from my own collection, so each piece exists once — when it is gone it is gone. Sizes are the label size; ask me for real measurements before you buy.</p>
    <div class="cta-row">
      <a class="btn saf" href="${wa("Hi! I have a question about something in the wardrobe.")}" target="_blank" rel="noopener">Ask me on WhatsApp →</a>
      <a class="btn" href="https://www.vinted.cz/member/3166447071" target="_blank" rel="noopener">Open my Vinted closet →</a>
    </div>
  </div>`;

const FX_NOTE =
  `<p class="fx-note">Prices are converted from Czech koruna at the European Central Bank ` +
  `reference rate and rounded to the nearest euro. Vinted charges in your own currency at ` +
  `checkout, so the amount you pay may differ slightly.</p>`;

function page(cat, items, manifest, counts, ch) {
  const desc = cat.lead.slice(0, 155);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(cat.title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<link rel="canonical" href="${SITE}${url(cat.page)}">
<meta name="theme-color" content="#4A4433">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Indian in Prague">
<meta property="og:locale" content="en">
<meta property="og:url" content="${SITE}${url(cat.page)}">
<meta property="og:title" content="${esc(cat.title.split(" | ")[0])}">
<meta property="og:description" content="${esc(desc)}">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:image" content="${SITE}/images/derived/IMG_5630-1200.jpg">
<meta property="og:image:alt" content="Indian in Prague">
<link rel="preload" href="/assets/fonts/ibm-plex-mono-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<!-- Plex Sans carries every lede and every paragraph of prose on the site now, so it is
     as much a first-paint font as the mono is. One file: it is a variable face. -->
<link rel="preload" href="/assets/fonts/ibm-plex-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/assets/clothes.css">
<link rel="stylesheet" href="/assets/shop.css">
<script type="application/ld+json">
${jsonLd(cat, items)}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${markNav(ch.header, "wardrobe")}

<main id="main">
<div class="page-head"><div class="wrap">
  <div class="crumb">${esc(cat.name)} · <span>${esc(cat.expo[1])}</span></div>
  <h1>${esc(cat.h1[0])} <b>${esc(cat.h1[1])}</b>.</h1>
  <p class="lede">${esc(cat.lead)}</p>
</div></div>

<section><div class="wrap sec-inner">
  ${catNav(cat.name, counts)}
  ${toolbar(items)}

  ${grid(items, manifest, cat.name === "Everything")}
  <p class="sb-empty" id="sb-empty" hidden>Nothing matches those filters. <button type="button" id="sb-reset">Clear them</button></p>
  ${FX_NOTE}

  ${HOW_IT_WORKS}
</div></section>
</main>
${ch.footer}
<script src="/assets/shop.js" defer></script>
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

async function main() {
  const catalog = JSON.parse(await readFile(path.join(ROOT, "data/catalog.json"), "utf8"));
  const manifestPath = path.join(ROOT, "images/derived/manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : {};
  if (!Object.keys(manifest).length) {
    console.warn("⚠ no images/derived/manifest.json — run build-images.mjs, cards will use full-size photos");
  }

  // Sold pieces sit in the grid alongside available ones — a shopper should see that things
  // here sell — but always BELOW them. Availability is the primary sort key and age only
  // the tiebreak, because a piece that sold last week would otherwise take the first slot
  // on the page under "Newest first", and the front of the shop would read as a graveyard.
  //
  // This is the order a visitor without JavaScript sees, and the order a crawler indexes,
  // so it cannot live only in shop.js — the same rule is applied there for the other sorts.
  const archive = existsSync(path.join(ROOT, "data/archive.json"))
    ? JSON.parse(await readFile(path.join(ROOT, "data/archive.json"), "utf8")).items
    : [];
  const sold = archive.filter((i) => !i.hidden);
  const available = catalog.items.filter((i) => !i.hidden);
  const byNewest = (a, b) => Number(b.id) - Number(a.id);
  const live = [...available.sort(byNewest), ...sold.sort(byNewest)];

  const counts = { __all: live.length, __sold: sold.length };
  for (const c of CATEGORIES) counts[c.name] = live.filter((i) => i.category === c.name).length;

  const indexPath = path.join(ROOT, "index.html");
  let indexHtml = await readFile(indexPath, "utf8");
  const ch = chrome(indexHtml);

  let written = 0;

  // Whole generated pages, one per non-empty category, plus the everything page.
  for (const cat of CATEGORIES) {
    const items = live.filter((i) => i.category === cat.name);
    if (!items.length) {
      // A category can empty out — the last "More" item gets a taxonomy rule, the last of
      // something sells. Leaving the page behind would strand a stale grid the nav no
      // longer links to, still in the sitemap and still indexable.
      const stale = path.join(ROOT, cat.page);
      if (!cat.managed && existsSync(stale)) {
        await rm(stale);
        console.log(`  ${cat.page} — removed (category is empty)`);
      }
      continue;
    }

    if (cat.managed) {
      // Hand-written page: swap only the grid region, leave the prose alone.
      const p = path.join(ROOT, cat.page);
      const html = await readFile(p, "utf8");
      // A module page gets the bare grid: no shelf strip (it is not a shelf in the wardrobe)
      // and no filter toolbar (two items cannot be usefully filtered — every control would
      // be a dead one). Just the pieces, and the note about how the prices convert.
      const body = cat.module
        ? grid(items, manifest, false) + "\n  " + FX_NOTE
        : catNav(cat.name, counts) + "\n  " + toolbar(items) + "\n  " + grid(items, manifest, false) +
          `\n  <p class="sb-empty" id="sb-empty" hidden>Nothing matches those filters. <button type="button" id="sb-reset">Clear them</button></p>\n  ` + FX_NOTE;
      await writeFile(p, replaceRegion(html, "SHOP:GRID", body, cat.page));
      console.log(`  ${cat.page} — ${items.length} items (grid region replaced)`);
    } else {
      await mkdir(path.dirname(path.join(ROOT, cat.page)), { recursive: true });
      await writeFile(path.join(ROOT, cat.page), page(cat, items, manifest, counts, ch));
      console.log(`  ${cat.page} — ${items.length} items`);
    }
    written++;
  }

  // The everything page — "the wardrobe", which is what the top nav calls it.
  //
  // It was shop.html. The word "shop" is gone from the visitor-facing site entirely: the
  // module is the Wardrobe, so the URL says wardrobe. nginx 301s the old path (see
  // nginx/indianinprague.conf) because shop.html is the strongest indexed page on the site
  // and every existing inbound link points at it.
  //
  // The build-time names — scripts/build-shop.mjs, assets/shop.css, assets/shop.js and the
  // SHOP:GRID markers — deliberately did NOT change. They are internals a visitor never
  // sees, and renaming them would have churned the asset cache token and every reference in
  // DEPLOY.md to buy nothing.
  const all = {
    name: "Everything", slug: "wardrobe", page: "wardrobe/index.html",
    title: "The whole wardrobe — Indian clothes, jewellery, home things in Prague | Indian in Prague",
    h1: ["Everything", "in one place"],
    lead: `All ${available.length} pieces currently for sale — clothing, jewellery, home things, books and the rest — plus what has already sold. Filter it down, or tap any piece to open its Vinted listing.`,
    expo: ["THE WARDROBE", "the full range", `${available.length} available · ${sold.length} sold`],
  };
  await mkdir(path.join(ROOT, "wardrobe"), { recursive: true });
  await writeFile(path.join(ROOT, "wardrobe/index.html"), page(all, live, manifest, counts, ch));
  console.log(`  wardrobe/index.html — ${live.length} items (${sold.length} sold)`);
  // The old page is not left on disk to rot: it would still be reachable, still be
  // indexable, and would go stale the first time the closet changed.
  if (existsSync(path.join(ROOT, "shop.html"))) {
    await rm(path.join(ROOT, "shop.html"));
    console.log(`  shop.html — removed (now wardrobe.html; nginx 301s the old path)`);
  }

  // The sold page. Worth its own URL rather than only a filter state: "has anything here
  // actually sold" is a question a hesitant buyer asks deliberately, and a URL can be
  // linked to and indexed where a toggle cannot.
  if (!sold.length && existsSync(path.join(ROOT, "wardrobe/sold.html"))) await rm(path.join(ROOT, "wardrobe/sold.html"));
  if (sold.length) {
    // The last N, not the whole archive. This page answers "does anything here actually
    // sell?", and that is a question about recency — a 2024 sale is no evidence the shop is
    // alive today. Ten is enough to be convincing and short enough to stay one screen of
    // scrolling. archive.json keeps every sale regardless; this is a display cap, so
    // nothing is lost by raising or lowering it.
    const RECENT_SOLD = 10;
    const recent = sold.slice(0, RECENT_SOLD);
    const soldPage = {
      name: "Sold", slug: "sold", page: "wardrobe/sold.html",
      title: "Last 10 items sold — Indian in Prague",
      h1: ["Already", "gone"],
      // "Sold" here means "left the closet". Vinted deletes a listing the moment it sells
      // and exposes no sold history, so a disappearance IS the sale event — see the sold
      // section of sync-vinted.mjs. The rare false positive is a listing pulled by hand.
      lead: `The last ${recent.length} pieces that found homes. Everything is one of a kind, so once it sells it is genuinely gone — but it shows what tends to move, and most of what I list is similar in spirit.`,
      expo: ["SOLD", "recent", `last ${recent.length} · sold`],
    };
    await writeFile(path.join(ROOT, "wardrobe/sold.html"), page(soldPage, recent, manifest, counts, ch));
    console.log(`  sold.html — ${recent.length} of ${sold.length} archived items`);
    written++;
  }

  // The homepage trust strip, in place of a paragraph describing the shop.
  //
  // What it replaced said "Everything I am selling, in one place. Contemporary Indian
  // clothing, oxidised silver, brass, home things and books read once…" — true, and already
  // said three times on the same screen: by the hero paragraph above it, by the six shelf
  // tiles below it, and by their subtitles. A visitor at this point has stopped asking WHAT
  // is for sale and started asking WHETHER TO TRUST IT: the goods are second-hand, the
  // payment happens on a marketplace they may not know, and the seller is one person.
  //
  // A rating carried by a count answers that in one line, and it is the only thing on this
  // page a stranger cannot simply assert about themselves. Hence what is in the strip and
  // what is deliberately not:
  //
  //   the number      — "5.0" is the claim; the stars just make it scannable
  //   the count       — 5.0 from 36 is trust, 5.0 from 1 is noise. Never show one alone
  //   "on Vinted"     — a rating is only as good as the place it is checkable
  //   Read the reviews — the link IS the proof, so it goes to the feedback tab itself,
  //                     not the profile. An unverifiable rating is worth less than none
  //
  // Not included, on purpose: a fourth description of the stock, a follower count, sales
  // totals, badges. Each would dilute the one number doing the work.
  //
  // Stars are rounded to whole characters — CSP is `style-src 'self'` on this page, so the
  // usual clipped-overlay trick for half stars would need an inline style and be blocked.
  // The printed figure next to them is the authoritative one, so a 4.8 shown as five stars
  // is never the only thing a reader has to go on.
  const seller = existsSync(path.join(ROOT, "data/seller.json"))
    ? JSON.parse(await readFile(path.join(ROOT, "data/seller.json"), "utf8"))
    : null;

  // No file, no reviews yet, or a Vinted hiccup during the sync: fall back to the plain
  // sentence rather than an empty box or a "0.0 ★" that actively repels. The strip is an
  // enhancement, and the shelves below it work without it.
  // The "One of a kind, priced in koruna, posted from Prague. Pick a shelf:" line that used
  // to sit under this strip was removed 17 Aug 2026. Every clause of it was already on the
  // screen: the shelves it told you to pick are the six tiles immediately below, each with a
  // piece count, and the terms are on the shelf pages themselves. With no reviews to show,
  // the region is now empty rather than falling back to that sentence — an empty region is
  // honest, a restatement is noise.
  const trust = !seller?.count
    ? ``
    : `<div class="trust">` +
      `<span class="trust-rate">` +
      `<span class="stars" aria-hidden="true">${"★".repeat(Math.round(seller.rating))}${"☆".repeat(5 - Math.round(seller.rating))}</span>` +
      `<b>${seller.rating.toFixed(1)}</b></span>` +
      `<span class="trust-n">${seller.count} reviews on Vinted</span>` +
      `<a class="trust-go" href="${esc(seller.feedbackUrl)}" target="_blank" rel="noopener">` +
      `Read the reviews<span class="vh"> on Vinted (opens in a new tab)</span> →</a>` +
      `<span class="vh">Rated ${seller.rating.toFixed(1)} out of 5 from ${seller.count} buyer reviews on Vinted.</span>` +
      `</div>`;

  indexHtml = replaceRegion(indexHtml, "SHOP:TRUST", trust, "index.html");

  // Homepage: SHELVES, not six individual pieces.
  //
  // The front page used to show six garments picked by recency. That made sense when the
  // wardrobe was one hand-written page of clothes. With 150 pieces across six shelves it is
  // the wrong unit entirely — six arbitrary items tell a first-time visitor nothing about
  // what is here, and the odds that any one of them is the thing they want are poor.
  //
  // A shelf with a count answers the question the homepage is actually asked ("what do you
  // have?") and lets someone pick a lane before they browse. The photo on each tile is the
  // newest piece on that shelf, so the front page still turns over as the closet does.
  const tiles = CATEGORIES.filter((c) => !c.module && counts[c.name])
    .map((c) => {
      const newest = available.filter((i) => i.category === c.name).sort(byNewest)[0];
      const n = counts[c.name];
      return (
        `<a class="tile" href="${url(c.page)}">` +
        `<div class="frame ${newest ? spice(newest.id) : "sp-oli"}">` +
        (newest ? picture(newest, manifest, false) : "") +
        `<div class="grain"></div>` +
        `<span class="cap">${n} ${n === 1 ? "piece" : "pieces"}</span></div>` +
        `<div class="tbody"><h3>${esc(label(c.name))}</h3>` +
        `<span class="tcz">${esc(c.sub)}</span></div></a>`
      );
    }).join("\n    ");

  // The last tile is the whole wardrobe. Someone who does not want to choose a shelf should
  // not have to scroll past six of them to find the way in.
  const allTile =
    `<a class="tile tile-all" href="/wardrobe">` +
    `<div class="tbody"><h3>Everything</h3>` +
    `<span class="tcz">${available.length} pieces for sale${sold.length ? ` · ${sold.length} sold` : ""}</span>` +
    `<span class="more">Open the wardrobe →</span></div></a>`;

  await writeFile(indexPath, replaceRegion(
    indexHtml, "SHOP:GRID", `<div class="tiles">\n    ${tiles}\n    ${allTile}\n  </div>`, "index.html"));
  console.log(`  index.html — ${tiles.split("</a>").length - 1} shelf tiles (strip region replaced)`);

  console.log(`\n${written + 2} pages written from ${live.length} live items`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
