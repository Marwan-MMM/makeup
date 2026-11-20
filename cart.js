/* ============================================================
   Blush Beauty — cart.js
   Guest cart (localStorage), refreshed against live product
   data: prices come from the database, quantities are capped
   at available stock, unavailable products are flagged.
   Order totals are re-validated server-side at checkout.
   ============================================================ */
(function () {
  'use strict';

  var UI = window.UI, DB = window.DB, I = window.I18N;

  var rows = []; /* [{p, qty}] */

  function render() {
    var items = UI.Cart.items();
    var list = document.getElementById('cart-list');
    var summary = document.getElementById('cart-summary');
    var empty = document.getElementById('cart-empty');
    var layout = document.getElementById('cart-layout');
    document.getElementById('cart-glyph').innerHTML = UI.icon('bag', 22);

    if (!items.length) {
      layout.style.display = 'none';
      empty.hidden = false;
      list.innerHTML = '';
      summary.hidden = true;
      return;
    }
    empty.hidden = true;
    layout.style.display = '';
    list.innerHTML = '<div class="skel" style="height:110px"></div>';

    DB.getProducts({ ids: items.map(function (i) { return i.id; }), limit: 100, noLimit: true })
      .then(function (res) {
        rows = items.map(function (it) {
          var p = res.items.find(function (x) { return x.id === it.id; });
          return p ? { p: p, qty: Math.min(it.qty, p.stock) } : null;
        }).filter(Boolean);

        /* remove entries whose products disappeared */
        if (res.items.length !== items.length) {
          res.items.forEach(function (p) {
            var original = items.find(function (x) { return x.id === p.id; });
            if (original && original.qty > p.stock) {
              UI.Cart.setQty(p.id, p.stock);
            }
          });
          items.filter(function (it) {
            return !res.items.find(function (x) { return x.id === it.id; });
          }).forEach(function (it) { UI.Cart.remove(it.id); });
        }

        draw();
      })
      .catch(function (err) {
        UI.toast(err.message || I.t('error_generic'), 'error');
        list.innerHTML = '';
      });
  }

  function draw() {
    var list = document.getElementById('cart-list');
    var summary = document.getElementById('cart-summary');
    if (!rows.length) { render(); return; }

    list.innerHTML = rows.map(function (r) {
      var p = r.p;
      var capped = r.qty !== UI.Cart.qtyOf(p.id);
      return '' +
        '<div class="cart-row" data-id="' + UI.esc(p.id) + '">' +
        '<a class="cart-row-media" href="product.html?id=' + encodeURIComponent(p.id) + '">' + UI.mediaHtml(p) + '</a>' +
        '<div class="cart-row-info">' +
        '<p class="cart-row-name"><a href="product.html?id=' + encodeURIComponent(p.id) + '">' + UI.esc(DB.locName(p)) + '</a></p>' +
        '<p class="cart-row-sku">' + I.t('sku') + ' <span class="num">' + UI.esc(p.sku) + '</span></p>' +
        '<p class="cart-row-price">' + UI.money(p.finalPrice) +
        (p.onSale ? ' <span class="price-old">' + UI.money(p.price) + '</span>' : '') + '</p>' +
        (capped ? '<p class="cart-stock-warn">' + UI.icon('alert', 12) + ' ' + I.t('cart_max_stock', { n: p.stock }) + '</p>' : '') +
        '<button type="button" class="cart-remove" data-remove="' + UI.esc(p.id) + '">' + UI.icon('trash', 14) + I.t('remove') + '</button>' +
        '</div>' +
        '<div class="cart-row-side">' +
        UI.qtyStepperHtml(r.qty, Math.max(1, p.stock), p.id) +
        '<span class="cart-row-total">' + UI.money(Math.round(p.finalPrice * r.qty * 100) / 100) + '</span>' +
        '</div>' +
        '</div>';
    }).join('');

    /* totals */
    var subtotal = 0, savings = 0;
    rows.forEach(function (r) {
      subtotal += r.p.finalPrice * r.qty;
      if (r.p.onSale) savings += (r.p.price - r.p.finalPrice) * r.qty;
    });
    DB.getSettings().then(function (s) {
      var shipping = Number(s.shipping_fee) || 0;
      document.getElementById('sum-subtotal').textContent = UI.money(round2(subtotal));
      document.getElementById('sum-shipping').textContent = UI.money(shipping);
      document.getElementById('sum-total').textContent = UI.money(round2(subtotal + shipping));
      var srow = document.getElementById('sum-savings-row');
      if (savings > 0) {
        srow.hidden = false;
        document.querySelector('[data-savings-label]').textContent = I.t('save_amount', { amount: '' });
        document.getElementById('sum-savings').textContent = UI.money(round2(savings));
      } else {
        srow.hidden = true;
      }
    }).catch(function () { /* keep previous totals */ });

    summary.hidden = false;

    UI.wireQtySteppers(list, function (v, ctx) {
      var id = ctx;
      var row = rows.find(function (r) { return r.p.id === id; });
      if (!row) return;
      UI.Cart.setQty(id, v);
      /* re-render only quantities and totals */
      row.qty = Math.min(v, row.p.stock);
      draw();
    });

    list.querySelectorAll('[data-remove]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.Cart.remove(b.dataset.remove);
        UI.toast(I.t('cart_removed'), 'info');
        render();
      });
    });
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  document.addEventListener('cart:change', function () {
    /* full refresh keeps stock capping consistent */
    clearTimeout(window.__cartTimer);
    window.__cartTimer = setTimeout(render, 60);
  });

  UI.boot({ rerender: render });
  render();
})();
