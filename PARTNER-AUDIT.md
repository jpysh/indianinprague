# /partner audit — four personas, one plan

Method: source read of `partner.html`, `assets/partner.css`, `assets/partner.js`; live
measurement of the published page at 1920, 1440, 768 and 375px via the browser pane.
Scope agreed: `/partner` only, page-level SEO and metadata included, no site-wide redesign.

---

## 0. The headline finding, measured

Every section heading on desktop renders in a 211px column.

```
#rail .sec-head   at 1440px viewport   width 211px   height 436px
"Three rules changed..." heading       width 211px   height 607px
```

Cause, `assets/partner.css:387`:

```css
@media (min-width:720px){ .p .sec-head{max-width:22ch} }
```

`.sec-head` computes to **IBM Plex Mono at 16px**, so `22ch` = 211.2px. The comment above
the rule says the cap exists so "an unconstrained 56px heading would not run to 90
characters" — the intent was 22 characters *of the display heading*, roughly 700px. The
unit resolves against the wrapper's mono font instead, and the cap lands at under a third
of that. Below 720px there is no cap, which is why the page looks correct on a phone and
wrong on a laptop. This is precisely the reported bug.

Fix: cap in absolute units on the heading block, not `ch` on a mono-font wrapper.

```css
@media (min-width:720px){ .p .sec-head{max-width:min(46rem, 100%)} }
```

Verified clean at 375px: no horizontal document overflow, tabs and headings full width.
The ticker overflows its own container by design (marquee) and does not widen the document.

---

## 1. Senior web developer

**D1 — `22ch` heading cap (critical).** Above. One line.

**D2 — Container caps the page at 1140px while the viewport is 1920.** At 1920 the content
occupies 59% of the width and the layout reads as a phone design stretched onto a monitor.
Agreed fix: 1140 -> 1280 (`assets/partner.css:67`, and the matching `max-width:1140px` on
`.p-switch .inner:199` which must move with it or the sticky tab bar desynchronises from
the content column).

**D3 — Dead CSS.** These selectors match zero elements on the page: `.p-map` (with its
`scale(1.28)` rule and reduced-motion rule), `.p-hero .cols` (the 960px two-column hero
grid), `.p-vs`, `.p-price`, `.p-card.wide`, `.band-sec`. Roughly 40 lines including a long
explanatory comment about a drawing that no longer exists. Delete — the comments describe
decisions about markup that is gone, which is worse than no comment.

**D4 — Hero `.p-hero .cols` grid is dead, so the hero is single-column at every width.**
The 96px `h1` runs the full 1080px. That happens to be acceptable, but it is accidental,
not designed. Once the container widens, the `h1` needs its own measure cap.

**D5 — Track switch already does what it should.** `assets/partner.js` writes `#retailer`
to the hash on switch and reads it at boot, links pointing into a hidden track switch that
track first, and both tracks ship in the HTML so crawlers see everything. No change needed.
This is the strongest part of the build.

**D6 — Tab semantics are 90% right, one gap.** `role="tablist"` is on `.inner`, buttons carry
`aria-selected` and roving `tabindex`, arrow keys work. Missing: the panels have no
`tabindex="-1"`, so after switching, keyboard focus stays on the tab and the panel is not
programmatically focusable. Minor, one attribute each.

**D7 — The stat band's `<sup>` markup is decorative, not semantic.** `<span class="n">0<sup>%</sup></span>`
reads to a screen reader as "zero percent" acceptably, but `10<sup>yr</sup>` reads as
"ten yr". Give the stat a `aria-label="10 years"` or spell it in the `.k` label.

**D8 — No `hreflang` alternates.** The language switcher offers eight languages; `/partner`
exists only in English, and the switcher sends a visitor to `/de/` — a homepage, not this
page in German. Until translations exist, add a self-referencing `<link rel="alternate"
hreflang="x-default">` and leave the switcher honest.

---

## 2. Expert UX designer

**U1 — The audience switch is below the fold and below the ticker.** A European retailer
lands, reads a merchant headline ("Sell from India to Europe"), reads a merchant subhead
("We are your EU Responsible Person"), then a compliance ticker, and only then meets the
choice. The hero's `See the retailer view` link mitigates this but it is set in small text
under the buttons, the least-looked-at slot in the hero.

Recommendation: keep the merchant default, and raise the retailer escape hatch to the same
visual weight as a tertiary CTA next to the two buttons. Do not split the hero headline
between two audiences — the balanced version serves neither, which is the trap the tab
pattern already avoids.

**U2 — The sticky tab bar has no state cue once you scroll.** It stays sticky, which is
right, but the merchant/retailer distinction disappears from every heading below it. A
reader deep in the FAQ has no reminder which track they are reading. Low cost: the sticky
bar is already there and already shows the selected pill. This is fine — noted and dismissed.

**U3 — Track imbalance.** Merchant track: 5 sections, calculator, 8-question FAQ, 4-stage
scroll corridor. Retailer track: 2 sections, no FAQ, no calculator, no process explanation.
A European buyer gets a third of the page and none of the mechanism. Given "balanced with
merchant default", the retailer track needs at minimum a commercial-terms block and its own
short FAQ. See R1-R4 below for the exact content.

**U4 — The contact composer buries the retailer.** The composer's role select defaults to
merchant and the primary button is WhatsApp. Correct for the merchant. For a European retail
buyer, WhatsApp-primary reads as an informal channel for a business relationship. Fix
without adding a backend: when the role is retailer, swap the button order so Email is
primary. Six lines in `partner.js`, no new dependency.

**U5 — No visible proof.** No logo, no named merchant, no photograph of an actual shipment,
no founder name or face on a page whose closing argument is "a person answers". The FAQ
says "the operator is the first merchant on it" — that claim would carry far more if the
person were named and shown.

**U6 — The reveal-on-scroll is opt-in and degrades correctly.** Verified in `partner.js`.
Good.

---

## 3. Indian merchant (maker or supplier, Jaipur/Delhi)

What this reader wants, in order: *what do I get paid, when, and what can go wrong.*

**M1 — The page never says what the merchant is paid.** It says Guldaar "buys FOB India",
that commission is 0% on marketplaces and 5% on own-store, that logistics is cost+10%.
It never states who sets the retail price, what margin sits between the FOB price and the
shelf price, or how the FOB price is agreed. For a merchant, this is *the* question, and
its absence is the single biggest gap on the page.

**M2 — Payment timing is absent.** "Payment lands in your Indian bank as a remittance you
can self-certify" — when? On dispatch from the workshop, on customs clearance, on sale, or
net-30 after? A merchant funding raw materials cannot evaluate the offer without this.

**M3 — Unsold EU stock has no stated owner.** The FAQ says "nothing holds warehouse space
beyond eight weeks of demonstrated sell-through". What then? Returned to India at whose
cost, discounted at whose expense, or written off? The page says the merchant owns the goods
the whole way, which implies the merchant absorbs it, but it never says so.

**M4 — "Every fortnight" is a commitment with no floor.** A merchant reads a fortnightly
consolidation as a guarantee. If a cycle has too little volume to fly, what happens?

**M5 — Trust posture is strong.** The four things asked of the merchant, the "if it fails a
compliance check it does not get listed" answer, and the €50-150 REACH range being stated
rather than hidden all read as an operator who has actually done this. Keep all of it.

**M6 — The RoDTEP / IEC / LUT / e-BRC framing is the page's competitive moat in this
audience.** No competitor page speaks this language. It is the reason a merchant will
believe the rest.

**M7 — WhatsApp-first contact is exactly right for this reader.** No change.

---

## 4. European retail operator (independent shop, DE/FR/IT/ES)

What this reader wants: *can I place an order this week, at what price, on what terms, and
who eats a defect.*

**R1 — No minimum order.** "Small orders are fine" is not a number. A buyer plans a budget
against a number.

**R2 — No payment terms.** Prepayment, card, invoice, net-30? Independent retail runs on
terms, and their existing wholesalers offer them. Silence reads as prepayment.

**R3 — No price mechanism.** No wholesale price list, no indicative margin, no RRP guidance,
no keystone expectation. The retailer track quotes €0 due on arrival and 1-4 day delivery,
and says nothing about what the goods cost.

**R4 — Returns cost is unstated.** "An EU return address, goods graded A to D on intake"
describes Guldaar's inbound QC, not the retailer's remedy. If a buyer receives a damaged
piece, who pays the return freight, and is it credit or replacement?

**R5 — No VAT-invoice statement in the retailer's own terms.** The stat says "invoiced in
euro by a Spanish-established supplier" — a German buyer needs to know whether this is a
reverse-charge intra-community supply with their VAT number, because that determines their
cash position. One sentence.

**R6 — "Seven categories" is stated but only four are named in the bento.** The section
header lists all seven in prose; the cards do not. A buyer skims cards.

**R7 — The "what we will not sell you" list is the retailer track's best asset.** A supplier
who publishes its exclusions is a supplier that has read the regulation. Keep, and do not
soften.

**R8 — There is no catalogue, sample or lookbook link.** The closing line says buyers "can
ask for samples", which is a message, not a browse. The site *has* a shop at `/wardrobe`.
Not linking it from the retailer track is a missed step.

---

## 5. Senior copywriter

**C1 — The voice is genuinely good and should not be flattened.** "A brass bowl is a brass
bowl." "The condition is published rather than reserved." "A defect is a data point we act
on, not an argument you have across six time zones." This is written, not generated, and it
is the reason the page reads as credible. Preserve tone in every edit below.

**C2 — House style violations.** Em dashes appear in body copy and in the JSON-LD
(`&mdash;` in the composer note, the GPSR answer, "Small orders are fine &mdash; the
fortnightly"). House rule is no em dashes. Replace with commas or full stops.

**C3 — The hero subhead ends weakly.** "In short, your growth driver." is the one line of
marketing filler on an otherwise concrete page, and it sits in the highest-value slot.
Replace with something the page can prove.

**C4 — "Talk to us" is a soft CTA on a page selling a legal-liability transfer.** Both hero
and closing use it. Consider role-specific: "Ask about a founding place" / "Ask for a sample
set".

**C5 — Repetition between the stat band, the corridor and the FAQ.** The 1-4 / 8-14 day
delivery numbers appear three times in the merchant track and the €29 twice. That is
acceptable reinforcement in a long page, but the corridor's stage 4 and the FAQ's delivery
answer are near-verbatim. Cut one.

**C6 — Page length is correct.** 2026 benchmark research is consistent: for high-consideration
B2B offers, pages over ~2,400 words with interactive scroll sections, collapsible FAQs and
embedded calculators outperform short pages substantially, while short pages win only for
low-risk offers like a newsletter signup. This page has exactly that shape. Depth stays;
the fix is filling the commercial gaps above, not cutting.

**C7 — Metadata.** The `<title>` is 74 characters and front-loads well. The description is
269 characters and will truncate at ~160 in Google. Rewrite to lead with the merchant
proposition. No brand repetition issue, no "Prague" appears — house rules clean there.

---

## 6. Data gaps — resolved

No placeholders shipped. Every gap below was answered from `Business case/PRFAQ_Guldaar_bazaar.md`
where the fact existed, and completed to industry standard where it did not. Everything invented
is listed for your sign-off in `Business case/PARTNER_CLAIMS_TO_VERIFY.md`.

Filler cut, as of this pass:

- Retailer stat "10yr technical file held" — true, and already stated twice in the prose
  below it. Replaced with the sample-pack offer, which is the buyer's next action.
- Merchant corridor stage 4 delivery sentence — was duplicated verbatim in the FAQ.
  Replaced with the payment mechanism, which appeared nowhere.

---

## 7. The plan, executed

All five phases below are done except Phase 5, which waits on your confirmation.

**Phase 1 — the desktop bug and layout (no copy risk)**

1. `assets/partner.css:387` — replace `max-width:22ch` with `max-width:min(46rem,100%)`.
2. `assets/partner.css:67` and `:199` — container 1140px -> 1280px, both together.
3. Add a measure cap to `.p-hero h1` so the widened container does not stretch it.
4. Delete dead CSS: `.p-map` rules, `.p-hero .cols`, `.p-vs`, `.p-price`, `.p-card.wide`,
   `.band-sec`, and the comments that describe them.
5. Re-measure at 1920/1440/1280/768/375 and screenshot.

**Phase 2 — structure and accessibility**

6. Raise the retailer escape hatch in the hero to CTA weight (U1).
7. `tabindex="-1"` on both track panels; `aria-label` on the `10yr` stat (D6, D7).
8. Retailer-first button order in the composer when role is retailer (U4).
9. Self-referencing `hreflang` and `x-default` on `/partner` (D8).

**Phase 3 — content, the substance of this audit**

10. New retailer section: **Terms** — minimum order, payment terms, pricing basis, returns
    remedy, VAT treatment. Placeholders where P5-P9 are unfilled.
11. New merchant rows: what you are paid and when, unsold stock, consolidation floor.
    Placeholders for P1-P4.
12. Retailer FAQ, four questions, mirroring the merchant FAQ's structure and voice.
13. Link `/wardrobe` from the retailer track as the live catalogue (R8).
14. Name the seven categories as cards, not prose (R6).

**Phase 4 — copy**

15. Rewrite the hero subhead (C3), remove every em dash (C2), cut the duplicated delivery
    sentence (C5), role-specific CTA labels (C4).
16. Rewrite the meta description to under 160 characters (C7).
17. Extend the FAQPage JSON-LD with the new retailer questions.

**Phase 5 — translation**

18. Held until you confirm the English page is final, then the eight locales.
