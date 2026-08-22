#!/usr/bin/env node
// The inventory dashboard: the page where stock decisions are made.
//
//   node scripts/inventory.mjs        → http://localhost:4380
//
// WHY THIS IS A SERVER AND NOT A FILE
// A page opened from disk cannot write to disk, and the whole point of this one is that it
// writes: marking something sold, overriding a price, correcting a shelf the vendor filed
// wrongly. The alternatives were a browser API that only Chrome implements and re-asks
// permission every session, or copying a command out of the page and pasting it into a
// terminal. Forty lines of server is cheaper than either and works in any browser.
//
// LOCAL ONLY. It binds 127.0.0.1, it is never staged into dist/, and it is the only thing
// in this repo that writes vendors/govinda/data/overrides.json.
//
// IT DOES NOT DEPLOY. There is no publish button, deliberately: the marks are the point of
// the page, and a half-finished checklist that deploys itself is worse than one that waits.
// The nightly job carries whatever is saved. The page says so, and says the command.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, createReadStream } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 4380;
const OVERRIDES = path.join(ROOT, "vendors/govinda/data/overrides.json");

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);

// Minimal CSV reader — this file writes the CSV it reads, so the shapes it must survive are
// known: quoted fields with embedded commas and doubled quotes.
function rows(text) {
  const out = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

function inventory() {
  const overrides = readJson(OVERRIDES, {});
  const changes = readJson(path.join(ROOT, "vendors/govinda/data/changes.json"), { added: [], price: [], stock: [], gone: [] });
  const manifest = readJson(path.join(ROOT, "images/derived/manifest.json"), {});

  const csv = readFileSync(path.join(ROOT, "vendors/govinda/data/listings.csv"), "utf8").replace(/^﻿/, "");
  const [head, ...body] = rows(csv);
  const col = Object.fromEntries(head.map((h, i) => [h, i]));

  const thumb = (photo) => {
    const e = manifest[photo];
    return e ? "/" + e.variants[0].jpg + (e.v ? `?v=${e.v}` : "") : "";
  };

  const govinda = body.filter((r) => r.length > 1 && r[col.sku]).map((r) => {
    const sku = r[col.sku];
    const o = overrides[sku] || {};
    return {
      vendor: "Govinda",
      sku,
      title: r[col.title],
      shelf: r[col.shelf],
      sub: r[col.subcategory],
      priceEur: Number(r[col.price_eur]) || 0,
      vendorCzk: Number(r[col.price_czk_vendor]) || 0,
      listed: r[col.list] === "yes",
      stock: r[col.availability],
      sold: o.sold || "",
      priceOverride: o.price_eur ?? "",
      thumb: thumb(`images/govinda-${sku}-1.jpg`),
    };
  });

  // Vinted is read-only here: sold is detected from the closet, and nothing on this page
  // could change it. It is present so the dashboard is the whole inventory rather than half.
  const cat = readJson(path.join(ROOT, "data/catalog.json"), { items: [] });
  const vinted = cat.items.map((i) => ({
    vendor: "Vinted",
    sku: i.id,
    title: i.title,
    shelf: i.category,
    sub: i.subcategory || "",
    priceEur: i.priceEur ?? 0,
    vendorCzk: i.priceCzk ?? 0,
    listed: true,
    stock: i.sold ? "sold" : "in stock",
    sold: i.sold ? i.soldAt || "yes" : "",
    priceOverride: "",
    readOnly: true,
    thumb: thumb(i.photo),
  }));

  return { items: [...govinda, ...vinted], changes };
}

const PAGE = readFileSync(path.join(ROOT, "scripts/inventory-page.html"), "utf8");

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "POST" && url.pathname === "/api/save") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const patch = JSON.parse(body);
        const overrides = readJson(OVERRIDES, {});
        for (const [sku, fields] of Object.entries(patch)) {
          overrides[sku] = { ...(overrides[sku] || {}), ...fields };
          // An empty value means "no override", not "override with nothing" — otherwise
          // clearing a price box would pin the price to an empty string forever.
          for (const [k, v] of Object.entries(overrides[sku])) {
            if (v === "" || v === null) delete overrides[sku][k];
          }
          if (!Object.keys(overrides[sku]).length) delete overrides[sku];
        }
        writeFileSync(OVERRIDES, JSON.stringify(overrides, null, 2) + "\n");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, count: Object.keys(patch).length }));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    });
    return;
  }

  if (url.pathname === "/api/inventory") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(inventory()));
    return;
  }

  // Derived images, so the dashboard shows what the shop shows.
  if (url.pathname.startsWith("/images/derived/")) {
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (existsSync(file)) {
      res.writeHead(200, { "content-type": url.pathname.endsWith(".webp") ? "image/webp" : "image/jpeg" });
      createReadStream(file).pipe(res);
      return;
    }
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`inventory dashboard → http://localhost:${PORT}`);
  console.log("writes vendors/govinda/data/overrides.json — nothing else, and never deploys");
});
