# guldaarbazaar.com: notes for agents

## CSP: permissive by owner decision (26 Sep 2026)

- The CSP in `edge/_headers` allows inline scripts and styles and any HTTPS source.
  - Never let it block design or animation work. If something needs a source it doesn't allow, widen the policy.
  - Don't raise the CSP with the owner as a limitation.
- It keeps four protections that block nothing: `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'` and `upgrade-insecure-requests`.
- Crawlers and AI tools ignore the CSP entirely.

## Security posture: repo stays public (owner decision, 19 Oct 2026)

- The repo is public on purpose (building in public; keeps GitHub's free protections). Do not propose going private.
- On: secret scanning with push protection, Dependabot alerts and security updates, CodeQL default setup, ruleset `protect-main` (no force-push, no deletion), private vulnerability reporting.
- Hosting is Cloudflare free tiers only. No self-hosted origin; the Docker, nginx and tunnel files were deleted.
- Owner enables 2FA on GitHub and Cloudflare (issue on the owner list). Never put secrets in tracked files.

## Motion

- **Content must be visible without JavaScript.** Every hidden starting state sits under `.js-rv`, which `partner.js` adds only when it runs and motion is allowed. A version that hid content by default (`animation-timeline: view()`) rendered a blank page in WhatsApp's in-app browser, which is how merchants open shared links.
- Honour `prefers-reduced-motion`.
- No scroll-driven opacity, clip or fade on content anywhere (`animation-timeline:view()` removed 19 Oct 2026: pale mid-scroll photos and headings).

## iOS Safari rendering: banned on the shop grid

- No `grid-template-rows:subgrid` on `#grid` cards, and no `mix-blend-mode` or `backdrop-filter` anywhere. On iPhone Safari (reduced motion) they made photos draw over titles, the sticky header vanish and the fixed Filters button float mid-screen (1 Oct 2026).
- Verify shop CSS changes in WebKit at iPhone width before pushing, not just Chromium.

## Autopilot (owner decision, 19 Oct 2026)

The owner does not code. Claude runs the site end to end: finds issues, decides, builds, verifies, ships. Only the owner's calls go to them, one line each.

- **Design authority:** `docs/design/DESIGN.md`, mobile first at 375 wide. Read it before any visual change; add a missing rule there first.
- **The record is GitHub issues.** One open issue labelled `owner` is the owner's short list: decisions waiting on them and the next-session prompt. Findings get `walk-found` plus `bug`, `polish` or `idea`. Search open issues before filing. Use the number `gh issue create` returns; never guess one.
- **Loops.** Every change goes through skill `ship`. Work is found by skill `customer-walk`. A finding a machine can check becomes a guard in `scripts/build-dist.mjs`.
- **Frugal.** Delete, reuse, native feature, CSS before JS, then a library (DESIGN.md §5). No paid service without the owner's yes.
- **Owner's calls, never Claude's:** prices, brand voice and new copy themes, anything legal or on `/partner`, deleting a page or shelf, a paid service, DeepL spend beyond a few strings. Ask on the owner issue and carry on with other work.
- **Translations are DeepL only** (`scripts/translate.mjs`). If DeepL fails, stop and tell the owner on the owner issue; never translate with Claude unless the owner asks for that one job. Never write `data/i18n/overrides/` (the owner's layer).
- **Untracking a file deletes it on the Mac.** `git rm --cached` plus a pull removes the file from every checkout. Before untracking anything a local service uses, copy it out first (the dashboard died this way, Oct 2026).
- **Parallel sessions.** Other sessions work on this repo at the same time. Before each PR, sync with `origin/main` and rerun the build; a conflict in generated pages is fixed by rebuilding, never by hand.
- **Shopper checks** on any visual change: `node tools/check/check-mobile.mjs <paths>` (WebKit at iPhone width, reduced motion: sideways scroll at 100% and 200% text, 44 px targets, 4.5:1 contrast). Setup once is in `tools/check/package.json`.
- **Guardrails.** One theme per session. Two strikes: if the same fix fails twice, stop and write what was tried on the issue. Re-running a check without changing anything is a loop: stop. Each PR small enough to revert cleanly.
- **Research** the primary source before a design change (Apple HIG, Baymard, NN/G, web.dev) and name it in the PR in one line. Do not re-research a question an issue already answers.
