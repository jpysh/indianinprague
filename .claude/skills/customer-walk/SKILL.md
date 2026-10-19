---
name: customer-walk
description: Walk guldaarbazaar.com as a real shopper on a phone for 30 to 60 minutes against one charter, judge it as a senior UX designer against docs/design/DESIGN.md, file each finding as an issue, and turn machine-checkable findings into build guards. Use at the start of an autopilot session or after about ten merged PRs in one area.
---
1. **Charter**, one line: who, wants what, arriving from where. Examples: a Czech woman from a WhatsApp link wants a dress for a wedding, under €40; a man from Google searching "rudraksha mala" lands on a product anchor; someone with 200% text and reduced motion browses jewellery; a merchant opens /partner in Spanish. Read open `walk-found` issues first.
2. **Walk it** in the browser pane at the mobile preset, on the live site (and `site-root` for unreleased work). Count taps to the goal (a WhatsApp message or a Vinted listing). Write down every hesitation as the customer: what I expected, what happened.
3. **Judge it** against `docs/design/DESIGN.md` §1-§4 and, where one applies, a named Baymard, NN/G or Apple HIG guideline.
4. **File** each finding (`gh issue create`, labels `walk-found` plus `bug`, `polish` or `idea`): what the customer saw, what they expected, the fix in one line, the cost (S/M/L). Rank by customer harm over effort. Fix the top ones through `ship`; batch an area's cosmetics into one PR.
5. **Guard**: when a class can be checked by a machine (dead anchor, missing alt, duplicate id, empty shelf, text under 13 px, untranslated string), add the check to `scripts/build-dist.mjs` so the build fails next time.
