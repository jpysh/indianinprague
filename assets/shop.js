/* Shop behaviour: filtering, sorting, progressive reveal, and the per-card photo carousel.
 *
 * Strictly an enhancement. Every card is already in the HTML, server-rendered and correct,
 * before this file runs. With JavaScript off — or if this fails to load — the visitor sees
 * the complete grid, unfiltered and unpaginated, with the first photo of each piece. That
 * is also what a crawler sees, which is why the grid is not fetched or paginated over the
 * network: cutting the page down to 24 cards server-side would have hidden most of the
 * catalog from search engines to save bytes this file already saves.
 *
 * No dependencies, no build step, and loaded with `defer` from an external file so the CSP
 * stays `script-src 'self'` with no 'unsafe-inline'.
 */
(function () {
  "use strict";

  // Root-absolute: shelf pages live at /wardrobe/<shelf>, so a relative path would
  // resolve to /wardrobe/images/derived/.
  var IMG = "/images/derived/";
  var SIZES = "(min-width:801px) 400px, (min-width:521px) 50vw, calc(100vw - 40px)";
  var PAGE = 48; // cards revealed per step once a filter has pulled in the whole shelf
  // The sticky site header is 52px; leave a little air so the toolbar does not land flush
  // underneath it when the jump control scrolls back to it.
  var HEADER_CLEARANCE = 68;

  /* ---------------------------------------------------------- category strip ---- */

  // The strip scrolls horizontally on a phone, and with eight categories the one you are
  // actually on is usually past the right edge — so the page opens looking like you are on
  // "Everything". Nudge the current chip into view.
  var current = document.querySelector('.cat-nav a[aria-current="page"]');
  if (current) {
    var strip = current.parentElement;
    if (strip.scrollWidth > strip.clientWidth) {
      strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
    }
  }

  var grid = document.getElementById("grid");
  var bar = document.querySelector("[data-shop-bar]");
  if (!grid) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll(".piece"));

  /* ----------------------------------------------------------------- carousel ---- */

  // Photos 2 and 3 arrive as a compact attribute rather than markup —
  // "vinted-123-2:400|800,vinted-123-3:400|800" — and become real <picture> elements the
  // first time someone interacts with the card. Shipping them as markup would have added
  // ~300 <picture> blocks to shop.html for images most visitors never look at; building
  // them on interaction means the bytes are only spent when there is intent.
  function buildCarousel(card) {
    if (card._built) return;
    card._built = true;

    var spec = card.getAttribute("data-shots");
    var track = card.querySelector("[data-track]");
    if (!spec || !track) return;

    spec.split(",").forEach(function (entry) {
      var bits = entry.split(":");
      var base = bits[0];
      var widths = bits[1].split("|");
      // Third field is the content token, appended as ?v= exactly as the server-rendered
      // <picture> does. Derived images are cached for a year as immutable, so a picture
      // that changes without changing filename would otherwise stay stale for every
      // returning visitor. Older markup has no third field; the URL is then unversioned,
      // which is what it was before.
      var q = bits[2] ? "?v=" + bits[2] : "";
      var srcset = function (ext) {
        return widths.map(function (w) { return IMG + base + "-" + w + "." + ext + q + " " + w + "w"; }).join(", ");
      };
      var shot = document.createElement("div");
      shot.className = "shot";
      var pic = document.createElement("picture");
      var src = document.createElement("source");
      src.type = "image/webp";
      src.srcset = srcset("webp");
      src.sizes = SIZES;
      var img = document.createElement("img");
      img.className = "ph";
      img.loading = "lazy";
      img.decoding = "async";
      // Empty alt on purpose: these are additional views of a product whose name is
      // already the link's accessible name. Repeating the title three times would make a
      // screen reader read the whole grid three times over.
      img.alt = "";
      img.src = IMG + base + "-" + widths[0] + ".jpg" + q;
      img.srcset = srcset("jpg");
      img.sizes = SIZES;
      pic.appendChild(src);
      pic.appendChild(img);
      shot.appendChild(pic);
      track.appendChild(shot);
    });

    var total = track.children.length;
    if (total < 2) return;

    var frame = track.parentElement;
    var count = document.createElement("span");
    count.className = "shot-count";
    count.setAttribute("aria-hidden", "true");
    count.textContent = "1/" + total;

    // The position is tracked explicitly rather than read back off the element.
    // scrollBy() with a relative delta does NOT work on a `scroll-snap-type: x mandatory`
    // container — the snap engine resolves the delta against a position it may already be
    // animating, and the scroll is silently cancelled. Measured: scrollBy left the track at
    // 0, scrollTo with the same absolute target moved it correctly. So: keep the index, and
    // always scroll to an absolute offset.
    var index = 0;

    function show(i) {
      index = Math.max(0, Math.min(i, total - 1));
      track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
      count.textContent = index + 1 + "/" + total;
    }

    function step(dir) {
      // type=button and these two calls are load-bearing: the control sits inside the <a>
      // that wraps the whole card, so without them every arrow press would also open the
      // Vinted listing in a new tab.
      return function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        show(index + dir);
      };
    }
    var prev = document.createElement("button");
    prev.type = "button";
    prev.className = "shot-nav prev";
    prev.setAttribute("aria-label", "Previous photo");
    prev.innerHTML = "&lsaquo;";
    prev.addEventListener("click", step(-1));

    var next = document.createElement("button");
    next.type = "button";
    next.className = "shot-nav next";
    next.setAttribute("aria-label", "Next photo");
    next.innerHTML = "&rsaquo;";
    next.addEventListener("click", step(1));

    // The track is a scroll-snap container, so touch swipe and trackpad scroll work with no
    // JavaScript at all — the buttons exist for mouse and keyboard. This keeps the index and
    // the counter honest when the visitor swipes instead of clicking.
    var ticking = false;
    track.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        index = Math.max(0, Math.min(Math.round(track.scrollLeft / track.clientWidth), total - 1));
        count.textContent = index + 1 + "/" + total;
        ticking = false;
      });
    }, { passive: true });

    frame.appendChild(prev);
    frame.appendChild(next);
    frame.appendChild(count);
    card.classList.add("has-shots");
  }

  // Galleries only in the large view. In the grid a finger scrolling past six cards a screen
  // would touchstart every one of them and fetch photos nobody is looking at; there, the
  // detail sheet is where the other photos live.
  function wireCarousel(card) {
    if (!card.getAttribute("data-shots")) return;
    ["pointerenter", "focusin", "touchstart"].forEach(function (ev) {
      card.addEventListener(ev, function () {
        if (grid.classList.contains("list")) buildCarousel(card);
      }, { passive: true });
    });
  }
  cards.forEach(wireCarousel);

  /* ------------------------------------------------------------ view toggle ---- */

  // Grid (two across on a phone) is the default; the large view is one across. Remembered
  // in this browser only, and a blocked localStorage simply means the default every time.
  var VIEW_KEY = "wardrobe-view";
  var ICON_GRID = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="currentColor">' +
    '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/>' +
    '<rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/></svg>';
  var ICON_LIST = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="currentColor">' +
    '<rect x="4" y="3" width="16" height="18"/></svg>';
  var viewBtns = [];

  function viewButton() {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "sb-view";
    b.addEventListener("click", function () { setView(!grid.classList.contains("list")); });
    viewBtns.push(b);
    return b;
  }

  // The icon shows the view a press switches TO, like a play/pause button.
  function setView(list, keep) {
    grid.classList.toggle("list", list);
    viewBtns.forEach(function (b) {
      b.innerHTML = list ? ICON_GRID : ICON_LIST;
      b.setAttribute("aria-label", "Large photos");
      b.setAttribute("aria-pressed", String(list));
    });
    if (keep) return;
    try { localStorage.setItem(VIEW_KEY, list ? "list" : "grid"); } catch (e) {}
  }

  var savedView = "";
  try { savedView = localStorage.getItem(VIEW_KEY) || ""; } catch (e) {}

  /* ----------------------------------------------------------- detail sheet ---- */

  // One <dialog> for every card, filled from the card that was tapped. Everything it shows
  // is already in that card's markup (the description rides along hidden), so opening it
  // costs no request. Its URL is the card's own #anchor, pushed as a history entry so the
  // phone's Back button closes the sheet instead of leaving the shelf.
  var sheet = document.createElement("dialog");
  sheet.className = "sheet";
  sheet.setAttribute("aria-labelledby", "sheet-title");
  sheet.innerHTML =
    '<button type="button" class="sheet-x" aria-label="Close">&times;</button>' +
    '<div class="sheet-media"></div>' +
    '<div class="sheet-body"><h2 id="sheet-title"></h2><p class="sheet-pr"></p>' +
    '<p class="sheet-tags"></p><p class="sheet-desc"></p>' +
    '<div class="sheet-acts"><a class="sheet-wa" target="_blank" rel="noopener"></a>' +
    '<a class="sheet-vinted" target="_blank" rel="noopener">Vinted &#8599;</a></div></div>';
  document.body.appendChild(sheet);
  var sheetPushed = false;

  function openSheet(card, push) {
    var text = function (sel) { var el = card.querySelector(sel); return el ? el.textContent.trim() : ""; };

    // A fresh frame each time: buildCarousel appends its arrows and counter to it.
    var media = sheet.querySelector(".sheet-media");
    media.innerHTML = '<div class="frame"><div class="shots" data-track></div></div>';
    var first = card.querySelector(".shot");
    if (first) media.querySelector("[data-track]").appendChild(first.cloneNode(true));
    card.querySelectorAll(".frame > .cap.flag").forEach(function (f) {
      media.firstChild.appendChild(f.cloneNode(true));
    });
    media._built = false;
    if (card.getAttribute("data-shots")) media.setAttribute("data-shots", card.getAttribute("data-shots"));
    else media.removeAttribute("data-shots");
    buildCarousel(media);

    sheet.querySelector("h2").textContent = text(".nm");
    sheet.querySelector(".sheet-pr").textContent = text(".pr");
    sheet.querySelector(".sheet-tags").textContent = text(".tags");
    var desc = sheet.querySelector(".sheet-desc");
    desc.textContent = text(".blurb");
    // The card carries a cut description (data-full marks that it was cut). The whole text
    // is one small file per product and language (translate-desc.mjs). A page never swaps
    // to another language mid-read: a missing translation 404s and the translated short
    // text stays, as does a failed fetch, which is why it is shown first.
    var cut = card.querySelector(".blurb[data-full]");
    var lang = document.documentElement.lang;
    if (cut) {
      fetch("/wardrobe/desc/" + (lang === "en" ? "" : lang + "/") + cut.id.replace(/^blurb-/, "") + ".txt")
        .then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (t) { if (t && sheet.open && sheet.querySelector("h2").textContent === text(".nm")) desc.textContent = t.trim(); })
        .catch(function () {});
    }

    var ask = card.querySelector(".ask");
    var wa = sheet.querySelector(".sheet-wa");
    wa.hidden = !ask;
    if (ask) {
      wa.href = ask.href;
      wa.innerHTML = ask.innerHTML;
    }
    var go = card.querySelector(".go");
    var vinted = sheet.querySelector(".sheet-vinted");
    vinted.hidden = !(go && /^https?:/.test(go.getAttribute("href")));
    if (!vinted.hidden) vinted.href = go.href;

    if (push) {
      history.pushState({ sheet: card.id }, "", location.pathname + location.search + "#" + card.id);
      sheetPushed = true;
    }
    if (!sheet.open) sheet.showModal();
    sheet.scrollTop = 0;
  }

  // Every way out goes through history when the sheet put an entry there, so the entry is
  // never left behind for Back to land on a second time.
  function closeSheet() {
    if (sheetPushed) { history.back(); return; }
    if (sheet.open) sheet.close();
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  window.addEventListener("popstate", function () {
    sheetPushed = false;
    if (sheet.open) sheet.close();
  });
  sheet.querySelector(".sheet-x").addEventListener("click", closeSheet);
  sheet.addEventListener("cancel", function (e) { e.preventDefault(); closeSheet(); });
  // A click on the dialog element itself is a click on the backdrop.
  sheet.addEventListener("click", function (e) { if (e.target === sheet) closeSheet(); });

  // Delegated, so cards the filters fetch later behave the same. Only the card's stretched
  // link opens the sheet; the arrows and the WhatsApp control keep their own jobs, and a
  // modified click still opens the link the way the visitor asked.
  grid.addEventListener("click", function (e) {
    var go = e.target.closest ? e.target.closest(".go") : null;
    if (!go || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openSheet(go.closest(".piece"), true);
  });

  if (!bar) return;

  /* ------------------------------------------------------------------ filters ---- */

  var q = document.getElementById("sb-q");
  var sort = document.getElementById("sb-sort");
  var count = document.getElementById("sb-count");
  var chips = document.getElementById("sb-chips");
  var empty = document.getElementById("sb-empty");
  var reset = document.getElementById("sb-reset");
  // Availability moved from a segmented control to a select when it grew a third state
  // (out of stock). Both are read here: the buttons are gone from the markup, but a page
  // cached from before this change still has them, and a control that silently stops
  // working is worse than one that is briefly duplicated.
  var availSelect = bar.querySelector("[data-avail-select]");
  var availBtns = Array.prototype.slice.call(bar.querySelectorAll("button[data-avail]"));

  // Only the controls this page actually rendered. A page whose items have no sizes never
  // gets a size dropdown, so nothing here may assume one exists.
  var selects = Array.prototype.slice.call(bar.querySelectorAll("select[data-filter]"));
  var avail = "";

  var BANDS = { "0-10": [0, 10], "10-25": [10, 25], "25-50": [25, 50], "50+": [50, Infinity] };

  var ATTR = { "sb-cond": "data-cond", "sb-size": "data-size", "sb-color": "data-color",
               "sb-partner": "data-partner" };

  function matches(card) {
    if (avail && card.getAttribute("data-avail") !== avail) return false;

    for (var i = 0; i < selects.length; i++) {
      var s = selects[i];
      // A single-partner shelf renders the Partner control as a label (data-single): it
      // states what everything here is rather than filtering it, so it never narrows.
      if (!s.value || s.hasAttribute("data-single")) continue;
      if (s.id === "sb-price") {
        var band = BANDS[s.value];
        var eur = Number(card.getAttribute("data-price")) / 24.254;
        if (!(eur >= band[0] && eur < band[1])) return false;
      } else if (card.getAttribute(ATTR[s.id]) !== s.value) {
        return false;
      }
    }

    if (hits) return hits.has(card);
    // The search library did not load (offline, blocked): plain substring match, as before.
    var term = (q.value || "").trim().toLowerCase();
    if (term) {
      if (card.getAttribute("data-title").indexOf(term) === -1 &&
          card.getAttribute("data-brand").toLowerCase().indexOf(term) === -1) return false;
    }
    return true;
  }

  cards.forEach(function (c, i) { c._i = i; }); // document order = newest first
  var num = function (el, a) { return Number(el.getAttribute(a)) || 0; };

  // 0 in stock, 1 out of stock, 2 sold. Three ranks rather than a sold/not-sold flag: out of
  // stock is not buyable today either, so it does not belong among the pieces that are — but
  // it is expected back, so it does not belong down with the sold ones either.
  var AVAIL_RANK = { available: 0, oos: 1, sold: 2 };
  var availRank = function (el) { return AVAIL_RANK[el.getAttribute("data-avail")] || 0; };

  function comparator() {
    var mode = sort.value;
    return function (a, b) {
      // Availability outranks every sort mode. Sold pieces belong in the grid — they are
      // proof that things here sell — but never above something a visitor can actually buy,
      // and the same goes for stock the vendor has run out of. Without this, "price low to
      // high" leads with a sold item and the cheapest available piece is pushed down the
      // page. build-shop.mjs applies the same three ranks to the server-rendered order, for
      // visitors and crawlers that never run this file.
      var byAvail = availRank(a) - availRank(b);
      if (byAvail) return byAvail;

      // While searching, best match first unless the shopper picked a sort themselves.
      if (hits && (!mode || mode === "new")) {
        var byScore = (hits.get(b) || 0) - (hits.get(a) || 0);
        if (byScore) return byScore;
      }
      if (mode === "asc") return num(a, "data-price") - num(b, "data-price");
      if (mode === "desc") return num(b, "data-price") - num(a, "data-price");
      if (mode === "loved") return num(b, "data-fav") - num(a, "data-fav");
      return a._i - b._i;
    };
  }

  /* --------------------------------------------------------- reveal / chips ---- */

  // A real button, not just a scroll trigger. Infinite scroll that only responds to
  // scrolling is unreachable by keyboard and pushes the footer permanently out of reach;
  // the observer below simply presses this for you when you scroll near it.
  var more = document.createElement("button");
  more.type = "button";
  more.className = "sb-more";
  more.hidden = true;
  grid.parentNode.insertBefore(more, grid.nextSibling);

  var shown = [];
  var revealed = 0;

  // A generated page holds 48 cards and shows them all. Batches only matter once a filter
  // has swapped the whole shelf in, which can be hundreds.
  function reveal() {
    var to = allUrl && full ? Math.min(revealed + PAGE, shown.length) : shown.length;
    for (var i = revealed; i < to; i++) shown[i].hidden = false;
    revealed = to;
    more.hidden = revealed >= shown.length;
    more.textContent = "Show " + Math.min(PAGE, shown.length - revealed) + " more";
    tally();
  }

  // "1–48 of 439". Unfiltered, a page counts from where it sits in its shelf, whose size the
  // build wrote on the grid; filtered, the grid is the whole shelf and counts from one.
  var pageStart = Number(grid.getAttribute("data-start")) || 0;
  var shelfTotal = Number(grid.getAttribute("data-total")) || 0;

  function tally() {
    var paged = !anyActive() && shelfTotal > shown.length;
    var from = paged ? pageStart : 0;
    var of = paged ? shelfTotal : shown.length;
    count.textContent = revealed >= of
      ? of + (of === 1 ? " piece" : " pieces")
      : (revealed ? from + 1 : 0) + "–" + (from + revealed) + " of " + of;
  }

  more.addEventListener("click", reveal);
  // Auto-reveal on scroll is wired up with the jump control at the end of this file, so
  // both share one listener.

  // Active filters as removable chips. Without these a shopper who scrolls down has no way
  // to see why the grid is short, and "no results" becomes a dead end rather than something
  // with an obvious undo.
  function drawChips() {
    chips.innerHTML = "";
    var active = [];
    var AVAIL_LABEL = { sold: "Sold", oos: "Out of stock", available: "In stock" };
    if (avail) active.push(["Availability", AVAIL_LABEL[avail] || avail, function () { setAvail(""); }]);
    selects.forEach(function (s) {
      if (!s.value) return;
      var text = s.options[s.selectedIndex].textContent;
      active.push([s.getAttribute("data-name"), text, function () { s.value = ""; apply(); }]);
    });
    if ((q.value || "").trim()) {
      active.push(["Search", '"' + q.value.trim() + '"', function () { q.value = ""; apply(); }]);
    }

    active.forEach(function (row) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.innerHTML = "<i>" + row[0] + "</i> " + row[1] + " <span aria-hidden=\"true\">&times;</span>";
      b.setAttribute("aria-label", "Remove filter " + row[0] + ": " + row[1]);
      b.addEventListener("click", row[2]);
      chips.appendChild(b);
    });

    if (active.length > 1) {
      var all = document.createElement("button");
      all.type = "button";
      all.className = "chip clear-all";
      all.textContent = "Clear all";
      all.addEventListener("click", clearAll);
      chips.appendChild(all);
    }
    chips.hidden = active.length === 0;
    drawRefineCount();
  }

  /* ------------------------------------------------------ subcategory strip ---- */

  // The strip wraps and is clamped to two rows in CSS. The button is only worth showing when
  // there is actually a third row behind the clamp, and that depends on the viewport, not on
  // the chip count — nine chips fit one row on a desktop and need three on a phone. So it is
  // measured rather than guessed, and re-measured on resize.
  //
  // Ships with the `hidden` attribute, so a visitor without JavaScript is never offered a
  // button that cannot do anything. That visitor sees a clamped strip — the trade for not
  // rendering a dead control — and every subcategory is still reachable from the shelf.
  var subs = document.querySelector(".subs");
  var subsMore = document.querySelector("[data-subs-more]");
  if (subs && subsMore) {
    var syncSubs = function () {
      if (subs.classList.contains("subs-open")) return;
      // Two rows of whatever a chip actually measures, plus the gap between them. Measured
      // rather than written down: a chip is 42px, not the 32px its padding and border
      // suggest, and a clamp set from the arithmetic cut the second row through the middle
      // of the chips instead of below them.
      var chip = subs.firstElementChild;
      if (chip) {
        var gap = parseFloat(getComputedStyle(subs).rowGap) || 8;
        subs.style.maxHeight = chip.offsetHeight * 2 + gap + "px";
      }
      subsMore.hidden = subs.scrollHeight <= subs.clientHeight + 1;
    };
    subsMore.addEventListener("click", function () {
      var open = subs.classList.toggle("subs-open");
      subsMore.setAttribute("aria-expanded", open ? "true" : "false");
      subsMore.firstChild.nodeValue = open ? "Show fewer " : "Show all ";
    });
    window.addEventListener("resize", syncSubs);
    syncSubs();
  }

  /* ------------------------------------------------------- refine disclosure ---- */

  // The five refinement selects are collapsed behind a summary on a phone.
  //
  // Measured before this existed: on a 375x812 screen the first product card sat at y=943 —
  // one and a sixth screens down — because the page head, the shelf strip and a 392px
  // toolbar came first. A shop page that shows no product on the first screen is a shop
  // page arguing with itself.
  //
  // Search stays out in the open — it is the one control that is not a filter. Availability,
  // condition, size, price, colour and sort are all refinements and live in here together;
  // availability used to sit outside beside the search box, which meant the control people
  // go to the filter group looking for was not in the filter group. Nothing is hidden
  // without being announced — the
  // summary carries a count of how many are currently set, and the chip row underneath is
  // outside the disclosure, so an active filter is always visible even when this is shut.
  //
  // It is a <details>, so with JavaScript disabled it still opens and closes on its own. All
  // the script does is decide the INITIAL state, which is a judgement about screen width
  // that CSS cannot make on a <details>.
  var refine = document.querySelector("[data-refine]");
  var refineCount = document.querySelector("[data-refine-count]");
  var wide = window.matchMedia("(min-width:721px)");

  function refineActive() {
    var n = 0;
    selects.forEach(function (s) { if (s.value) n++; });
    // Counted like any other refinement now that it lives in the group. It carries no
    // data-filter — the availability rules are their own code path, see setAvail — so it is
    // not in `selects` and has to be added by hand. Missing it would let someone arrive on a
    // shared "sold only" link and find the disclosure shut on a phone, with no explanation
    // on screen for why the grid is short.
    if (availSelect && availSelect.value) n++;
    if (sort && sort.value && sort.value !== "new") n++;
    return n;
  }

  function drawRefineCount() {
    if (!refineCount) return;
    var n = refineActive();
    refineCount.textContent = n ? String(n) : "";
    refineCount.hidden = !n;
  }

  function syncRefine() {
    if (!refine) return;
    // Open on a wide screen, where there is room and the row costs nothing. On a phone,
    // open only if something in it is already set — arriving on a shared filtered link and
    // finding the controls shut would hide the reason the grid is short.
    refine.open = wide.matches || refineActive() > 0;
  }

  if (wide.addEventListener) wide.addEventListener("change", syncRefine);
  else if (wide.addListener) wide.addListener(syncRefine);

  function setAvail(v) {
    avail = v;
    availBtns.forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-avail") === v));
    });
    if (availSelect && availSelect.value !== v) availSelect.value = v;
    apply();
  }

  function clearAll() {
    q.value = "";
    selects.forEach(function (s) { s.value = ""; });
    setAvail("");
  }

  /* ------------------------------------------------------ filters in the URL ---- */

  // The filter state lives in the query string, so a narrowed-down grid is a place rather
  // than a mood.
  //
  // Without this, "silver earrings under €25" existed only in the tab that produced it: it
  // could not be sent to anyone, could not be bookmarked, did not survive a refresh, and —
  // the one that actually loses sales — was destroyed by following a link to a listing and
  // pressing Back, which is the single most common thing a shopper does on a page like this.
  //
  // replaceState, not pushState. Every keystroke in the search box calls apply(), and
  // pushing a history entry per keystroke would mean thirty presses of Back to leave the
  // page. The URL stays current and shareable; the history stays honest.
  var PARAMS = { "sb-cond": "cond", "sb-size": "size", "sb-color": "color", "sb-price": "price",
                 "sb-partner": "partner" };

  function writeUrl() {
    var p = new URLSearchParams();
    if ((q.value || "").trim()) p.set("q", q.value.trim());
    selects.forEach(function (s) {
      if (s.value && PARAMS[s.id] && !s.hasAttribute("data-single")) p.set(PARAMS[s.id], s.value);
    });
    if (sort.value && sort.value !== "new") p.set("sort", sort.value);
    if (avail) p.set("avail", avail);
    var qs = p.toString();
    history.replaceState(null, "", qs ? location.pathname + "?" + qs : location.pathname);
  }

  // Read on load. Every value is validated against the controls this page actually
  // rendered — a size dropdown does not exist on the books page, and a hand-edited ?size=XL
  // must not put the grid into a state the toolbar cannot show or undo.
  function readUrl() {
    var p = new URLSearchParams(location.search);
    if (p.get("q")) q.value = p.get("q");
    selects.forEach(function (s) {
      var v = p.get(PARAMS[s.id]);
      if (!v) return;
      for (var i = 0; i < s.options.length; i++) {
        if (s.options[i].value === v) { s.value = v; return; }
      }
    });
    var so = p.get("sort");
    if (so) {
      for (var j = 0; j < sort.options.length; j++) {
        if (sort.options[j].value === so) { sort.value = so; break; }
      }
    }
    var av = p.get("avail");
    // "oos" joined sold and available when out-of-stock vendor stock started being shown
    // rather than hidden.
    if (av === "sold" || av === "available" || av === "oos") {
      // Only if this page rendered the availability control; otherwise the state would be
      // unreachable and un-clearable.
      if (availSelect || availBtns.length) {
        avail = av;
        availBtns.forEach(function (b) {
          b.setAttribute("aria-pressed", String(b.getAttribute("data-avail") === av));
        });
        if (availSelect) availSelect.value = av;
      }
    }
  }

  /* ------------------------------------------------- the rest of the shelf ---- */

  // The page holds 100 cards; the shelf may hold 461. Filtering or sorting only what is on
  // screen answers the wrong question — "Brown" would report four matches out of a hundred
  // and call it the shelf. So the first time a control is actually used, the remaining
  // cards are fetched and the grid becomes the whole shelf.
  //
  // Deferred rather than done on load because most visitors browse and never filter, and
  // this is several hundred KB they would pay for and not use.
  var allUrl = grid.getAttribute("data-all");
  var full = !allUrl;
  var loading = false;

  function anyActive() {
    if (avail || (q.value || "").trim()) return true;
    if (sort && sort.value && sort.value !== "new") return true;
    for (var i = 0; i < selects.length; i++) if (selects[i].value) return true;
    return false;
  }

  function ensureFull(then) {
    if (full || loading) return then();
    loading = true;
    grid.setAttribute("aria-busy", "true");
    fetch(allUrl, { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (html) {
        grid.innerHTML = html;
        cards = Array.prototype.slice.call(grid.querySelectorAll(".piece"));
        cards.forEach(function (c, i) { c._i = i; });
        mini = null; // index the whole shelf, not the first page
        // Galleries are built on first interaction with a card, so the new ones need the
        // same listeners the original hundred got.
        cards.forEach(wireCarousel);
        // The pager is now meaningless: every card of the shelf is in this grid, and the
        // reveal button below takes over from it.
        var pg = document.querySelector(".pager");
        if (pg) pg.hidden = true;
        full = true;
      })
      .catch(function () {
        // Filtering the hundred cards already here is a worse answer than the whole shelf,
        // but it is a far better one than a grid that stops responding.
        full = true;
      })
      .then(function () {
        loading = false;
        grid.removeAttribute("aria-busy");
        then();
      });
  }

  /* --------------------------------------------------------------- search ---- */

  // MiniSearch (assets/vendor, pinned) over every card: title, brand, colour, category, the
  // description, and data-q, the extra words build-shop.mjs writes from data/search-terms.json
  // (occasions, synonyms, other languages). Loaded on first search only. Typos and partial
  // words still match, accents are ignored, and results come best match first.
  var MS_SRC = "/assets/vendor/minisearch-7.2.0.js";
  var STOP = { a: 1, an: 1, the: 1, for: 1, with: 1, and: 1, of: 1, to: 1, in: 1, my: 1, me: 1,
               some: 1, something: 1, pro: 1, na: 1, do: 1, s: 1, se: 1, und: 1, fur: 1 };
  var mini = null, msLoad = null, hits = null;

  function norm(t) {
    t = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (STOP[t]) return null;
    // Crude plural folding, applied to the index and the query alike: dresses/dress, rings/ring.
    if (t.length > 4 && /[^s]es$/.test(t)) return t.slice(0, -2);
    if (t.length > 3 && /[^s]s$/.test(t)) return t.slice(0, -1);
    return t;
  }

  function loadSearch(then) {
    if (window.MiniSearch) return then();
    if (!msLoad) {
      msLoad = [];
      var sc = document.createElement("script");
      sc.src = MS_SRC;
      sc.onload = sc.onerror = function () { var f = msLoad; msLoad = null; f.forEach(function (g) { g(); }); };
      document.head.appendChild(sc);
    }
    msLoad.push(then);
  }

  function buildIndex() {
    mini = new window.MiniSearch({
      fields: ["title", "brand", "color", "cat", "q", "desc"],
      processTerm: norm,
      searchOptions: {
        boost: { title: 3, brand: 2, color: 2, cat: 1.5, q: 1 },
        prefix: function (t) { return t.length > 2; },
        fuzzy: function (t) { return t.length > 4 ? 0.2 : t.length > 3 ? 1 : 0; },
      },
    });
    // Position, not the element id: a few cards share an id, which MiniSearch rejects.
    mini.addAll(cards.map(function (c, i) {
      var d = c.querySelector(".blurb");
      return { id: i, title: c.getAttribute("data-title"), brand: c.getAttribute("data-brand"),
               color: c.getAttribute("data-color"), cat: c.getAttribute("data-cat"),
               q: c.getAttribute("data-q") || "", desc: d ? d.textContent : "" };
    }));
  }

  // Every word must match; if nothing does ("gift for mum"), any word may, ranked.
  function runSearch() {
    var term = (q.value || "").trim();
    hits = null;
    if (!term || !window.MiniSearch) return;
    if (!mini) buildIndex();
    var res = mini.search(term, { combineWith: "AND" });
    if (!res.length) res = mini.search(term, { combineWith: "OR" });
    hits = new Map(res.map(function (r) { return [cards[r.id], r.score]; }));
  }

  function apply() {
    if (!full && !loading && anyActive()) return ensureFull(apply);
    if ((q.value || "").trim() && !window.MiniSearch && !msTried) {
      msTried = true;
      return loadSearch(applyNow);
    }
    applyNow();
  }
  var msTried = false;

  function applyNow() {
    runSearch();
    shown = cards.filter(matches).sort(comparator());
    var inShown = new Set(shown);

    // One reflow for the whole grid rather than one per card.
    var frag = document.createDocumentFragment();
    shown.forEach(function (c) { c.hidden = true; frag.appendChild(c); });
    cards.forEach(function (c) { if (!inShown.has(c)) { c.hidden = true; frag.appendChild(c); } });
    grid.appendChild(frag);

    revealed = 0;
    reveal();
    drawChips();
    writeUrl();
    if (empty) empty.hidden = shown.length !== 0;
  }

  bar.addEventListener("input", function (e) { if (e.target === q) apply(); });
  bar.addEventListener("change", function (e) {
    if (e.target === sort || selects.indexOf(e.target) !== -1) apply();
  });
  availBtns.forEach(function (b) {
    b.addEventListener("click", function () { setAvail(b.getAttribute("data-avail")); });
  });
  if (availSelect) {
    availSelect.addEventListener("change", function () { setAvail(availSelect.value); });
  }
  if (reset) reset.addEventListener("click", function () { clearAll(); q.focus(); });

  /* ------------------------------------------------------- return to filters ---- */

  // 150 cards is a long scroll, and once the toolbar is off-screen the only way back to it
  // is a long flick to the top. Two things are wanted at that point and they are different
  // intents, so they get separate controls rather than one ambiguous arrow:
  //
  //   "Filters"  — I want to narrow this down. Scrolls the toolbar back into view and moves
  //                focus into it, so the keyboard lands where the eye does.
  //   "Top"      — I want to start again.
  //
  // Bottom-anchored rather than a second sticky bar at the top: the header already sticks,
  // and stacking another strip under it eats the small viewport this matters most on. It
  // only appears once the toolbar has actually scrolled away, so it never covers the
  // controls it points at.
  var jump = document.createElement("div");
  jump.className = "sb-jump";
  jump.hidden = true;
  jump.innerHTML =
    '<button type="button" class="sb-jump-filters">' +
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M7 12h10M11 18h2"/></svg>' +
    "Filters &amp; sort</button>" +
    '<button type="button" class="sb-jump-top" aria-label="Back to top">' +
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 19V5M5 12l7-7 7 7"/></svg></button>';
  jump.insertBefore(viewButton(), jump.querySelector(".sb-jump-top"));
  document.body.appendChild(jump);
  // Beside the count, so the toggle can be found without scrolling first.
  count.parentNode.appendChild(viewButton());
  setView(savedView === "list", true);

  // Honour the OS setting the rest of the site already honours.
  var smooth = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  // A smooth window scroll can be silently dropped — it is cancellable, and any competing
  // scroll (scroll anchoring as lazy images resize the grid, a stray touch) kills it with no
  // error. Observed directly in testing: scrollTo({top: 438, behavior: "smooth"}) moved the
  // page while scrollTo({top: 0, behavior: "smooth"}) did nothing at all from the same state.
  //
  // For a navigation control, arriving matters more than the animation. Ask for smooth, then
  // check: if the page has not moved a moment later, jump instantly.
  function scrollWindowTo(top) {
    var from = window.scrollY;
    window.scrollTo({ top: top, behavior: smooth });
    if (smooth === "auto") return;
    setTimeout(function () {
      if (Math.abs(window.scrollY - from) < 4 && Math.abs(from - top) > 4) window.scrollTo(0, top);
    }, 450);
  }

  jump.querySelector(".sb-jump-filters").addEventListener("click", function () {
    // An explicit scrollTo rather than bar.scrollIntoView(). scrollIntoView with a smooth
    // behaviour was silently dropped in testing, and because focus() below passes
    // preventScroll the browser's own fallback scroll was suppressed too — so focus moved
    // and the page did not. This computes the target itself, which is also the only way to
    // clear the sticky header: scrollIntoView would have parked the toolbar underneath it.
    var top = bar.getBoundingClientRect().top + window.scrollY - HEADER_CLEARANCE;
    scrollWindowTo(Math.max(0, top));
    // Focus follows the scroll, otherwise a keyboard user is moved visually but their tab
    // position is still a hundred cards further down the page. preventScroll because the
    // line above already owns the scrolling.
    if (q) q.focus({ preventScroll: true });
  });
  jump.querySelector(".sb-jump-top").addEventListener("click", function () {
    scrollWindowTo(0);
  });

  // One passive scroll listener drives both the jump control's visibility and the automatic
  // reveal of the next batch of cards.
  //
  // Deliberately NOT an IntersectionObserver, which is the tidier tool for both jobs: IO
  // callbacks (and requestAnimationFrame) are throttled to nothing while a page is not being
  // composited, which made both behaviours impossible to verify. A control whose visibility
  // cannot be tested is one that will quietly stop appearing one day. Two
  // getBoundingClientRect reads on a scroll event — already capped at the frame rate by the
  // browser — cost nothing measurable and are deterministic.
  function onScroll() {
    jump.hidden = bar.getBoundingClientRect().bottom > 0;
    // Same 600px lead-in the observer had: start the next batch before the visitor reaches
    // the end, so the grid feels continuous rather than stepped.
    if (!more.hidden && more.getBoundingClientRect().top < window.innerHeight + 600) reveal();
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  bar.hidden = false;
  // Restore any filter state carried in the query string BEFORE the first apply(), so a
  // shared or bookmarked link paints the filtered grid once rather than painting all 157
  // cards and then filtering them.
  readUrl();
  // After readUrl, so a filtered link opens the disclosure that explains why it is filtered,
  // and before apply(), so the toolbar is at its final height when the grid first paints.
  syncRefine();
  apply();
  onScroll();

  // A shared or indexed link to one piece (the item URLs in the structured data are
  // /wardrobe/fashion#slug) opens that piece's sheet.
  var landed = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (landed && landed.classList.contains("piece")) openSheet(landed, false);
})();
