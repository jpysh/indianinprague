# guldaarbazaar.com

Source of [guldaarbazaar.com](https://guldaarbazaar.com): a small shop and guide for Indian clothing, jewellery and spiritual goods, sold second-hand and handmade, with pages in eight languages (English plus ru, fr, de, it, es, pl, cs).

It is a static site. Plain HTML, CSS and a little JavaScript; no framework. Node scripts generate the shop shelves, translated pages and sitemap from data files.

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

Issues are welcome. Open an issue before a pull request; the owner decides copy, prices and anything on `/partner`.
