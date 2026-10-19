# UX audit — indianinprague.jains.es

Audited 13 Aug 2026 against the local copy on `:4321`, at 375×812 (mobile) and 1280×800
(desktop). Every number below was measured in the browser, not estimated.

The short version: **the craft here is well above average for a personal shop** — real
image derivatives, honest structured data, a CSP with no `unsafe-inline`, immutable
caching, filters that work without JavaScript, and a palette whose contrast was actually
computed rather than eyeballed. Nothing in this document is a rewrite. The gaps are
almost all in the same place: **the site is excellent at showing things and weak at
letting someone act.**

Findings are ordered by what they cost, not by how hard they are.

---

## 1. The conversion path is broken on the device most visitors use

WhatsApp is the stated primary channel — it is the contact point in the JSON-LD
`contactPoint`, it is in the footer of all 13 pages, and it is where a buyer is supposed
to ask a question. On a phone it is invisible.

| # | Finding | Evidence | Severity |
|---|---------|----------|----------|
| 1.1 | The WhatsApp and Vinted icons are hidden below 641px | `assets/site.css:214` — `@media (max-width:640px){.bar-ico{display:none}}`. Confirmed: computed `display:none` at 375px | **High** |
| 1.2 | On mobile the only WhatsApp link is in the footer — 14,332px down on `shop.html` | measured `document.documentElement.scrollHeight` at 375px | **High** |
| 1.3 | No WhatsApp link anywhere carries a prefilled message | all 13 pages use bare `wa.me/420777558262`, no `?text=` | **High** |
| 1.4 | No way to ask about a specific piece — every card's only exit is Vinted, in a new tab | `scripts/build-shop.mjs:212` | **High** |
| 1.5 | Nothing on the site lets a visitor subscribe to updates | no "notify me", no channel link, no list | **High** |

Why 1.3 matters more than it looks: an unprefilled `wa.me` link produces an empty chat.
The visitor has to compose the question, and the recipient gets "hi" with no idea which
of 150 pieces it is about. A prefilled body converts an intention into a message.

**Fix.** A persistent WhatsApp affordance on mobile; prefilled text on every WhatsApp
link, page-specific; a per-card "Ask about this piece" that prefills title + price + the
Vinted URL; and one explicit "get the drops" surface.

## 2. No decision support

Someone considering a €29 kurta from a seller they have never heard of has, on this
site, no answer to: how does delivery work, can I try it, what if it does not fit, who
are you, has anyone actually bought from you.

| # | Finding | Evidence | Severity |
|---|---------|----------|----------|
| 2.1 | No shipping, sizing, condition-grading or returns information anywhere | grep across all pages | **High** |
| 2.2 | No trust signals beyond Vinted heart counts | no seller rating, no "7 pieces sold" on the homepage | Medium |
| 2.3 | Sizes ship as a bare letter (`L`), but the source data has the full `L / 40 / 12` and most listings carry measurements in the description | `data/catalog.json` — `size` vs `sizeGroup`; the Buddha co-ord lists bust 40in, length 44in | Medium |
| 2.4 | The card's hover blurb is the only place a description appears, and hover does not exist on touch | `build-shop.mjs:159`; measured height 0px until hover | Medium |

**Fix.** One short "How buying works" block, reused on every shop page; surface
measurements where the data already has them; a quiet proof line on the homepage.

## 3. Navigation does not tell you where you are

| # | Finding | Evidence | Severity |
|---|---------|----------|----------|
| 3.1 | The primary nav never marks the current page | `nav.main a.active` is styled at `assets/site.css:183` but no page sets the class, and no `nav.main` link on any page carries `aria-current`. The 7 `aria-current` hits in the codebase are all in the shop's `.cat-nav` strip | **High** |
| 3.2 | The nav clips at common phone widths with no scroll affordance | at 375px: `scrollWidth 225` vs `clientWidth 203` — "DIARIES" is cut off. The fade mask that signals scrollability is scoped to `max-width:339px` (`site.css:222`), so exactly the widths where it clips are the widths with no hint | **High** |
| 3.3 | "Shop" and "Clothes" both sit in the top nav, but Clothes is one of six shop categories | `index.html:118` | Medium |
| 3.4 | `.crumb` on every page head looks like a breadcrumb and is not a link | `site.css` `.crumb` | Low |

## 4. Findability inside the shop

| # | Finding | Evidence | Severity |
|---|---------|----------|----------|
| 4.1 | Filter state is not in the URL | `assets/shop.js` — no `history`/`location` use. A filtered view cannot be shared, bookmarked, or recovered with Back; a refresh loses it | **High** |
| 4.2 | On mobile the toolbar consumes the first screen — first product card sits at y=745 in an 812px viewport | measured | Medium |
| 4.3 | Applying a filter neither scrolls the grid into view nor moves focus; the count updates in an `aria-live` region far above the fold | `shop.js:314` | Medium |
| 4.4 | Search matches title and brand only, not description or colour | `shop.js:195` | Low |
| 4.5 | No cross-links from a category to related writing, or from writing to the category | — | Medium |

## 5. Content integrity — things that are simply missing

These are the ones that make a good site feel unfinished.

| # | Finding | Evidence | Severity |
|---|---------|----------|----------|
| 5.1 | **`restaurants.html` ships zero photographs.** All five `.frame` elements are empty gradient placeholders — while the homepage teasers for the same three restaurants use real photos (`IMG_4126`, `IMG_4041`, `IMG_5054`) | measured: `[...document.querySelectorAll('.frame')].map(f=>!!f.querySelector('img'))` → all false | **High** |
| 5.2 | `diaries.html`'s featured article has no photo either; the identical card on the homepage does | same probe on `/diaries.html` | **High** |
| 5.3 | The homepage teases 3 restaurants; the page has 5 | `index.html:155` vs `restaurants.html` | Medium |
| 5.4 | Two reviews have no `id`, so they cannot be deep-linked (INDelicious, Palo Verde) | `restaurants.html:203,219` | Medium |
| 5.5 | `diaries.html` `<title>` is a bare "Tram 22 Diaries" — no brand or keyword suffix, unlike every other page | `diaries.html:6` | Medium |
| 5.6 | An empty `<div class="diary">` is left in the markup, and `.entry` styles exist for a list that was never built | `diaries.html:96`, `assets/diaries.css` | Low |

## 6. Performance — good, with two cheap wins

Nothing here is urgent. Recording it so the "snappy" goal has numbers attached.

| Measure | Value |
|---|---|
| `shop.html` | 456 KB raw → **74 KB gzipped** |
| DOM nodes on `shop.html` | 2,893 |
| `<img>` elements in the document at load | 157 |
| Cards rendered server-side / revealed initially | 157 / 24 |
| Sub-resources on first paint | 16 |

Already right: mobile-first CSS, fonts self-hosted and preloaded, WebP with JPEG
fallback and correct `sizes`, `width`/`height` on every card image so nothing reflows,
lazy loading below the first row, immutable caching on `/assets/` and `/images/derived/`,
a `?v=` token so a CSS change is never stale, full server-side render so the catalog is
crawlable, extra carousel photos built only on interaction.

| # | Opportunity | Gain |
|---|---|---|
| 6.1 | `content-visibility:auto` + `contain-intrinsic-size` on off-screen `.piece` cards — skips layout and paint for ~130 of 157 cards | Largest single win on a mid-range phone; one CSS rule |
| 6.2 | Brotli alongside gzip in nginx | ~15–20% off the 74 KB |
| 6.3 | The hero background is a CSS gradient, so LCP is text — keep it that way when the homepage is restructured | Protects what is already fast |

## 7. Accessibility — measured, and largely fine

Every text/ground pair measured against the `#4A4433` ground:

| Element | Ratio | Verdict |
|---|---|---|
| Card title | 8.43:1 | Pass |
| Card tags / prices in Kč / notes | 6.22:1 | Pass |
| Price (amber) | 4.70:1 | Pass AA |
| Nav link (at `opacity:.68`) | ~4.9:1 | Pass AA |

Also correct: a skip link, `aria-label` on both navs, 44px tap targets on nav links,
`prefers-reduced-motion` honoured for smooth scrolling, visually-hidden text telling
screen-reader users that item links open a new tab, `role="status"` on the result count,
empty `alt` on the carousel's secondary photos so the grid is not read three times over.

Remaining, all minor:

| # | Finding |
|---|---|
| 7.1 | Body metadata sits at 10.5–11px. It passes contrast, but it is small for price and size information a buyer has to read |
| 7.2 | The brand wordmark link is 18px tall — under the 24px WCAG 2.2 target minimum |
| 7.3 | Any horizontal scroller added to Diaries must be keyboard-reachable and must not trap focus off-screen |

---

## What was fixed, and what was left

Implemented in the restructure that followed this audit. Numbers re-measured after the
change, not predicted.

| # | Finding | Outcome |
|---|---------|---------|
| 1.1 | WhatsApp hidden below 641px | **Fixed.** The mobile bar is two rows now — brand + contact icons, then the nav — so `.bar-ico` is `display:flex` at 375px |
| 1.2 | WhatsApp only in the footer on mobile | **Fixed** by 1.1; it is in the sticky header on every page |
| 1.3 | No prefilled message | **Fixed.** Every WhatsApp link on the site now carries a `?text=`, written for its context |
| 1.4 | No way to ask about a specific piece | **Fixed.** Every card has an "Ask about this piece" link prefilled with title, price and listing URL. Sold cards ask "do you have anything similar?" instead |
| 1.5 | Nothing to subscribe to | **Partly.** Three "tell me when this lands" surfaces (Wellness, Buddy, end of Diaries). Still no list — deliberately, since one message is the whole mechanism |
| 2.1 | No shipping / sizing / returns | **Fixed.** A "How buying works" block on every wardrobe page: ask first, buy on Vinted, posts from Prague |
| 2.2 | No trust signals | **Fixed** (19 Oct 2026). The detail sheet shows the Vinted rating and review count, hidden under 4.5 |
| 2.3 | Full sizes and measurements never surfaced | **Not done.** Still `sizeGroup` only. The data is there; it needs a card-level design decision |
| 2.4 | Description only on hover | **Fixed** (19 Oct 2026). The detail sheet shows the description on touch and mouse |
| 3.1 | Nav never marks the current page | **Fixed.** `aria-current` + the `.active` rule that had never been set, on all 15 pages, via the new `scripts/sync-chrome.mjs` |
| 3.2 | Nav clips at 375px with no affordance | **Fixed.** Overflow measured at 22px before, **0** after |
| 3.3 | "Shop" and "Clothes" both in the nav | **Fixed.** Four modules; the shelves live in the category strip |
| 3.4 | `.crumb` is not a link | **Not done** |
| 4.1 | Filter state not in the URL | **Fixed.** `?q=&cond=&size=&color=&price=&sort=&avail=`, `replaceState` so a keystroke does not become a history entry, and every value validated against the controls the page actually rendered |
| 4.2 | Toolbar eats the first mobile screen | **Not done** |
| 4.3 | Filtering does not move focus or scroll | **Fixed separately** by the bottom-anchored "Filters & sort / Top" control |
| 4.4 | Search misses description and colour | **Fixed** (19 Oct 2026). MiniSearch covers title, brand, colour, category and description |
| 4.5 | No cross-links between shelves and writing | **Fixed.** Every Diaries rail carries a "see all" into its shelf |
| 5.1 | restaurants.html ships no photographs | **Fixed.** Four added; Palo Verde has no photograph to add |
| 5.2 | diaries.html feature has no photo | **Fixed.** The page is generated from `data/posts.json` and every card takes its photo from the image manifest |
| 5.3 | Homepage teases 3 restaurants, page has 5 | **Fixed.** All five are posts in the Food rail |
| 5.4 | Two reviews cannot be deep-linked | **Fixed.** `#indelicious` and `#palo-verde` added |
| 5.5 | Bare `<title>` on diaries | **Fixed** |
| 5.6 | Dead `.diary` markup and `.entry` styles | **Fixed.** Both gone; `diaries.css` is now the rails |
| 6.1 | `content-visibility` on off-screen cards | **Done**, from the 7th card on |
| 6.2 | Brotli | **Not done** — an nginx build change, not a frontend one |
| 7.1 | 10.5–11px metadata | **Not done** — a deliberate type-scale decision, worth taking on its own |
| 7.2 | Wordmark under the 24px target minimum | **Not done** |
| 7.3 | New scrollers must be keyboard-reachable | **Done.** Each rail is `tabindex="0"` with `role="group"` and a name, and has a visible focus ring |

One cost worth naming: `wardrobe.html` went from 456 KB to 576 KB raw (74 → 82 KB gzipped),
because 157 prefilled WhatsApp links are 157 long URLs. That is ~8 KB gzipped to make every
card answerable, and the WhatsApp glyph was deliberately left out of the card to avoid
another ~110 KB.

## What this adds up to

Three sentences:

1. **Make it possible to act** — WhatsApp present on mobile, prefilled, per item, plus one
   place to subscribe.
2. **Make it possible to decide** — how buying works, real measurements, honest proof.
3. **Make it possible to navigate** — mark the current page, stop clipping the nav, put
   filters in the URL, and give the writing a home with an actual shape.

The restructure requested alongside this audit — four top-level modules and a Diaries hub
built from category rails — is the vehicle for point 3. Points 1 and 2 are independent of
it and are worth doing regardless.
