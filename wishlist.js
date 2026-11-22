/* ============================================================
   Blush Beauty — wishlist.js
   Guest wishlist page (localStorage). Saved products can be
   moved to the cart. Works without customer registration.
   ============================================================ */
(function () {
  'use strict';

  var UI = window.UI, DB = window.DB, I = window.I18N;

  function render() {
    var ids = UI.Wish.items();
    var grid = document.getElementById('wish-grid');
    var empty = document.getElementById('wish-empty');
    var line = document.getElementById('wish-count-line');
    document.getElementById('wish-glyph').innerHTML = UI.icon('heart', 22);

    line.textContent = I.t('wish_count', { n: ids.length });

    if (!ids.length) {
      grid.hidden = true;
      empty.hidden = false;
      grid.innerHTML = '';
      return;
    }

    empty.hidden = true;
    grid.hidden = false;
    grid.innerHTML = '<div class="skel skel-card"></div><div class="skel skel-card"></div>';

    /* Settings first (cached): the "Show Individual Shade Prices"
       switch must be settled before card chips render. */
    DB.getSettings().catch(function () { return {}; }).then(function () {
      return DB.getProducts({ ids: ids, limit: 100, noLimit: true });
    }).then(function (res) {
      var items = res.items;
      /* drop wishlist entries whose products no longer exist / are inactive */
      if (items.length !== ids.length) {
        items.forEach(function (p) { /* keep as-is */ });
        ids.forEach(function (id) {
          if (!items.find(function (p) { return p.id === id; })) {
            UI.Wish.remove(id);
          }
        });
      }
      line.textContent = I.t('wish_count', { n: items.length });
      if (!items.length) {
        grid.hidden = true;
        empty.hidden = false;
        return;
      }
      grid.innerHTML = items.map(function (p) {
        var card = UI.productCard(p);
        /* inject an "add to cart" action under the stock line */
        return card.replace(
          '<p class="card-stock">' + UI.stockLabel(p) + '</p>',
          '<p class="card-stock">' + UI.stockLabel(p) + '</p>' +
          (p.stock > 0
            ? '<button type="button" class="btn btn-ghost btn-sm mt-1" data-add-id="' + UI.esc(p.id) + '">' + UI.icon('bag', 14) + I.t('wish_add_cart') + '</button>'
            : '')
        );
      }).join('');

      grid.querySelectorAll('[data-add-id]').forEach(function (b) {
        b.addEventListener('click', function () {
          UI.Cart.add(b.dataset.addId, 1);
          UI.toast(I.t('added_cart'), 'ok');
        });
      });
    }).catch(function (err) {
      grid.innerHTML = '';
      UI.toast(err.message || I.t('error_generic'), 'error');
    });
  }

  document.addEventListener('wish:toggled', function () { render(); });
  document.addEventListener('wish:change', function () { render(); });

  UI.boot({ rerender: render });
  render();
})();
