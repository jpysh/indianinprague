# DESIGN.md: guldaarbazaar.com on a phone

The design authority for every page. **Mobile first, 375 wide.** Desktop is the same layout with more columns, never a separate design. If a screen needs a rule this file lacks, add the rule here first, then build.

What we borrow: structure and behaviour from Airbnb (photo-first cards, one accent colour, a calm grid, a bottom sheet for detail) and Apple's HIG (clarity, deference, 44 pt targets, Dynamic-Type-sized text). What we keep: our brand. The olive "void" palette, saffron and paprika accents, and IBM Plex Mono for the scanned parts and Plex Sans for prose (`assets/site.css` tokens). We are not cloning anyone's look.

Sources (19 Oct 2026): Apple HIG (layout, typography, touch targets, sheets); reconstructions of Airbnb's system (getdesign.md, superdesign.dev: unofficial, used for patterns only); Baymard Product List UX 2025 and the filter guide (Apr 2026); NN/G on Liquid Glass. Re-read the primary source before changing a rule below.

## 1. Principles

1. **The photo sells.** A card is the photograph first, then title, then price. No borders, no heavy shadows: depth comes from the picture (Airbnb).
2. **Deference.** The interface steps back: chrome is quiet, the product is loud. One accent colour (saffron on void) for the one main action on a screen.
3. **One thumb.** Every main action is reachable at the bottom half of a 375x812 screen: Filters, Ask on WhatsApp, View on Vinted.
4. **Nothing is hidden behind JavaScript.** Content is readable with JS off and in WhatsApp's in-app browser (CLAUDE.md, Motion).
5. **Fewer taps.** Measure taps from a shared link to a WhatsApp message or a Vinted listing; a change states before and after.
6. **Calm.** Motion explains a change of place (a sheet rising, a card opening). It never decorates, and it honours reduced motion.

## 2. Numbers

| What | Rule |
|---|---|
| Side gutter | 16 px at 375 wide (`--gutter` today is 20; move to 16 on phones) |
| Spacing | 4 px base; use 8, 12, 16, 24, 32, 48 |
| Touch target | 44 x 44 px minimum, 8 px apart |
| Body text | 16 px minimum for anything read; 17 px for long prose |
| Smallest text | 13 px, and only for labels a shopper scans (never prices, never sentences) |
| Price | same size as title or larger, weight above body |
| Card photo | 4:5 portrait, 12 px radius, two columns at 375 (§7.8) |
| Radius | 12 px cards and sheets, 999 px pills, 8 px inputs |
| Contrast | WCAG AA: 4.5:1 text, 3:1 large text and controls; `--avocado` and `--paprika` are fills only |
| Sheet | bottom sheet for product detail and filters, grab handle, closes on swipe down, Back and Esc |

## 3. Components (reuse, never rebuild)

The shop kit lives in `assets/shop.css` and `assets/shop.js`: card (`.piece`), filter bar (`.sb-*`), detail sheet, chips, pager. A new screen uses these. A fix to one is a token or kit change, never a one-off value in a page.

## 4. Shop rules (Baymard)

- Applied filters show as removable chips above the grid (done).
- Price filter always present (80% of mobile shoppers try it).
- Search tolerates typos and other languages, best match first (done, MiniSearch).
- A no-results state always offers a way out: clear filters, or ask on WhatsApp.
- Never show the same product twice in a list.

## 5. Libraries

Native first: CSS scroll-snap for galleries, `<dialog>` for sheets, View Transitions for page changes. A library is allowed when it is MIT or similar, has zero or few dependencies, no known vulnerabilities on Snyk, a release older than two weeks, and is vendored and pinned under `assets/vendor/` and loaded only when used. Candidates when a need appears: PhotoSwipe (pinch-zoom product photos), MiniSearch (in use).

## 6. Banned

`backdrop-filter`, `mix-blend-mode` and `subgrid` on the shop grid (iOS Safari breaks them; CLAUDE.md). GSAP, three.js and Lenis outside Spirituality. Text over a busy photo without a solid scrim.

## 7. Redesign decisions (owner, 19 Oct 2026)

1. **Light for shopping, dark for stories.** Shop pages and the homepage go light (warm off-white ground, near-black text) with olive, saffron and paprika as accents. Spirituality and Diaries keep the dark void.
2. **Plex Sans everywhere**; Plex Mono only for prices and small labels.
3. **Scope, in stages:** shop first (/wardrobe, shelves, detail sheet, search, filters), then the homepage. Other pages later.
4. **Detail stays a sheet, made better:** swipe gallery, pinch zoom, size and measurements, a sticky "Ask on WhatsApp" bar. Separate product pages are a later, separate decision (SEO and URLs).
5. **Trust:** show the Vinted rating only: "★ 5.0 · 93 reviews on Vinted", linked to the feedback page, from `data/seller.json` (refreshed daily). Hide it if the rating drops below 4.5 or the file is missing. No sold counts or follower counts yet: too small to help.
6. **Directions before building:** two or three mocked-up directions as a page the owner opens on a phone and picks from. Build only the chosen one.
7. **English first;** the seven translated sites follow by translating only the changed strings. A new DeepL key is the owner's call.
8. **Direction picked (owner, 19 Oct 2026): C "Stall"** from the mock-up page (claude.ai/artifact/HviNG29SMoC4VdiFsEhPSE): warm paper ground `#FBF3E4`, ink `#1E1B13`, paprika-brown accent text, saffron fills, category tiles with photos, two columns at 375 wide (replaces "1 column at 375" in §2). **Except the bottom Filters and Sort control, which follows direction A "Ledger":** one dark pill, "Filters · Sort", centred at the bottom. Tokens live at the top of `assets/shop.css`; dark pages keep the defaults in `site.css`.
