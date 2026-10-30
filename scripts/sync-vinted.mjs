#!/usr/bin/env node
// Pull the Vinted closet into data/catalog.json — the product master for this site.
//
// Why a build-time snapshot rather than a live call from the page: Vinted sits behind
// DataDome, and any request made from a visitor's browser (or from nginx on their behalf)
// would eventually be challenged or blocked. A visitor would then see an empty shop. So
// the network call happens here, on this machine, at publish time, and the site itself
// only ever reads a JSON file that is already on disk. Vinted can rate-limit us and the
// site stays up serving the last good snapshot.
//
// Two endpoints, because neither one alone is enough:
//
//   /api/v2/wardrobe/<user>/items  — the whole closet as JSON: title, price, size, brand,
//                                    condition, every photo URL, favourite count. Fast,
//                                    96 items per page. But NO description and NO category.
//   /items/<id>-<slug>  (HTML)     — carries a schema.org Product in a <script type=
//                                    "application/ld+json">, which does have description,
//                                    category and colour. The JSON twin of this
//                                    (/api/v2/items/<id>) is blocked; the HTML is not.
//
// The wardrobe endpoint is the cheap one and is refetched in full on every run. The item
// pages are the expensive one (~2 MB of HTML each, for ~1 KB of useful data) so they are
// fetched ONCE per item and then cached in the catalog forever. A run that finds no new
// listings makes exactly two requests.
//
// Session: a cold call to the API is 401 "invalid_authentication_token". Vinted hands an
// anonymous bearer to any browser that loads the homepage, as a cookie, so we fetch the
// homepage first and replay its cookies. That token is what the site's own JavaScript
// uses; there is no login here and no credential stored anywhere in this repo.
//
//   node scripts/sync-vinted.mjs            # incremental
//   node scripts/sync-vinted.mjs --full     # re-enrich every item, ignoring the cache
//
// Run it before build-images.mjs, which turns the photos this downloads into the
// responsive variants the markup actually serves.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const IMG_DIR = path.join(ROOT, "images");

const USER_ID = "3166447071";
const HOST = "https://www.vinted.cz";

// Vinted mirrors every listing across its national storefronts — vinted.es/items/<id>
// serves the same item as vinted.cz/items/<id>. Storing all three now means the Spanish
// shop is a template change later, not a re-sync.
const STOREFRONTS = {
  cz: "https://www.vinted.cz",
  es: "https://www.vinted.es",
  com: "https://www.vinted.com",
  uk: "https://www.vinted.co.uk",
};

// Item detail is read from the UK storefront, not the Czech one. Vinted renders each
// national site in its own language and ignores both Accept-Language and the locale
// cookie for anonymous visitors (measured 21 Aug 2026: en-GB, en-US, ?locale=en and
// anonymous-iso-locale=en all still returned Czech). The listing itself is identical
// across storefronts — same id, same photos, same seller — so fetching /items/<id> from
// .co.uk is the same item in the language this site publishes in.
//
// .co.uk specifically, not .com: the US site says "Jewelry" and the UK site says
// "Jewellery", and this site is written in British English.
const DETAIL_HOST = STOREFRONTS.uk;

// A real browser UA. Not evasion — the API returns 403 to the default Node agent, and
// this is the same request the author's own browser makes against their own closet.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Deliberately slow. 500 item pages at this pace is ~12 minutes of wall clock on the
// first cold run and near-zero thereafter, which is a fine trade for not tripping a rate
// limiter that would cost a day of backoff.
const DELAY_MS = 1500;
const MAX_RETRIES = 3;
const CHECKPOINT_EVERY = 20;

// Photos kept per item for the card carousel. Listings carry a median of 7 and up to 14,
// but the first three — the main shot plus two — are what sell a piece in a grid; the rest
// are detail and label shots that the Vinted listing itself is there for. Three keeps the
// download, the disk and the encode time all roughly a third of what "everything" costs,
// which matters at 500 SKUs. Raise it here and re-run to change your mind; nothing else
// depends on the number.
const PHOTOS_PER_ITEM = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJson(file, fallback) {
  const p = path.join(DATA_DIR, file);
  if (!existsSync(p)) return fallback;
  return JSON.parse(await readFile(p, "utf8"));
}

async function writeJson(file, value) {
  await writeFile(path.join(DATA_DIR, file), JSON.stringify(value, null, 2) + "\n");
}

/* ---------------------------------------------------------------- session ---- */

// Collect the cookies the homepage sets and flatten them into one Cookie header. The one
// that matters is access_token_web; the rest are carried along because sending a partial
// jar is more suspicious to a bot filter than sending the whole thing.
async function openSession(host = HOST) {
  const res = await fetch(host + "/", { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`session bootstrap failed: HTTP ${res.status}`);
  await res.text();

  const jar = new Map();
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  if (!jar.has("access_token_web")) {
    throw new Error("no access_token_web in homepage response — Vinted changed its session flow");
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function get(url, cookie, accept, lang = "en-GB,en;q=0.9") {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept, Cookie: cookie, "Accept-Language": lang },
    });
    if (res.ok) return res;
    // 429/403 are the rate limiter talking. 5xx is Vinted or the Cloudflare in front of it
    // having a moment — a 524 (origin timeout) killed an early run of this script partway
    // through the catalog. All of them are worth retrying; a 404 is not.
    if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt <= MAX_RETRIES) {
      const wait = DELAY_MS * 4 * attempt;
      console.warn(`  HTTP ${res.status} on ${url} — retry ${attempt}/${MAX_RETRIES} in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
}

/* ------------------------------------------------------------------ fetch ---- */

async function fetchWardrobe(cookie) {
  const items = [];
  for (let page = 1; ; page++) {
    const url = `${HOST}/api/v2/wardrobe/${USER_ID}/items?page=${page}&per_page=96`;
    const body = await (await get(url, cookie, "application/json")).json();
    items.push(...body.items);
    const { current_page: cur, total_pages: total, total_entries: n } = body.pagination;
    console.log(`  page ${cur}/${total} — ${items.length}/${n} items`);
    if (cur >= total) break;
    await sleep(DELAY_MS);
  }
  return items;
}

// Pull the schema.org Product out of an item page. Vinted renders it server-side, so it
// survives without executing any of the page's JavaScript.
async function fetchDetail(itemUrl, cookie, host = DETAIL_HOST) {
  // Same listing, UK storefront by default — see DETAIL_HOST. The path carries the id and
  // slug and is storefront-independent, so any host serves the same item.
  const url = itemUrl.replace(/^https:\/\/www\.vinted\.[a-z.]+/, host);
  const html = await (await get(url, cookie, "text/html")).text();
  const blocks = html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g);
  // ld.category is a flattened two-level string ("Ženy Dlouhé šaty") that drops every
  // level in between: the page itself reads Ženy > Doplňky > Šperky > Náhrdelníky. That
  // full path is what the site's taxonomy is built from, and it is NOT in the JSON-LD —
  // Vinted renders breadcrumbs as markup only (measured 21 Aug 2026: the item page carries
  // exactly one ld+json block, a Product). So the path is read from the HTML instead.
  let out = { description: "", vintedCategory: "", colorRaw: "", crumbs: [], condition: "" };
  for (const [, raw] of blocks) {
    try {
      const ld = JSON.parse(raw);
      if (ld["@type"] === "Product") {
        out.description = (ld.description || "").trim();
        out.vintedCategory = ld.category || "";
        out.colorRaw = ld.color || "";
      }
    } catch {
      // A malformed block is not worth aborting a 500-item run over.
    }
  }
  out.crumbs = crumbs(html);
  // Condition comes from the page, not from the wardrobe API. The API is bound to the
  // Czech marketplace and answers "Velmi dobrý" whatever Accept-Language asks for; the UK
  // item page says "Very good". Since the condition is displayed and filtered on, it has
  // to be the English one. The UK wardrobe endpoint is not an alternative — it answers 200
  // with an empty list, because the closet lives on .cz.
  out.condition = condition(html);
  return out;
}

// The same item's attribute words in Czech, read from the .cz storefront.
//
// Vinted localises its OWN vocabulary — category, condition, colour — per national site,
// but NOT the seller's title and description: those are typed once and served identically
// everywhere (measured 24 Aug 2026, .co.uk and .cz returned byte-identical descriptions for
// the same listing while the category read "Women Summer dresses" and "Ženy Letní šaty").
//
// So this fetch is worth exactly three fields, and they are three fields worth having: they
// are Czech written by Czechs rather than by a translation API, for the market this shop
// actually ships from. Everything else Czech-facing has to come from somewhere else.
//
// One extra request per NEW item, at the same deliberate pace as the rest of this script.
async function fetchCzech(itemUrl, cookie) {
  const detail = await fetchDetail(itemUrl, cookie, STOREFRONTS.cz);
  return {
    condition: detail.condition,
    colorRaw: detail.colorRaw,
    vintedCategory: detail.vintedCategory,
  };
}

// The condition, e.g. "Very good", "New without tags".
//
// Anchored on itemProp="status" — the wrapper carries data-testid="item-attributes-status"
// but so does the "Condition" LABEL that precedes the value, and the gap between them runs
// to a few hundred characters. itemProp sits on the value's own node, so it cannot pick up
// the label by accident. Class names are hashed per Vinted build and are not used.
function condition(html) {
  const m = html.match(/itemProp="status"[\s\S]{0,300}?<span[^>]*>([^<]*)/);
  return m ? m[1].trim() : "";
}

// The breadcrumb trail as rendered. Anchored on data-testid="breadcrumb" rather than the
// class names, which are hashed per build (Breadcrumbs-module-scss-module__mDt9qq__) and
// would break on any Vinted deploy.
//
// The final crumb is a brand-within-category link ("Handmade Beauty Náhrdelníky", href
// .../brand/7294168-...) — a filter, not a level of the tree — so it is dropped. Its href
// is what identifies it; the label alone is indistinguishable from a real category.
function crumbs(html) {
  const out = [];
  for (const m of html.matchAll(
    /<a\s+href="([^"]*)"[^>]*data-testid="breadcrumb"[^>]*>[\s\S]*?<span[^>]*itemProp="title"[^>]*>([^<]*)<\/span>/g
  )) {
    const href = m[1];
    const name = m[2].replace(/&amp;/g, "&").trim();
    if (!name || href.includes("/brand/")) continue;
    // /catalog/1187-doplnky?referrer=… — the numeric id is stable, the slug is localised.
    const id = Number(href.match(/\/catalog\/(\d+)-/)?.[1]) || null;
    out.push({ id, name });
  }
  return out;
}

/* ----------------------------------------------------------------- seller ---- */

// The seller's own feedback, for the trust strip on the homepage.
//
// /api/v2/users/<id> answers with the whole profile in ONE request and needs the same
// anonymous session the wardrobe endpoint uses, so this costs a single extra call on a run
// that already makes hundreds. The public /member/<id>?tab=feedback page renders the same
// numbers, but only after its JavaScript runs — scraping it would mean a headless browser
// for two integers that are sitting in a JSON field.
//
// `feedback_reputation` is a 0–1 float, NOT a star rating: 1 means every review is
// positive. Multiplying by 5 is the same arithmetic Vinted's own profile page does.
//
// This never throws. A rating is decoration on a page whose job is selling clothes — if
// Vinted changes the field or rate-limits this one call, the strip falls back to its
// static copy and the publish carries on. Compare fetchWardrobe, where a failure MUST stop
// the run because the catalog would otherwise be published empty.
async function fetchSeller(cookie) {
  try {
    const { user: u } = await (await get(`${HOST}/api/v2/users/${USER_ID}`, cookie, "application/json")).json();
    const count = Number(u.feedback_count) || 0;
    if (!count || u.hide_feedback) return null;
    return {
      fetched: new Date().toISOString(),
      rating: Math.round(Number(u.feedback_reputation) * 50) / 10,
      count,
      positive: Number(u.positive_feedback_count) || 0,
      neutral: Number(u.neutral_feedback_count) || 0,
      negative: Number(u.negative_feedback_count) || 0,
      followers: Number(u.followers_count) || 0,
      // Sales Vinted itself counts, which is a larger and truer number than archive.json:
      // it includes everything sold before this pipeline existed.
      soldTotal: Number(u.given_item_count) || 0,
      feedbackUrl: `${HOST}/member/${USER_ID}?tab=feedback`,
    };
  } catch (err) {
    console.warn(`  ⚠ could not read seller feedback: ${err.message} — keeping the last value`);
    return null;
  }
}

async function downloadPhoto(url, dest) {
  if (existsSync(dest)) return false;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`photo HTTP ${res.status} for ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

/* ------------------------------------------------------------------- sold ---- */

// Vinted deletes a listing the moment it sells: the wardrobe endpoint stops returning it,
// and the item URL 307s to a page with its JSON-LD stripped out. So sold history cannot be
// queried — it can only be ACCUMULATED, by noticing what disappeared between two syncs.
// That is the diff at the end of main().
//
// This function covers the other case: items that sold before this pipeline existed, whose
// ids are listed in data/sold-seed.json. Their pages still carry Open Graph tags, so the
// real title, description and photo can be recovered rather than invented. One-time per
// id — once an item is in archive.json it is never fetched again.
// Meta tag content is HTML-escaped at the source, so "Green &amp; Rust" arrives literally.
// Left alone it gets escaped a second time on the way into the page and renders as
// "Green &amp;amp; Rust".
const unescapeHtml = (s) =>
  s.replace(/&(?:amp|lt|gt|quot|#0?39|apos|nbsp);/g, (m) =>
    ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#039;": "'", "&apos;": "'", "&nbsp;": " " })[m]);

async function fetchSoldMeta(id, cookie) {
  const html = await (await get(`${HOST}/items/${id}`, cookie, "text/html")).text();
  const og = (p) => {
    const m = new RegExp(`<meta property="og:${p}" content="([^"]*)"`).exec(html);
    return m ? unescapeHtml(m[1]) : "";
  };
  const title = og("title").replace(/\s*\|\s*Vinted\s*$/, "").trim();
  if (!title) return null;

  // THE PRICE SURVIVES AFTER ALL (27 Aug 2026).
  //
  // This function used to take title, description and photo from the Open Graph tags and
  // record `priceCzk: null`, on the belief that Vinted strips price from a sold listing.
  // That was measured, and it has stopped being true: a sold item page still returns 200
  // with its real body, and the price sits in the same `data-testid="item-price"` node a
  // live listing uses. Forty of the sixty-one sold cards were showing the word "Sold" where
  // a price belongs purely because nobody re-checked the assumption.
  //
  // Read from HOST, which is vinted.cz, so the figure is in Kč like every other price in
  // this pipeline — the .co.uk storefront answers the same question in £ and would need a
  // second conversion with a rate this script does not carry.
  //
  // It is the LISTED price, not what the buyer finally paid: the page has no record of an
  // accepted offer, and the sold cards that DO have a price got it the same way, captured
  // from the listing while the item was live. Two meanings in one slot would be worse than
  // the gap this fills. The number next to it in the markup is the buyer-protection total,
  // which is Vinted's fee and not what the piece fetched — deliberately not read.
  //
  // "250,00 Kč" — Czech decimal comma, thin space or nbsp before the unit. Everything after
  // the comma is discarded rather than rounded: these are whole-koruna prices, and the
  // decimals are formatting.
  const priceNode = /data-testid="item-price"><p[^>]*>([^<]+)</.exec(html);
  const czk = priceNode ? Number(priceNode[1].replace(/[^\d,]/g, "").split(",")[0]) : NaN;
  const priceCzk = Number.isFinite(czk) && czk > 0 ? czk : null;
  // og:description is "<title> - <the actual description>", so the title would otherwise
  // appear twice on the card: once as the name and again at the head of the blurb.
  let description = og("description").trim();
  if (description.startsWith(title)) description = description.slice(title.length).replace(/^\s*[-–—]\s*/, "");
  return { title, description: description.trim(), image: og("image"), priceCzk };
}

/* --------------------------------------------------------------- currency ---- */

// The site quotes EUR first for the cross-EU audience and Kč second for the local one.
// Neither is a checkout price — Vinted converts at its own rate when the buyer pays — so
// the ECB daily reference rate is the right choice: it is the neutral published figure,
// it is free, and it needs no key. Last good value is cached so a network blip or a
// weekend (the ECB does not publish daily) never blocks a build.
async function fxRate(cached) {
  try {
    const res = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const m = /currency=['"]CZK['"]\s+rate=['"]([\d.]+)['"]/.exec(await res.text());
    if (!m) throw new Error("no CZK rate in ECB feed");
    const rate = { czkPerEur: Number(m[1]), fetched: new Date().toISOString().slice(0, 10), source: "ECB" };
    console.log(`  ECB rate: 1 EUR = ${rate.czkPerEur} CZK`);
    return rate;
  } catch (err) {
    if (!cached) throw new Error(`no FX rate available and none cached: ${err.message}`);
    console.warn(`  ECB fetch failed (${err.message}) — reusing cached rate from ${cached.fetched}`);
    return cached;
  }
}

/* --------------------------------------------------------------- taxonomy ---- */

// Vinted is fetched with Accept-Language: en-GB — the same toggle a person flips in its
// header — so conditions, colours and categories already arrive in English and nothing
// Czech is stored. This map is therefore no longer a translation: it exists to force
// BRITISH spellings on the handful of words where Vinted ships American ones
// ("Multicolor" -> "Multicolour"). An unmapped value passes through unchanged.
function translate(map, value) {
  if (!value) return "";
  return map[value] || value;
}

// Vinted sends a compound size, "L / 40 / 12" — UK letter, EU number, US number. Nobody
// filters a shop by "L / 40 / 12", so the letter is split off and mapped. Items with no
// size at all (books, decor, most jewellery — two thirds of this closet) get an empty
// string, and the shop hides its size control on pages where nothing has one.
function sizeGroup(raw, map) {
  if (!raw) return "";
  const head = raw.split("/")[0].trim();
  if (map[head]) return map[head];
  // Only a garment size earns a place in the size filter. Vinted reuses the size field for
  // physical dimensions on non-clothing — a pendant came through as "30–38 mm" — and that
  // would appear in the dropdown as if it were something to wear.
  return /^(XX?S|S|M|L|XX?L|\d{1,2})$/i.test(head) ? head.toUpperCase() : "";
}

// Category comes back as a Czech breadcrumb string ("Bydlení Pekáče", "Ženy Šaty").
// Matching on longest prefix means one rule covers a whole branch of Vinted's tree, so
// the mapping stays small as the catalog grows.
// The same shape ld.category has — top level plus leaf, "Women Necklaces" — rebuilt from
// the breadcrumbs. Needed because a small number of item pages come back without the
// Product JSON-LD block at all (2 of 141 on 21 Aug 2026, neither reserved nor sold, and
// both fine on a retry). The breadcrumbs are rendered server-side and were present on
// both, so they are the more reliable of the two and are used as the fallback rather than
// letting the item drop to Uncategorised.
function flatten(crumbs) {
  if (!crumbs?.length) return "";
  return crumbs.length === 1 ? crumbs[0].name : `${crumbs[0].name} ${crumbs[crumbs.length - 1].name}`;
}

function categorise(vintedCategory, rules) {
  let best = null;
  for (const [prefix, category] of Object.entries(rules)) {
    if (vintedCategory.startsWith(prefix) && (!best || prefix.length > best[0].length)) {
      best = [prefix, category];
    }
  }
  return best ? best[1] : "Uncategorised";
}

/* -------------------------------------------------------------------- csv ---- */

// A spreadsheet of the whole closet, live and sold, written on every sync. Useful for the
// things a web page is bad at — reviewing prices across a category, spotting what has sat
// unsold for months, and preparing a bulk upload for the next marketplace.
//
// Excel and Numbers both assume the platform's 8-bit encoding unless told otherwise, and
// this data is full of Czech diacritics and em dashes, so the file opens with a BOM.
async function writeCsv(live, sold) {
  const cols = [
    "id", "status", "title", "category", "brand", "price_czk", "price_eur", "condition",
    "size", "colour", "favourites", "photos", "sold_at", "vinted_category", "url",
  ];
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (i, status) => [
    i.id, status, i.title, i.category, i.brand, i.priceCzk, i.priceEur, i.condition?.en,
    i.sizeGroup || i.size, i.color?.en, i.favourites, (i.photos || []).length,
    i.soldAt || "", i.vintedCategory, i.urls?.cz || "",
  ].map(cell).join(",");

  const lines = [cols.join(","), ...live.map((i) => row(i, i.reserved ? "reserved" : "available")),
    ...sold.map((i) => row(i, "sold"))];
  await writeFile(path.join(DATA_DIR, "catalog.csv"), "﻿" + lines.join("\n") + "\n");
}

/* ------------------------------------------------------------------- main ---- */

async function main() {
  const full = process.argv.includes("--full");
  await mkdir(DATA_DIR, { recursive: true });

  const taxonomy = await readJson("taxonomy.json", null);
  if (!taxonomy) throw new Error("data/taxonomy.json is missing — it maps Vinted's Czech categories onto yours");
  const overrides = await readJson("overrides.json", {});
  const previous = await readJson("catalog.json", { items: [] });
  const archive = await readJson("archive.json", { items: [] });

  // What has already been enriched, so a rerun does not refetch 500 item pages. Two
  // sources: the last published catalog, and the checkpoint file written mid-run, which
  // is what makes an interrupted cold run resumable.
  const enrichCache = await readJson("enrich-cache.json", {});
  for (const i of previous.items) {
    if (!i.needsEnrich && !(i.id in enrichCache)) {
      enrichCache[i.id] = {
        description: i.description,
        vintedCategory: i.vintedCategory,
        colorRaw: i.color?.en || "",
      };
    }
  }
  const cache = new Map(Object.entries(enrichCache));
  let sinceCheckpoint = 0;

  console.log("opening session…");
  const cookie = await openSession();
  // A separate jar: cookies are per-domain, and item detail is fetched from .co.uk.
  const detailCookie = await openSession(DETAIL_HOST);

  console.log("fetching wardrobe…");
  const raw = await fetchWardrobe(cookie);

  console.log("fetching seller feedback…");
  const seller = await fetchSeller(cookie);
  if (seller) {
    await writeJson("seller.json", seller);
    console.log(`  ${seller.rating.toFixed(1)}★ from ${seller.count} reviews`);
  }

  console.log("fetching FX rate…");
  const rate = await fxRate(await readJson("fxrate.json", null));

  const items = [];
  let enriched = 0;
  let photos = 0;

  for (const r of raw) {
    const id = String(r.id);
    // is_hidden covers drafts and items the seller has pulled from view; they are still
    // returned by the wardrobe endpoint but must not appear in the shop.
    if (r.is_hidden || r.is_draft) continue;

    // A cache entry written before breadcrumbs existed has no crumbs, and the taxonomy
    // is built from those paths. Treating it as a miss backfills the gap on an ordinary
    // run instead of forcing a --full re-enrich of everything.
    const hit = full ? null : cache.get(id);
    const cached = hit && Array.isArray(hit.crumbs) && hit.crumbs.length ? hit : null;
    let detail;
    let needsEnrich = false;
    if (cached) {
      detail = cached;
      // Cached before the Czech pass existed. One request tops it up in place rather than
      // forcing --full over the whole closet, the same way a missing crumbs array does
      // above. A failure here is not worth a warning: the item keeps its English attribute
      // words, the site falls back to them, and the next run tries again.
      if (!detail.cs) {
        try {
          detail.cs = await fetchCzech(r.url, detailCookie);
          enrichCache[id] = detail;
          if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
            await writeJson("enrich-cache.json", enrichCache);
            sinceCheckpoint = 0;
          }
          await sleep(DELAY_MS);
        } catch {
          /* next run */
        }
      }
    } else {
      process.stdout.write(`  enriching ${id} — ${r.title.slice(0, 50)}…\n`);
      try {
        detail = await fetchDetail(r.url, detailCookie);
        // Czech attribute words for the same listing — see fetchCzech. Failing this must
        // not cost the English enrichment that just succeeded, so it is caught separately.
        try {
          detail.cs = await fetchCzech(r.url, detailCookie);
          await sleep(DELAY_MS);
        } catch (err) {
          console.warn(`  ⚠ no Czech attributes for ${id}: ${err.message} — will retry next run`);
        }
        enrichCache[id] = detail;
        // Checkpoint. Without this, a failure 400 items into a cold run threw away every
        // page fetched so far — which is exactly what a Cloudflare 524 did on the first
        // run of this script. The cache is a separate file from catalog.json on purpose:
        // a half-finished run leaves the catalog untouched rather than publishing a
        // partial shop.
        if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
          await writeJson("enrich-cache.json", enrichCache);
          sinceCheckpoint = 0;
        }
      } catch (err) {
        // One unreachable item page must not cost a whole run. Keep the item — the
        // wardrobe data alone is enough to display it — and flag it so the next run
        // retries just this one rather than everything.
        console.warn(`  ⚠ could not enrich ${id}: ${err.message} — will retry next run`);
        detail = { description: "", vintedCategory: "", colorRaw: "", crumbs: [], condition: "" };
        needsEnrich = true;
      }
      enriched++;
      await sleep(DELAY_MS);
    }

    // Every photo, main one first, so the card carousel can show a whole listing without
    // sending the shopper to Vinted. Named vinted-<id>-<n>.jpg so build-images.mjs derives
    // each one and the index keeps them ordered and stable between runs.
    //
    // full_size_url, not photo.url. The latter is Vinted's "f800" rendition, which caps
    // the LONG edge at 800 — a portrait shot arrives 450x800, and build-images.mjs rightly
    // refuses to upscale, so the grid got a single 400px variant and looked soft on any
    // retina screen. full_size_url is 900x1600 for the same photo, which derives to 400 and
    // 800 — exactly the 1x and 2x a 400px grid cell wants, and no more.
    const ordered = [...(r.photos || [])]
      .sort((a, b) => (b.is_main ? 1 : 0) - (a.is_main ? 1 : 0))
      .filter((p) => !p.is_hidden)
      .slice(0, PHOTOS_PER_ITEM);
    const photoPaths = [];
    for (const [n, p] of ordered.entries()) {
      const file = `vinted-${id}-${n + 1}.jpg`;
      if (await downloadPhoto(p.full_size_url || p.url, path.join(IMG_DIR, file))) photos++;
      photoPaths.push(`images/${file}`);
    }

    const priceCzk = Number(r.price.amount);
    const category =
      overrides[id]?.category ||
      categorise(detail.vintedCategory || flatten(detail.crumbs), taxonomy.categories);

    items.push({
      id,
      title: r.title,
      priceCzk,
      priceEur: Math.round(priceCzk / rate.czkPerEur),
      brand: r.brand || "",
      size: r.size || "",
      sizeGroup: sizeGroup(r.size, taxonomy.sizes),
      // English goes through the taxonomy maps, which force Vinted's wording onto this
      // site's wording. Czech does NOT: it is Vinted's own Czech, already correct for a
      // Czech reader, and mapping it would only introduce a second vocabulary to maintain.
      // The key is absent, not empty, when the Czech fetch has not landed yet — an absent
      // key is what the translation layer reads as "fall back to English".
      condition: {
        en: translate(taxonomy.conditions, detail.condition),
        ...(detail.cs?.condition ? { cs: detail.cs.condition } : {}),
      },
      color: {
        en: translate(taxonomy.colors, detail.colorRaw),
        ...(detail.cs?.colorRaw ? { cs: detail.cs.colorRaw } : {}),
      },
      category,
      vintedCategory: detail.vintedCategory,
      // Full path from the item page's breadcrumbs, in English:
      // ["Women","Accessories","Jewellery","Necklaces"].
      crumbs: detail.crumbs || [],
      description: detail.description,
      photo: photoPaths[0] || null,
      photos: photoPaths,
      favourites: r.favourite_count || 0,
      reserved: !!r.is_reserved,
      sold: false,
      ...(needsEnrich ? { needsEnrich: true } : {}),
      featured: !!overrides[id]?.featured,
      hidden: !!overrides[id]?.hidden,
      urls: Object.fromEntries(Object.entries(STOREFRONTS).map(([k, base]) => [k, base + r.path])),
    });
  }

  // Anything that was in the last snapshot and is not in this one has left the closet —
  // sold, almost always. It drops out of the shop but is kept, because "what sells" is
  // the only inventory history this setup will ever have.
  const liveIds = new Set(items.map((i) => i.id));
  // An item that dropped out for a day and was relisted is not sold. Left in the archive it
  // rendered twice on its shelf and failed the duplicate-id guard (30 Oct 2026).
  archive.items = archive.items.filter((i) => !liveIds.has(i.id));
  const knownArchived = new Set(archive.items.map((i) => i.id));
  const soldAt = new Date().toISOString().slice(0, 10);
  let newlySold = 0;
  for (const old of previous.items) {
    if (!liveIds.has(old.id) && !knownArchived.has(old.id)) {
      // Keep everything, the outbound urls included (27 Aug 2026). They used to be
      // stripped here, on the same stale measurement that cost the sold cards their prices:
      // a sold listing was believed to 307 to a stripped page. It does not. Checked with no
      // session at all, /items/<id> answers 200 and redirects to the item's own slug URL,
      // photographs and description intact.
      archive.items.push({ ...old, sold: true, soldAt });
      newlySold++;
    }
  }

  // Items that sold before this pipeline existed. Their listing pages are gone, but the
  // Open Graph tags survive, so the real title and photo can be recovered instead of
  // invented. Fetched once each, then never again.
  const seed = await readJson("sold-seed.json", { ids: [] });
  let seeded = 0;
  for (const sid of seed.ids || []) {
    const id = String(sid);
    if (knownArchived.has(id) || liveIds.has(id)) continue;
    process.stdout.write(`  recovering sold item ${id}…\n`);
    let meta = null;
    try {
      meta = await fetchSoldMeta(id, cookie);
    } catch (err) {
      console.warn(`  ⚠ could not recover ${id}: ${err.message}`);
    }
    await sleep(DELAY_MS);
    if (!meta) continue;

    const file = `vinted-${id}-1.jpg`;
    let photoPath = null;
    try {
      if (meta.image) {
        await downloadPhoto(meta.image, path.join(IMG_DIR, file));
        photoPath = `images/${file}`;
      }
    } catch {
      // The photo may already be on disk from the pre-pipeline site; fall back to that.
      if (existsSync(path.join(IMG_DIR, file))) photoPath = `images/${file}`;
    }

    archive.items.push({
      id,
      title: meta.title,
      description: meta.description,
      // Read from the listing, which still carries it (see fetchSoldMeta). Null only when
      // the page genuinely has no price node — the card then shows "Sold" in that slot, as
      // all forty of these did until 27 Aug 2026. Converted with the same ECB rate as every
      // live item, so one currency means one thing across the whole grid.
      priceCzk: meta.priceCzk,
      priceEur: meta.priceCzk == null ? null : Math.round(meta.priceCzk / rate.czkPerEur),
      brand: "", size: "", sizeGroup: "",
      condition: { en: "", cs: "" }, color: { en: "", cs: "" },
      // A sold listing has no category left on it either, so overrides.json is the only
      // place this can come from. Unset ones land in "More" alongside anything else the
      // taxonomy has not caught up with.
      category: overrides[id]?.category || "Uncategorised", vintedCategory: "",
      photo: photoPath, photos: photoPath ? [photoPath] : [],
      favourites: 0, reserved: false,
      // The listing is still there and still worth linking to — see the note where the diff
      // archives an item. Built from the id rather than recovered from the page: Vinted
      // redirects the bare /items/<id> to the slug form itself, so the id is the durable
      // address and the slug is decoration.
      urls: Object.fromEntries(Object.entries(STOREFRONTS).map(([k, base]) => [k, `${base}/items/${id}`])),
      sold: true, soldAt: "earlier", recovered: true,
    });
    seeded++;
  }

  // BACKFILL: sold items already in the archive with no price on them.
  //
  // The forty recovered before 27 Aug 2026 were written with `priceCzk: null` under the old
  // belief that a sold listing has no price left. They are already in knownArchived, so the
  // seed loop above skips them forever and the fix above would only ever help items that
  // sell from here on. This is the one-off that repairs the back catalogue — and it costs
  // nothing on every later run, because an item is only fetched while its price is missing.
  //
  // Nothing else about the archived record is touched. Re-recovering the title or photo of
  // an item that has been on the site for weeks would churn the pages for no reason, and
  // hand edits in overrides.json would be silently overwritten by a scrape.
  // Same one-off shape as the price backfill below, and for the same reason: every item
  // archived before 27 Aug 2026 had its urls deleted on the way in, so without this they
  // would stay unlinkable forever. The id is all that is needed to rebuild them.
  let relinked = 0;
  for (const item of archive.items) {
    if (item.urls) continue;
    item.urls = Object.fromEntries(Object.entries(STOREFRONTS).map(([k, base]) => [k, `${base}/items/${item.id}`]));
    relinked++;
  }
  if (relinked) console.log(`relinked ${relinked} sold item(s) to their Vinted listings`);

  const needPrice = archive.items.filter((i) => i.recovered && i.priceCzk == null);
  if (needPrice.length) {
    console.log(`backfilling prices for ${needPrice.length} sold item(s) recovered before prices were read`);
    let filled = 0;
    for (const item of needPrice) {
      let meta = null;
      try {
        meta = await fetchSoldMeta(item.id, cookie);
      } catch (err) {
        console.warn(`  ⚠ could not read a price for ${item.id}: ${err.message}`);
      }
      await sleep(DELAY_MS);
      if (meta?.priceCzk == null) continue;
      item.priceCzk = meta.priceCzk;
      item.priceEur = Math.round(meta.priceCzk / rate.czkPerEur);
      filled++;
    }
    console.log(`  ${filled}/${needPrice.length} priced; the rest keep "Sold" in the price slot`);
  }

  items.sort((a, b) => Number(b.id) - Number(a.id)); // newest listing first

  await writeJson("catalog.json", { syncedAt: new Date().toISOString(), rate, count: items.length, items });
  await writeJson("archive.json", { items: archive.items });
  await writeJson("fxrate.json", rate);
  await writeJson("enrich-cache.json", enrichCache);

  const unmapped = items.filter((i) => i.category === "Uncategorised");
  const byCategory = {};
  for (const i of items) byCategory[i.category] = (byCategory[i.category] || 0) + 1;

  await writeCsv(items, archive.items);

  console.log(`\n${items.length} live items, ${enriched} enriched, ${photos} photos downloaded`);
  if (newlySold) console.log(`${newlySold} item(s) left the closet since last sync -> sold`);
  if (seeded) console.log(`${seeded} previously-sold item(s) recovered from sold-seed.json`);
  console.log(`${archive.items.length} sold item(s) total`);
  console.log(Object.entries(byCategory).map(([k, v]) => `  ${k}: ${v}`).join("\n"));

  // The maintenance model: you never categorise 500 items, you categorise the handful
  // whose Vinted branch is not in the rules yet, and each rule you add covers the branch
  // from then on.
  if (unmapped.length) {
    console.log(`\n⚠ ${unmapped.length} item(s) need a rule in data/taxonomy.json:`);
    const branches = [...new Set(unmapped.map((i) => i.vintedCategory || "(no category)"))];
    for (const b of branches.sort()) console.log(`   "${b}"`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
