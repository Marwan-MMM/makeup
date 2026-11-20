/* ============================================================
   Blush Beauty — product.js
   Product details: gallery, prices with discount display,
   stock-aware quantity selector, add to cart / wishlist,
   related products. Quantity is capped at available stock
   and re-validated server-side at order time.
   ============================================================ */
(function () {
  'use strict';

  var UI = window.UI, DB = window.DB, I = window.I18N;

  var product = null;
  var qty = 1;
  var selectedImg = 0;

  function idFromUrl() {
    var u = new URLSearchParams(window.location.search);
    return u.get('id') || '';
  }

  function render() {
    var id = idFromUrl();
    if (!id) { notFound(); return; }

    DB.getProduct(id).then(function (p) {
      if (!p) { notFound(); return; }
      product = p;
      qty = 1;
      selectedImg = 0;
      drawPdp();
      document.title = p.nameEn + ' \u2014 Blush Beauty';
      return DB.getRelated(p, 4);
    }).then(function (related) {
      if (!related || !related.length) return;
      var sec = document.getElementById('section-related');
      sec.hidden = false;
      document.getElementById('related-row').innerHTML = related.map(UI.productCard).join('');
    }).catch(function (err) {
      UI.toast(err.message || I.t('error_generic'), 'error');
      notFound();
    });
  }

  function notFound() {
    var root = document.getElementById('pdp-root');
    root.innerHTML =
      '<div class="empty-state">' +
      '<div class="glyph">' + UI.icon('box', 22) + '</div>' +
      '<h2>' + I.t('shop_empty_title') + '</h2>' +
      '<p>' + I.t('pdp_out_note') + '</p>' +
      '<a class="btn btn-outline" href="shop.html">' + I.t('continue_shopping') + '</a>' +
      '</div>';
  }

  function drawPdp() {
    var p = product;
    var root = document.getElementById('pdp-root');
    var rootSec = document.getElementById('pdp-root');

    /* breadcrumb tail */
    var bc = document.getElementById('pdp-breadcrumb');
    var catName = I.lang === 'ar' ? (p.catNameAr || p.catNameEn || '') : (p.catNameEn || p.catNameAr || '');
    if (catName) {
      bc.insertAdjacentHTML('beforeend',
        '<span class="sep">/</span><a href="shop.html?cat=' + UI.esc(p.catSlug) + '">' + UI.esc(catName) + '</a>' +
        '<span class="sep">/</span><span>' + UI.esc(DB.locName(p)) + '</span>');
    } else {
      bc.insertAdjacentHTML('beforeend', '<span class="sep">/</span><span>' + UI.esc(DB.locName(p)) + '</span>');
    }

    var out = p.stock <= 0;
    var wished = UI.Wish.has(p.id);
    var max = Math.max(1, p.stock);

    var gallery = '' +
      '<div class="pdp-gallery">' +
      '<div class="pdp-main-img">' + mainImage() + '</div>' +
      (p.images.length > 1 ? '<div class="pdp-thumbs">' + p.images.map(function (src, i) {
        return '<button type="button" class="pdp-thumb' + (i === selectedImg ? ' active' : '') + '" data-img="' + i + '">' +
          '<img src="' + UI.esc(src) + '" alt="' + UI.esc(DB.locName(p)) + '"></button>';
      }).join('') + '</div>' : '') +
      '</div>';

    var info = '' +
      '<div class="pdp-info">' +
      '<p class="pdp-cat">' + UI.esc(UI.catLabel(p)) + '</p>' +
      '<h1 class="pdp-name">' + UI.esc(DB.locName(p)) + '</h1>' +
      '<p class="pdp-sku">' + I.t('sku') + ' <span class="num">' + UI.esc(p.sku) + '</span></p>' +
      '<div class="pdp-prices">' +
      '<span class="price-now">' + UI.money(p.finalPrice) + '</span>' +
      (p.onSale ? '<span class="price-old">' + UI.money(p.price) + '</span>' +
        '<span class="badge badge-off">' + I.t('off_badge', { p: p.pct }) + '</span>' +
        '<span class="pdp-save">' + I.t('save_amount', { amount: UI.money(p.savings) }) + '</span>' : '') +
      '</div>' +
      '<p class="pdp-stock' + (out ? ' is-out' : '') + '">' + UI.stockLabel(p) + '</p>' +
      (out ? '<p class="muted small">' + I.t('pdp_out_note') + '</p>' : '') +
      '<div class="pdp-actions">' +
      (out ? '' : UI.qtyStepperHtml(qty, max, 'pdp')) +
      '<button type="button" class="btn btn-primary" id="pdp-add"' + (out ? ' disabled' : '') + '>' + UI.icon('bag', 16) + I.t('add_to_cart') + '</button>' +
      '<button type="button" class="btn btn-ghost" id="pdp-wish">' + UI.icon(wished ? 'heartFill' : 'heart', 16) +
      '<span id="pdp-wish-label">' + (wished ? I.t('pdp_in_wish') : I.t('pdp_add_wish')) + '</span></button>' +
      '</div>' +
      '<div class="pdp-desc">' + UI.esc(DB.locDesc(p)) + '</div>' +
      '<div class="pdp-attrs">' +
      '<div class="row"><b>' + I.t('sku') + '</b><span class="num">' + UI.esc(p.sku) + '</span></div>' +
      '<div class="row"><b>' + I.t('pdp_stock') + '</b><span>' + UI.stockLabel(p) + '</span></div>' +
      '</div>' +
      '</div>';

    rootSec.querySelector('.pdp-layout').innerHTML = gallery + info;

    /* sticky mobile CTA */
    var oldSticky = document.getElementById('pdp-sticky');
    if (oldSticky) oldSticky.remove();
    var sticky = document.createElement('div');
    sticky.className = 'pdp-sticky-cta';
    sticky.id = 'pdp-sticky';
    sticky.innerHTML =
      '<span class="sticky-price">' + UI.money(p.finalPrice) + '</span>' +
      '<button type="button" class="btn btn-primary" id="pdp-add-sticky"' + (out ? ' disabled' : '') + '>' + I.t('add_to_cart') + '</button>';
    document.body.appendChild(sticky);

    wireGallery();
    wireActions();
  }

  function mainImage() {
    var p = product;
    if (p.images.length) {
      return '<img id="pdp-main-src" src="' + UI.esc(p.images[selectedImg]) + '" alt="' + UI.esc(DB.locName(p)) + '">';
    }
    return UI.phHtml(DB.locName(p), UI.seedOf(p));
  }

  function wireGallery() {
    document.querySelectorAll('.pdp-thumb').forEach(function (b) {
      b.addEventListener('click', function () {
        selectedImg = Number(b.dataset.img);
        var holder = document.querySelector('.pdp-main-img');
        holder.innerHTML = mainImage();
        document.querySelectorAll('.pdp-thumb').forEach(function (x) {
          x.classList.toggle('active', Number(x.dataset.img) === selectedImg);
        });
      });
    });
  }

  function wireActions() {
    var p = product;
    UI.wireQtySteppers(document.getElementById('pdp-root'), function (v) { qty = v; });

    function addToCart() {
      if (!product || product.stock <= 0) return;
      var cap = Math.min(qty, product.stock);
      if (cap < qty) {
        UI.toast(I.t('cart_max_stock', { n: product.stock }), 'info');
      }
      UI.Cart.add(product.id, cap);
      UI.toast(I.t('added_cart'), 'ok');
    }

    ['pdp-add', 'pdp-add-sticky'].forEach(function (bid) {
      var b = document.getElementById(bid);
      if (b) b.addEventListener('click', addToCart);
    });

    var wishBtn = document.getElementById('pdp-wish');
    if (wishBtn) {
      wishBtn.addEventListener('click', function () {
        var added = UI.Wish.toggle(product.id);
        wishBtn.querySelector('svg').outerHTML = UI.icon(added ? 'heartFill' : 'heart', 16);
        document.getElementById('pdp-wish-label').textContent = added ? I.t('pdp_in_wish') : I.t('pdp_add_wish');
      });
    }

    document.addEventListener('wish:toggled', function (e) {
      if (product && e.detail.id === product.id) {
        var btn = document.getElementById('pdp-wish');
        if (btn) {
          btn.querySelector('svg').outerHTML = UI.icon(e.detail.added ? 'heartFill' : 'heart', 16);
          document.getElementById('pdp-wish-label').textContent = e.detail.added ? I.t('pdp_in_wish') : I.t('pdp_add_wish');
        }
      }
    });
  }

  UI.boot({ rerender: function () {
    /* language switch: redraw breadcrumb tail and full PDP */
    var bc = document.getElementById('pdp-breadcrumb');
    if (bc) {
      bc.innerHTML = '<a href="index.html" data-i18n="pdp_breadcrumb_home"></a><span class="sep">/</span>' +
        '<a href="shop.html" data-i18n="pdp_breadcrumb_shop"></a>';
    }
    if (product) drawPdp();
  } });
  render();
})();
