#!/usr/bin/env node
// Local-only inventory view: inventory.html.
//
// This is the answer to "how do I see the whole closet at once". It is NOT part of the
// website — .dockerignore keeps it out of the container and robots.txt disallows it, so it
// only ever exists on this machine, reachable at http://localhost:4321/inventory.html
// while the local server is running.
//
// Because it never ships, it breaks the site's rules on purpose: the CSS and JS are inline
// so the file works even opened straight off disk, and there is no cache token to bump.
// Nothing here is subject to the site's CSP.
//
// What it is for, in order of how often you will want it:
//   1. Data-quality warnings   — what needs a taxonomy rule, what is missing a photo
//   2. Pricing review          — everything in a category, sorted by price or by age
//   3. What is not moving      — days listed against favourites
//
// The spreadsheet twin, data/catalog.csv, is written by sync-vinted.mjs for the things a
// table in a browser is bad at: pivots, bulk edits, and feeding a marketplace upload.
//
//   node scripts/build-inventory.mjs

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Vinted ids increment over time, so the id is a usable proxy for "when was this listed"
// without storing a date Vinted does not give us in the wardrobe payload.
function daysListed(id, newest, oldest, span) {
  if (span <= 0) return 0;
  return Math.round(((newest - Number(id)) / span) * 100);
}

async function main() {
  const catalog = JSON.parse(await readFile(path.join(ROOT, "data/catalog.json"), "utf8"));
  const archivePath = path.join(ROOT, "data/archive.json");
  const sold = existsSync(archivePath)
    ? JSON.parse(await readFile(archivePath, "utf8")).items
    : [];
  const live = catalog.items;
  const all = [...live.map((i) => ({ ...i, _s: i.reserved ? "reserved" : "available" })),
               ...sold.map((i) => ({ ...i, _s: "sold" }))];

  const ids = live.map((i) => Number(i.id));
  const newest = Math.max(...ids), oldest = Math.min(...ids);
  const span = newest - oldest;

  // Everything worth being told about without going looking.
  const warn = {
    "Needs a taxonomy rule": all.filter((i) => i.category === "Uncategorised"),
    "No photo": all.filter((i) => !i.photo),
    "Fewer than 3 photos": live.filter((i) => (i.photos || []).length < 3),
    "No description": all.filter((i) => !i.description),
    "Description not fetched yet": all.filter((i) => i.needsEnrich),
    "No colour recorded": live.filter((i) => !i.color?.en),
  };

  const byCat = {};
  for (const i of live) {
    const c = (byCat[i.category] ||= { n: 0, czk: 0, favs: 0 });
    c.n++; c.czk += i.priceCzk || 0; c.favs += i.favourites || 0;
  }

  const totalCzk = live.reduce((s, i) => s + (i.priceCzk || 0), 0);
  const rate = catalog.rate?.czkPerEur || 24.254;

  const rows = all.map((i) => {
    const age = i._s === "sold" ? "" : daysListed(i.id, newest, oldest, span);
    return `<tr data-status="${i._s}" data-cat="${esc(i.category)}">
      <td class="im">${i.photo ? `<img src="${esc(i.photo)}" alt="" loading="lazy">` : ""}</td>
      <td class="ti"><a href="${esc(i.urls?.cz || "#")}"${i.urls ? ' target="_blank" rel="noopener"' : ""}>${esc(i.title)}</a>
        <span class="id">${esc(i.id)}</span></td>
      <td>${esc(i.category)}</td>
      <td class="st ${i._s}">${i._s}</td>
      <td class="n" data-v="${i.priceCzk ?? -1}">${i.priceCzk != null ? `${i.priceCzk} Kč` : "—"}</td>
      <td>${esc(i.condition?.en || "—")}</td>
      <td>${esc(i.sizeGroup || "—")}</td>
      <td>${esc(i.color?.en || "—")}</td>
      <td class="n" data-v="${i.favourites || 0}">${i.favourites || 0}</td>
      <td class="n" data-v="${(i.photos || []).length}">${(i.photos || []).length}</td>
      <td class="n" data-v="${age === "" ? -1 : age}">${age === "" ? "—" : age}</td>
    </tr>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Inventory — ${live.length} live, ${sold.length} sold</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#4A4433;color:#F2EFE6;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:24px}
h1{font-size:20px;font-weight:600;margin-bottom:4px}
.sub{color:#D6CFB8;font-size:12px;margin-bottom:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:24px}
.card{background:#413C2D;border:1px solid rgba(242,239,230,.18);padding:12px}
.card b{display:block;font-size:22px;font-weight:600;color:#E8A93C}
.card span{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#D6CFB8}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;margin:24px 0 10px;color:#E8A93C}
.warn{background:#413C2D;border-left:3px solid #D3502F;padding:10px 14px;margin-bottom:8px}
.warn b{color:#D3502F}
.warn .list{color:#D6CFB8;font-size:11.5px;margin-top:6px;word-break:break-word}
.ok{color:#DCE775}
.controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
select,input{background:#413C2D;color:#F2EFE6;border:1px solid rgba(242,239,230,.25);padding:8px 10px;font:inherit}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid rgba(242,239,230,.12);vertical-align:middle}
th{background:#383426;position:sticky;top:0;cursor:pointer;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;user-select:none}
th:hover{color:#E8A93C}
th.sorted::after{content:" \\2193";color:#E8A93C}
th.sorted.asc::after{content:" \\2191"}
td.n{text-align:right;font-variant-numeric:tabular-nums}
td.im img{width:38px;height:50px;object-fit:cover;display:block}
td.ti a{color:#F2EFE6;text-decoration:none}
td.ti a:hover{color:#E8A93C;text-decoration:underline}
td.ti .id{display:block;color:#D6CFB8;opacity:.6;font-size:10px}
td.st{text-transform:uppercase;font-size:10px;letter-spacing:.05em}
td.st.sold{color:#D3502F}
td.st.reserved{color:#DCE775}
td.st.available{color:#D6CFB8}
tr:hover{background:#413C2D}
</style></head><body>
<h1>Inventory</h1>
<p class="sub">Local only — never deployed. Synced ${esc((catalog.syncedAt || "").slice(0, 16).replace("T", " "))} · 1 EUR = ${rate} CZK</p>

<div class="cards">
  <div class="card"><b>${live.length}</b><span>Live</span></div>
  <div class="card"><b>${sold.length}</b><span>Sold</span></div>
  <div class="card"><b>${live.filter((i) => i.reserved).length}</b><span>Reserved</span></div>
  <div class="card"><b>${Math.round(totalCzk / rate).toLocaleString()} €</b><span>Stock value</span></div>
  <div class="card"><b>${Math.round(totalCzk / live.length)} Kč</b><span>Avg price</span></div>
  <div class="card"><b>${live.reduce((s, i) => s + (i.favourites || 0), 0)}</b><span>Total favourites</span></div>
</div>

<h2>Attention</h2>
${Object.entries(warn).filter(([, v]) => v.length).map(([k, v]) =>
  `<div class="warn"><b>${v.length}</b> ${esc(k)}<div class="list">${
    v.slice(0, 12).map((i) => esc(i.id)).join(", ")}${v.length > 12 ? ` … +${v.length - 12} more` : ""}</div></div>`
).join("\n") || '<p class="ok">Nothing needs attention — every item is categorised, photographed and described.</p>'}

<h2>By category</h2>
<div class="cards">
${Object.entries(byCat).sort((a, b) => b[1].n - a[1].n).map(([k, v]) =>
  `<div class="card"><b>${v.n}</b><span>${esc(k)} · ${Math.round(v.czk / v.n)} Kč avg · ♥${v.favs}</span></div>`
).join("\n")}
</div>

<h2>All items</h2>
<div class="controls">
  <input id="q" type="search" placeholder="Filter by title or id…" autocomplete="off">
  <select id="st"><option value="">All statuses</option><option>available</option><option>reserved</option><option>sold</option></select>
  <select id="ct"><option value="">All categories</option>${
    Object.keys(byCat).sort().map((c) => `<option>${esc(c)}</option>`).join("")}</select>
  <span id="n" style="align-self:center;color:#D6CFB8"></span>
</div>
<table id="t">
<thead><tr>
  <th data-t="s"></th><th data-t="s">Title</th><th data-t="s">Category</th><th data-t="s">Status</th>
  <th data-t="n">Price</th><th data-t="s">Condition</th><th data-t="s">Size</th><th data-t="s">Colour</th>
  <th data-t="n">♥</th><th data-t="n">Photos</th><th data-t="n">Age</th>
</tr></thead>
<tbody>
${rows}
</tbody></table>

<script>
(function(){
  var tb=document.querySelector('#t tbody'),rows=[].slice.call(tb.rows);
  var q=document.getElementById('q'),st=document.getElementById('st'),ct=document.getElementById('ct'),n=document.getElementById('n');
  function filter(){
    var term=q.value.toLowerCase(),s=st.value,c=ct.value,shown=0;
    rows.forEach(function(r){
      var ok=(!s||r.dataset.status===s)&&(!c||r.dataset.cat===c)&&
             (!term||r.cells[1].textContent.toLowerCase().indexOf(term)!==-1);
      r.style.display=ok?'':'none'; if(ok)shown++;
    });
    n.textContent=shown+' of '+rows.length;
  }
  [q,st,ct].forEach(function(el){el.addEventListener('input',filter);el.addEventListener('change',filter);});
  filter();
  [].slice.call(document.querySelectorAll('#t th')).forEach(function(th,i){
    var asc=false;
    th.addEventListener('click',function(){
      asc=!asc;
      [].slice.call(document.querySelectorAll('#t th')).forEach(function(o){o.className='';});
      th.className='sorted'+(asc?' asc':'');
      var num=th.dataset.t==='n';
      rows.sort(function(a,b){
        var x=num?+a.cells[i].dataset.v:a.cells[i].textContent.trim().toLowerCase();
        var y=num?+b.cells[i].dataset.v:b.cells[i].textContent.trim().toLowerCase();
        return (x<y?-1:x>y?1:0)*(asc?1:-1);
      });
      rows.forEach(function(r){tb.appendChild(r);});
    });
  });
})();
</script>
</body></html>
`;

  await writeFile(path.join(ROOT, "inventory.html"), html);
  const issues = Object.values(warn).reduce((s, v) => s + v.length, 0);
  console.log(`inventory.html: ${live.length} live, ${sold.length} sold, ${issues} item(s) flagged`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
