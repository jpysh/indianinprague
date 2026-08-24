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

import { readFile, writeFile, rm, mkdir, readdir } from "node:fs/promises";
import { vendorItems } from "./vendor-items.mjs";
import { productNode, itemSlug } from "./product-node.mjs";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = "https://guldaarbazaar.com";

// Which storefront the "buy" links point at. The catalog stores cz/es/com for every item,
// so switching this — or making it per-visitor once the Spanish shop opens — is a
// one-line change here rather than a re-sync.
const STOREFRONT = "cz";

// Order is display order: the nav, and the sequence of sections on shop.html.
const CATEGORIES = [
  {
    name: "Fashion", slug: "fashion", page: "wardrobe/fashion.html", managed: true,
    // The shelf in the words a buyer would type. Used by the subcategory title template,
    // where "Kanthi malas: buy Indian ritual objects in Europe" needs a noun for the shelf
    // that is not the shelf's own label — nobody searches for "Meditation".
    noun: "Indian clothing",
    sub: "kurtas · sarees · sets",
    title: "Indian Clothes in Europe: Kurtas, Sarees, Block Print",
    // Page 1 is hand-written and only its grid region is replaced, so it never reads these.
    // Pages 2+ are generated from the same template as every other shelf and do.
    h1: ["Clothes,", "worn and new"],
    lead: "Kurtas, sarees, dhotis and sets. Block print, handloom and artisan-made, some from my own wardrobe and the rest new.",
    expo: ["FASHION", "kurtas · sarees", "second-hand · new"],
  },
  {
    name: "Home Decor", slug: "home-decor", page: "wardrobe/home-decor.html",
    sub: "textiles · ceramics",
    noun: "Indian home decor",
    title: "Indian Home Decor in Europe: Textiles, Ceramics, Handmade",
    h1: ["Home things,", "carried back"],
    lead: "Block-printed textiles, hand-painted ceramics and small objects that make your flat feel less like a rental. Made by hand in India, and chosen the way I choose things for my own home.",
    expo: ["HOME", "textiles · ceramics", "handmade · block print"],
  },
  {
    name: "Jewellery", slug: "jewellery", page: "wardrobe/jewellery.html",
    sub: "silver · handmade",
    noun: "Indian jewellery",
    title: "Indian Jewellery in Europe: Silver, Beads, Handmade",
    h1: ["Jewellery,", "mostly silver"],
    lead: "Made across India and meant to be worn rather than collected. Oxidised silver, glass beads and the kind of thing you cannot find easily.",
    expo: ["JEWELLERY", "silver · brass", "handmade · oxidised"],
  },
  {
    // The catalog still says "Spirituality" — that is the Vinted branch name, and renaming
    // it in the data would break the sync. Only the shelf's public face moved: /spirituality
    // is the Spirituality MODULE now (yoga, ayurveda, meditation, trips — its own nav slot
    // and its own hand-written page), so the shelf of brass and beads took the name it
    // always actually described and gave up the URL.
    // TWO category values feed this shelf. "Spirituality" is what data/catalog.json says —
    // that is Vinted's branch name and renaming it would break the sync. "Meditation" is
    // what the vendor catalogue says, because the taxonomy was rebuilt around it when the
    // shelf grew from 11 items to the largest on the site.
    name: "Spirituality", names: ["Spirituality", "Meditation"],
    label: "Meditation", slug: "meditation", page: "wardrobe/meditation.html",
    sub: "brass · sandalwood",
    noun: "Indian ritual objects",
    title: "Indian Ritual Objects in Europe: Incense, Brass, Malas",
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
    sub: "second-hand · new",
    noun: "Indian books",
    title: "Indian Books in Europe: Fiction, Cookery, Scripture",
    // "Books I have finished with" was a promise the shelf broke: 72 of its 117 books are
    // new editions and translations that have never been anyone's. "Award winners" is
    // carried by real stock, not by hope: Elizabeth Kolbert's Under a White Sky took the
    // Pulitzer, and Mirza Waheed's The Book of Gold Leaves was DSC Prize shortlisted.
    h1: ["Award winners,", "read and unread"],
    lead: "Fiction, cookery, art and scripture. Literary second-hand finds from my own shelves, alongside new editions and translations.",
    expo: ["BOOKS", "second-hand · new", "fiction · cookery"],
  },
  {
    name: "Wellness", slug: "wellness", page: "wardrobe/wellness.html",
    sub: "oils · soaps · ayurveda",
    noun: "Ayurvedic wellness",
    title: "Ayurvedic Wellness in Europe: Oils, Soaps, Perfumes",
    h1: ["Oils, soaps,", "and remedies"],
    lead: "Ayurvedic creams and oils, hand-cut soaps, oil-based perfumes — the everyday shelf of an Indian bathroom, most of it made in small batches.",
    expo: ["WELLNESS", "oils · soaps", "ayurvedic"],
  },
  {
    name: "Keepsakes", slug: "keepsakes", page: "wardrobe/keepsakes.html",
    sub: "cards · notebooks · dolls",
    noun: "Indian gifts",
    title: "Indian Gifts in Europe: Cards, Notebooks, Dolls, Keyrings",
    h1: ["Small things,", "carried home"],
    // Names the dolls because a quarter of the shelf is now dolls: the whole "Gift items"
    // branch of the vendor's tree moved here on 22 Aug 2026, from a shelf called Others that
    // no shopper would think to open. The lead is this page's meta description as well as
    // its opening line, so it has to say what is actually on the shelf.
    lead: "Greetings cards, notebooks, keyrings and badges, and small deity dolls for children. The inexpensive end of the shelf, and the easiest thing to post to someone.",
    expo: ["KEEPSAKES", "cards · dolls", "small gifts"],
  },
  {
    name: "Food", slug: "food", page: "wardrobe/food.html",
    sub: "spices · honey · prasadam",
    noun: "Indian food",
    title: "Indian Food in Europe: Spices, Masalas, Ayurvedic Supplements",
    h1: ["Spices, and", "what goes with them"],
    lead: "Single spices and masala blends, honey, prasadam, and Ayurvedic supplements. Cupboard things, not souvenirs.",
    expo: ["FOOD", "spices · masala", "honey · prasadam"],
  },
  {
    // The data keeps saying "Uncategorised" — that is the signal sync-vinted.mjs prints
    // when a Vinted branch has no rule yet, and softening it in the data would hide the
    // work. The shopper just sees "More".
    // Same two-name arrangement: "Uncategorised" is what sync-vinted.mjs writes when a
    // Vinted branch has no rule yet, and softening it in the data would hide the work.
    name: "Uncategorised", names: ["Uncategorised", "Others"],
    label: "Others", slug: "others", page: "wardrobe/others.html",
    sub: "odds and ends",
    noun: "Indian goods",
    title: "Indian Odds and Ends in Europe: Everything Else",
    h1: ["Everything", "else"],
    lead: "The pieces that do not fit a shelf label yet.",
    expo: ["MORE", "everything else", "odds and ends"],
  },
];

// Deterministic so a card keeps the same placeholder tint between builds — the tint shows
// while the photo decodes, and one that changed on every deploy would flicker.
const SPICE = ["sp-oli", "sp-mag", "sp-pap", "sp-saf", "sp-chi", "sp-plum"];
// Digits only, because a vendor id is "govinda-2254" and Number() on that is NaN — NaN % 6
// is NaN and SPICE[NaN] is undefined, which is how every vendor card has been shipping
// `class="frame undefined"` and no placeholder tint at all. Stripping the non-digits leaves
// Vinted's numeric ids exactly as they were, so no existing card changes colour.
const spice = (id) => SPICE[Number(String(id).replace(/\D/g, "")) % SPICE.length];

// Prices below €2 keep their cents. Above that the cents are noise, and whole euros are
// what this shop has always shown. See build-listings.mjs for the measurement.
const money = (n) => (n < 2 ? Number(n).toFixed(2) : String(Math.round(n)));

// The site serves extensionless URLs (see wrangler.jsonc html_handling). Every URL this
// file writes — canonical, og:url, tiles, breadcrumbs — goes through here, so the .html
// form exists only as a filename on disk and never as a link. index.html is the site root.
const url = (page) => (page === "index.html" ? "/" : "/" + String(page).replace(/\.html$/, ""));

// Cards per generated page. 99 keeps the heaviest shelf near the weight of a page the
// site already served comfortably, and divides by 3 so the desktop grid ends on a full row;
// the browser then reveals them 24 at a time (shop.js).
const PER_PAGE = 99;

// URL-safe form of a subcategory name. Diacritics are stripped rather than percent-encoded:
// /wardrobe/meditation/kanthi-malas is a URL someone can read aloud, and the Sanskrit and
// Czech names in this catalogue would otherwise produce a line of %C3%A1.
const slug = (name) =>
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    // Apostrophes are DELETED rather than treated as a separator: "Women's clothing" is
    // womens-clothing, which is what a person types and links to. Letting the general rule
    // below have it produces women-s-clothing, a URL that reads as a typo.
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Page 1 is the shelf itself. Page 2 of /wardrobe/fashion is /wardrobe/fashion/2, which
// means fashion.html sits beside a fashion/ directory — the same shape wardrobe.html and
// wardrobe/ already use, and unambiguous for the same reason: only one of the two can
// answer any given URL.
const pageFile = (cat, no) =>
  no === 1 ? cat.page : cat.page.replace(/\.html$/, "") + `/${no}.html`;

// A subcategory page and its own page 2: /wardrobe/meditation/kanthi-malas and
// /wardrobe/meditation/kanthi-malas/2. Page numbers and subcategories share the shelf
// directory and cannot collide — a page is a number, a subcategory is a word.
const subFile = (cat, name, no) => {
  const base = cat.page.replace(/\.html$/, "") + "/" + slug(name);
  return no === 1 ? base + ".html" : base + `/${no}.html`;
};

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
  //
  // ?v= is the content token from the manifest. Derived images are cached for a year as
  // immutable, so a URL whose bytes change without changing name is served stale to every
  // returning visitor until the cache expires — which is what happened when the Govinda
  // book covers were composited in place. The token makes a changed picture a changed URL.
  const q = entry.v ? `?v=${entry.v}` : "";
  const jpgs = entry.variants.map((v) => `/${v.jpg}${q} ${v.w}w`).join(", ");
  const webps = entry.variants.map((v) => `/${v.webp}${q} ${v.w}w`).join(", ");
  // src is the SMALLEST variant, not the largest. srcset decides what a modern browser
  // actually fetches, so src is only the fallback — and pointing it at the 800 meant any
  // client that ignored srcset pulled 120 KB to fill a 400px cell. width/height come from
  // the same variant so the intrinsic ratio matches what src refers to.
  const fallback = entry.variants[0];
  const load = eager ? 'fetchpriority="high"' : 'loading="lazy"';
  return (
    `<picture><source type="image/webp" srcset="${webps}" sizes="${IMG_SIZES}">` +
    `<img class="ph" src="/${fallback.jpg}${q}" srcset="${jpgs}" sizes="${IMG_SIZES}" ` +
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
      // base:widths:token — shop.js appends the token as ?v= for the same cache reason the
      // <picture> markup does.
      return `${base.replace("images/derived/", "")}:${entry.variants.map((v) => v.w).join("|")}` +
        (entry.v ? `:${entry.v}` : "");
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
  return `<p class="blurb" id="blurb-${esc(item.id)}">${esc(cut)}</p>`;
}

// The touch route to the same text. Hover does not exist on a phone, so the blurb above was
// simply display:none there and a touch visitor never saw a word of it — the one piece of
// prose on the card, gone on the device most people shop from.
//
// A <details> and not a button: the open/closed state, the keyboard handling and the
// accessible name all come from the browser, and there is no site-wide JavaScript to hang a
// button off. Only rendered when there IS a description, so the control never appears with
// nothing behind it.
//
// It sits before .blurb in the markup deliberately: CSS can only reach forwards, so
// `.info[open] ~ .blurb` is what reveals the text.
function infoToggle(item) {
  const d = (item.description || "").trim();
  if (!d) return "";
  return `<details class="info"><summary aria-label="Description of ${esc(item.title)}" aria-controls="blurb-${esc(item.id)}">` +
    `<span aria-hidden="true">i</span></summary></details>`;
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
  // Out of stock asks a different question, and it is a question with a real answer:
  // the vendor restocks, so "when" is answerable in a way "is this available" is not.
  if (item.vendor && !item.sold && item.inStock === false) {
    return wa(`Hi! Is "${item.title}" coming back in stock? — ref ${item.id}`);
  }
  // Vendor stock: no listing URL to quote — these are not linked out to, and the customer
  // is buying from this site. The SKU is what makes the message answerable instead.
  if (item.vendor) {
    const price = item.priceEur == null ? "" : ` (€${money(item.priceEur)})`;
    return wa(`Hi! I'd like to order "${item.title}"${price} — ref ${item.id}`);
  }
  if (item.sold) {
    return wa(`Hi! "${item.title}" has sold — do you have anything similar?`);
  }
  const price = item.priceEur == null ? "" : ` (€${money(item.priceEur)})`;
  return wa(`Hi! I'd like to ask about "${item.title}"${price} — ${item.urls[STOREFRONT]}`);
}

// The data-* attributes are what assets/shop.js filters on. They are on the card rather
// than in a JS blob so that filtering needs no parallel copy of the catalog, and so the
// page is still correct and complete with JavaScript switched off.
function card(item, manifest, eager, showCat) {
  const sold = !!item.sold;
  // Three states, not two. Sold means it is gone; out of stock means the vendor has run
  // out and it is expected back. They share a visual language deliberately — both mean
  // "you cannot buy this today", and a shopper scanning a grid of 100 cards needs that
  // readable at a glance rather than spelled out in a badge they have to stop and read.
  const oos = !sold && item.vendor && item.inStock === false;
  // A vendor card gets no brand caption: the vendor flag at the top of the frame already
  // says "Govinda", and the brand on those items is "Govinda Shop" — the same word twice on
  // the same photograph, once in each corner. The category caption on the Everything page is
  // kept, because there it says something the flag does not.
  const caption = showCat ? label(item.category) : item.vendor ? "" : item.brand;
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
    ` data-fav="${item.favourites || 0}" data-avail="${sold ? "sold" : oos ? "oos" : "available"}"` +
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
    : `<span class="pr">€${money(item.priceEur)}</span>`;

  // Where a piece comes from, on the photograph. Secondhand pieces from the closet and new
  // retail stock shipped from Prague are different propositions, and a buyer has to be able
  // to tell which is which before they ask about one.
  const vendorBadge = item.vendor
    ? `<span class="cap flag vendor-flag">${esc(item.vendor)}</span>`
    : "";

  const badges =
    (sold ? `<span class="cap flag sold-flag">Sold</span>` : "") +
    (item.reserved ? `<span class="cap flag res">Reserved</span>` : "") +
    (oos ? `<span class="cap flag oos-flag">Out of stock</span>` : "") +
    vendorBadge;

  const inner =
    `<div class="frame ${spice(item.id)}">` +
    `<div class="shots" data-track><div class="shot">${picture(item, manifest, eager)}</div></div>` +
    `<div class="grain"></div>` +
    // The ↗ promises a link out. Vendor cards have none — they are bought here — so the
    // glyph would be a lie about where the card goes.
    (sold || item.vendor ? "" : `<span class="ext" aria-hidden="true">↗</span>`) +
    `${caption ? `<span class="cap">${esc(caption)}</span>` : ""}${badges}${favBadge}` +
    infoToggle(item) +
    blurb(item) +
    `</div>` +
    `<div class="meta"><span class="nm">${esc(item.title)}</span>${price}</div>` +
    `<div class="tags">${esc(item.vendor ? `New · ${item.delivery}` : tags) || (sold ? "No longer available" : "")}</div>`;

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
  // Vendor cards get no .go at all: there is no destination. Vinted items link to their
  // listing because that is where the sale happens; a Govinda item is bought here, through
  // the ask link, and linking to the vendor's own shop would send the buyer to the same
  // item at the vendor's own price.
  const go = sold || item.vendor
    ? ""
    : `<a class="go" href="${esc(item.urls[STOREFRONT])}" target="_blank" rel="noopener"` +
      ` aria-label="${esc(item.title)} — open the Vinted listing in a new tab"></a>`;

  // No WhatsApp glyph here, deliberately. The icon's path data is ~700 bytes and there are
  // 157 cards on wardrobe.html — the mark alone would have added ~110 KB to the page to
  // decorate a link whose label already says what it does. The green carries the recognition.
  const ask =
    `<a class="ask" href="${esc(askUrl(item))}" target="_blank" rel="noopener">` +
    `${oos ? "Notify when back" : item.vendor ? "Order on WhatsApp" : sold ? "Ask for something similar" : "Ask about this piece"}` +
    `<span class="vh"> — opens WhatsApp in a new tab</span></a>`;

  // The id is the item's address. There is no page per piece — a card on a shelf is what an
  // item IS here — so the anchor is the only way to link to one, for a shopper pasting it
  // into a chat and for an AI assistant citing a specific garment. Readable words plus the
  // Vinted id; see itemSlug() for why the number stays.
  return `<div class="piece${sold ? " sold" : ""}${oos ? " oos" : ""}" id="${itemSlug(item)}"${data}>${inner}${go}${ask}</div>`;
}

// The first three cards are the ones above the fold on a desktop grid, so they load eagerly
// and everything below them lazily.
// The subcategory strip: one chip per division of this shelf, each a real page.
//
// Only divisions with enough in them to be worth a page — a chip leading to two items is a
// dead end that costs a click, and a page of two items is not a page a search engine has
// any reason to keep. Everything below the threshold stays reachable on the shelf itself.
const SUB_MIN = 8;

function subChips(cat, items, active) {
  // Not on the everything page. Its divisions are the shelves, which the strip above it
  // already lists — and a chip there would point at /wardrobe/<slug>, a URL that does not
  // exist and sits in the same namespace as the shelves themselves.
  if (cat.name === "Everything" || cat.name === "Sold") return "";
  const counts = new Map();
  for (const i of items) if (i.subcategory) counts.set(i.subcategory, (counts.get(i.subcategory) || 0) + 1);
  const subs = [...counts].filter(([, n]) => n >= SUB_MIN).sort((a, b) => b[1] - a[1]);
  if (!subs.length) return "";
  return (
    `<nav class="subs" aria-label="${esc(label(cat.name))} subcategories">` +
    `<a class="sub${active ? "" : " on"}" href="${url(cat.page)}">All <b>${items.length}</b></a>` +
    subs.map(([name, n]) =>
      `<a class="sub${active === name ? " on" : ""}" href="${url(subFile(cat, name, 1))}">` +
      `${esc(name)} <b>${n}</b></a>`).join("") +
    `</nav>` +
    // Wrapped rather than scrolled sideways — see the note on .subs in assets/shop.css.
    // Clamped to two rows so a shelf with a dozen divisions does not push the products off
    // the first screen, and the button says how many are behind the clamp rather than
    // leaving it to be guessed. Ships hidden: shop.js reveals it only when the strip
    // actually overflows, so a shelf with four chips is never offered a pointless control.
    `<button class="subs-more" type="button" data-subs-more hidden aria-expanded="false">` +
    `Show all <b>${subs.length + 1}</b></button>`
  );
}

// The strip of page links under the grid.
//
// Real links to real pages, not a script that swaps content: each page has its own URL, so
// it can be linked, shared, indexed and reached with JavaScript off. rel=prev/next is
// emitted because Bing and Seznam still read it — Google retired it in 2019, and neither
// costs anything.
function pager(cat, seq, sub = null) {
  if (seq.total < 2) return "";
  const href = (n) => url(sub ? subFile(cat, sub, n) : pageFile(cat, n));
  const link = (n, label, cls) =>
    `<a class="pg${cls ? " " + cls : ""}" href="${href(n)}"${n === seq.no ? ' aria-current="page"' : ""}>${label}</a>`;

  // Window of page numbers around the current one: the whole run for a short series, and
  // first/last plus neighbours for a long one, so a 16-page shelf does not print 16 links.
  const nums = [];
  const near = (n) => n === 1 || n === seq.total || Math.abs(n - seq.no) <= 2;
  for (let n = 1; n <= seq.total; n++) {
    if (near(n)) nums.push(link(n, String(n)));
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }

  return (
    `<nav class="pager" aria-label="Pagination">` +
    (seq.no > 1 ? link(seq.no - 1, "← Previous", "pg-step") : "") +
    `<span class="pg-nums">${nums.map((n) => (n === "…" ? `<span class="pg-gap">…</span>` : n)).join("")}</span>` +
    (seq.no < seq.total ? link(seq.no + 1, "Next →", "pg-step") : "") +
    `<span class="pg-of">Page ${seq.no} of ${seq.total}</span>` +
    `</nav>`
  );
}

const grid = (items, manifest, showCat, allUrl = "") =>
  `<div class="grid3" id="grid"${allUrl ? ` data-all="${allUrl}"` : ""}>\n` +
  items.map((it, i) => "    " + card(it, manifest, i < 3, showCat)).join("\n") +
  `\n  </div>`;

// The whole shelf as cards and nothing else, for the filters.
//
// A filter that searches only the hundred cards on the current page is a filter that lies:
// "Brown" on page 1 of Meditation reports four matches out of 461 items. So the rest of the
// shelf is fetched — but only when someone actually touches a control, because most
// visitors browse and never filter.
//
// This ships the SERVER-RENDERED cards rather than a JSON index that the script turns back
// into cards. An index is a tenth of the bytes and would need a second implementation of
// the card in JavaScript, which then has to be kept in step with this one — badge, price,
// gallery, ask link, the lot. Two renderers that must agree is a bug with a delivery date.
//
// Not an .html file on purpose: it is a fragment, not a page, and naming it so keeps it out
// of the sitemap and out of anything that enumerates pages.
const cardsFragment = (items, manifest, showCat) =>
  items.map((it) => card(it, manifest, false, showCat)).join("\n");

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
  const oosCount = items.filter((i) => !i.sold && i.vendor && i.inStock === false).length;

  // Availability was a three-way segmented control — All / Available / Sold — and that was
  // the right shape while "not available" had exactly one meaning. It has three now: in
  // stock, out of stock at the vendor, and sold. Four segments is past what fits at this
  // width on a phone without wrapping into a second row, and a wrapped segmented control
  // stops reading as one control. So it is a select.
  //
  // It sat beside the search box for a while, on the argument that "can I buy this" is a
  // different question from "which colour". True, but it is still a filter, and a filter
  // parked outside the filter group is a filter people do not find when they go looking for
  // filters. It sits last among the refinements, after colour and before sort, in the same
  // place on every width.
  //
  // No counts in the labels, unlike the shelf chips. This control sits in a row of selects
  // whose closed state reads "Any condition", "All colours", "Newest first" — a bare number
  // in among those reads as a different kind of control, and the count is on screen anyway
  // in the result line under the toolbar. The counts still decide which options EXIST: an
  // option leading to nothing is a click that can only disappoint, so it is not offered.
  //
  // The default option names its own filter — "Availability All" rather than "All" —
  // because closed, a select shows only its selected option, and "All" alone next to
  // "All colours" says nothing about what it is all of.
  //
  // Sold spans both catalogues on purpose. A shopper does not care which of them a thing
  // came from, and splitting the view by vendor would make them ask.
  // Every option is gated on its own count, "In stock" included. It used to be added
  // unconditionally, which put an "In stock" choice on the sold page that matched nothing —
  // the exact "click that can only disappoint" the paragraph above rules out.
  const availableCount = items.filter((i) => !i.sold && !(i.vendor && i.inStock === false)).length;
  const availOpts = [
    ["", "Availability All"],
    availableCount ? ["available", "In stock"] : null,
    oosCount ? ["oos", "Out of stock"] : null,
    soldCount ? ["sold", "Sold"] : null,
  ].filter(Boolean);

  const avail = availOpts.length > 2 ? `<label class="sb-avail"><span class="vh">Availability</span>
      <select id="sb-avail" data-avail-select>
        ${availOpts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("\n        ")}
      </select></label>` : "";

  return `<div class="shop-bar" data-shop-bar hidden>
    <div class="sb-top">
      <label class="sb-search"><span class="vh">Search the closet</span>
        <input type="search" id="sb-q" placeholder="Search title or brand…" autocomplete="off"></label>
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
      ${avail}
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
  // "All", not "Everything": it is the widest chip in the strip by some way, and at 375px
  // its width is part of what forces the strip to five rows. The internal name of the
  // category stays "Everything" — it is what the page is called and what the home tile says.
  `<a href="/wardrobe"${active === "Everything" ? ' aria-current="page"' : ""}>All <b>${counts.__all}</b></a>` +
  // `module` categories are excluded: Wellness has its own slot in the TOP nav now, and
  // listing it here as well would put the same word in two navigations on the same screen,
  // pointing at the same page, one of them implying it is a shelf inside the wardrobe.
  CATEGORIES.filter((c) => counts[c.name] && !c.module)
    .map((c) => `<a href="${url(c.page)}"${active === c.name ? ' aria-current="page"' : ""}>${esc(label(c.name))} <b>${counts[c.name]}</b></a>`)
    .join("") +
  // Sold is NOT a chip here. This strip answers "what do you have?", and a shelf of things
  // nobody can buy is not an answer to it — it was sitting in the primary navigation of a
  // shop, at equal weight to Fashion and Jewellery, offering a dead end.
  //
  // The page still exists and still earns its URL: "what has already sold" is a thing a
  // shopper goes looking for deliberately, and a page can be linked and indexed where a
  // filter state cannot. It is reached from the footer and from the Availability filter,
  // which is where someone actually asks that question.
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
          // One shared builder, see scripts/product-node.mjs. The url is this page's own
          // anchor for the item, so the graph a page publishes describes that page.
          item: productNode(it, `${pageUrl}#${itemSlug(it)}`),
        })),
      },
    ],
  }, null, 2);
}

// Both the four-step "How buying works" block and the currency note used to be rendered
// here, on all ~80 shelf pages. They moved to /how-it-works on 22 Aug 2026, whole and
// unedited, so that shipping, returns, prices, privacy and terms live at one address that
// can be linked, cited and found — rather than as a block repeated eighty times and
// reachable from nowhere in particular.
//
// The cost is real and worth naming: that block answered "how does it reach me, can I ask
// first, what if it does not fit" at the moment someone was looking at a €29 garment, and
// now it answers them one click away, from the footer. The trade was made deliberately.
//
// Everything a visitor needs is still one link from every page, because the footer is on
// every page. If the conversion cost shows up in practice, the smallest fix is a one-line
// summary here linking to /how-it-works — not restoring eighty copies of the full text.

function page(cat, items, manifest, counts, ch, seq = { no: 1, total: 1 }, sub = null, shelfItems = null) {
  const desc = cat.lead.slice(0, 155);
  // Page 2 onwards says so in the title. Identical titles across a series is the classic
  // way to make a shop's own pages compete with each other in search results.
  // A subcategory page is its own page, not a variant of the shelf: its title leads with
  // what it holds, because "Kanthi malas" is what someone searches for and the shelf title
  // is not.
  // A subcategory page leads with what it holds, because "Kanthi malas" is what someone
  // searches for and the shelf title is not. What follows is the shelf in buyable words plus
  // the market, and NOT the site name: repeating "Guldaar Bazaar" after every one of these
  // spent title width saying what the brand already says, on the pages with the highest
  // intent on the site.
  const base = sub ? `${sub}: buy ${cat.noun} in Europe` : cat.title;
  const pageTitle = seq.no > 1 ? `${base}, page ${seq.no}` : base;
  const self = sub ? subFile(cat, sub, seq.no) : pageFile(cat, seq.no);
  // Only when there is more to fetch: a shelf that fits on one page already holds every
  // card the filters could match.
  const allUrl = seq.total > 1 && !sub ? url(cat.page).replace(/\/$/, "") + ".cards" : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<link rel="canonical" href="${SITE}${url(self)}">
<meta name="theme-color" content="#4A4433">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Guldaar Bazaar">
<meta property="og:locale" content="en">
<meta property="og:url" content="${SITE}${url(self)}">
<meta property="og:title" content="${esc(pageTitle.split(" | ")[0])}">
<meta property="og:description" content="${esc(desc)}">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:image" content="${SITE}/images/derived/IMG_5630-1200.jpg">
<meta property="og:image:alt" content="Guldaar Bazaar">
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
  <div class="crumb"><a href="${url(cat.page)}">${esc(label(cat.name))}</a>${sub ? ` · <span>${esc(sub)}</span>` : ` · <span>${esc(cat.expo[1])}</span>`}</div>
  <h1>${sub ? esc(sub) : `${esc(cat.h1[0])} <b>${esc(cat.h1[1])}</b>.`}</h1>
  <p class="lede">${sub ? `${items.length} ${esc(sub.toLowerCase())} in the ${esc(label(cat.name).toLowerCase())} shelf.` : esc(cat.lead)}</p>
</div></div>

<section><div class="wrap sec-inner">
  ${catNav(cat.name, counts)}
  ${subChips(cat, shelfItems || items, sub)}
  ${/* The whole shelf, not this page of it. The filters search the whole shelf, so a
        count taken from the hundred cards on screen would promise "Out of stock 13" and
        then find 107. */ ""}${toolbar(shelfItems || items)}

  ${grid(items, manifest, cat.name === "Everything", allUrl)}
  <p class="sb-empty" id="sb-empty" hidden>Nothing matches those filters. <button type="button" id="sb-reset">Clear them</button></p>
  ${pager(cat, seq, sub)}
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

  // Vendor stock joins the closet here and nowhere earlier: data/catalog.json stays purely
  // Vinted, so sync-vinted.mjs can keep rewriting it wholesale without touching any of this.
  const vendor = vendorItems(ROOT);
  if (vendor.length) console.log(`  ${vendor.length} vendor item(s) from Govinda`);
  // The leaf of the Vinted breadcrumb trail is that catalogue's subcategory: "Women >
  // Accessories > Jewellery > Necklaces" belongs under Necklaces, the same shelf division
  // the vendor catalogue states outright. Without this the two vendors would divide the
  // same shelf along different lines.
  const withSub = (i) => ({
    ...i,
    subcategory: i.subcategory || (i.crumbs?.length ? i.crumbs[i.crumbs.length - 1].name : ""),
  });
  const available = [...catalog.items.filter((i) => !i.hidden).map(withSub), ...vendor];

  // The shared clock. One line per item: id -> the date this build first saw it.
  //
  // Written here and nowhere else, because this is the only script that sees both catalogues
  // merged — sync-vinted.mjs knows nothing about Govinda, and the Govinda CSV is built by its
  // own script. It cannot live inside data/catalog.json either: sync-vinted.mjs regenerates
  // that file wholesale, so the stamps would be destroyed on the next sync, which is the same
  // reason vendor items are kept out of it.
  //
  // A stamp is written once and never rewritten. A Vinted relist gets a new id and so stamps
  // fresh, correctly — it is a new listing. A Govinda SKU keeps its number through going out
  // of stock and coming back, and keeps its original stamp with it: restocked stock is not
  // news, which is what the sort has always assumed.
  //
  // Sold pieces are stamped too. When a thing appeared and whether it later sold are two
  // different facts, and stamping both keeps the sold grid ordered like everything else.
  const firstSeenPath = path.join(ROOT, "data/first-seen.json");
  const firstSeen = existsSync(firstSeenPath)
    ? JSON.parse(await readFile(firstSeenPath, "utf8"))
    : {};
  const today = new Date().toISOString().slice(0, 10);
  let stamped = 0;
  for (const i of [...available, ...sold]) {
    if (!firstSeen[i.id]) { firstSeen[i.id] = today; stamped++; }
  }
  if (stamped) {
    // Sorted by id so the file diffs legibly instead of shuffling on every run.
    const ordered = Object.fromEntries(
      Object.keys(firstSeen).sort().map((k) => [k, firstSeen[k]]));
    await writeFile(firstSeenPath, JSON.stringify(ordered, null, 2) + "\n");
    console.log(`  data/first-seen.json — ${stamped} newly stamped, ${Object.keys(firstSeen).length} total`);
  }
  // "Newest" needs a clock the two catalogues share, and they have none.
  //
  // Vinted ids are numeric and ascend with time, so sorting on them is genuinely "newest
  // first" — within Vinted. Govinda SKUs ascend too — within Govinda. Across the two the
  // numbers mean nothing to each other: 9696606450 and 2254 are not comparable, and
  // Number("govinda-2254") is NaN, which makes every comparison false and leaves those cards
  // wherever the sort happened to drop them. The old rule dodged the problem by forcing
  // every vendor item to sort last. That is why the Others tile — a shelf of twenty-nine
  // Govinda pieces and one Apple trackpad — led with the trackpad.
  //
  // So the clock is recorded rather than inferred: first-seen(), below, stamps the date an
  // id is first seen by a build and never changes it afterwards. The stamps live in
  // data/first-seen.json, they are committed like any other data file, and they mean that
  // from now on "newest" is a fact about when a thing appeared here rather than a guess from
  // its id.
  //
  // Within one day the stamps tie, and then it falls back to the old ordering: Vinted before
  // Govinda, each newest-first by its own id. The tie matters most on the first run, when
  // everything already in the catalogue is stamped at once; it stops mattering as real dates
  // accumulate.
  // The same-day tiebreak, in three steps rather than one number. The single `key` this
  // replaced returned -1 for every vendor item, which sorted them below Vinted correctly but
  // made them all equal to each other — so the final string compare, which is ASCENDING,
  // decided the order among them and the oldest Govinda SKU came out on top. The Others tile
  // led with a tube of toothpaste, SKU 485.
  const isVendor = (i) => (i.vendor ? 1 : 0);
  const num = (i) => Number(String(i.id).replace(/\D/g, ""));
  const byNewest = (a, b) =>
    (firstSeen[b.id] || "").localeCompare(firstSeen[a.id] || "") ||   // real clock first
    isVendor(a) - isVendor(b) ||                                      // Vinted before Govinda
    num(b) - num(a) ||                                                // each newest by its own id
    String(b.id).localeCompare(String(a.id), "en", { numeric: true }); // stable, and descending
  // Three tiers, not two. Out-of-stock vendor stock used to sort in among the buyable
  // pieces, because it is not sold and the split was sold/not-sold — so a grid of things you
  // can buy today was salted with things you cannot. It is still not the same as sold: the
  // piece is expected back, which is why it sits ABOVE the sold pieces rather than with
  // them. In stock, then out of stock, then sold; newest first within each.
  const canBuy = (i) => !(i.vendor && i.inStock === false);
  const live = [
    ...available.filter(canBuy).sort(byNewest),
    ...available.filter((i) => !canBuy(i)).sort(byNewest),
    ...sold.sort(byNewest),
  ];

  const counts = { __all: live.length, __sold: sold.length };
  // Same list-of-names rule as the shelf itself: counting on cat.name alone would have the
  // strip say "Meditation 11" over a page of 461.
  for (const c of CATEGORIES)
    counts[c.name] = live.filter((i) => (c.names || [c.name]).includes(i.category)).length;

  const indexPath = path.join(ROOT, "index.html");
  let indexHtml = await readFile(indexPath, "utf8");
  const ch = chrome(indexHtml);

  let written = 0;

  // id -> the one canonical address for that item, written to data/anchors.json at the end.
  //
  // An item has no page of its own; it is a card on a shelf. Which shelf page depends on
  // where it falls in the pagination, and that is known HERE and nowhere else. build-jsonld
  // needs the same answer for the home-page graph, and duplicating the pagination arithmetic
  // over there is how the two schema generators drifted apart in the first place. So this
  // build records it and the other one reads it.
  //
  // The category page wins over /wardrobe: /wardrobe only holds the first PER_PAGE items, so
  // an anchor pointing there would jump to nothing for everything past it. The category page
  // always contains the item. One rule, never wrong.
  const anchors = {};

  // Whole generated pages, one per non-empty category, plus the everything page.
  for (const cat of CATEGORIES) {
    const items = live.filter((i) => (cat.names || [cat.name]).includes(i.category));
    if (!items.length) {
      // A category can empty out — the last "More" item gets a taxonomy rule, the last of
      // something sells, everything on it gets refiled. Leaving the pages behind would
      // strand a stale grid the nav no longer links to, still in the sitemap and still
      // indexable.
      //
      // The DIRECTORY goes too, not just the page. It holds the numbered pages and every
      // subcategory page of a shelf that no longer exists, and build-sitemap.mjs walks
      // wardrobe/ recursively — so leaving it behind means submitting pages to Google for a
      // shelf whose items now live somewhere else entirely.
      //
      // No redirect is left behind, deliberately. The shelf returns by itself the day
      // something lands in it again, and a static 301 would then sit in front of the rebuilt
      // page until a person remembered to delete it.
      const stale = path.join(ROOT, cat.page);
      const staleDir = path.join(ROOT, cat.page.replace(/\.html$/, ""));
      if (!cat.managed && existsSync(stale)) {
        await rm(stale);
        console.log(`  ${cat.page} — removed (category is empty)`);
      }
      if (!cat.managed && existsSync(staleDir)) {
        await rm(staleDir, { recursive: true });
        console.log(`  ${cat.page.replace(/\.html$/, "")}/ — removed (category is empty)`);
      }
      continue;
    }

    const total = Math.max(1, Math.ceil(items.length / PER_PAGE));

    // Every page this build writes under the shelf's own directory. Anything else found
    // there afterwards is stale and gets swept — see the note at the end of this block.
    const dir = path.join(ROOT, cat.page.replace(/\.html$/, ""));
    const wrote = new Set();

    for (let no = 1; no <= total; no++) {
      const slice = items.slice((no - 1) * PER_PAGE, no * PER_PAGE);
      const seq = { no, total };
      const file = pageFile(cat, no);

      // First shelf to claim an item wins. Two CATEGORIES can list the same source category
      // in `names` (Spirituality feeds Meditation), and an item needs exactly one address.
      for (const it of slice) if (!(it.id in anchors)) anchors[it.id] = `${SITE}${url(file)}#${itemSlug(it)}`;

      if (cat.managed && no === 1) {
        // Hand-written page: swap only the grid region, leave the prose alone.
        const p = path.join(ROOT, file);
        const html = await readFile(p, "utf8");
        // A module page gets the bare grid: no shelf strip (it is not a shelf in the
        // wardrobe) and no filter toolbar (two items cannot be usefully filtered — every
        // control would be a dead one). Just the pieces, and the note about how the prices
        // convert.
        const body = cat.module
          ? grid(slice, manifest, false)
          // toolbar(items), not toolbar(slice) — the whole shelf, for the reason given at the
          // other call site: options taken from one page of 99 describe that page, and the
          // filters act on the shelf.
          : catNav(cat.name, counts) + "\n  " + subChips(cat, items, null) + "\n  " + toolbar(items) +
            "\n  " + grid(slice, manifest, false, total > 1 ? url(cat.page) + ".cards" : "") +
            `\n  <p class="sb-empty" id="sb-empty" hidden>Nothing matches those filters. <button type="button" id="sb-reset">Clear them</button></p>\n  ` +
            pager(cat, seq);
        await writeFile(p, replaceRegion(html, "SHOP:GRID", body, file));
      } else {
        await mkdir(path.dirname(path.join(ROOT, file)), { recursive: true });
        await writeFile(path.join(ROOT, file), page(cat, slice, manifest, counts, ch, seq, null, items));
      }
      wrote.add(path.resolve(ROOT, file));
      written++;
    }
    console.log(`  ${cat.page} — ${items.length} items across ${total} page${total === 1 ? "" : "s"}`);

    if (total > 1) {
      await writeFile(
        path.join(ROOT, cat.page.replace(/\.html$/, "") + ".cards"),
        cardsFragment(items, manifest, false),
      );
    }

    // Subcategory pages. These are the pages that can actually rank: "kanthi mala" and
    // "gopi dress" are what someone types, and a shelf of 461 mixed objects answers none of
    // those queries. Same threshold as the chips — a page of three items is not worth a URL.
    const bySub = new Map();
    for (const i of items) if (i.subcategory) {
      if (!bySub.has(i.subcategory)) bySub.set(i.subcategory, []);
      bySub.get(i.subcategory).push(i);
    }
    let subPages = 0;
    for (const [name, subItems] of bySub) {
      if (subItems.length < SUB_MIN) continue;
      const subTotal = Math.max(1, Math.ceil(subItems.length / PER_PAGE));
      for (let no = 1; no <= subTotal; no++) {
        const file = subFile(cat, name, no);
        await mkdir(path.dirname(path.join(ROOT, file)), { recursive: true });
        await writeFile(
          path.join(ROOT, file),
          page(cat, subItems.slice((no - 1) * PER_PAGE, no * PER_PAGE), manifest, counts, ch,
               { no, total: subTotal }, name, items),
        );
        wrote.add(path.resolve(ROOT, file));
        subPages++;
        written++;
      }
    }
    if (subPages) console.log(`    + ${subPages} subcategory page(s)`);

    // Sweep the shelf's directory: any .html this build did not just write is stale.
    //
    // This used to check only for NUMBERED pages above the current page count, which caught
    // a shrinking shelf and nothing else. It missed every other way a page goes stale — a
    // subcategory renamed, a subcategory falling below SUB_MIN, or the slug rule itself
    // changing. That last one had already happened: slug() deletes apostrophes, so
    // "Dolls and children's gifts" is dolls-and-childrens-gifts, and the older
    // dolls-and-children-s-gifts.html sat there for months, unlinked, in the sitemap, a
    // duplicate of a live page.
    //
    // Comparing against what was written is the rule that covers all of them at once, and it
    // cannot go wrong in the dangerous direction: a page that should exist was written a few
    // lines above and is therefore in the set.
    if (existsSync(dir)) {
      const sweep = async (d) => {
        for (const f of await readdir(d, { withFileTypes: true })) {
          const full = path.join(d, f.name);
          if (f.isDirectory()) { await sweep(full); continue; }
          if (!f.name.endsWith(".html") || wrote.has(path.resolve(full))) continue;
          await rm(full);
          console.log(`  ${path.relative(ROOT, full)} — removed (no longer generated)`);
        }
      };
      await sweep(dir);
    }
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
    name: "Everything", slug: "wardrobe", page: "wardrobe.html",
    noun: "Indian goods",
    title: "Shop Indian clothes, jewellery and home things in Europe",
    h1: ["Everything", "in one place"],
    // No count in the lede. It is on screen twice already — the shelf strip says "All 1631"
    // and the toolbar prints the result count — and a number in the opening line dates the
    // sentence the moment stock moves. This is also the page's meta description.
    lead: "Clothing, jewellery, home things, meditation objects, books and the rest. Hand-picked and hand-crafted, some of it out of my own wardrobe. Filter it down, or tap any piece to buy it or ask about it.",
    expo: ["THE WARDROBE", "the full range", `${available.length} available · ${sold.length} sold`],
  };
  // The storefront is a ROOT FILE, not wardrobe/index.html, and the difference is a status
  // code. With an index.html inside the directory, the asset server answers /wardrobe with
  // a 307 to /wardrobe/ — measured on the live site. /wardrobe is the most linked URL here
  // and every canonical, tile and nav item points at it, so it has to answer 200 itself.
  //
  // wardrobe.html beside a wardrobe/ directory that has no index is unambiguous, and it is
  // exactly the shape diaries.html and diaries/ already use: /diaries 200s, /diaries/ 307s
  // back to it, /diaries/<post> 200s.
  await mkdir(path.join(ROOT, "wardrobe"), { recursive: true });

  // The storefront paginates like every other shelf, and it is the page that most needed
  // it: 1,543 cards in one document came to 4 MB, which is not a page anyone should be
  // asked to load on a phone. Its pages 2+ go to /wardrobe/2, /wardrobe/3 — the same
  // directory the shelves live in, which is why a shelf may never be called by a number.
  const allTotal = Math.max(1, Math.ceil(live.length / PER_PAGE));
  for (let no = 1; no <= allTotal; no++) {
    const slice = live.slice((no - 1) * PER_PAGE, no * PER_PAGE);
    const file = no === 1 ? "wardrobe.html" : `wardrobe/${no}.html`;
    // `live` as shelfItems, not the slice: the toolbar's options are a statement about the
    // WHOLE closet, and the filters already act on it (shop.js fetches wardrobe.cards the
    // first time a control is used). Passing the slice meant page 1 — which is all in-stock,
    // because sold and out-of-stock sort last — reported no sold and no out-of-stock items
    // and suppressed the Availability control entirely. That in turn made ?avail=sold a
    // no-op on /wardrobe: shop.js only honours the parameter when the page rendered the
    // control it belongs to.
    await writeFile(path.join(ROOT, file), page(all, slice, manifest, counts, ch, { no, total: allTotal }, null, live));
  }
  if (allTotal > 1) {
    await writeFile(path.join(ROOT, "wardrobe.cards"), cardsFragment(live, manifest, true));
  }
  console.log(`  wardrobe.html — ${live.length} items (${sold.length} sold) across ${allTotal} pages`);
  // The old page is not left on disk to rot: it would still be reachable, still be
  // indexable, and would go stale the first time the closet changed.
  if (existsSync(path.join(ROOT, "shop.html"))) {
    await rm(path.join(ROOT, "shop.html"));
    console.log(`  shop.html — removed (now wardrobe.html; nginx 301s the old path)`);
  }

  // THERE IS NO SOLD PAGE. Removed 24 Aug 2026, along with its RECENT_SOLD = 10 cap.
  //
  // It existed because "has anything here actually sold" is a question a hesitant buyer asks
  // deliberately, and a URL can be linked and indexed where a filter state cannot. That
  // reasoning was written when the split was sold/not-sold. It stopped holding when
  // out-of-stock arrived as a third state: nothing gave sold a dedicated page that did not
  // equally give one to out-of-stock, and there was never a /wardrobe/oos. Two sibling
  // states, one with a URL and a hand-written lead and a display cap, the other a filter
  // value — that asymmetry was history, not design.
  //
  // Sold is now exactly what out-of-stock is: a value of data-avail, ordered last by `live`
  // above, reachable at /wardrobe?avail=sold and on any shelf. The cap goes with the page —
  // it capped the page, never the data, and the filter shows every archived piece.
  //
  // The old file is deleted rather than left to rot: on disk it would keep being served and
  // keep going stale. It is NOT redirected — a deliberate choice, matching the rest of this
  // hostname, which has no indexing history to preserve.
  const soldPageFile = path.join(ROOT, "wardrobe/sold.html");
  if (existsSync(soldPageFile)) {
    await rm(soldPageFile);
    console.log("  wardrobe/sold.html — removed (sold is now ?avail=sold, like out-of-stock)");
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
  //   the link itself  — the proof, so it goes to the feedback tab, not the profile. An
  //                     unverifiable rating is worth less than none
  //
  // The WHOLE strip is the link as of 24 Aug 2026, rather than a separate "Read the reviews"
  // anchor beside it. Two reasons. The rating and the proof were two targets for one
  // intention, and the stars — the part a thumb goes for first — were not clickable at all.
  // And on a phone the second anchor wrapped onto its own row, spending ~44px to repeat what
  // the count already said. The arrow on the count now carries "this goes somewhere", and
  // the visually-hidden sentence carries the rest for a screen reader.
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
    : `<a class="trust" href="${esc(seller.feedbackUrl)}" target="_blank" rel="noopener">` +
      `<span class="trust-rate">` +
      `<span class="stars" aria-hidden="true">${"★".repeat(Math.round(seller.rating))}${"☆".repeat(5 - Math.round(seller.rating))}</span>` +
      `<b>${seller.rating.toFixed(1)}</b></span>` +
      `<span class="trust-n">${seller.count} reviews on Vinted →</span>` +
      `<span class="vh">Rated ${seller.rating.toFixed(1)} out of 5 from ${seller.count} buyer reviews. Read them on Vinted (opens in a new tab).</span>` +
      `</a>`;

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
      // (c.names || [c.name]), matching the shelf and the counts. Filtering on c.name alone
      // meant the Others tile drew from the single item whose category literally reads
      // "Uncategorised" and ignored the twenty-nine filed as "Others" — the same
      // one-name-versus-two bug the counts above already had to fix.
      const names = c.names || [c.name];
      // canBuy as well as available: the tile is a shop window, and since vendor stock the
      // supplier has run out of still counts as "available" (it is not sold), the newest
      // piece on a shelf could otherwise be one nobody can order today.
      const newest = available
        .filter((i) => names.includes(i.category) && canBuy(i))
        .sort(byNewest)[0];
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

  await writeFile(path.join(ROOT, "data/anchors.json"), JSON.stringify(anchors, null, 2) + "\n");
  console.log(`  data/anchors.json — ${Object.keys(anchors).length} item anchors`);

  console.log(`\n${written + 2} pages written from ${live.length} live items`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
