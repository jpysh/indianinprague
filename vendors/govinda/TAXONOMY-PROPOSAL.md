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
`Meditation` added because a third of the vendor catalogue has nowhere else to go, and
`Others` as the honest home for what genuinely fits nowhere.

| Shelf | Vinted | Govinda | Notes |
|---|---:|---:|---|
| Meditation | ~11 | 486 | **New.** Malas, incense, deities, worship items |
| Fashion | 49 | 344 | Clothing and bags, both vendors |
| Jewellery | 37 | 242 | Lifted out of Govinda's `Fashion` to match your existing shelf |
| Home Decor | 12 | 127 | Accessories, textiles, crockery, boxes |
| Books | 39 | 91 | |
| Wellness | 1 | 82 | Govinda's `Cosmetics` folded in |
| Others | 2 | 78 | **New.** Anything that fits nowhere, kept visible rather than hidden |
| Food | 0 | 27 | **New.** Spices, honey, prasadam, Ayurvedic supplements |

### No `Gifts` shelf

Dropped, as asked — and looking at what was actually in it, it should never have been a
shelf. The branch is not gifting, it is devotional goods filed by object type:

| Govinda branch | Items | Goes to | Why |
|---|---:|---|---|
| Small statues | 58 | Meditation › Deities | They are murtis — Damodar, Nrsimhadev, Yasoda |
| Stickers and posters | 51 | Meditation › Stickers and posters | Krishna, Durga, Hanuman |
| Boxes (incl. Rajasthani) | 28 | Home Decor › Boxes | Painted and mirror-work boxes |
| Key rings | 24 | Others › Key rings | |
| Dolls and children's gifts | 19 | Others › Dolls and children's gifts | Radha-Krishna, Nrsimha-Prahlad dolls |
| Greetings cards | 18 | Others › Greetings cards | |
| Pendants | 17 | Jewellery › Pendants | Tilak, kavaca, Nrsimhadev |
| Notebooks | 8 | Others › Notebooks | |
| Badges | 7 | Others › Badges | |

Merging the statues into `Deities` also fixes that shelf: it held 5 items, most of them
*clothes* for deities. It now holds 63 and means what it says.

### `Others`, and when it stops being `Others`

78 Govinda items plus the two Vinted oddments — the computer mouse and one arts-and-crafts
item — taking Vinted's own branch names for anything that arrives uncategorised.

Subcategories: Key rings (24), Dolls and children's gifts (19), Greetings cards (18),
Notebooks (8), Badges (7).

At ~88 items it is the second-smallest shelf, which is the right size for a catch-all. If
it grows past roughly 150, the natural split is **Stationery & keepsakes** (cards,
notebooks, badges, keyrings — 57 today) leaving dolls and true oddments behind. Not worth
doing at this size.

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

## Level 2

Max two levels below the top, as agreed. Vendor subcategories deeper than that collapse
into their parent — Govinda's author-level book tree (`Books > Other authors > Suhotra
Swami`) becomes a brand-style filter rather than a URL.

| Shelf | Subcategories (Govinda counts) |
|---|---|
| Meditation | Kanthi malas (108), Devotional pictures (86), Deities (63), Japa bead bags (60), Incense sticks (53), Stickers and posters (51), Bead counters (22), Worship items (20), Malas and clickers (13), Incense holders (6), Tilak and Ganga clay (3) |
| Fashion | Women's clothing, Men's clothing, Children's clothing, Bags |
| Jewellery | Bindi (101), Bracelets (42), Necklaces (28), Pendants (17), Earrings (15), Other adornments (10), Anklets (4) |
| Home Decor | Home textiles (36), Crockery (34), Home accessories (29), Boxes (28) |
| Books | Srila Prabhupada, Other authors, Foreign languages, Cookery books, For children, Second-hand books, Audio and video, E-books |
| Wellness | Creams and oils, Soaps, Oil-based perfumes, Shampoos and hair dyes, Dental hygiene, Make-up |
| Others | Key rings, Dolls and children's gifts, Greetings cards, Notebooks, Badges |
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

- Vinted's `Electronics` and `Hobbies & collectables` branches map to `Others`, keeping
  Vinted's own subcategory names. That rule goes into data/taxonomy.json at build time, not
  now — it would change live category assignments before the tree is approved.
- Govinda's `01` and `01 02` categories are junk in their own data and are skipped.
- 8 of 1,485 product URLs do not resolve to a category and need a look during the scrape.
