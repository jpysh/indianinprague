// The one place a catalogue item becomes a schema.org Product.
//
// It used to be two places, and they disagreed. build-shop.mjs emitted euro and handled
// sold items; build-jsonld.mjs emitted koruna and had no sold handling at all, so a garment
// that sold on Vinted went on advertising itself to Google as InStock, at a price the site
// no longer displayed anywhere. Same SKU, two prices, contradictory availability — which is
// exactly the entity inconsistency answer engines are documented to check for.
//
// Merging them is the fix. Anything that needs a Product node calls productNode(); there is
// no second copy left to drift.

const SITE = "https://indianinprague.jains.es";

/** The anchor a single item is reachable at, e.g. "indian-boho-dress-9729949801".
 *
 * Readable words plus the Vinted id. The words are what makes a shared link legible to a
 * human and carry a little of the item's language into the URL; the id is what makes it
 * unique, because two dresses can share a title and the number never repeats.
 *
 * The id is NOT replaced by the slug. sku stays the number: it already keys the photos on
 * disk, the overrides file and the archive, and minting a second identifier would mean
 * maintaining a mapping whose only job is to eventually disagree with the first one. */
export function itemSlug(item) {
  const words = String(item.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 6)          // Vinted titles are keyword-stuffed with pipes; six words is the piece.
    .join("-");
  return words ? `${words}-${item.id}` : String(item.id);
}

/** A schema.org Product for one catalogue item.
 *
 * `url` is the page anchor this item is reachable at — the card lives on a shelf page, not
 * on a page of its own, so the anchor IS its address. Passing it in rather than deriving it
 * keeps every page's graph self-consistent: the Product a page describes points at that
 * page. */
export function productNode(item, url) {
  const sold = !!item.sold;
  // Vendor stock the supplier has run out of. Recoverable, unlike sold — the piece is
  // expected back — but not buyable today either way.
  const oos = !sold && item.vendor && item.inStock === false;

  return {
    "@type": "Product",
    name: item.title,
    // Emitted on sold items too: an identifier is how a crawler recognises that the SoldOut
    // product it sees today is the one it indexed as InStock last week, rather than a
    // different piece that happens to share a title.
    sku: item.id,
    productID: item.id,
    ...(item.description
      ? { description: item.description.replace(/\s+/g, " ").trim().slice(0, 400) }
      : {}),
    ...(item.photo ? { image: `${SITE}/${item.photo}` } : {}),
    ...(item.brand ? { brand: { "@type": "Brand", name: item.brand } } : {}),
    ...(item.color?.en ? { color: item.color.en } : {}),
    ...(item.size ? { size: item.size } : {}),
    ...(item.category ? { category: item.category } : {}),
    // The item's own address on this site. A sold piece keeps it: the card is still on the
    // page, and a crawler that can reach it can see for itself that it is gone.
    ...(url ? { url } : {}),
    offers: {
      "@type": "Offer",
      // A sold piece is declared SoldOut with no price and no url, rather than quietly left
      // out. Omitting it would misrepresent the page (the item IS on it), and marking it
      // InStock would put an unbuyable product into search results.
      //
      // No price on a sold item either: Vinted strips the price from a sold listing, and
      // inventing one would misstate what the piece actually fetched.
      ...(sold
        ? { availability: "https://schema.org/SoldOut" }
        : {
            // Vendor items have no listing URL — they are bought here, through WhatsApp — so
            // the offer points at the page the card sits on. No `seller` is asserted for
            // them either: naming a merchant in structured data is a public claim, and that
            // is not settled while orders run through a chat.
            ...(item.vendor ? (url ? { url } : {}) : { url: item.urls?.cz }),
            // Euro, everywhere, visible and hidden. Structured data is supposed to agree
            // with what the visitor can see, and the site states one currency. The koruna
            // figure is preserved in data/catalog.csv.
            price: item.priceEur,
            priceCurrency: "EUR",
            availability: oos
              ? "https://schema.org/OutOfStock"
              : item.reserved
                ? "https://schema.org/PreOrder"
                : "https://schema.org/InStock",
            ...(item.vendor ? {} : { seller: { "@id": `${SITE}/#author` } }),
          }),
      // Vinted's own condition, rather than assuming every piece is used — a good part of
      // this closet is listed new or new-without-tags.
      ...(item.condition?.en
        ? {
            itemCondition: /^New/.test(item.condition.en)
              ? "https://schema.org/NewCondition"
              : "https://schema.org/UsedCondition",
          }
        : {}),
    },
  };
}
