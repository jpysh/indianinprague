# indianinprague.jains.es — deployment

Static site **built** on this Mac and **hosted** on Cloudflare, as a static-assets-only
Worker. Everything below the "Shape" heading still describes the build; what changed on
15 Aug 2026 is only where the output lands.

**Live:** https://indianinprague.jains.es
**Local preview:** `./node_modules/.bin/wrangler dev` (serves `dist/` exactly as the edge will)

---

## Hosting: Cloudflare, not Docker (15 Aug 2026)

nginx, the `cloudflared` tunnel and the two containers are gone. The site is ~1,940 static
files with no server-side behaviour — `assets/shop.js` filters client-side against JSON
that is already on disk — so there was nothing for an origin to do. The free tier covers it
with room to spare: 20,000 files per version (we use 1,941), 25 MiB per file (largest
derivative is 0.59 MiB), unmetered bandwidth. There is no Worker *script* — `wrangler.jsonc`
declares assets and no `main` — so nothing draws on the 100k/day request budget.

### Why Workers Static Assets and not Cloudflare Pages

Pages was the obvious choice and was configured first. It force-redirects `/wardrobe.html`
to `/wardrobe` with a 308, and that behaviour cannot be turned off. This site links every
page as `href="wardrobe.html"`, `sitemap.xml` lists `.html` URLs, and every page carries a
`<link rel="canonical">` pointing at its own `.html` form — so on Pages a crawler fetches
`/wardrobe.html`, gets bounced to `/wardrobe`, and is then told by the page that the
canonical URL is `/wardrobe.html`. Contradictory signals on every page, plus a redirect hop
on every internal click. nginx served both forms at 200.

Workers Static Assets exposes `html_handling`, so `"none"` keeps every URL byte-identical to
what has been indexed for months. Same free limits, same `_headers` and `_redirects`
support, no markup churn. The one cost: `"none"` also stops `/` mapping to `index.html` by
itself, which is why `edge/_redirects` carries an explicit `/ → /index.html 200` **rewrite**
(status 200, not 301 — the homepage must not redirect).

What this buys, beyond one less moving part: the site no longer goes down when this Mac
sleeps, and it is served from Cloudflare's edge rather than through a tunnel back to a
laptop in a flat.

### What could NOT move, and why

The daily job stays here. Four independent reasons, any one of which is decisive:

- **ImageMagick.** `build-images.mjs` shells out to `magick` and `cwebp`. Workers run V8
  isolates — no native binaries, no `child_process`.
- **Subrequests.** A Worker invocation gets 50 on the free plan. `sync-vinted.mjs` makes one
  wardrobe call plus a ~2 MB HTML fetch *per new item*, plus a download per photo. A cold
  run is ~500 item pages over ~12 minutes.
- **DataDome.** The anonymous-token handshake in `openSession()` works because it comes from
  a residential IP with a browser UA. From a Cloudflare or GitHub Actions datacenter range
  it gets challenged. This is the one that cannot be engineered around, and it is the same
  reason the fetch happens at build time rather than from a visitor's browser.
- **The originals.** 408 MB in `images/` that the derivatives are generated from, existing
  only on this disk.

So: **hosting is Cloudflare's, building is ours.** No Docker is involved any more — node,
magick, cwebp and wrangler are all native, driven by launchd at 07:15.

### Why the build is NOT containerised

It was considered and rejected. The pipeline's untrusted inputs are Vinted's item HTML and
the photos it downloads, and the risky operation is ImageMagick parsing those bytes — a real
risk, but one a container addresses badly here:

- The build's *output* is what gets published, and it needs this directory mounted to do its
  job. A container would protect the host from a process whose legitimate function is to
  write the files that go live. That is host safety, not **site** safety.
- `wrangler` needs the deploy token and network egress regardless, so the credential ends up
  inside the container anyway.
- A launchd job at 07:15 that requires Docker Desktop to be awake reintroduces the exact
  failure mode this migration removed.

Two facts made the trade easy: every script under `scripts/` imports **only `node:`
builtins** (zero npm dependencies, so no supply chain), and the photos ImageMagick processes
are the author's own uploads coming back from Vinted, not arbitrary files.

Three cheaper controls were applied instead, and they close more of the real risk:

1. **The Cloudflare credential never goes in the launchd plist** — that file lives in
   `scripts/` and its `EnvironmentVariables` are readable by anything that can read the repo.
   `publish.sh` takes whichever of these it finds:
   - a scoped API token in the macOS Keychain (`Workers Scripts:Edit`, this account only),
     added with `security add-generic-password -a "$USER" -s indianinprague-cf-token -w`.
     Tighter: it cannot touch DNS, the zone or the other tunnels, so the worst case if it
     leaks is a defaced site rather than a lost domain.
   - otherwise the browser session from `wrangler login`. Much easier to set up, broader
     access. Chosen deliberately for a personal site; swapping in the token later needs no
     code change, just the one `security` command above.
2. **`wrangler` is pinned exactly and lockfiled**, and invoked as
   `./node_modules/.bin/wrangler` — never `npx wrangler`, which resolves the latest version
   from the npm registry at run time and would execute it unattended with that token in the
   environment. `package.json` exists for this single purpose. Upgrade deliberately with
   `npm install --save-dev --save-exact wrangler@<version>`.
3. **ImageMagick has a policy** at `~/.config/ImageMagick/policy.xml`, where it survives
   `brew upgrade`. It was `Policy: Undefined` (fully permissive) before. Delegates are off
   entirely, and the network/scripting/Ghostscript coders are denied by coder rather than by
   extension, since a crafted file selects its coder by content. Verified: a remote URL now
   fails *before* any network request, where previously it fetched to a temp file first.

If isolation is ever wanted, the right split is by trust, not by process: run **sync + image
derivation** in a container with *no credentials*, and keep **deploy** on the host with the
token, so untrusted input never meets the secret.

### The three files that replaced nginx

| Was | Now |
|---|---|
| `nginx/security-headers.conf` + per-location `add_header` | `edge/_headers` |
| `location = /shop.html { return 301 ... }` | `edge/_redirects` |
| `Dockerfile`'s `COPY` list (what is public) | `scripts/build-dist.mjs` → `dist/` |
| `listen` / `root` / `index` / 404 handling | `wrangler.jsonc` |

The `/404.html` fallback is `not_found_handling: "404-page"`. `try_files $uri $uri.html` has
deliberately **not** been replaced: extensionless URLs like `/clothes` no longer resolve.
Nothing in the markup, sitemap or any canonical tag ever used them — they existed only for
hand-typed URLs — and restoring them would serve every page at two live URLs, which is the
duplicate-content problem the `.html` decision above exists to avoid. The one extensionless
path ever published, `/shop`, is redirected explicitly.

**`dist/` is not cosmetic.** Pointing the asset server at the repo root would have uploaded `scripts/`,
`data/`, `nginx/`, `.sync.log` and 408 MB of camera originals. `build-dist.mjs` is now the
single definition of what is public, and it asserts that — it throws if `scripts/`, `data/`
or `inventory.html` reach the staging directory.

**`inventory.html` is no longer published.** The Dockerfile's `COPY *.html` glob had been
quietly shipping the internal stock-taking view to the live site. It is withheld from
`dist/` and opened locally instead.

---

## Shape

```
visitor ──https──▶ Cloudflare edge ──▶ static assets (dist/, uploaded by wrangler)

this Mac, 07:15 daily (launchd):
  vinted.cz ──▶ sync-vinted ──▶ build-images (magick/cwebp) ──▶ build-* ──▶ dist/ ──▶ wrangler deploy
```

> **Superseded 15 Aug 2026.** The two containers below (`indianinprague-site` running
> nginx, `indianinprague-tunnel` running cloudflared) and the `Dockerfile`,
> `docker-compose.yml`, `nginx/` and `.cloudflared/` files that define them are no longer
> used. They are kept until the Cloudflare deployment has run unattended for a few days,
> then deleted. Nothing in the daily job touches Docker. The historical description is
> retained below because the tunnel-and-nginx arrangement is referenced further down this
> document.

| Container | Image | Role |
|---|---|---|
| `indianinprague-site` | built from `Dockerfile` | nginx serving the HTML + images on :8080, published to the host as :8092 |
| `indianinprague-tunnel` | `cloudflare/cloudflared:latest` | holds the tunnel open, forwards to `indianinprague-site:8080` |

The tunnel reached the site **by compose service name**, not through the published host
port. 8092 existed purely so you could `curl` the origin without going out to Cloudflare and
back. The tunnel container waited on the site's Docker health check before registering, so
the hostname was never live while the origin would still 502.

### Cloudflare

| | |
|---|---|
| Tunnel name | `indianinprague-jains-es` |
| Tunnel UUID | `423c232e-37cf-48f5-9243-04bcdd2a0bc5` |
| Credentials | `/Users/webserver/.cloudflared/423c232e-37cf-48f5-9243-04bcdd2a0bc5.json` (mode 0400) |
| DNS | `indianinprague.jains.es` CNAME → `<uuid>.cfargotunnel.com`, proxied |
| Ingress | `.cloudflared/indianinprague.docker.yml` |

This is deliberately its **own** tunnel rather than an extra ingress rule on the shared
`jains-es` tunnel. That one is run by the launchd agent `com.jains.cloudflared` and already
carries jains.es and ayurveda.jains.es — editing it would put two live sites through a
restart to publish a third. This stack starts and stops on its own. Same reasoning as
`/Users/webserver/code/OliveUIndia`, which is the closest model for this setup.

The container mounts only that one credentials file, **never** `~/.cloudflared/cert.pem`.
cert.pem is account-wide authority over every tunnel and DNS record on `jains.es`; a static
site's web server has no business holding it. This is also why the ingress file names the
tunnel by UUID rather than by name — name lookup is what would require cert.pem.

---

## Everyday operations

### The shop: adding a product

**List it on Vinted, then run this. There is nowhere else to type it.**

```bash
./scripts/publish.sh
```

That is the whole procedure. The script syncs the closet, derives the new photos, rebuilds
every shop page, regenerates the structured data and sitemap, bumps the cache token,
rebuilds the container and pings IndexNow — in that order, for reasons documented at the
top of the script.

Useful variants:

```bash
./scripts/publish.sh --local    # rebuild and inspect locally, no deploy, no IndexNow
./scripts/publish.sh --full     # re-fetch every item's description (after a taxonomy change)
```

**What is generated and must not be hand-edited:** `shop.html`, `home-decor.html`,
`jewellery.html`, `spirituality.html`, `wellness.html`, `books.html`, `more.html`, and
`data/catalog.json` / `archive.json` / `fxrate.json` / `enrich-cache.json`.

**What is hand-written and safe to edit:** `index.html` and `clothes.html`. The generator
only replaces the region between `<!-- SHOP:GRID:START -->` and `<!-- SHOP:GRID:END -->` in
those two files — the hero, the block-print manifesto and the handloom guide are yours.
`clothes.html` is the Fashion category page and keeps its URL because it holds the site's
existing rankings; do not rename it.

**The two files you actually maintain** live in `data/`:

- `taxonomy.json` — maps Vinted's Czech category strings onto your categories. Longest
  prefix wins, so one rule covers a whole branch. You only ever add a rule when a sync run
  ends with `⚠ N item(s) need a rule in data/taxonomy.json` and lists the branch. That is
  the entire maintenance model: you categorise exceptions, not items.
- `overrides.json` — per-item curation keyed on the Vinted id: `category` (for Spirituality
  and Wellness, which have no Vinted equivalent), `featured` (pin to the homepage strip),
  `hidden` (keep on Vinted, off this site).

### It runs itself, once a day

A launchd agent runs `publish.sh` at **07:15** daily — early enough to pick up that day's
ECB rate, which is published on CET working mornings.

```bash
tail -50 /Users/webserver/code/indianinprague/.sync.log
```

```bash
launchctl unload ~/Library/LaunchAgents/com.jains.indianinprague-sync.plist
```

The source of truth for the agent is `scripts/com.jains.indianinprague-sync.plist`; the
copy in `~/Library/LaunchAgents/` is what actually runs. It sets an explicit `PATH`
because launchd's default has neither node, docker nor ImageMagick on it.

### Sold pieces

Sold items stay on the site, desaturated with a SOLD badge — proof that things sell. They
also get their own page, `sold.html`, and an Available/Sold toggle on every shop page.

**Availability is the primary sort key everywhere**, ahead of age, price and favourites: a
sold piece appears in the grid but never above something a visitor can buy. Otherwise a
piece that sold last week takes the top slot under "Newest first", and "price low to high"
leads with something unbuyable. The rule is applied twice on purpose — in `build-shop.mjs`
for the server-rendered order that no-JS visitors and crawlers get, and in `shop.js` for
the other sort modes.

Three things about them are deliberate and not bugs:

- **A sold card is not a link.** Vinted 307s a sold listing to a page with its structured
  data stripped out, so every one of those links would be a dead end.
- **Sold cards show no price.** Vinted deletes it along with the size, colour and
  condition. An invented number would misstate what a piece actually fetched.
- **Sold history only accumulates forwards.** Vinted has no "what did this member sell"
  endpoint — the wardrobe API ignores every status filter tried. The only way to know
  something sold is to notice it vanish between two syncs, which is exactly what the diff
  in `sync-vinted.mjs` does. `data/sold-seed.json` covers the seven that sold before this
  pipeline existed; their titles and photos were recovered from the Open Graph tags, which
  do survive on a sold page.

Because sold items lose their category too, theirs is set by hand in `overrides.json`.

### Photographs

Three per listing (`PHOTOS_PER_ITEM` in `sync-vinted.mjs`), which the card shows in a
swipeable carousel. Only the first ships as markup — the other two are described by a
compact `data-shots` attribute and built by `shop.js` the first time someone touches or
hovers the card, which keeps `shop.html` at 72 KB gzipped instead of megabytes.

Product photos derive to **400 and 800 only**, at a lower quality than the editorial
images. That is not a rounding-down: the grid cell is 400 CSS pixels, and while the wider
variants existed a DPR-3 phone computed 335 × 3 and downloaded a **437 KB** image to fill a
thumbnail. See the comments in `build-images.mjs`, including the two things tried that did
*not* help, so nobody repeats them.

A first visit to `shop.html` — 157 items — costs about **170 KB**: 72 KB of gzipped HTML,
13 KB of CSS, 4 KB of JS, a 9 KB font and three eager photographs. The other 154 photos are
lazy and cost nothing until scrolled to; cards past the first 24 are hidden, so their images
are never even requested.

### Seeing the whole closet

```bash
open http://localhost:4321/inventory.html
```

`inventory.html` is generated by every build and **never deployed** — `.dockerignore` keeps
it out of the container and `robots.txt` disallows it. Stock value, per-category averages,
a sortable and filterable table of every SKU, and a warnings panel for anything missing a
category, a photo or a description.

`data/catalog.csv` is written on every sync for what a browser table is bad at: pivots,
pricing reviews, and feeding a bulk upload to the next marketplace. It opens with a BOM so
Excel and Numbers read the Czech diacritics correctly.

### How the sync works, and what breaks it

Two Vinted endpoints, because neither is sufficient alone:

| | endpoint | gives |
|---|---|---|
| cheap, every run | `/api/v2/wardrobe/<user>/items` | title, price, size, brand, condition, photos, favourites |
| expensive, once per item | `/items/<id>-<slug>` (HTML) → JSON-LD | description, category, colour |

A cold run over 150 items takes ~5 minutes; a run that finds nothing new makes two
requests and finishes in seconds, because descriptions are cached in
`data/enrich-cache.json` and checkpointed every 20 items. That checkpoint exists because
the first run of this script died on a Cloudflare `524` two-thirds of the way through and
lost everything it had fetched.

Things that will break it, and the symptom:

- **`no access_token_web in homepage response`** — Vinted changed its session flow. The API
  is 401 without the anonymous bearer the homepage sets as a cookie; there is no login
  here and no credential in this repo.
- **Repeated 429/403** — rate limited. The script already waits 1.5s between item pages and
  backs off three times; if it persists, wait a few hours rather than lowering `DELAY_MS`.
- **`data/taxonomy.json is missing`** — it is not optional; the sync refuses to guess.

Note the site never calls Vinted at request time. Visitors read a JSON snapshot that is
already on disk, so Vinted rate-limiting us cannot take the shop down — it only means the
catalog is a day stale.

### Deploy an HTML-only change

```bash
cd /Users/webserver/code/indianinprague && docker compose up -d --build
```

The image bakes the files in, so a rebuild is required — editing on disk alone changes
nothing. Rebuilds take a couple of seconds and the tunnel stays connected across them.

**If you touched anything under `assets/`, bump the cache token first:**

```bash
node scripts/bump-assets.mjs && docker compose up -d --build
```

This is not optional. The stylesheets are served `immutable` for a year, and Cloudflare
caches them at the edge — a CSS change without a bump will sit invisible behind
`cf-cache-status: HIT`. The script rewrites `?v=N` on every `<link>` in every page, which
changes the cache key so the release reaches everyone immediately. See the note in
`nginx/indianinprague.conf`; this is a mistake that has already been made once here.

**After adding or replacing a photo** in `images/`, regenerate the derivatives first —
the pages reference `images/derived/`, never the originals:

```bash
node scripts/build-images.mjs && docker compose up -d --build
```

Then hand-write the `<picture>` block for the new photo, copying the shape of an existing
one (`<source type="image/webp" srcset="… 400w, … 800w" sizes="…">` plus an `<img>` with
the same `srcset`, `width`, `height` and an `alt`). `build-images.mjs` writes
`images/derived/manifest.json` with each file's dimensions and available widths.

**After adding, removing or repricing a garment** in `clothes.html`, regenerate the
structured data — it is scraped from the markup so the two cannot drift:

```bash
node scripts/build-jsonld.mjs && docker compose up -d --build
```

Check the origin without involving Cloudflare:

```bash
curl -sI http://localhost:8092/ | head -1
```

Check what the public actually gets:

```bash
curl -sI https://indianinprague.jains.es/ | head -1
```

Watch the logs:

```bash
docker compose logs -f
```

Stop / start the whole stack:

```bash
cd /Users/webserver/code/indianinprague && docker compose down
```

Note that the watchdog (below) will bring it back within five minutes. To take the site
down deliberately, unload the launchd agent first.

---

## Staying up

Supervision is NOT per-project any more. This site is one row in a shared manifest:

    /Users/webserver/code/Ops/sites.conf     the six sites on this Mac
    /Users/webserver/code/Ops/sitectl.sh     the supervisor
    com.ops.sitectl                          the single launchd agent (login + every 5 min)

```bash
/Users/webserver/code/Ops/sitectl.sh status
```

The old per-project agent (`com.indianinprague.dockercompose`) and its `scripts/ensure-up.sh`
were retired on 2026-08-05 and live in `Ops/retired/`. Do not re-add a watchdog here — it
would be the third supervisor to have existed for this one container.

Why polling exists at all: on 2026-08-04 Docker Desktop restarted and every container on
the host stopped with exit 0. `restart: unless-stopped` did not bring them back. See
`Ops/README.md`.

---

## Layout

```
├── *.html                  the site — hand-written; no inline <style>, no JavaScript
├── assets/
│   ├── site.css            the shared shell: palette, header, footer, grids, buttons
│   ├── index|clothes|restaurants|diaries|article|404.css   per-page rules
│   ├── fonts.css           @font-face for the self-hosted IBM Plex Mono
│   └── fonts/*.woff2       latin + latin-ext subsets, weights 300/400/500/600 + 400 italic
├── images/                 camera originals — kept as the archive, NOT served
├── images/derived/         what the site actually serves: WebP + JPEG at 400/800/1200/1600
│                           plus manifest.json (dimensions per source)
├── robots.txt llms.txt     crawler files, hand-maintained
├── sitemap.xml             GENERATED by scripts/build-sitemap.mjs — do not hand-edit
├── <32-hex>.txt            IndexNow key; must stay reachable or submissions are rejected
├── 404.html                served by nginx's error_page, styled to match
├── Dockerfile              nginx:alpine + the files; no build step, the pages ARE the source
├── docker-compose.yml      site + tunnel
├── nginx/
│   ├── indianinprague.conf     vhost: routing, caching, gzip, /healthz
│   └── security-headers.conf   CSP and friends, included per-location (see the note in it)
├── .cloudflared/
│   └── indianinprague.docker.yml   tunnel ingress (mounted read-only into the container)
└── scripts/
    ├── build-images.mjs                   regenerates images/derived/ (idempotent)
    ├── build-jsonld.mjs                   regenerates the JSON-LD from the markup
    ├── bump-assets.mjs                    bumps the ?v= cache token on every stylesheet link
    ├── build-sitemap.mjs                  regenerates sitemap.xml incl. image entries
    ├── indexnow.mjs                       pushes URLs to Bing / Seznam / Yandex
    └── (supervision lives in /Users/webserver/code/Ops — see Ops/README.md)
```

Note that `images/` (23 MB of originals) is deliberately **not** copied into the container
— only `images/derived/` (7 MB) is. Keep the originals: they are the source the
derivatives are regenerated from, and re-encoding from a derivative would compound the
loss.

---

## Performance, SEO and privacy

What the optimisation pass changed, and why each piece matters:

**Images.** Every photo was being served straight off the camera — `IMG_5564.JPG` at
3.4 MB into a box a few hundred pixels wide. `scripts/build-images.mjs` derives WebP and
JPEG at 400/800/1200/1600 and the markup picks between them with `<picture>` + `srcset` +
`sizes`. A phone now pulls the 400px WebP: 17 KB instead of 3.4 MB for that image. EXIF is
stripped in the process, which also removes the GPS coordinates phone photos carry.

**CSS.** Five near-identical inline `<style>` blocks became `assets/site.css` plus a small
per-page file. The shared sheet is fetched once (5 KB gzipped) and cached for the rest of
the visit, so pages two onward are ~2–6 KB of HTML and nothing else.

**Fonts.** IBM Plex Mono is served from `assets/fonts/` instead of fonts.googleapis.com.
That removes a render-blocking round trip to a third party before any text could paint,
and it removes the last origin that saw a visitor's IP. Only latin and latin-ext ship
(the copy is English and Czech); `unicode-range` is preserved so latin-ext downloads only
when a character like `č` actually appears.

**Mobile.** The layout is mobile-first — unprefixed rules are the phone, `min-width`
queries add the wider layouts. Three real bugs were fixed: the nav was
`display:none` below 640px with nothing replacing it (a phone had *no* navigation), the
brand wrapped out of the fixed-height header bar, and `.expo` carried `white-space:nowrap`
so its text ran off the right edge at 375px. Tap targets are 44px, and there is no
horizontal scroll on any page.

**SEO.** Every page has a canonical URL, full Open Graph and Twitter card meta, and a
schema.org JSON-LD graph — `WebSite`+`Person` on the home page, an `ItemList` of `Product`
nodes with CZK prices on the wardrobe, `Review`+`Restaurant` nodes on the restaurants
page, `Article` on the dispatch, `BreadcrumbList` throughout.
`scripts/build-jsonld.mjs` scrapes the products out of the markup rather than duplicating
them, so a sold garment disappears from both at once.

**AI crawlers.** `llms.txt` states plainly what the site is and what makes it a
first-hand source. The JSON-LD does most of the work here too — LLM crawlers lean on
schema.org because it is unambiguous.

**Contrast — the biggest change.** The palette's own accents did not meet WCAG AA against
the original `#726A4E` ground, and the failures were commercial as well as legal: garment
**prices** measured 1.28:1 (paprika on olive — effectively invisible), the "View on
Vinted" call to action 2.62:1, and every line of body copy 3.47:1 against a 4.5:1
requirement. Nine distinct text styles failed.

The fix was to darken the ground to `#4A4433` rather than lighten each accent. Three
accent hues sit on that ground; lightening them one by one washes the spice palette toward
cream and loses what makes the design its own, whereas a deeper olive keeps every accent's
chroma and lifts all of them at once. Two follow-on rules came out of it:

- **paprika is a fill colour, not a text colour.** It is a mid-luminance saturated red
  that cannot reach 4.5:1 on *any* ground dark enough to read against — it tops out near
  3.5:1 on near-black. Small accent text now uses `--magenta` (4.70:1). paprika keeps its
  job as a background.
- **The Czech-In chip flipped to bone-on-chilli.** Dark text on paprika was 2.29:1, and
  paprika has so little headroom that only near-black clears AA on it, which reads as a
  printing error. Light text on the deeper chilli red gives 4.73:1 and stays
  unmistakably red.

The site now measures **zero contrast failures**. To revert the whole thing, put `--void`
back to `#726A4E` in `assets/site.css` — nothing else depends on the new values.

**Privacy.** No JavaScript, no cookies, no analytics, no third-party origin of any kind.
Verified: no `Set-Cookie` on any response and `document.cookie` empty on every page. Since
there is nothing to consent to, there is no consent banner — the footer line
("No cookies, no trackers, no analytics on this site.") is the entire privacy notice. The
CSP enforces it rather than merely documenting it: `script-src 'none'`, `style-src 'self'`
with no `'unsafe-inline'`, `font-src 'self'`, and `browsing-topics=()` in
Permissions-Policy opts out of the browser-level ad-topics API.

Transferred weight, gzipped, first visit to the home page on a phone: ~255 KB including
three font files and six photographs. Repeat visits are the HTML alone — under 4 KB.

---

## Things that bit, so they don't bite again

**Pages `_headers` merges where nginx replaces — and the merge is silent.** nginx drops all
inherited `add_header`s the moment a location sets one of its own. Pages does the opposite:
a more specific rule *appends*. Both traps fired on the first version of `edge/_headers`,
caught by a local `wrangler dev` before anything shipped:

- `Cache-Control` in `/*` plus `Cache-Control` in `/assets/*` produced the literal value
  `public, max-age=0, must-revalidate, public, max-age=31536000, immutable`. A browser
  honours the **first** `max-age` it reads, so the year-long immutable cache was dead and
  every stylesheet and photograph revalidated on every view. Pages also sets its own default
  `Cache-Control`, so even removing the `/*` rule was not enough.
- The relaxed CSP for `/spirituality.html` merged with the strict site-wide one. A merged
  CSP is enforced as the **intersection**, so the page was still blocked from loading cdnjs
  and would have rendered as the blank white page the exception exists to prevent.

The fix for both is `! Header-Name` in the specific rule, which detaches the inherited *and*
default value before the new one is set. Anything that varies by path must never be declared
in `/*`. Verify with `curl -sI` against a local `wrangler dev`, not by reading the file.

**An ImageMagick policy can be valid XML and still be silently ignored.** ImageMagick does
not use a real XML parser for `policy.xml`, and its own parser aborts on a **backtick inside
a comment**. A draft that passed `xmllint` cleanly was dropped without a word — `magick -list
policy` simply stopped listing the file, which looks exactly like a machine with no policy.
(XML's own rule that comments may not contain a double hyphen killed an earlier draft too,
via the dashed underlines beneath its headings.) Never assume the file loaded: check that it
appears in `magick -list policy`, then probe an actual denial.

**Two owners of the `?v=` token, one of which broke when its shape changed.**
`build-shop.mjs` and `build-diaries.mjs` used to scrape the current token out of
`index.html` with `/(\d+)/` and echo it onto every page they generated. When the token
became a hex content hash, that regex stopped matching, both fell back to `?v=1`, and every
regenerated page shipped a wrong token until `bump-assets.mjs` corrected it seconds later —
harmless in the output, but it made the daily log claim the stylesheets had changed when
they had not. The generators now emit no token at all; `bump-assets.mjs` owns it outright.

**The asset `?v=` token was invalidating everything, every day.** `bump-assets.mjs` used a
single global counter and `publish.sh` runs it unconditionally each morning, so a sync that
added two photos and touched no CSS still moved every asset to `?v=N+1` — roughly 55 KB of
CSS and JS re-downloaded daily by every returning visitor to deliver nothing. The immutable
header was buying 24 hours instead of a year. It now stamps each file with 8 hex characters
of sha256 **of that file's own bytes**, so an unchanged file keeps its URL and a changed one
gets a URL that has never been served. It is also more correct than the counter, which could
not tell "shipped" from "edited".

**`cloudflared tunnel route dns` ignores the tunnel you name it.** There is a global
`~/.cloudflared/config.yml` on this host pinned to `tunnel: jains-es`, and it wins over the
positional argument. The first attempt at this subdomain silently created a CNAME pointing
at the *jains-es* tunnel. Pass a throwaway config to route DNS for any other tunnel:

```bash
printf 'ingress:\n  - service: http_status:404\n' > /tmp/empty-cf.yml && cloudflared --config /tmp/empty-cf.yml tunnel route dns --overwrite-dns <tunnel-name> <hostname>
```

**The pages were mode 0600 on disk.** `COPY` preserves host mode bits, so the first working
build served a blanket 403 on every page while `robots.txt` and the images were fine. The
sources are 0644 now and the Dockerfile runs `chmod -R a+rX` over the web root so a future
0600 file can't quietly take a page off the air.

**`.dockerignore` and the Dockerfile can disagree.** `nginx/` must *not* be ignored — the
Dockerfile copies the two `.conf` files out of it — and the Dockerfile copies site content
by explicit pattern (`*.html`, `robots.txt`, `sitemap.xml`, `images/`) rather than `COPY .`
so that deployment machinery can sit beside the site without being served.

**CSP is looser than the neighbouring sites, on purpose.** These pages carry their whole
stylesheet in an inline `<style>` block and link Google Fonts, so `style-src` needs
`'unsafe-inline'` and `fonts.googleapis.com`, and `font-src` needs `fonts.gstatic.com`.
There is no JavaScript at all, so `script-src` stays `'none'` — which does block the
`onerror="this.style.display='none'"` attributes on the `<img>` tags, but every referenced
image is present in `images/`, so that handler never fires anyway.

**Cloudflare prepends its Content Signals Policy to `robots.txt`.** The public file is much
larger than the one in this repo. That's a zone-level setting, not a bug here.

**`padding` shorthand cancels the `.wrap` gutter.** `.hero-inner` and `.sec-inner` are
applied *alongside* `.wrap` (`class="wrap sec-inner"`), and both declared
`padding: 22px 0 44px`. The `0` reset the horizontal padding `.wrap` had set, so the hero
and every section on every page ran flush to both screen edges — text against the bezel on
a phone. Both now use `padding-block`, which only touches the vertical axis. Any new class
that pairs with `.wrap` must do the same.

**Why there is no hamburger menu.** It was considered and rejected. There are three
section links plus two icon links; as a horizontally scrollable strip they all fit from
about 360px up and every destination is one tap away. A disclosure menu would hide the
information architecture and add a tap to reach *every* page, in exchange for roughly 40px
of header height. It would also need JavaScript, which the CSP forbids (`script-src
'none'`) — a `<details>`-based version is possible but relies on overriding UA
`display` behaviour on the closed state, which is exactly the kind of thing that breaks
quietly in one browser. The scroll strip has a fade affordance below 360px, where it
genuinely does overflow.

**The `og:image` must point at a variant that actually exists.** `build-images.mjs` never
upscales, so a small source has only a 400px derivative. `clothes.html` briefly pointed at
`9315253483-1200.jpg`, which was never generated — that source is 450×800. Check
`images/derived/manifest.json` before choosing an `og:image`.

---

## ⚠ Open item: Cloudflare is still blocking AI crawlers at the zone level

**Status as of 2026-08-05: STILL ACTIVE.** The setting was looked for in the dashboard but
the injection is unchanged. Verified against a fresh cache key, so this is not a stale
edge copy.

Cloudflare has TWO independent controls under AI Crawl Control, and it is the second one
doing this:

1. a **block / challenge policy** for AI bots (enforcement, returns 403)
2. **Manage robots.txt** — prepends Cloudflare-managed directives to our file

The injected block arrives BEFORE our own rules, and in robots.txt the first matching
stanza wins, so everything declared below it is dead text. It currently sends:

- `Content-Signal: search=yes,ai-train=no,use=reference` — explicitly refuses training
- `Disallow: /` for GPTBot, ClaudeBot, CCBot, Google-Extended, Applebot-Extended,
  Bytespider, Amazonbot and meta-externalagent

**The fix:** turn the managed robots.txt OFF entirely in the dashboard (jains.es zone →
AI Crawl Control). Our own robots.txt already declares exactly the intended policy, and
one source of truth beats two. While there, confirm control (1) is not set to block AI
crawlers — that one enforces regardless of what robots.txt says.

Check whether it is resolved:

```bash
curl -s "https://indianinprague.jains.es/robots.txt?v=$(date +%s)" | head -5
```

While it is still active, that starts with Cloudflare's legal preamble. When it is clear,
the first line is our own comment, the only Content-Signal is
`search=yes, ai-input=yes, ai-train=yes`, and there is no `Disallow` anywhere in the file.

**A caution on testing this.** Spoofing a crawler's User-Agent to check whether it is
blocked does not work and will mislead you: Cloudflare verifies known bots by IP and
reverse DNS, so a fake Googlebot or ClaudeBot from an ordinary address is *correctly*
rejected with a 403. That 403 says nothing about whether the real crawler is allowed.
robots.txt is the only part of this checkable from outside.

---

## Known loose ends

- `images/9313953618.jpg` and `images/IMG_5000.jpg` are not referenced by any page. They
  still get derivatives generated; harmless, but they could be deleted.
- The `Kaivalya` `@font-face` that pointed at a non-existent `fonts/` directory has been
  removed along with the inline styles. If that font is ever licensed, add it to
  `assets/fonts.css` and put it ahead of IBM Plex Mono in the `body` font stack.
- `clothes.html` is 51 KB raw, about 24 KB of which is the `Product` JSON-LD for 24
  garments. It gzips to 6 KB, so this is not a real cost — but if the wardrobe grows a
  lot, consider trimming the per-product fields.

---

## Design review: what was changed, and what was left alone

Changed:

- **Contrast** — see above. Nine failing text styles, now zero.
- **Gutters** — the `padding` shorthand bug, above.
- **Mobile navigation** — the nav was `display:none` under 640px with no replacement.
- **Tap targets** — the five footer links were 40px; everything is now ≥44px.
- **WhatsApp** — icon in the header (green, so it is recognised at a glance) and a
  labelled link in the footer. The split is deliberate: a bare glyph works for people who
  already know they want to message, but by the time someone has scrolled to the footer
  they are looking for a way to get in touch, and a labelled link converts better than an
  icon. Both are `wa.me/420777558262`.
- **Header IA** — "Tram 22 Diaries" is shortened to "Diaries" in the header only, and
  Vinted became an icon. Five text labels would not fit a 375px strip. The footer and the
  page itself keep the full name, so the brand is not lost.
- **LCP** — the first two images on the image-bearing pages are now `fetchpriority="high"`
  instead of `loading="lazy"`. Lazy-loading an above-the-fold image delays discovery by a
  round trip; everything below the fold stays lazy (8 on the home page, 22 on clothes).
- **`lang="cs"`** on the Czech strings, so screen readers switch pronunciation and search
  engines read the bilingual intent correctly.

Deliberately left alone:

- **The typographic scale and the monospace face.** IBM Plex Mono at these sizes is the
  site's whole personality. It is unusual for long-form reading, but the copy is short and
  the voice is specific — changing it would be redesigning someone else's site rather than
  fixing it.
- **The grain, vignette and duotone frame treatment.** Purely decorative, costs nothing
  (inline SVG data URIs), and it is the strongest thing about the visual identity.
- **The roman-numeral `MMXXVI` stamps.** Not machine-readable, but they are set dressing
  rather than information. If the journal ever gets real publication dates, use `<time
  datetime="…">` for those.

Worth doing next, in rough order of value:

1. **Lift the Cloudflare AI-crawler block** (see the section above) — it currently
   cancels a whole strand of the SEO work.
2. **Real dates on the journal entries.** `Article` JSON-LD has no `datePublished`,
   which is the single most useful field for a piece of writing in search results.
3. **A proper `og:image` per page.** All four currently reuse one of three photographs;
   a purpose-made 1200×630 card per page would improve link previews a lot.
4. **Restaurant addresses.** The JSON-LD has `addressLocality` and a district but no
   street address, which is what would make the reviews eligible for a local-results
   listing.

---

## Search engine submission

**There is no longer any way to push a sitemap to Google.** The ping endpoint was retired
in 2023 and Bing followed; submission is Search Console / Bing Webmaster Tools only, and
both need the site owner's login. Two things worth doing there once, by hand:

- **Google Search Console** — add `indianinprague.jains.es` as a property (DNS TXT
  verification via the Cloudflare dashboard is easiest since the zone is already there),
  then submit `https://indianinprague.jains.es/sitemap.xml`.
- **Bing Webmaster Tools** — same, and it can import directly from Search Console.

What *can* be automated is IndexNow, which is the one push mechanism still operating:

```bash
node scripts/build-sitemap.mjs && node scripts/indexnow.mjs
```

One submission fans out to every participant. The one that matters most here is
**Seznam.cz** — it is the Czech search engine, it takes a real share of Czech-language
queries, and this site is deliberately targeting Czech searches (*indické oblečení Praha*,
*indická restaurace Praha*). Bing comes along too, and Bing's index is what ChatGPT search
reads, which makes this the fastest route into AI answers as well.

The key lives in `<32-hex>.txt` at the site root and is discovered by the script rather
than hardcoded, so rotating it means replacing the file and nothing else. The script
verifies the key file is actually reachable before submitting, because every participant
rejects a submission whose key cannot be fetched and it is better to fail loudly than to
report a success that did nothing.

Run it after any content change worth reindexing — new garments, a new dispatch, a
reworked page.
