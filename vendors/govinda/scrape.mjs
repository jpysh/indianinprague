// Scrape Govinda product listings into data/products-raw.json.
//
// Authorised reseller sync, confirmed by the vendor in writing. robots.txt permits these
// paths; 1 request / 2s, single-threaded, honest User-Agent naming the site.
//
// This file is DISPOSABLE OUTPUT: the weekly run rewrites it wholesale. Nothing hand-edited
// belongs here — that lives in data/overrides.json, keyed by SKU, and is applied on top at
// build time. It is the only arrangement that survives a product being removed and coming
// back, or a SKU changing.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const UA = "IndianInPrague-reseller/1.0 (+https://guldaarbazaar.com; authorised reseller sync)";
const DELAY = 2000;
const SITEMAP = "https://govindashop.cz/1_cs_0_sitemap.xml";
const OUT = "vendors/govinda/data/products-raw.json";

const limit = Number(process.argv[2]) || Infinity; // `node scrape.mjs 20` for the pilot
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "cs" } });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
    } catch {}
    await sleep(5000);
  }
  throw new Error("failed: " + url);
}

// PrestaShop emits a Product node per page. Price, availability and images all come from
// it rather than from the rendered markup: the markup is themed and changes, the JSON-LD
// is generated and does not.
function parse(html, url, categoryBySlug) {
  let product = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      if (j["@type"] === "Product") product = j;
    } catch {}
  }
  if (!product) return null;

  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  // Their own description carries markup and non-breaking spaces from the CMS editor.
  const text = (s) =>
    (s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/\s+/g, " ").trim();

  // Photos come from the gallery markup, NOT from the JSON-LD: the Product node carries
  // only the first image, and products have between one and three (measured across a
  // sample spanning the catalogue). So up to three where three exist — several products
  // simply do not have that many, and inventing them is not an option.
  //
  // thickbox_default is the largest size PrestaShop renders here. home_default, which the
  // JSON-LD points at, is a thumbnail and too small for the 800px grid derivative.
  const images = [...new Set(
    [...html.matchAll(/data-image-large-src="([^"]+)"/g)].map((m) => m[1]),
  )].slice(0, 3);

  return {
    sku: String(product.sku || product.productID || url.match(/\/(\d+)-/)?.[1] || ""),
    url,
    // Product URLs carry the category slug WITHOUT its id (/bavlna/490-…), while category
    // URLs carry both (/243-bavlna). Matching on the slug is what joins the two.
    categoryId: categoryBySlug.get(url.replace("https://govindashop.cz/", "").split("/")[0])?.id ?? null,
    categorySlug: url.replace("https://govindashop.cz/", "").split("/")[0],
    titleCs: text(product.name),
    descriptionCs: text(product.description),
    brand: product.brand?.name || "",
    // Their prices include 21% VAT. priceCzk is what a customer pays THEM; what a customer
    // pays us is computed at build time from markup_pct, and is not stored here.
    priceCzk: Number(offer?.price) || null,
    currency: offer?.priceCurrency || "CZK",
    // PrestaShop reports InStock/OutOfStock. Never a quantity — that needs the API, which
    // we do not have.
    availability: (offer?.availability || "").replace("https://schema.org/", ""),
    images,
    scrapedAt: new Date().toISOString(),
  };
}

// Slug -> category, so each product lands on a shelf. Built from the scraped tree.
const categoryBySlug = new Map(
  JSON.parse(readFileSync("vendors/govinda/data/categories-en.json", "utf8"))
    .map((c) => [c.url.split("/").pop().replace(/^\d+-/, ""), c]),
);

const xml = await get(SITEMAP);
const products = [...xml.matchAll(/<loc><!\[CDATA\[(.*?)\]\]><\/loc>/g)]
  .map((m) => m[1])
  .filter((u) => /\/\d+-[^/]+\.html$/.test(u))
  .slice(0, limit);

console.error(`${products.length} product pages`);

// Resume rather than restart: a run that dies at product 900 must not throw away 900 pages.
const out = existsSync(OUT) && limit === Infinity ? JSON.parse(readFileSync(OUT, "utf8")) : {};
let done = 0, failed = 0;
for (const url of products) {
  if (out[url]) continue;
  const html = await get(url);
  const p = html && parse(html, url, categoryBySlug);
  if (!p) { failed++; console.error(`  no Product node: ${url}`); }
  else { out[url] = p; done++; }
  if (done % 25 === 0) writeFileSync(OUT, JSON.stringify(out, null, 2));
  process.stderr.write(`\r  ${done + failed}/${products.length}`);
  await sleep(DELAY);
}
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.error(`\nwrote ${OUT}: ${Object.keys(out).length} products, ${failed} without a Product node`);
