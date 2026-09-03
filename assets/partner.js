/* /partner — the only scripted page on the site besides the shop.
 *
 * Three jobs, and nothing else. No analytics, no third-party calls, no fetch of any kind:
 * connect-src in the CSP is 'self' and this file never needs it.
 *
 *   1. The audience switch (merchants / retailers).
 *   2. A reveal fallback for browsers without animation-timeline: view().
 *   3. The contact composer, which turns three answers into a prefilled WhatsApp or email
 *      message. There is no backend on this site to POST a lead to, so the lead arrives as
 *      a message the visitor sends themselves — which also means they keep a copy of it.
 *
 * Written to run before the page is interactive and to fail soft: if this file never loads,
 * the page is still a complete, readable, contactable landing page. Both tracks are in the
 * HTML, the WhatsApp and email links in the hero and the footer are plain anchors, and the
 * composer degrades to those. That is deliberate — the visitor most likely to have a
 * flaky connection is exactly the merchant this page is written for.
 */
(function () {
  "use strict";

  var WA = "420777558262";
  var MAIL = "helloayursen@gmail.com";

  /* ---------- 2. reveal ----------
   * Opt-in, never opt-out. partner.css leaves every .rv visible; this adds the class that
   * hides them and then reveals them on scroll. If this file never runs, the page is simply
   * a page — see the long note in partner.css for the WebView case that forced this shape.
   *
   * Skipped entirely under reduced motion and without IntersectionObserver, so those
   * visitors never even get the hidden state applied. */
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce && "IntersectionObserver" in window) {
    document.documentElement.classList.add("js-rv");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("seen"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.04 });
    var items = document.querySelectorAll(".rv");
    for (var i = 0; i < items.length; i++) io.observe(items[i]);
    /* Anything already on screen at load reveals immediately rather than waiting for a
       scroll that may never come on a short viewport. */
    requestAnimationFrame(function () {
      for (var k = 0; k < items.length; k++) {
        if (items[k].getBoundingClientRect().top < innerHeight) items[k].classList.add("seen");
      }
    });
  }

  /* ---------- 1. audience switch ----------
   * Both tracks ship in the HTML and one carries the hidden attribute. That ordering
   * matters for more than JavaScript-off: a crawler and an AI summariser both read the
   * whole page, so the retailer content is indexable even though a visitor sees one track.
   *
   * The chosen track is remembered in the URL hash rather than storage — it survives a
   * share, which storage does not, and it needs no consent banner, which is the whole
   * posture of this site. */
  var tabs = [].slice.call(document.querySelectorAll("[data-track-tab]"));
  var tracks = {};
  [].forEach.call(document.querySelectorAll("[data-track]"), function (el) {
    tracks[el.getAttribute("data-track")] = el;
  });

  function paint(name) {
    Object.keys(tracks).forEach(function (k) { tracks[k].hidden = k !== name; });
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-track-tab") === name;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.setAttribute("tabindex", on ? "0" : "-1");
    });
    var sel = document.getElementById("ask-role");
    if (sel && sel.value !== name) { sel.value = name; compose(); }
  }

  function show(name, push) {
    if (!tracks[name]) return;
    /* View Transitions turn the swap into one cross-fade instead of a jump that loses the
       reader's place. Guarded, and skipped under reduced motion. */
    var reduceNow = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (document.startViewTransition && !reduceNow) {
      /* Two of these can overlap — the role <select> and the tab buttons both call show(),
         and a second transition aborts the first with an InvalidStateError that surfaces as
         an unhandled rejection. The swap itself is unaffected, but an error in the console
         of a page like this is a support question waiting to happen, so both promises are
         explicitly swallowed. */
      var vt = document.startViewTransition(function () { paint(name); });
      if (vt.ready && vt.ready.catch) vt.ready.catch(function () {});
      if (vt.finished && vt.finished.catch) vt.finished.catch(function () {});
    } else paint(name);
    if (push && history.replaceState) history.replaceState(null, "", "#" + name);
  }

  tabs.forEach(function (t, idx) {
    t.addEventListener("click", function () { show(t.getAttribute("data-track-tab"), true); });
    /* Arrow keys across a tablist: expected behaviour for the role, and free to add. */
    t.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var next = tabs[(idx + d + tabs.length) % tabs.length];
      next.focus();
      show(next.getAttribute("data-track-tab"), true);
    });
  });

  /* ---------- 3. contact composer ---------- */
  var role = document.getElementById("ask-role");
  var topic = document.getElementById("ask-topic");
  var where = document.getElementById("ask-where");
  var preview = document.getElementById("ask-preview");
  var waLink = document.getElementById("ask-wa");
  var mailLink = document.getElementById("ask-mail");

  function message() {
    var r = role && role.value === "retailer" ? "retailer" : "merchant";
    var t = topic ? topic.options[topic.selectedIndex].text : "";
    var w = where && where.value.trim();
    var lines = r === "retailer"
      ? ["Hello Guldaar — I am a retailer and I found /partner on guldaarbazaar.com.",
         "What I am looking for: " + t + ".",
         w ? "Where I sell: " + w + "." : "",
         "Please tell me about EU-stocked availability, trade terms and the compliance file."]
      : ["Hello Guldaar — I make or supply goods in India and I found /partner on guldaarbazaar.com.",
         "What I make: " + t + ".",
         w ? "Where I am based: " + w + "." : "",
         "I would like to know about joining as a founding merchant."];
    return lines.filter(Boolean).join("\n");
  }

  function compose() {
    var body = message();
    if (preview) preview.textContent = body;
    if (waLink) waLink.href = "https://wa.me/" + WA + "?text=" + encodeURIComponent(body);
    if (mailLink) {
      mailLink.href = "mailto:" + MAIL +
        "?subject=" + encodeURIComponent("Guldaar partner enquiry") +
        "&body=" + encodeURIComponent(body);
    }
  }

  [role, topic, where].forEach(function (el) {
    if (!el) return;
    el.addEventListener("change", compose);
    el.addEventListener("input", compose);
  });
  if (role) role.addEventListener("change", function () { show(role.value, true); });

  /* Topic options belong to the audience, so they are swapped rather than shown as one
     merged list that half the visitors have to read past. */
  var TOPICS = {
    merchant: ["Jewellery", "Fashion and textiles", "Home decor and rugs", "Meditation and ritual objects",
               "Wellness accessories (non-ingestible)", "Books and stationery", "Keepsakes and gifts", "Something else"],
    retailer: ["Jewellery", "Fashion and textiles", "Home decor and rugs", "Meditation and ritual objects",
               "Gifting range for my shop", "Wholesale samples first", "Something else"]
  };
  function fillTopics(r) {
    if (!topic) return;
    var keep = topic.value;
    topic.innerHTML = "";
    TOPICS[r].forEach(function (label) {
      var o = document.createElement("option");
      o.value = label; o.textContent = label;
      topic.appendChild(o);
    });
    if (keep) topic.value = keep;
    if (!topic.value) topic.selectedIndex = 0;
  }
  if (role) role.addEventListener("change", function () { fillTopics(role.value); compose(); });

  /* ---------- boot ---------- */
  var start = (location.hash || "").replace("#", "");
  if (!tracks[start]) start = "merchant";
  fillTopics(start);
  paint(start);
  compose();
})();
