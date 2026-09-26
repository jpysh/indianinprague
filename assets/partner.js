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
  var page = document.querySelector("main.p");

  /* .js-on says "this page is being driven by script", and it gates the CSS that hides
     things the script is responsible for showing: the corridor's photographs and badges.
     It is set on the SAME condition the corridor runs on — motion allowed — and not, as it
     was, inside the IntersectionObserver branch below. In a browser with motion allowed but
     no IntersectionObserver, the corridor still ran and set .on while .js-on was absent, so
     the CSS fallback kept stage one's photograph visible underneath the stage the script
     had switched to: two images stacked. */
  if (page && !reduce) page.classList.add("js-on");

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
  /* Each audience now owns TWO regions, not one: its hero (headline, subhead, chip and
     buttons, above the switch's own position) and its track further down. So a name maps to
     a list of elements rather than to one, which it did when the hero was shared. Written as
     a list rather than two lookups because the shape stops being a special case the moment a
     third region is added. */
  var tabs = [].slice.call(document.querySelectorAll("[data-track-tab]"));
  var tracks = {};
  [].forEach.call(document.querySelectorAll("[data-track]"), function (el) {
    var k = el.getAttribute("data-track");
    (tracks[k] || (tracks[k] = [])).push(el);
  });

  function paint(name) {
    Object.keys(tracks).forEach(function (k) {
      tracks[k].forEach(function (el) { el.hidden = k !== name; });
    });
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

  /* In-page links that name a track switch it, rather than dropping an unused hash on the
     URL. The hero carries one of these so a European buyer can leave the merchant framing
     in the first screen instead of scrolling two of them to find the tabs. */
  [].forEach.call(document.querySelectorAll('a[href="#merchant"], a[href="#retailer"]'), function (a) {
    a.addEventListener("click", function (e) {
      var name = a.getAttribute("href").slice(1);
      if (!tracks[name]) return;
      e.preventDefault();
      show(name, true);
      var sw = document.querySelector(".p-switch");
      if (sw) sw.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
  });

  /* An in-page link can point at something inside the OTHER track, which is hidden. The
     hero's "Watch a piece travel" points at #rail, and #rail lives in the merchant track:
     a retailer who switched tracks and then used that link jumped nowhere at all, silently.
     So: if the target is inside a hidden track, switch to that track first, then scroll. */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute("href").slice(1);
    if (!id || tracks[id]) return;                 // track links are handled above
    var target = document.getElementById(id);
    if (!target) return;
    var panel = target.closest("[data-track]");
    if (!panel || !panel.hidden) return;
    e.preventDefault();
    show(panel.getAttribute("data-track"), true);
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  });

  /* ---------- 3. the scroll corridor ----------
   * Four stages; the active one drives which photograph shows and which compliance badges
   * are stamped on. The active stage is whichever one is nearest the middle of the
   * viewport, recomputed on scroll and throttled to one animation frame.
   *
   * Two things this deliberately is NOT:
   *
   *   GSAP + ScrollTrigger, though both are already vendored on this origin. They earn
   *   their 70KB on a continuous scrub; this is a switch between four discrete states.
   *
   *   IntersectionObserver with a narrow rootMargin band, which was the first version.
   *   It is the textbook tool and it works, but it delivers nothing while a document is
   *   hidden, and a band narrow enough to pick one stage is also narrow enough to be
   *   skipped by a fast flick on a phone. Measuring distance to the centre always yields
   *   exactly one active stage, at any scroll speed, and never leaves the sequence stuck.
   *
   * partner.css shows stage one's photograph and every badge until .js-on is set, so with
   * no JavaScript this section is a picture and four readable stages. */
  var steps = [].slice.call(document.querySelectorAll("[data-step]"));
  if (steps.length && !reduce) {
    var shots = [].slice.call(document.querySelectorAll(".p-rail .frame picture img"));
    var badges = [].slice.call(document.querySelectorAll("[data-badge]"));
    var current = -1;
    var setStage = function (i) {
      if (i === current) return;
      current = i;
      steps.forEach(function (s, n) { s.classList.toggle("on", n === i); });
      shots.forEach(function (img, n) { img.classList.toggle("on", n === i); });
      badges.forEach(function (b) {
        b.classList.toggle("on", Number(b.getAttribute("data-badge")) <= i);
      });
    };
    var ticking = false;
    var measure = function () {
      ticking = false;
      var mid = window.innerHeight / 2;
      var best = 0, bestD = Infinity;
      for (var i = 0; i < steps.length; i++) {
        var r = steps[i].getBoundingClientRect();
        var d = Math.abs(r.top + r.height / 2 - mid);
        if (d < bestD) { bestD = d; best = i; }
      }
      setStage(best);
    };
    var onScroll = function () {
      if (ticking) return;
      /* requestAnimationFrame does not run while the document is hidden, so a scroll that
         happens in a background tab — restored scroll position, an anchor followed before
         the tab is focused — would queue a frame that never arrives and leave the sequence
         on whichever stage it was last given. Measuring synchronously when hidden costs
         nothing, because there is no paint to align with anyway. */
      if (document.hidden) { measure(); return; }
      ticking = true;
      requestAnimationFrame(measure);
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    /* And recompute on the way back, so returning to the tab never shows a stage that does
       not match where the reader actually is. */
    document.addEventListener("visibilitychange", function () { ticking = false; measure(); });
    measure();
  }

  /* ---------- 4. take-rate calculator ----------
   * Every rate below is the published rate quoted in the page copy; nothing is invented,
   * and logistics is excluded on all sides because every party bills it separately.
   * The output is deliberately "what you keep", not "what they take" — the same
   * arithmetic, read the way a person actually thinks about their own money. */
  var gmv = document.getElementById("calc-gmv");
  var gmvOut = document.getElementById("calc-gmv-out");
  var calcOut = document.getElementById("calc-out");
  if (gmv && calcOut) {
    var eur = function (n) {
      return "\u20ac" + Math.round(n).toLocaleString("en-GB");
    };
    var PLANS = [
      { k: "Guldaar", f: function (x) { return 29 + x * 0.05; }, us: true },
      { k: "Global-e style blended", f: function (x) { return x * 0.17; } },
      { k: "EU agency retainer", f: function (x) { return x * 0.20 + 1500; } },
      { k: "Not On The High Street", f: function (x) { return x * 0.25; } }
    ];
    var draw = function () {
      var x = Number(gmv.value);
      if (gmvOut) gmvOut.textContent = eur(x);
      calcOut.innerHTML = "";
      /* Sorted by what is left, so the list reads as a ranking rather than as four
         unordered facts. Guldaar comes top because the arithmetic puts it there. */
      PLANS.slice().sort(function (a, b) { return (x - a.f(x)) < (x - b.f(x)) ? 1 : -1; })
        .forEach(function (p) {
        var row = document.createElement("div");
        if (p.us) row.className = "us";
        var name = document.createElement("span");
        name.textContent = p.us ? "You keep with Guldaar" : "You keep with " + p.k;
        var val = document.createElement("b");
        val.textContent = eur(Math.max(0, x - p.f(x)));
        row.appendChild(name);
        row.appendChild(val);
        calcOut.appendChild(row);
      });
    };
    gmv.addEventListener("input", draw);
    draw();
  }

  /* ---------- 5. contact composer ---------- */
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

  /* A merchant lives on WhatsApp; a European retail buyer opening a trade account mostly
     does not, and a green chat button as the only prominent channel reads as informal for
     a relationship that involves credit terms and a VAT number. Both channels stay, and
     the primary one follows the audience. */
  function primaryChannel(r) {
    if (!waLink || !mailLink) return;
    var mailIsPrimary = r === "retailer";
    mailLink.className = "btn-lg " + (mailIsPrimary ? "pri" : "sec");
    waLink.className = "btn-lg " + (mailIsPrimary ? "sec" : "pri");
    var cta = waLink.parentNode;
    if (cta && cta.firstChild !== (mailIsPrimary ? mailLink : waLink)) {
      cta.insertBefore(mailIsPrimary ? mailLink : waLink, cta.firstChild);
    }
  }

  function compose() {
    var body = message();
    primaryChannel(role && role.value === "retailer" ? "retailer" : "merchant");
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

  /* Posters: "Save as PDF" is the browser's own print dialog, so the PDF is never stale. */
  [].forEach.call(document.querySelectorAll("[data-print]"), function (b) {
    b.addEventListener("click", function () { window.print(); });
  });

  /* ---------- boot ---------- */
  /* Since 26 Sep 2026 each audience has its own URL. /partner 301s to /partner/merchant and
     the browser keeps the fragment, so an old /partner#retailer link lands here: forward it. */
  var start = (location.hash || "").replace("#", "");
  var aud = page && page.getAttribute("data-audience");
  if (start === "retailer" && aud === "merchant") { location.replace("/partner/retailer"); return; }
  start = aud || "merchant";
  fillTopics(start);
  paint(start);
  compose();
})();
