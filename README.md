# guldaarbazaar.com

Source of [guldaarbazaar.com](https://guldaarbazaar.com): a small shop and guide for Indian clothing, jewellery and spiritual goods, sold second-hand and handmade, with pages in eight languages (English plus ru, fr, de, it, es, pl, cs).

It is a static site. Plain HTML, CSS and a little JavaScript; no framework. Node scripts generate the shop shelves, translated pages and sitemap from data files.

## Built in public

This repo is public on purpose: the owner is building the shop in the open, and the site is meant to be a template anyone can learn from. It is not an invitation to fork or run a copy of the shop. Product data, photos and copy belong to guldaarbazaar.com.

To build something similar, the parts worth reading are `scripts/build-dist.mjs` (static build), `edge/` (headers and redirects) and `wrangler.jsonc` (Cloudflare Workers static assets, free tier). Hosting is Cloudflare only; there is no server, database or container.

## Layout

| Path | What |
|---|---|
| `*.html`, `wardrobe/`, `content/`, `partner/` | Pages. `wardrobe/` is generated. |
| `data/` | Catalogue (`catalog.json`), translations (`data/i18n/`), vendor data |
| `scripts/` | Build and sync scripts |
| `assets/` | CSS, JS, fonts (vendored) |
| `edge/` | Cloudflare headers and redirects |
| `docs/design/DESIGN.md` | Design rules; read before any visual change |
| `CLAUDE.md` | Working notes for the AI agent that maintains the site |

## Build

```sh
npm install                      # pins wrangler only
node scripts/build-dist.mjs      # builds everything into dist/
```

Translations: `node scripts/translate.mjs --dry` shows what is missing. DeepL keys go in `.env` (see `.env.example`); never commit it.

Merging to `main` deploys to Cloudflare. Product data is synced from Vinted and a vendor feed by scripts in `scripts/` and `vendors/`.

## Contributing

Issues are welcome. Report security problems through GitHub's private vulnerability reporting (Security tab), not a public issue. Open an issue before a pull request; the owner decides copy, prices and anything on `/partner`.
