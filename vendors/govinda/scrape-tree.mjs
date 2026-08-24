// Fetch Govinda's category tree. Each PrestaShop category page carries a BreadcrumbList
// in JSON-LD, which is the only place the parent/child relationship is stated — the URLs
// are flat (/23-dhoti), so the hierarchy cannot be derived from paths alone.
//
// 139 categories at 1 request / 2s. Authorised reseller sync; robots.txt permits these paths.
import { writeFile } from "node:fs/promises";

const UA = "IndianInPrague-reseller/1.0 (+https://guldaarbazaar.com; authorised reseller sync)";
const DELAY = 2000;
const SITEMAP = "https://govindashop.cz/1_cs_0_sitemap.xml";

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

const locs = (xml) => [...xml.matchAll(/<loc><!\[CDATA\[(.*?)\]\]><\/loc>/g)].map((m) => m[1]);

// Products are /<slug>/<id>-<slug>.html or /<id>-<slug>.html; categories are /<id>-<slug>.
const isCategory = (u) => /^https:\/\/govindashop\.cz\/\d+-[^/.]+$/.test(u);

function breadcrumb(html) {
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    let j;
    try { j = JSON.parse(m[1]); } catch { continue; }
    if (j["@type"] === "BreadcrumbList") {
      return j.itemListElement
        .sort((a, b) => a.position - b.position)
        .map((e) => ({ name: e.name, url: e.item }))
        .filter((e) => e.name !== "Domů");
    }
  }
  return null;
}

const xml = await get(SITEMAP);
const cats = locs(xml).filter(isCategory);
console.error(`${cats.length} categories`);

const out = [];
for (const [i, url] of cats.entries()) {
  const html = await get(url);
  const path = html && breadcrumb(html);
  const id = Number(url.match(/\/(\d+)-/)[1]);
  out.push({ id, url, path: path || [], depth: path ? path.length : 0 });
  console.error(`${i + 1}/${cats.length} ${path ? path.map((p) => p.name).join(" > ") : "NO BREADCRUMB " + url}`);
  await sleep(DELAY);
}

await writeFile("vendors/govinda/data/categories.json", JSON.stringify(out, null, 2));
console.error("wrote vendors/govinda/data/categories.json");
