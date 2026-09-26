# guldaarbazaar.com: notes for agents

## CSP and animation

- The CSP (`edge/_headers`) is enforced by browsers only. Search and AI crawlers read the HTML and ignore it, so it never affects indexing.
- `script-src 'self'` plus Cloudflare Web Analytics, and `style-src 'self'`. That means:
  - no `style="..."` attributes in HTML, and no inline `<script>` or `<style>`: use classes in the stylesheets;
  - setting `el.style.x` or a custom property from our own JS (CSSOM) is allowed.
- Motion is native: CSS transitions and keyframes, IntersectionObserver, SVG `animateMotion`, cross-document View Transitions. No GSAP or other CDN libraries.
- `/spirituality` is the one exception: it is an imported design that uses GSAP from cdnjs under its own relaxed CSP. Do not copy that exception elsewhere.
- **Content must be visible without JavaScript.** Every hidden starting state sits under `.js-rv`, which `partner.js` adds only when it runs and motion is allowed. A version that hid content by default (`animation-timeline: view()`) rendered a blank page in WhatsApp's in-app browser, which is exactly how merchants open shared links.
- Honour `prefers-reduced-motion`: no `.js-rv`, no keyframes, and no view transitions for those visitors.
