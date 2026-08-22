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
  var PAGE = 24; // cards revealed per step
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

  cards.forEach(function (card) {
    if (!card.getAttribute("data-shots")) return;
    ["pointerenter", "focusin", "touchstart"].forEach(function (ev) {
      card.addEventListener(ev, function () { buildCarousel(card); }, { once: true, passive: true });
    });
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

  var ATTR = { "sb-cond": "data-cond", "sb-size": "data-size", "sb-color": "data-color" };

  function matches(card) {
    if (avail && card.getAttribute("data-avail") !== avail) return false;

    for (var i = 0; i < selects.length; i++) {
      var s = selects[i];
      if (!s.value) continue;
      if (s.id === "sb-price") {
        var band = BANDS[s.value];
        var eur = Number(card.getAttribute("data-price")) / 24.254;
        if (!(eur >= band[0] && eur < band[1])) return false;
      } else if (card.getAttribute(ATTR[s.id]) !== s.value) {
        return false;
      }
    }

    var term = (q.value || "").trim().toLowerCase();
    if (term) {
      if (card.getAttribute("data-title").indexOf(term) === -1 &&
          card.getAttribute("data-brand").toLowerCase().indexOf(term) === -1) return false;
    }
    return true;
  }

  cards.forEach(function (c, i) { c._i = i; }); // document order = newest first
  var num = function (el, a) { return Number(el.getAttribute(a)) || 0; };

  var isSold = function (el) { return el.getAttribute("data-avail") === "sold" ? 1 : 0; };

  function comparator() {
    var mode = sort.value;
    return function (a, b) {
      // Availability outranks every sort mode. Sold pieces belong in the grid — they are
      // proof that things here sell — but never above something a visitor can actually buy.
      // Without this, "price low to high" leads with a sold item and the cheapest available
      // piece is pushed down the page. build-shop.mjs applies the same rule to the
      // server-rendered order, for visitors and crawlers that never run this file.
      var byAvail = isSold(a) - isSold(b);
      if (byAvail) return byAvail;

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

  function reveal() {
    var to = Math.min(revealed + PAGE, shown.length);
    for (var i = revealed; i < to; i++) shown[i].hidden = false;
    revealed = to;
    more.hidden = revealed >= shown.length;
    more.textContent = "Show " + Math.min(PAGE, shown.length - revealed) + " more";
    tally();
  }

  function tally() {
    count.textContent = revealed >= shown.length
      ? (shown.length === cards.length ? cards.length + " pieces" : shown.length + " of " + cards.length + " pieces")
      : "Showing " + revealed + " of " + shown.length;
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

  /* ------------------------------------------------------- refine disclosure ---- */

  // The five refinement selects are collapsed behind a summary on a phone.
  //
  // Measured before this existed: on a 375x812 screen the first product card sat at y=943 —
  // one and a sixth screens down — because the page head, the shelf strip and a 392px
  // toolbar came first. A shop page that shows no product on the first screen is a shop
  // page arguing with itself.
  //
  // Search and the availability segments stay out in the open: those are the two controls
  // people reach for first. Condition, size, price, colour and sort are refinements, and
  // refinements can ask to be opened. Nothing is hidden without being announced — the
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
  var PARAMS = { "sb-cond": "cond", "sb-size": "size", "sb-color": "color", "sb-price": "price" };

  function writeUrl() {
    var p = new URLSearchParams();
    if ((q.value || "").trim()) p.set("q", q.value.trim());
    selects.forEach(function (s) {
      if (s.value && PARAMS[s.id]) p.set(PARAMS[s.id], s.value);
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
        // Galleries are built on first interaction with a card, so the new ones need the
        // same listeners the original hundred got.
        cards.forEach(function (card) {
          ["pointerenter", "focusin", "touchstart"].forEach(function (ev) {
            card.addEventListener(ev, function () { buildCarousel(card); }, { once: true, passive: true });
          });
        });
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

  function apply() {
    if (!full && anyActive()) return ensureFull(applyNow);
    applyNow();
  }

  function applyNow() {
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
  document.body.appendChild(jump);

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
})();
