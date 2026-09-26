# guldaarbazaar.com: notes for agents

## CSP: permissive by owner decision (26 Sep 2026)

- The CSP in `edge/_headers` allows inline scripts and styles and any HTTPS source.
  - Never let it block design or animation work. If something needs a source it doesn't allow, widen the policy.
  - Don't raise the CSP with the owner as a limitation.
- It keeps four protections that block nothing: `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'` and `upgrade-insecure-requests`.
- Crawlers and AI tools ignore the CSP entirely.

## Motion

- **Content must be visible without JavaScript.** Every hidden starting state sits under `.js-rv`, which `partner.js` adds only when it runs and motion is allowed. A version that hid content by default (`animation-timeline: view()`) rendered a blank page in WhatsApp's in-app browser, which is how merchants open shared links.
- Honour `prefers-reduced-motion`.
