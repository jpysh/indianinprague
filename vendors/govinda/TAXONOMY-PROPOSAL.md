# Taxonomy proposal — one tree for two vendors

Step 2 of the Govinda integration. Nothing is built from this yet; it needs approval first,
because the URLs it implies are expensive to change once 1,485 vendor items and their
filter pages exist.

## What is being merged

| | Items | Source |
|---|---|---|
| Vinted closet | 141 live, 24 sold | Secondhand, one-of-a-kind, yours |
| Govinda | 1,485 | New retail, restockable, shipped from Prague |

Vinted items sit in 6 top-level branches, almost all under `Women` (87) and
`Books & Media` (39). Govinda's 138 categories sit under 7.

## Proposed top level of `/wardrobe`

Eight shelves. Your existing tree kept wherever it survives contact with 1,485 new items;
`Meditation` added because a fifth of the vendor catalogue has nowhere else to go.

| Shelf | Vinted | Govinda | Notes |
|---|---:|---:|---|
| Fashion | 49 | 490 | Clothing and bags, both vendors |
| Meditation | ~11 | 377 | **New.** Ritual objects, malas, incense, deities |
| Gifts | 0 | 232 | **New.** Statues, boxes, cards, keyrings |
| Home Decor | 12 | 99 | Accessories, textiles, crockery |
| Books | 39 | 91 | |
| Jewellery | 37 | 79 | Lifted out of Govinda's `Fashion` to match your existing shelf |
| Wellness | 1 | 82 | Govinda's `Cosmetics` folded in |
| Food | 0 | 27 | **New.** Spices, honey, prasadam, Ayurvedic supplements |

### What changed from your current tree, and why

- **`Wardrobe` is the store, not a shelf.** It stops being a page in the nav and becomes the
  root: `/wardrobe`, with every shelf beneath it.
- **`Clothes` and `Wardrobe` stop overlapping.** `Clothes` becomes `Fashion` at
  `/wardrobe/fashion`, which is what the filter already calls it in your data.
- **`Ritual Objects` moves under `Meditation`** — as you asked. It stops being a top-level
  shelf and becomes `/wardrobe/meditation/worship-items`, alongside malas, incense and
  deities. On its own it was a shelf a shopper could not tell apart from `Spirituality`.
- **`Spirituality` leaves the shelf list entirely.** It is an editorial page about
  experience, products and services — it stays at `/spirituality`, links into the shelves,
  and no longer pretends to be a category.
- **`More` disappears.** Everything it held now has a real home.
- **`Gifts` and `Food` are new** because 259 vendor items would otherwise be Uncategorised.

## Level 2

Max two levels below the top, as agreed. Vendor subcategories deeper than that collapse
into their parent — Govinda's author-level book tree (`Books > Other authors > Suhotra
Swami`) becomes a brand-style filter rather than a URL.

| Shelf | Subcategories |
|---|---|
| Fashion | Women's clothing, Men's clothing, Children's clothing, Bags |
| Meditation | Worship items, Japa bead bags, Kanthi malas, Malas and clickers, Rudraksha, Incense sticks, Incense holders, Deities, Devotional pictures, Tilak and Ganga clay, Bead counters |
| Gifts | Small statues, Boxes, Notebooks, Greetings cards, Key rings, Pendants, Badges, Stickers and posters, Children's gifts and dolls |
| Home Decor | Home accessories, Home textiles, Crockery |
| Books | Srila Prabhupada, Other authors, Foreign languages, Cookery books, For children, Second-hand books, Audio and video, E-books |
| Jewellery | Necklaces, Earrings, Bracelets, Anklets, Bindi, Silver, Other adornments |
| Wellness | Creams and oils, Soaps, Oil-based perfumes, Shampoos and hair dyes, Dental hygiene, Make-up |
| Food | Spices, Ayurvedic supplements, Prasadam and mahaprasadam, Honey |

## URLs this implies

```
/wardrobe                              the storefront, everything
/wardrobe/fashion                      shelf
/wardrobe/fashion/womens-clothing      subcategory
/wardrobe/meditation/worship-items     what /ritual-objects becomes
```

Every current shelf URL needs a 301: `/clothes`, `/books`, `/jewellery`, `/home-decor`,
`/ritual-objects`, `/more`, `/sold`. `edge/_redirects` already carries this pattern from the
16 Aug migration. `/spirituality` and `/diaries` do not move.

## Translation notes

Govinda's tree is Czech-only — there is no English storefront to read it from, unlike
Vinted. The 128 distinct category names went through DeepL, and a glossary resolves the
Sanskrit transliterations before DeepL sees them, because it reads them as Czech words:
`Kantimály` came back as "Cantimals", `Nákotníčky` as "Knee pads". The glossary is
`data/glossary.json` and is worth a look — it decides what these shelves are called.

## Open

- `Electronics Mice` — one Vinted item (a computer mouse) that fits nowhere. Currently
  Uncategorised. Suggest an override to `Gifts` or leave it out of the shop.
- Govinda's `01` and `01 02` categories are junk in their own data and are skipped.
- 8 of 1,485 product URLs do not resolve to a category and need a look during the scrape.
