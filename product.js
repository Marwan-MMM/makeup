/* ============================================================
   Blush Beauty — product.js
   Product details: gallery, prices with discount display,
   stock-aware quantity selector, add to cart / wishlist,
   related products, and colour shades.

   Shades: one product may expose several colour variations
   (product_shades). Each shade has independent stock and its own
   image gallery; selecting a shade swaps the entire gallery to
   that shade's images, caps the quantity by that shade's stock
   and stores the shade on the cart line. Products without shades
   keep the exact previous behaviour. Quantity is re-validated
   server-side at order time.
   ============================================================ */
(function () {
  'use strict';

  var UI = window.UI, DB = window.DB, I = window.I18N;

  var product = null;
  var shades = [];       /* active shades of this product (mapped) */
  var shade = null;      /* currently selected shade or null */
  var selectedImg = 0;   /* index inside the active gallery */
  var qty = 1;

  function idFromUrl() {
    var u = new URLSearchParams(window.location.search);
    return u.get('id') || '';
  }

  function shadeParam() {
    var u = new URLSearchParams(window.location.search);
    return u.get('shade');
  }

  function render() {
    var id = idFromUrl();
    if (!id) { notFound(); return; }

    DB.getProduct(id).then(function (p) {
      if (!p) { notFound(); return Promise.reject(new Error('not-found')); }
      product = p;
      qty = 1;
      selectedImg = 0;
      shade = null;
      UI.registerShareProduct(p); /* for the PDP share button */
      document.title = p.nameEn + ' \u2014 Blush Beauty';
      /* Shades load independently: if the shades migration has not run
         yet (or the product simply has none) the PDP works unchanged. */
      return DB.getShades(p.id).catch(function () { return []; });
    }).then(function (list) {
      shades = list || [];
      pickInitialShade();
      drawPdp();
      return DB.getRelated(product, 4);
    }).then(function (related) {
      if (!related || !related.length) return;
      var sec = document.getElementById('section-related');
      sec.hidden = false;
      document.getElementById('related-row').innerHTML = related.map(UI.productCard).join('');
    }).catch(function (err) {
      if (err && err.message === 'not-found') return;
      UI.toast(err.message || I.t('error_generic'), 'error');
      notFound();
    });
  }

  function pickInitialShade() {
    if (!shades.length) return;
    var wanted = shadeParam();
    if (wanted !== null && wanted !== '') {
      shade = shades.find(function (s) {
        return String(s.number) === wanted || s.id === wanted;
      }) || null;
    }
    if (!shade && shades.length === 1) {
      shade = shades[0]; /* single available shade: select automatically */
    }
    if (shade) selectedImg = 0;
  }

  function hasShades() { return shades.length > 0; }

  /* Images of the active gallery: the selected shade's images when a
     shade with images is selected; otherwise the product's own images
     (also the fallback for a shade without images — never another
     shade's images). */
  function galleryImages() {
    var p = product;
    if (shade && shade.images.length) {
      return shade.images.map(function (im) { return im.url; }).filter(Boolean);
    }
    return p.images || [];
  }

  function shadeName(s) {
    return I.lang === 'ar' ? (s.nameAr || s.nameEn) : (s.nameEn || s.nameAr);
  }

  function shadeLineLabel(s) {
    var name = shadeName(s);
    return I.t('shade_numbered', { n: s.number }) + (name ? ' \u2014 ' + name : '');
  }

  /* Individual shade pricing: a shade with its own DB price IS the
     selling price for that selection (the product discount never
     stacks on top, so nothing is discounted twice). Shades without an
     individual price keep the product's live-discount price. drawPdp()
     re-renders on every shade switch, so the displayed price follows
     the selection immediately. */
  function priceOverride() {
    return !!(shade && DB.shadePriceOverride(product, shade));
  }
  function displayPrice() {
    return priceOverride() ? Number(shade.price) : product.finalPrice;
  }

  /* Stock label for shaded products follows the selected shade. */
  function currentStock() {
    return shade ? shade.stock : (product ? product.stock : 0);
  }

  function stockLine() {
    var p = product;
    if (hasShades() && !shade) {
      return '<p class="pdp-stock"><span class="stock-dot dot-low"></span>' + UI.esc(I.t('shade_required')) + '</p>';
    }
    var stock = currentStock();
    if (stock <= 0) {
      return '<p class="pdp-stock is-out"><span class="stock-dot dot-out"></span>' + I.t('out_of_stock') + '</p>';
    }
    /* Shade stock quantities stay private unless the shade reaches its
       own low-stock alert level (per-shade threshold). */
    if (stock <= (shade ? shade.lowThreshold : p.lowThreshold)) {
      return '<p class="pdp-stock"><span class="stock-dot dot-low"></span>' + I.t('low_stock', { n: stock }) + '</p>';
    }
    return '<p class="pdp-stock"><span class="stock-dot dot-ok"></span>' + I.t('in_stock') + '</p>';
  }

  function shadeSectionHtml() {
    if (!hasShades()) return '';
    var showPrices = DB.shadePricesDiffer(product);
    var btns = shades.map(function (s) {
      var selectable = s.stock > 0;
      var cls = 'shade-btn' + (shade && shade.id === s.id ? ' active' : '') + (selectable ? '' : ' is-out');
      /* Per-shade low-stock alert: show the remaining quantity ONLY
         when the shade reaches its own threshold; out-of-stock shades
         are already flagged separately. */
      var low = selectable && s.stock <= s.lowThreshold
        ? '<span class="shade-btn-low">' + UI.esc(I.t('low_stock', { n: s.stock })) + '</span>' : '';
      var price = showPrices
        ? '<span class="shade-btn-price num">' + UI.esc(UI.money(DB.shadeUnitPrice(product, s))) + '</span>' : '';
      var aria = shadeLineLabel(s) +
        (price ? ' \u00b7 ' + UI.money(DB.shadeUnitPrice(product, s)) : '') +
        (low ? ' \u00b7 ' + I.t('low_stock', { n: s.stock }) : '') +
        (selectable ? '' : ' \u00b7 ' + I.t('shade_unavailable'));
      return '<button type="button" class="' + cls + '" data-shade-id="' + UI.esc(s.id) + '"' +
        (selectable ? '' : ' disabled aria-disabled="true"') +
        ' aria-pressed="' + (shade && shade.id === s.id ? 'true' : 'false') + '"' +
        ' aria-label="' + UI.esc(aria) + '">' +
        '<span class="shade-btn-num num">' + UI.esc(s.number) + '</span>' +
        (shadeName(s) ? '<span class="shade-btn-name">' + UI.esc(shadeName(s)) + '</span>' : '') +
        price +
        low +
        (selectable ? '' : '<span class="shade-btn-out">' + I.t('shade_unavailable') + '</span>') +
        '</button>';
    }).join('');
    /* Selected-shade line: quantities appear only when the shade is low
       or out of stock (per-shade low-stock alert level). */
    var label = shade
      ? '<p class="shade-selected">' + UI.esc(shadeLineLabel(shade)) +
        (shade.stock <= 0
          ? ' \u00b7 <span class="num">' + UI.esc(I.t('shade_unavailable')) + '</span>'
          : (shade.stock <= shade.lowThreshold
            ? ' \u00b7 <span class="num">' + UI.esc(I.t('low_stock', { n: shade.stock })) + '</span>'
            : '')) +
        '</p>'
      : '';
    return '<div class="pdp-shades">' +
      '<p class="overline pdp-shades-title">' + I.t('shades_title') + '</p>' +
      '<div class="shade-btns">' + btns + '</div>' +
      label +
      '</div>';
  }

  function drawPdp() {
    var p = product;
    var root = document.getElementById('pdp-root');
    var rootSec = document.getElementById('pdp-root');

    /* breadcrumb tail — REPLACED on every draw: drawPdp re-renders on
       each shade selection, and the previous insertAdjacentHTML here
       APPENDED "Category / Product" again for every switch, so three
       shade clicks produced three duplicated breadcrumb segments. The
       static Home/Shop anchors stay untouched; only this tail span is
       rewritten, in both LTR and RTL. */
    var bc = document.getElementById('pdp-breadcrumb');
    var bcTail = document.getElementById('pdp-breadcrumb-tail');
    if (!bcTail) {
      bcTail = document.createElement('span');
      bcTail.id = 'pdp-breadcrumb-tail';
      bc.appendChild(bcTail);
    }
    var catName = I.lang === 'ar' ? (p.catNameAr || p.catNameEn || '') : (p.catNameEn || p.catNameAr || '');
    bcTail.innerHTML = (catName
      ? '<span class="sep">/</span><a href="shop.html?cat=' + UI.esc(p.catSlug) + '">' + UI.esc(catName) + '</a>'
      : '') +
      '<span class="sep">/</span><span>' + UI.esc(DB.locName(p)) + '</span>';

    var images = galleryImages();
    var out = hasShades() ? (!shade || shade.stock <= 0) : (p.stock <= 0);
    var purchasable = !out;
    var wished = UI.Wish.has(p.id);
    var max = Math.max(1, hasShades() && shade ? shade.stock : p.stock);

    var gallery = '' +
      '<div class="pdp-gallery">' +
      '<div class="pdp-main-img">' + mainImage(images) + '</div>' +
      (images.length > 1 ? '<div class="pdp-thumbs">' + images.map(function (src, i) {
        return '<button type="button" class="pdp-thumb' + (i === selectedImg ? ' active' : '') + '" data-img="' + i + '">' +
          '<img src="' + UI.esc(src) + '" alt="' + UI.esc(DB.locName(p)) + '"></button>';
      }).join('') + '</div>' : '') +
      '</div>';

    var info = '' +
      '<div class="pdp-info">' +
      '<p class="pdp-cat">' + UI.esc(UI.catLabel(p)) + '</p>' +
      '<h1 class="pdp-name">' + UI.esc(DB.locName(p)) + '</h1>' +
      '<div class="pdp-prices">' +
      '<span class="price-now">' + UI.money(displayPrice()) + '</span>' +
      (!priceOverride() && p.onSale ? '<span class="price-old">' + UI.money(p.price) + '</span>' +
        '<span class="badge badge-off">' + I.t('off_badge', { p: p.pct }) + '</span>' +
        '<span class="pdp-save">' + I.t('save_amount', { amount: UI.money(p.savings) }) + '</span>' : '') +
      (priceOverride() ? '<span class="pdp-shade-price-note">' + UI.esc(I.t('shade_price_note')) + '</span>' : '') +
      '</div>' +
      stockLine() +
      (out ? '<p class="muted small">' + I.t('pdp_out_note') + '</p>' : '') +
      shadeSectionHtml() +
      '<div class="pdp-actions">' +
      (purchasable ? UI.qtyStepperHtml(qty, max, 'pdp') : '') +
      '<button type="button" class="btn btn-primary" id="pdp-add"' + (purchasable ? '' : ' disabled') + '>' + UI.icon('bag', 16) + I.t('add_to_cart') + '</button>' +
      '<button type="button" class="btn btn-ghost" id="pdp-wish">' + UI.icon(wished ? 'heartFill' : 'heart', 16) +
      '<span id="pdp-wish-label">' + (wished ? I.t('pdp_in_wish') : I.t('pdp_add_wish')) + '</span></button>' +
      '<button type="button" class="btn btn-ghost" id="pdp-share" data-share-id="' + UI.esc(p.id) + '">' + UI.icon('share', 16) +
      '<span>' + I.t('share_product') + '</span></button>' +
      '</div>' +
      '<div class="pdp-desc">' + UI.esc(DB.locDesc(p)) + '</div>' +
      '<div class="pdp-attrs">' +
      '<div class="row"><b>' + I.t('pdp_stock') + '</b><span>' + stockLine() + '</span></div>' +
      (shade ? '<div class="row"><b>' + I.t('shade_label') + '</b><span>' + UI.esc(shadeLineLabel(shade)) + '</span></div>' : '') +
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
      '<span class="sticky-price">' + UI.money(displayPrice()) + '</span>' +
      '<button type="button" class="btn btn-primary" id="pdp-add-sticky"' + (purchasable ? '' : ' disabled') + '>' + I.t('add_to_cart') + '</button>';
    document.body.appendChild(sticky);

    wireGallery();
    wireShadeButtons();
    wireActions();
  }

  function mainImage(images) {
    var p = product;
    if (images && images.length) {
      return '<img id="pdp-main-src" src="' + UI.esc(images[selectedImg] || images[0]) + '" alt="' + UI.esc(DB.locName(p)) + '">';
    }
    return UI.phHtml(DB.locName(p), UI.seedOf(p));
  }

  function wireGallery() {
    document.querySelectorAll('.pdp-thumb').forEach(function (b) {
      b.addEventListener('click', function () {
        selectedImg = Number(b.dataset.img);
        var holder = document.querySelector('.pdp-main-img');
        holder.innerHTML = mainImage(galleryImages());
        document.querySelectorAll('.pdp-thumb').forEach(function (x) {
          x.classList.toggle('active', Number(x.dataset.img) === selectedImg);
        });
      });
    });
  }

  function wireShadeButtons() {
    document.querySelectorAll('.shade-btn').forEach(function (b) {
      if (b.disabled) return;
      b.addEventListener('click', function () {
        var s = shades.find(function (x) { return x.id === b.dataset.shadeId; });
        if (!s || s.stock <= 0) return;
        shade = s;
        selectedImg = 0;
        qty = 1;
        /* Keep the shade in the URL so sharing / reloading preserves
           the exact selection (PDP share shares the current URL). */
        var u = new URLSearchParams(window.location.search);
        u.set('shade', String(s.number));
        try { history.replaceState(null, '', window.location.pathname + '?' + u.toString()); } catch (e) { /* ignore */ }
        drawPdp();
      });
    });
  }

  function wireActions() {
    var p = product;
    UI.wireQtySteppers(document.getElementById('pdp-root'), function (v) { qty = v; });

    function addToCart() {
      if (!product) return;
      if (hasShades() && !shade) {
        UI.toast(I.t('shade_required'), 'info');
        var sec = document.querySelector('.pdp-shades');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      var stock = hasShades() && shade ? shade.stock : p.stock;
      if (stock <= 0) return;
      var cap = Math.min(qty, stock);
      if (cap < qty) {
        UI.toast(I.t('cart_max_stock', { n: stock }), 'info');
      }
      /* Cart line identity = product id + shade id (null when the
         product has no shades). The shade snapshot keeps the label and
         thumbnail correct inside the cart. */
      UI.Cart.add(p.id, cap, shade ? {
        id: shade.id,
        number: shade.number,
        nameEn: shade.nameEn,
        nameAr: shade.nameAr,
        /* Individual shade price snapshot for the cart line display */
        price: shade.price,
        img: shade.images.length ? shade.images[0].url : ''
      } : null);
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
