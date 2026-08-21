// Fixture is the real markup from an item page, trimmed. Asserts the two things that
// actually matter: every category level is captured, and the brand filter crumb is not.
import assert from "node:assert";
const src = await import("node:fs").then(m => m.readFileSync("scripts/sync-vinted.mjs", "utf8"));
const fn = src.slice(src.indexOf("function crumbs(html)"));
const crumbs = new Function("html", fn.slice(fn.indexOf("{") + 1, fn.indexOf("\n}")) );

const html = `<ul><li><a href="/catalog/1904-women?referrer=item-crumbs" itemProp="url" data-testid="breadcrumb"><span itemProp="title">Women</span></a></li>
<li><a href="/catalog/1187-accessories?referrer=item-crumbs" itemProp="url" data-testid="breadcrumb"><span itemProp="title">Accessories</span></a></li>
<li><a href="/catalog/21-jewellery?referrer=item-crumbs" itemProp="url" data-testid="breadcrumb"><span itemProp="title">Jewellery</span></a></li>
<li><a href="/catalog/164-necklaces?referrer=item-crumbs" itemProp="url" data-testid="breadcrumb"><span itemProp="title">Necklaces</span></a></li>
<li><a href="/catalog/164-necklaces/brand/7294168-handmade-beauty?referrer=item-crumbs" itemProp="url" data-testid="breadcrumb"><span itemProp="title">Handmade Beauty Necklaces</span></a></li></ul>`;

const got = crumbs(html);
assert.deepStrictEqual(got.map(c => c.name), ["Women", "Accessories", "Jewellery", "Necklaces"], "brand crumb must be dropped, all four levels kept");
assert.deepStrictEqual(got.map(c => c.id), [1904, 1187, 21, 164], "catalog ids");
assert.deepStrictEqual(crumbs("<p>no crumbs here</p>"), [], "no breadcrumbs is empty, not a throw");
console.log("crumbs() ok:", got.map(c => c.name).join(" > "));

// condition() — the label shares a node with the value, and the value is what gets shown.
const condFn = src.slice(src.indexOf("function condition(html)"));
const condition = new Function("html", condFn.slice(condFn.indexOf("{") + 1, condFn.indexOf("\n}")));
// Real shape: a "Condition" label node, then the value node carrying itemProp="status".
const statusHtml = (v) =>
  `<div data-testid="item-attributes-status"><div class="details-list__item-value">` +
  `<span class="web_ui__Text__text">Condition</span></div>` +
  `<div class="details-list__item-value" itemProp="status">` +
  `<span class="web_ui__Text__text web_ui__Text__bold">${v}<button data-testid="faq">?</button></span></div></div>`;
assert.strictEqual(condition(statusHtml("Very good")), "Very good");
assert.strictEqual(condition(statusHtml("New without tags")), "New without tags", "must not stop at the label");
assert.strictEqual(condition("<p>nothing</p>"), "", "missing block is empty, not a throw");
console.log("condition() ok");
