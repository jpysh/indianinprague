# SEO / AI-search working doc — indianinprague.jains.es

Living document. Survives session boundaries: if a Claude session closes, start here.
Owner: one person doing everything, so every item below is scored for effort vs. payoff and
nothing here assumes a budget, an agency or a second pair of hands.

Last updated: 2026-08-22
Targets: `https://indianinprague.jains.es/` and `https://indianinprague.jains.es/wardrobe`
Secondary: `https://indianinprague.jains.es/spirituality` (the 17 Aug target; still valid, no longer first)
Audience: European women, 18–65, looking for products and services.

---

## 0.5 Your tasks — the things only you can do

Everything else in this file is mine. These need a login I do not have, a fact about the
business only you know, or your own words. Ordered by payoff.

- [ ] **Bing Webmaster Tools — verify the site.** This is the one blocking item. Bing is
      refusing IndexNow submissions for this host with `403 UserForbiddedToAccessSite`, and
      Bing's index is what ChatGPT Search reads, so this is the closest thing to a direct
      lever on ChatGPT visibility that exists.
      1. `https://www.bing.com/webmasters` → sign in with any Microsoft account.
      2. Choose **Import from Google Search Console**, authorise, pick
         `indianinprague.jains.es`. Verification comes across with it — no DNS or file change.
      3. If the import does not offer the property: **Add site manually** → XML file method →
         it gives you `BingSiteAuth.xml`. Do not upload it anywhere; send the contents to a
         Claude session and it gets deployed with everything else.
      4. Once verified, open **IndexNow** in the sidebar and confirm the key
         `f21add2c50aa16c370d126be8a4b1f8d` is listed. If it offers to generate a new key,
         **decline** — the existing one is already deployed.
      5. Open **Sitemaps** and submit `https://indianinprague.jains.es/sitemap.xml`.
      6. Say so in the next session, and the 403 gets re-tested.
      (Bing Places is not relevant — there is no walk-in premises. Skip it.)

- [ ] **Read `/how-it-works` before it goes live.** It was drafted on 22 Aug 2026 and it makes
      public statements in your name about shipping, returns, privacy and terms. Every factual
      claim in it came from copy already on the site or from what you confirmed in that
      session, and the 14-day withdrawal line is a legal requirement, not a choice. But it is
      not legal advice and it has not been read by a lawyer. Check it says what is true.

- [ ] **Home page copy — ~600 words, in your voice.** Still open, and still the biggest
      ranking gap on the site: the home page is 705 words against 11k on `/wardrobe`. See 3.5
      for the two sections suggested. On 22 Aug you chose to put the FAQ on `/how-it-works`
      rather than the home page, which is the right split — but it leaves this untouched.

- [ ] **Vinted profile bio.** Five minutes, real value. Make the bio name "Indian in Prague"
      in exactly that form and link back to the site. Answer engines check whether an entity
      describes itself the same way everywhere; this is the cheapest consistency win available.

- [ ] **Fortnightly AI-visibility check.** Section 6. Ask ChatGPT, Perplexity, Claude and
      Google AI Mode the section 4 queries and log the answer in section 7. Twenty minutes,
      and it is the same thing paid monitoring tools sell.

- [ ] **Decide on shipping and return facts for vendor stock**, if you ever want
      `shippingDetails` and `hasMerchantReturnPolicy` in the product markup — see 3.11.

---

## 0. How to use this file

- **Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[?]` needs a human decision
- Anything marked `[?]` is waiting on the site owner, not on an agent.
- Section 6 is the recurring loop. Everything above it is one-time build-out.

---

## 1. What the research says (Aug 2026)

Condensed from the sources listed in section 8. The short version, because the field is
loud and most of it is noise.

**Three separate ecosystems, not one "AI search" channel.**
ChatGPT Search (~800M weekly users) blends OpenAI's own crawl with Bing results plus a
re-ranking layer. Perplexity (~780M queries/month) runs a live search per query and weights
recency and source authority heavily. Google AI Overviews appear on ~48% of queries and are
grounded in the *top organic results* — meaning classic SEO is still the feed for it.
Only ~11% of domains cited by ChatGPT are also cited by Perplexity. Optimising for one does
not get you the others.

**Citation rates differ enormously.** One 2026 study measured a 46× spread: ChatGPT cited
brands 0.59% of the time, Perplexity 13.05%. Perplexity is the realistic near-term win for a
small site; ChatGPT is a long game that follows from authority and mentions elsewhere.

**What actually moves the needle** (Princeton GEO paper, replicated since): citing sources
and adding concrete statistics were the top-performing tactics, worth 30–40% improvement in
AI visibility. Not keyword density. Specific, verifiable, first-hand claims.

**Entity consistency is underrated.** Answer engines check whether the brand/person/service
is coherent *across sources*. Same name, same description, same category language everywhere
— site, Vinted, any directory listing. Clean entity markup beats unstructured mentions.

**Schema.org is the machine-readable layer AI leans on hardest**, because it is unambiguous
where prose is not. `Organization`, `Person`, `Service`, `Product`, `FAQPage`, `Article`,
`BreadcrumbList` are the types that matter here.

**llms.txt is near-worthless in practice — but keep it.** SE Ranking's 300k-domain study
found ~10% adoption and, critically, that GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot and
Google-Extended overwhelmingly *skip* the file and crawl HTML directly. No major provider has
committed to it. It costs nothing to maintain, so it stays — but zero effort should be spent
on it beyond keeping it accurate, and **no** strategy should depend on it. The HTML is what
gets read.

**The real lesson for a one-person site:** AI crawlers read rendered-ish HTML fast and cheap.
Anything that hides content behind JavaScript, a preloader, or 700 KB of animation libraries
is a direct tax on both AI citation and Google ranking. Speed and plain semantic HTML *are*
the AI optimisation. That is the through-line of every fix in section 3.

---

## 2. Audit findings — 17 Aug 2026

### What is already best-in-class (do not regress these)

The technical baseline here is genuinely better than most commercial sites. Credit where due:

- Static HTML, no cookies, no trackers, no analytics. Nothing to consent to, nothing to slow it.
- `robots.txt` is exemplary: explicit `Content-Signal: search=yes, ai-input=yes, ai-train=yes`
  plus per-agent `Allow` stanzas for GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot,
  PerplexityBot, Google-Extended, Applebot-Extended, CCBot and others. Several of these agents
  read only their own stanza, so naming them individually is the correct call.
- Generated `sitemap.xml` with real `lastmod` and image extensions.
- Generated JSON-LD (`scripts/build-jsonld.mjs`) driven from the catalog, so structured data
  cannot drift from the markup — a `Product` disappears when the garment sells.
- Strong security headers, HSTS preload, sensible CSP, Cloudflare edge caching (`HIT`).
- Home page TTFB ~69 ms, 19.7 KB. That is excellent.
- IndexNow pings on publish.
- Real first-hand content with a genuine point of view — the single hardest thing to fake and
  the thing GEO research says matters most.

### Findings, worst first

**F1 — `/spirituality` carries zero structured data.** `grep -c 'application/ld+json'` returns
0. The page is 15,490 words of services, retreats, products and a real FAQ, and it is
completely invisible as machine-readable entities. Every other page on the site has a graph;
this one was a design export that never got wired into `scripts/build-jsonld.mjs`.
*This is the single biggest gap on the site.* — **FIXED, see 3.1**

**F2 — 731 KB of render-blocking third-party JavaScript on `/spirituality`.**
Four `<script>` tags in `<head>`, none deferred:

| Library | Size | What it does here |
|---|---|---|
| `three.min.js` (r128) | **603 KB** | decorative WebGL background |
| `gsap.min.js` | 72 KB | scroll animation |
| `ScrollTrigger.min.js` | 43 KB | scroll animation |
| `lenis.min.js` | 13 KB | smooth scroll |

603 KB — 82% of the payload — renders a background gradient. This is the LCP problem, the
mobile-data problem, and the reason the CSP on this path has to be relaxed to allow
`cdnjs.cloudflare.com` and `unpkg.com`. It also means two extra DNS lookups + TLS handshakes
to third-party origins before the page can paint. — **PARTLY FIXED, see 3.2**

**F3 — content is gated behind a preloader.** `#preloader` covers the viewport at z-index
9999 until GSAP finishes. There is already a 3-second no-JS escape hatch (good instinct), but
3 seconds is far past the LCP budget of 2.5 s, and a crawler or agent that renders the page
sees an empty overlay. — **FIXED, see 3.3**

**F4 — a real FAQ with no `FAQPage` schema.** The "Good to know." section has five genuine
question-and-answer pairs, visible on the page. FAQ schema is one of the highest-leverage GEO
tactics and this qualifies cleanly under Google's "must mirror visible content" rule.
— **FIXED, see 3.1**

**F5 — the home page is thin: 705 words.** For comparison `/clothes` has 11,166 and
`/spirituality` 15,490. The home page is the primary ranking target and it is mostly
navigation. It has no substantive prose for a search engine or an AI to extract an answer
from. — **`[?]` needs owner copy, see 3.5**

**F6 — no `Organization` / `LocalBusiness` entity.** The site models the author as a `Person`
(correctly, and `sameAs` to Vinted is a good entity-reconciliation move), but `/spirituality`
sells services and physical goods across Europe. There is no entity that says "this is a
business, here is where it operates, here is what it offers." — **FIXED, see 3.1**

**F7 — no Czech-language surface at all.** The audience is European and the business is
physically in Prague. Czech queries — *ájurvéda Praha*, *jóga Praha*, *pančakarma*, *indické
oblečení Praha* — are dramatically less competitive than their English equivalents and are
what a local buyer actually types. The site declares `inLanguage: ["en","cs"]` in schema but
serves no Czech. That is a mismatch. — **`[?]` biggest untapped opportunity, see 3.6**

**F8 — `llms.txt` is stale.** It does not mention `/spirituality` at all — the largest page on
the site and one of the two ranking targets. It also still lists `/clothes.html` with the
extension after the move to extensionless URLs. Low impact (see section 1) but it is wrong.
— **FIXED, see 3.4**

**F9 — no author/expertise signals for a YMYL-adjacent topic.** Ayurveda, Panchakarma and
health treatments sit close to "your money or your life" territory, where Google weights
E-E-A-T hardest. There is no named practitioner, no credentials, no bio on `/spirituality`.
— **`[?]` needs owner input, see 3.7**

**F11 — `/spirituality` lost its only local keyword from the H1.** The hero eyebrow and the
words "in Prague" were removed from the H1 on 15 Aug 2026 for good layout reasons, which also
stripped both hero Prague mentions from the page. The H1 now reads "Yoga, Ayurveda and
Spirituality" — three head terms with no geographic qualifier, competing globally instead of
locally. The H1 is the strongest on-page signal there is, and "ayurveda prague" is the #1
target query for this page. A kicker rewrite was offered at the time and never chosen.
*Concrete suggestion, keeping the two-beat mask reveal intact:* leave the H1 alone and change
the kicker from "One philosophy. Four ways to begin." to **"One philosophy. Four ways to begin,
in Prague."** — one word of layout risk, restores the local signal in the highest-weighted
block on the page. — **`[?]` see 3.9**

**F12 — the trip and product cards are not clickable.** The six journey cards and eight
product cards have no `<a>`, no `href`, no handler. On a page whose entire purpose is selling
services and goods, the shelf is decoration. This is primarily a conversion bug, but it is an
SEO one too: I have just marked those fourteen items up as `TouristTrip` and
`ProductCollection` nodes (3.1), and schema without a `url` on the item is far weaker — there
is nothing for a search engine to rank or for an AI to link a reader to. The structured data
is ready to carry URLs the moment destinations exist. — **`[?]` see 3.10**

**F10 — the two target pages barely link to each other.** `/` links to `/spirituality` once in
the nav and once in the footer, with the anchor text "Spirituality". `/spirituality` needs
descriptive internal links back. Anchor text is a ranking signal and a topical-relationship
signal for AI. — **`[?]` see 3.8**

---

## 3. Changes

### 3.1 `[x]` Full structured-data graph for `/spirituality`

Added `"spirituality.html"` to the `graphs` registry in `scripts/build-jsonld.mjs`, so it is
generated by the same pipeline as every other page and cannot drift by hand. Nodes:

- `Organization` (`#org`) — the business entity F6 was missing, `sameAs` linked to the Person
  so the two reconcile as one operation. Carries `areaServed: Europe`, contact point, and the
  Prague address.
- `WebPage` + `BreadcrumbList` — standard, and breadcrumbs are one of the schema types AI
  parsers are documented to use.
- `FAQPage` with the five real Q&As from "Good to know." (F4). Verbatim from the visible
  page, which is what Google's guidelines require.
- Three `Service` nodes — Courses/Treatments/Sessions, Journeys to India, Ayurvedic Goods —
  each with `serviceType`, `provider`, `areaServed` and an `OfferCatalog` of what is inside.
- `ItemList` of the six journeys as `TouristTrip` nodes with real itineraries
  (Kerala/Himalayas, Rishikesh, Rishikesh·Chopta, Delhi·Agra·Jaipur·Goa, Nepal, tailored).
- `ItemList` of the eight product categories.
- `DefinedTermSet` for the seven chakras — the page has a whole section defining them, and
  this is exactly the "what is the Anahata chakra" question an AI answers from a source.
  Follows the precedent already set for the clothes glossary, and dodges the same FAQPage
  guideline risk for the same reason.

Rationale for `DefinedTermSet` over `FAQPage` on the chakras is the existing in-file comment
at `scripts/build-jsonld.mjs` — statement headings are not questions, and rewriting them into
questions to satisfy a schema is tail-wagging-the-dog. Kept consistent.

### 3.2 `[x]` Third-party JS un-blocked and self-hosted on `/spirituality`

My first plan was to delete three.js and replace the background with a CSS gradient. **That
was wrong and I did not do it.** Reading the code showed three.js drives two things, not one:
the `#bg-canvas` fluid background *and* the interactive 3D chakra visualisation at
`#chakra-canvas`, which is a genuine feature of the page and one of its differentiators.
Deleting the library to save bytes would have silently removed it. Recorded here because the
reasoning matters more than the outcome.

What was done instead achieves most of the same win with no visual change at all:

- All four libraries **self-hosted** under `assets/vendor/`. No more `cdnjs.cloudflare.com`
  or `unpkg.com`: two fewer DNS lookups and TLS handshakes before anything can render, no
  third party seeing every visitor's IP, and no CDN outage able to break the page.
- The four `<script>` tags **moved out of `<head>`** to sit just above the engine at the
  bottom of `<body>`. The browser now parses and paints the whole 15,000-word page before it
  spends a byte on animation.
- Deliberately **not** `defer`. The engine is an inline script, and inline scripts run at
  parse time — ahead of any deferred script — so `defer` would have left `gsap`, `THREE`,
  `ScrollTrigger` and `Lenis` all undefined at the moment the engine reached for them.
  Ordinary synchronous tags placed after the content give the same first-paint benefit with
  none of that risk.
- CSP for `/spirituality` tightened: `script-src` is back to `'self' 'unsafe-inline'`.
  `images.unsplash.com` **stays** in `img-src` — 16 images on the page still use it.

Total bytes are unchanged, but none of them block the first paint any more, and the render
path no longer depends on two third-party origins. Verified in-browser: all four libraries
load, both canvases initialise, the preloader dismisses, zero console errors.

**Still open:** those 16 Unsplash images are the last third-party origin and a real payload.
Replacing them with the author's own photography — already the plan in `edge/_headers` —
would let this CSP stanza collapse into the site-wide policy and would be a further
meaningful speed win. Stock photos of unnamed people also weaken E-E-A-T (see 3.7).

### 3.3 `[x]` Preloader no longer gates content

The existing no-JS escape hatch was a good instinct but fired at 3000 ms — past Google's
2.5 s "good LCP" threshold on its own, so in the failure case it existed for, the page was
guaranteed to fail Core Web Vitals before it recovered, and a rendering crawler sampling the
viewport in that window saw a loading overlay instead of content. Dropped to **800 ms**,
which is still far longer than the engine needs to boot now that the libraries are
same-origin and not racing a third-party handshake. The guard itself is kept — a parse error
or exception anywhere in the engine can still strand a visitor on a loading screen.

### 3.4 `[x]` `llms.txt` corrected

Added `/spirituality` with a description of what is on it, fixed the stale `/clothes.html`
link to `/clothes`, and added the wardrobe category pages. Kept short deliberately — per
section 1 this file is near-worthless, it just should not be *wrong*.

### 3.5 `[?]` Home page needs ~600 more words — OWNER DECISION

The fix is not "add filler." The home page needs one or two substantive first-hand sections
that answer the questions a European woman actually types. Suggested, in your voice:

- *"What contemporary Indian clothing actually is"* — ~300 words distinguishing it from the
  Goa-hippie/festival-sari cliché. You already make this argument in `llms.txt` and on
  `/clothes`; the home page is where it earns rankings. This is your strongest differentiator
  and it is currently buried.
- *"How buying from a Prague wardrobe works"* — ~200 words: sizing, CZK pricing, shipping
  across Europe, why it is Vinted. Answers the transactional questions directly, which is
  exactly the shape of query AI assistants get asked.
- Add 3–5 FAQs to the home page and they will be marked up automatically once written.

**I have not written this copy.** GEO research is explicit that AI-generated filler is
actively deprioritised, and the site's whole advantage is that it is genuinely first-hand.
Ghost-writing it would trade the one asset that cannot be copied for a word count. Draft it
roughly and I will structure, mark up and optimise it.

### 3.6 `[?]` Czech — a decision you have already made once — OWNER DECISION

**Context first: the site is English-only by your explicit instruction, 16 Aug 2026.** All
Czech was deliberately stripped — `lang="cs"` spans, tile subtitles, the Czech tails on
titles and meta descriptions, the JSON-LD `alternateName`s, the Czech keyword notes in
`llms.txt`. I am not proposing to undo that quietly, and I have not touched it.

I am raising it only because it is, in pure SEO terms, the largest single opportunity the
site is not taking, and it would be dishonest to write a ranking plan that omits it. English
"yoga Prague" is contested by every studio in the city with a marketing budget. `ájurvéda
Praha`, `pančakarma Praha` and `indické oblečení Praha` are close to uncontested, and they
are what a Prague-based buyer — squarely inside your 18–65 European female target — actually
types.

Note the current state is also internally inconsistent: `build-jsonld.mjs` still declares
`inLanguage: ["en", "cs"]` on the WebSite node and `knowsLanguage: ["en","cs","hi"]` on the
Person, while the site serves no Czech at all. Whichever way you decide, one of those two
should change so the schema tells the truth. **That is worth fixing either way** — a false
language claim is an entity-consistency problem, which section 1 flags as one of the things
answer engines actively check.

If you ever revisit it, the minimum viable version is two pages — `/cs/` and
`/cs/spiritualita` — with `hreflang` alternates wired both ways plus `x-default`. Not a site
translation. And it only works written by you or a Czech speaker: machine-translated Czech
reads as machine-translated Czech to a Czech reader, and costs more trust than the rankings
are worth.

**Default assumption unless you say otherwise: the site stays English-only, and I fix the
schema to match.**

### 3.7 `[?]` E-E-A-T / author signals — OWNER DECISION

For Ayurveda and Panchakarma, Google and the AI engines both weight demonstrated expertise
heavily, and there is currently no named human on `/spirituality`. Tell me and I will mark it
up:

- Who teaches/treats? Name, training, lineage, years practising.
- Any certification, or the Indian institution behind the retreats?
- The Haidakhan Babaji connection is mentioned in the hero — is there a formal affiliation?

A named `Person` with credentials, `alumniOf` and `knowsAbout`, linked as the `provider` of
each `Service`, is worth more here than any amount of keyword work.

### 3.8 `[?]` Internal linking — small, do it with the next copy pass

Change the home page nav/footer anchor "Spirituality" to something descriptive at least once
in body copy — *"yoga, Ayurveda and journeys to India"* — and add contextual links from
`/spirituality` back to `/ritual-objects` and `/books`, which are topically adjacent and
currently orphaned from it.

### 3.9 `[?]` Restore "Prague" to the `/spirituality` hero — OWNER DECISION

See F11. Recommended: kicker becomes "One philosophy. Four ways to begin, in Prague." I have
not made this change because it is a copy and layout decision on a page whose hero you have
already tuned deliberately, and the mask reveal is timed to the current line lengths. Say the
word and it is a one-line edit.

### 3.10 `[?]` Make the trip and product cards clickable — OWNER DECISION

See F12. This is the highest-value *commercial* fix on the site and it is blocked on a
question only you can answer: **where should these fourteen cards link to?** Options, cheapest
first:

1. **WhatsApp deep links**, one per card, pre-filled with the trip or product name — matches
   how the rest of the site already converts, costs nothing, works today.
2. **Anchor sections** further down `/spirituality` with real detail per trip.
3. **A page per trip** — best for SEO by a distance (six pages that can each rank for their
   own query, e.g. "panchakarma retreat kerala from europe"), most work.

Tell me which and I will wire the links and add `url` to the matching schema nodes in the
same pass. Related: no pricing or duration is shown anywhere on the page. `Offer` with
`price`, and `TouristTrip` with `duration`, are both strong rich-result and AI-answer signals,
and "how much does it cost" is the single most common question an assistant gets asked about
a service. That data is not on the page for me to mark up.

### 3.11 `[x]` Session of 22 Aug 2026 — IndexNow, product data, `/how-it-works`, shelf UX

A working session with the site owner. Decisions are recorded with their reasoning because
several of them closed off options that will look tempting again later.

**IndexNow: the 403 diagnosed, and the fan-out decoupled from it.**
`api.indexnow.org` **is** Bing. When Bing refuses a host it answers 403 before any fan-out
happens, so Bing's private opinion of this site was deciding whether Seznam heard anything at
all. Measured the same payload against each participant directly:

| Endpoint | Result |
|---|---|
| `api.indexnow.org` | 403 `UserForbiddedToAccessSite` |
| `www.bing.com/indexnow` | 403 `UserForbiddedToAccessSite` |
| `search.seznam.cz/indexnow` | **200** |
| `yandex.com/indexnow` | **202** `{"success":true}` |

`scripts/indexnow.mjs` now submits to all three separately and only exits non-zero if *nobody*
accepts. Ran live: Seznam and Yandex took all 92 URLs, the first successful ping in days.
The key file also lost its trailing newline — 33 bytes to 32 — as a candidate cause of Bing's
refusal, since Bing's validator is stricter than the spec requires. The likelier cause is that
the host is not verified in Bing Webmaster Tools, which is now item one of section 0.5.

**Google Merchant Center: ruled out, deliberately.** Merchant Center requires a unique landing
page per offer and strips URL fragments, so 141+ anchor URLs would collapse to one `link`
value and be disapproved as duplicates. Building a page per item was considered and rejected
by the owner — the shopping experience stays as it is. This costs less than it sounds: AI
shopping assistants (ChatGPT, Perplexity, Copilot) read `Product`/`Offer` JSON-LD **off the
page** and do not consume Merchant Center feeds at all. Route 2 serves them fully.
*Do not re-propose Merchant Center without first re-proposing per-item pages; they are the
same decision.*

**Every item now has an address.** Cards carry `id="<title-words>-<vinted-id>"`, and that
anchor is the `url` on the item's `Product` node. Before this there was no way to link to a
single garment — not for a shopper pasting into a chat, not for an assistant citing one. The
canonical anchor is on the **category** page, recorded in `data/anchors.json` by
`build-shop.mjs` as it paginates, because that is the only place the page an item lands on is
known. `/wardrobe` was rejected as the canonical home: it holds only the first 100 items.

**The two schema generators were merged.** `scripts/product-node.mjs` is now the only place a
catalogue item becomes a `Product`. They had drifted badly: `build-shop.mjs` emitted EUR and
handled sold items, `build-jsonld.mjs` emitted **CZK** and had no sold handling at all — so a
garment that had already sold went on advertising itself to Google as `InStock`, at a price
the site displays nowhere. Same SKU, two prices, contradictory availability, which is exactly
the entity inconsistency section 1 flags. Euro everywhere now, by the owner's decision.

**`/how-it-works` created.** One page for how buying works, prices and currency, shipping,
returns, five FAQs, privacy and terms. Linked from the footer site-wide, marked up as
`WebPage` + `BreadcrumbList` + `FAQPage` with the five answers verbatim. The four-step "How
buying works" block and the currency note **moved here** from the ~80 shelf pages that carried
them. That cost is real and was accepted knowingly: the block used to answer "how does it
reach me, what if it does not fit" at the moment someone was looking at a €29 garment, and now
it answers them one click away. If conversion suffers, the fix is a one-line summary linking
here — not eighty copies of the full text.

Shipping and return facts are stated minimally and honestly: Vinted's own terms and Buyer
Protection govern second-hand sales; vendor stock ordered on WhatsApp carries the EU 14-day
right of withdrawal, which is law whether or not the page says so, and costs are "confirmed
with you before you pay" rather than invented figures.

**`shippingDetails` and `hasMerchantReturnPolicy` are deliberately NOT in the product markup.**
They are the highest-leverage fields left for merchant rich results, and both need concrete
numbers — postage cost, delivery window, who pays return postage — that the minimal route
above deliberately does not commit to. Open, not dropped. See section 0.5.

**Shelf navigation stopped scrolling sideways.** `.cat-nav` wraps; the fade mask is gone.
Horizontal scroll hid half the primary navigation behind a gesture, gave no overview of how
many shelves exist, and was close to undiscoverable with a mouse. The subcategory strip wraps
too, clamped to two rows with a measured "Show all (n)" button that only appears when there is
genuinely a third row.

Measured cost, so it is on the record: on a 375px phone the wrapped shelf strip is 244px tall
across five rows, and the first product card sits at y=1031. The scrolling version was one
row. Tightening the chip padding and type at ≤520px recovered only 8px — the constraint is
label length, not padding. **If this matters, the lever is the labels**, not the layout:
"Home decor 131" and "Everything 1632" are what force two chips to a row. That is a copy
decision and has not been made unilaterally.

**Availability moved in with the other filters.** It sat beside the search box on the argument
that "can I buy this" precedes "which colour" — true, but it is still a filter, and a filter
parked outside the filter group is one people do not find when they go looking for filters. It
now leads the refinements, which are open by default on desktop, and the disclosure counts it
like any other set control so a shared "sold only" link still explains itself on a phone.

**`data/first-seen.json` — a new data file, do not delete it.** The two catalogues had no
shared clock: Vinted ids and Govinda SKUs both ascend with time but mean nothing to each
other, so `build-shop.mjs` dodged the problem by forcing every vendor item to sort last. That
is why the Others shelf — twenty-nine Govinda pieces and one Apple trackpad — put a trackpad
on the home page. Now the clock is recorded: the first time a build sees an id it stamps
today's date and never rewrites it. "Newest" is a fact about when a thing appeared rather than
a guess from its id, the home-page tile follows it automatically, and nothing is pinned.
Seeded 2026-08-22 with all 1,632 items on the same date, so the tiebreak (Vinted before
Govinda, each newest-first by its own id) decides tiles until real dates accumulate. One
hand-set entry, documented in the file's own `_comment`.

A `featured` pin was built first and reverted the same session, at the owner's direction: a
dormant pin is a thing that surprises whoever finds a tile not matching the sort order later.
`featured` in `data/overrides.json` is dead data again. Do not revive it without asking.

**Bug found and fixed in passing: the sitemap had lost every image.** `build-sitemap.mjs`
tested `src.startsWith("images/")`, written when the markup used repo-relative paths. Shelf
pages moved into `/wardrobe/` and began emitting `/images/...`, at which point the test matched
nothing, silently: "93 pages, 0 images", no error, for as long as that has been true. Now 985
images across the sitemap.

---

## 4. Keyword targets

Ten per page, chosen for *winnability by a one-person site*, not for headline volume. Chasing
"yoga Prague" is a waste of a solo operator's time; the long tail is where you actually rank,
and it is also the exact shape of question people ask ChatGPT and Perplexity.

### `/` — Indian in Prague

| # | Query | Intent | Difficulty | Where it is answered |
|---|---|---|---|---|
| 1 | indian clothes prague | transactional | low | home + `/clothes` |
| 2 | contemporary indian clothing europe | commercial | medium | needs 3.5 copy |
| 3 | where to buy indian clothes in prague | transactional | low | home |
| 4 | block print clothing prague | transactional | very low | `/clothes` glossary |
| 5 | handloom cotton clothing europe | commercial | medium | `/clothes` glossary |
| 6 | indian restaurants prague authentic | informational | medium | `/diaries#food` |
| 7 | best indian food prague real spice | informational | low | `/diaries#food` |
| 8 | vegan indian prague | informational | low | `/diaries#vegan` |
| 9 | modern indian fashion not goa hippie | informational | very low | needs 3.5 copy |
| 10 | indian jewellery prague silver | transactional | low | `/jewellery` |

### `/wardrobe` and `/how-it-works` — added 22 Aug 2026

`/wardrobe` replaced `/spirituality` as the second primary target. The queries below are
transactional and long-tail on purpose: they are what a buyer types, and they are the same
shape as what an assistant gets asked.

| # | Query | Intent | Difficulty | Where it is answered |
|---|---|---|---|---|
| 1 | buy indian clothes online europe | transactional | medium | `/wardrobe/fashion` |
| 2 | second hand indian clothes europe | transactional | low | `/wardrobe` |
| 3 | indian jewellery silver buy europe | transactional | low | `/wardrobe/jewellery` |
| 4 | kanthi mala buy europe | transactional | very low | subcategory page |
| 5 | indian incense buy prague | transactional | very low | `/wardrobe/meditation` |
| 6 | where to buy indian home decor europe | commercial | low | `/wardrobe/home-decor` |
| 7 | does she ship indian clothes to germany | informational | very low | `/how-it-works` |
| 8 | indian clothing sizes vs european sizes | informational | medium | `/how-it-works` FAQ |
| 9 | is it safe to buy indian clothes on vinted | informational | low | `/how-it-works` FAQ |
| 10 | return policy indian clothes shop europe | informational | very low | `/how-it-works` |

7–10 exist because of the new page and are the ones an AI assistant is most likely to quote
verbatim, since each is answered by a visible question-and-answer pair carrying `FAQPage`
markup. They will never be high-volume. They are close to uncontested, and they are asked by
someone who is already deciding whether to buy.

Every item on a shelf is also individually addressable now (`3.11`), so an assistant answering
"does anyone in Europe sell oxidised silver Indian bracelets" has a URL for the specific piece
rather than only the shelf.

### `/spirituality`

| # | Query | Intent | Difficulty | Where it is answered |
|---|---|---|---|---|
| 1 | ayurveda prague | commercial | medium | services section |
| 2 | panchakarma retreat india from europe | commercial | medium | journeys |
| 3 | ayurvedic consultation prague | transactional | low | services |
| 4 | yoga retreat rishikesh authentic | commercial | high | journeys |
| 5 | marma therapy prague | transactional | very low | services |
| 6 | ayurvedic oils europe shipping | transactional | low | products |
| 7 | copper vessels ayurveda buy europe | transactional | very low | products |
| 8 | chakras explained root to crown | informational | medium | chakra section |
| 9 | yoga trip to india small group | commercial | medium | journeys |
| 10 | is yoga connected to religion | informational | low | FAQ — now schema'd |

Note how many of these are now directly answered by structured data added in 3.1. #10 in
particular is a verbatim FAQ answer, which is the single most citable format there is.

---

## 5. Free / near-free tooling

Everything here is $0. Nothing on this list needs a subscription.

- **Google Search Console** — already set up for both properties. Good.
- **Bing Webmaster Tools** — `[ ]` **not set up, and this is now blocking IndexNow, not just
  desirable.** Step-by-step instructions are in section 0.5.
  ChatGPT Search is Bing-backed. This is the closest thing to a direct lever on ChatGPT
  visibility and it is free. Highest-priority item you can do yourself in ten minutes.
  Import directly from GSC, no re-verification needed.
- **IndexNow** — wired in `scripts/indexnow.mjs`, and as of 22 Aug 2026 it submits to Bing,
  Seznam and Yandex separately rather than through `api.indexnow.org`. Seznam and Yandex accept;
  Bing 403s until the Webmaster Tools item in section 0.5 is done. See 3.11.
- **Manual AI-visibility check** — every fortnight, ask ChatGPT, Perplexity, Claude and
  Google AI Mode the ten queries in section 4 and log whether the site is cited. This is what
  paid "AI visibility monitoring" tools do; done by hand at this scale it is free and more
  accurate. Log in section 7.
- **Cloudflare Web Analytics** — free, cookieless, privacy-preserving. Would not violate the
  site's "no trackers" promise the way GA4 would. `[?]` your call; the promise is a real asset.
- **PageSpeed Insights / Lighthouse** — free field + lab data. Re-run after 3.2 ships.
- **Vinted profile** — entity consistency (section 1). Ensure the bio names "Indian in Prague"
  identically and links back. Free, five minutes, real GEO value.

---

## 6. The recurring loop

Small and sustainable, because it has to survive being one person's side of a side project.
An abandoned elaborate routine is worth less than a modest one that actually runs.

**Weekly (~15 min)**
- GSC → Performance: note new impressions, any query at position 11–20 (these are page-two
  and the cheapest wins available — a small copy tweak often lifts them onto page one).
- Confirm the publish job ran and IndexNow pinged.

**Fortnightly (~20 min)**
- Run the section 4 queries through ChatGPT / Perplexity / Google AI Mode. Log in section 7.
- Fix anything wrong in what they say about you — a wrong fact repeated by an AI is worse
  than no mention.

**Monthly (~1 hr)**
- One new substantive piece of first-hand writing. One is genuinely enough. Recency is a
  ranking factor for Perplexity specifically, and first-hand content is the one thing here
  that competitors cannot replicate.
- Re-run Lighthouse on both targets.
- Update section 7.

**Quarterly**
- Re-read this doc. Re-audit the `[?]` items. Check whether anything in section 1 has shifted
  — this field moves fast and half of section 1 will be stale within a year.

---

## 7. Measurement log

Record baselines here so progress is visible. Start the day after the 3.2 changes go live.

| Date | Page | Payload | LCP | GSC impressions | GSC clicks | Avg pos | AI citations (C/P/G) |
|---|---|---|---|---|---|---|---|
| 2026-08-17 | `/` | 19.7 KB | — | baseline | baseline | — | 0 / 0 / 0 |
| 2026-08-17 | `/spirituality` | ~863 KB | — | baseline | baseline | — | 0 / 0 / 0 |
| _(post-fix)_ | `/spirituality` | ~260 KB | | | | | |

C/P/G = ChatGPT / Perplexity / Google AI Overviews.

---

## 8. Sources

Research current as of Aug 2026. Re-verify quarterly — this field moves fast.

- [AI Search Statistics 2026 — SEO Sherpa](https://seosherpa.com/ai-search-statistics/)
- [How ChatGPT, Google AI Overviews, and Perplexity Source Information in 2026 — Leapd](https://www.leapd.ai/blog/ai-visibility/how-chatgpt-google-ai-overviews-and-perplexity-source-information-in-2026)
- [Generative Engine Optimization: Complete 2026 Guide — Enrich Labs](https://www.enrichlabs.ai/blog/generative-engine-optimization-geo-complete-guide-2026)
- [Mastering generative engine optimization in 2026 — Search Engine Land](https://searchengineland.com/mastering-generative-engine-optimization-in-2026-full-guide-469142)
- [Answer Engine Optimization in 2026: A Practical Playbook — ALM Corp](https://almcorp.com/blog/answer-engine-optimization-2026/)
- [State of llms.txt 2026 — Presenc AI](https://presenc.ai/research/state-of-llms-txt-2026)
- [AI Search Optimization: Per-Engine Playbook for 2026 — Layer3Labs](https://www.layer3labs.io/guides/ai-search-optimization)
