/* ============================================================
   Blush Beauty — cart.js
   Guest cart (localStorage), refreshed against live product and
   shade data: prices come from the database, quantities are
   capped at the selected shade's available stock (or the product
   stock for unshaded products), unavailable lines are flagged or
   removed. A cart line's identity is the product id PLUS the
   selected shade id: the same product in two shades shows as two
   lines; the same product+shade merges into one line.
   Order totals are re-validated server-side at checkout.
   ============================================================ */
(function () {
  'use strict';

  var UI = window.UI, DB = window.DB, I = window.I18N;

  var rows = []; /* [{p, shade, shadeRow, qty}] */

  function shadeLabel(shadeRow, snapshot) {
    if (shadeRow) {
      var name = I.lang === 'ar' ? (shadeRow.nameAr || shadeRow.nameEn) : (shadeRow.nameEn || shadeRow.nameAr);
      return I.t('shade_numbered', { n: shadeRow.number }) + (name ? ' \u2014 ' + name : '');
    }
    if (snapshot) {
      var sname = I.lang === 'ar' ? (snapshot.nameAr || snapshot.nameEn) : (snapshot.nameEn || snapshot.nameAr);
      return I.t('shade_numbered', { n: snapshot.number }) + (sname ? ' \u2014 ' + sname : '');
    }
    return '';
  }

  function shadeImageFor(r) {
    if (r.shadeRow && r.shadeRow.images.length) return r.shadeRow.images[0].url;
    if (r.shade && r.shade.img) return r.shade.img;
    return '';
  }

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

    var shadedIds = [];
    items.forEach(function (it) { if (it.shade && shadedIds.indexOf(it.id) === -1) shadedIds.push(it.id); });

    Promise.all([
      DB.getProducts({ ids: items.map(function (i) { return i.id; }), limit: 100, noLimit: true }),
      shadedIds.length
        ? Promise.all(shadedIds.map(function (pid) {
            return DB.getShades(pid).catch(function () { return []; });
          }))
        : Promise.resolve([])
    ]).then(function (res) {
      var prods = res[0].items;
      var shadesByProduct = {};
      res[1].forEach(function (list2) {
        if (list2.length) shadesByProduct[list2[0].productId] = list2;
      });

      rows = items.map(function (it) {
        var p = prods.find(function (x) { return x.id === it.id; });
        if (!p) return null;
        var shadeRow = null;
        if (it.shade && shadesByProduct[p.id]) {
          shadeRow = shadesByProduct[p.id].find(function (s) { return s.id === it.shade.id; }) || null;
          /* shade removed or deactivated server-side: drop the line */
          if (!shadeRow) return null;
        }
        var cap = shadeRow ? shadeRow.stock : p.stock;
        return { p: p, shade: it.shade || null, shadeRow: shadeRow, qty: Math.min(it.qty, cap) };
      }).filter(Boolean);

      /* keep the stored cart in sync with what is actually available */
      var seen = {};
      items.forEach(function (it) {
        var r = rows.find(function (x) { return x.p.id === it.id && (x.shade ? x.shade.id : null) === (it.shade ? it.shade.id : null); });
        var cap = r ? (r.shadeRow ? r.shadeRow.stock : r.p.stock) : 0;
        if (!r) {
          UI.Cart.remove(it.id, it.shade ? it.shade.id : null);
        } else if (it.qty > cap && !seen[it.id + (it.shade ? '::' + it.shade.id : '')]) {
          UI.Cart.setQty(it.id, cap, it.shade ? it.shade.id : null);
        }
      });

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

    list.innerHTML = rows.map(function (r, idx) {
      var p = r.p;
      var shadeId = r.shade ? r.shade.id : null;
      var capped = r.qty !== UI.Cart.qtyOf(p.id, shadeId);
      var stock = r.shadeRow ? r.shadeRow.stock : p.stock;
      /* Individual shade pricing: the line sells at the shade's own
         price when one is set; otherwise the product's discount logic. */
      var lineUnit = DB.shadeUnitPrice(p, r.shadeRow);
      var lineOverride = DB.shadePriceOverride(p, r.shadeRow);
      var img = shadeImageFor(r);
      var thumb = img
        ? '<img src="' + UI.esc(img) + '" alt="' + UI.esc(DB.locName(p)) + '" loading="lazy">'
        : UI.mediaHtml(p);
      var pdpHref = 'product.html?id=' + encodeURIComponent(p.id) +
        (r.shadeRow ? '&shade=' + encodeURIComponent(r.shadeRow.number) : '');
      return '' +
        '<div class="cart-row" data-idx="' + idx + '">' +
        '<a class="cart-row-media" href="' + pdpHref + '">' + thumb + '</a>' +
        '<div class="cart-row-info">' +
        '<p class="cart-row-name"><a href="' + pdpHref + '">' + UI.esc(DB.locName(p)) + '</a></p>' +
        (r.shadeRow || r.shade ? '<p class="cart-row-shade">' + UI.icon('palette', 13) + ' ' + UI.esc(shadeLabel(r.shadeRow, r.shade)) + '</p>' : '') +
        (p.demo ? '<p class="cart-row-demo">' + UI.icon('info', 12) + ' ' + UI.esc(I.t('demo_item_note')) + '</p>' : '') +
        '<p class="cart-row-price">' + UI.money(lineUnit) +
        (p.onSale && !lineOverride ? ' <span class="price-old">' + UI.money(p.price) + '</span>' : '') + '</p>' +
        (capped ? '<p class="cart-stock-warn">' + UI.icon('alert', 12) + ' ' + I.t('cart_max_stock', { n: stock }) + '</p>' : '') +
        '<button type="button" class="cart-remove" data-remove-idx="' + idx + '">' + UI.icon('trash', 14) + I.t('remove') + '</button>' +
        '</div>' +
        '<div class="cart-row-side">' +
        UI.qtyStepperHtml(r.qty, Math.max(1, stock), String(idx)) +
        '<span class="cart-row-total">' + UI.money(Math.round(lineUnit * r.qty * 100) / 100) + '</span>' +
        '</div>' +
        '</div>';
    }).join('');

    /* totals */
    var subtotal = 0, savings = 0;
    rows.forEach(function (r) {
      var unit = DB.shadeUnitPrice(r.p, r.shadeRow);
      subtotal += unit * r.qty;
      /* Individual shade prices are the selling price — the product
         discount does not stack on them, so no savings are shown. */
      if (r.p.onSale && !DB.shadePriceOverride(r.p, r.shadeRow)) {
        savings += (r.p.price - r.p.finalPrice) * r.qty;
      }
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
      var row = rows[Number(ctx)];
      if (!row) return;
      var shadeId = row.shade ? row.shade.id : null;
      UI.Cart.setQty(row.p.id, v, shadeId);
      row.qty = Math.min(v, row.shadeRow ? row.shadeRow.stock : row.p.stock);
      draw();
    });

    list.querySelectorAll('[data-remove-idx]').forEach(function (b) {
      b.addEventListener('click', function () {
        var row = rows[Number(b.dataset.removeIdx)];
        if (!row) return;
        UI.Cart.remove(row.p.id, row.shade ? row.shade.id : null);
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
