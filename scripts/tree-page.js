// Client script for the Product Tree tab, served at /assets/tree.js by dashboard-server.mjs.
//
// It does one thing: open a dialog of the photographs filed under a node, and save the one
// you click as that node's face. Everything else on the page is server-rendered HTML.
//
// Plain <dialog> and fetch, no framework and no build step — this file is served verbatim off
// disk to one browser on one machine.
(function () {
  var dlg = document.getElementById("picker");
  var grid = document.getElementById("pgrid");
  var title = document.getElementById("ptitle");
  var openFor = null;

  document.getElementById("pclose").addEventListener("click", function () { dlg.close(); });

  // Delegated: the table has ~97 rows and gains more with every new subcategory, so one
  // listener on the document beats a listener per button.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-pick]");
    if (!btn) return;
    openFor = btn.getAttribute("data-pick");
    title.textContent = openFor === "__wardrobe__" ? "The whole wardrobe" : openFor;
    grid.innerHTML = '<p style="padding:8px;color:#9e9686">Loading photographs…</p>';
    dlg.showModal();

    fetch("/api/tree/photos?path=" + encodeURIComponent(openFor))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.photos || !d.photos.length) {
          grid.innerHTML = '<p style="padding:8px;color:#9e9686">Nothing on this node has a photograph.</p>';
          return;
        }
        var current = document.querySelector('tr[data-path="' + cssEscape(openFor) + '"] td.face img');
        var currentSrc = current ? current.getAttribute("src") : null;
        grid.innerHTML = d.photos.map(function (p) {
          // The sold ones are shown greyed rather than hidden: a shelf's best photograph is
          // sometimes of a piece that has gone, and the picture is still the right face for
          // the shelf even when that exact item is not for sale.
          return '<button class="opt' + (p.thumb === currentSrc ? " on" : "") + '" data-id="' + p.id + '" title="' +
            escapeAttr(p.title) + '">' +
            '<img src="' + p.thumb + '" alt="" loading="lazy"' + (p.sold ? ' style="filter:grayscale(.7)"' : "") + '>' +
            (p.favourites ? '<span class="fav">♥ ' + p.favourites + "</span>" : "") +
            "</button>";
        }).join("");
      });
  });

  grid.addEventListener("click", function (e) {
    var opt = e.target.closest(".opt");
    if (!opt || !openFor) return;
    var id = opt.getAttribute("data-id");
    opt.classList.add("on");

    fetch("/api/featured", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: openFor, itemId: id }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) { alert(d.error); return; }
        // Update the row in place rather than reloading: a reload rebuilds the whole tree
        // server-side and throws away your scroll position halfway down 97 rows.
        var row = document.querySelector('tr[data-path="' + cssEscape(openFor) + '"]');
        if (row) {
          row.querySelector("td.face").innerHTML =
            '<img src="' + d.thumb + '" alt="" width="34" height="34">';
          if (!row.querySelector(".tag")) {
            var tag = document.createElement("span");
            tag.className = "tag";
            tag.textContent = "yours";
            row.querySelector("td.name").appendChild(tag);
          }
        }
        dlg.close();
      });
  });

  // Node paths contain spaces, slashes and apostrophes ("Fashion/Women's clothing"). These
  // go inside a QUOTED attribute selector, so the only two characters that need escaping are
  // the closing quote and the backslash — CSS.escape is the wrong tool here and would escape
  // the space into something that no longer matches the attribute's actual value.
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }
  function escapeAttr(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
})();
