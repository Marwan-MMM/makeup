/* ============================================================
   Blush Beauty — shop.js
   Shop page: category + subcategory filtering (subcategories
   only when enabled in settings and only those with active
   products), price range, availability, sale filter, sorting,
   search and "load more" pagination.
   ============================================================ */
(function () {
  'use strict';

  var UI = window.UI, DB = window.DB, I = window.I18N;

  var PAGE_SIZE = 12;
  var state = {
    cat: 'all',
    sub: '',
    q: '',
    min: '',
    max: '',
    inStock: false,
    onSale: false,
    sort: 'newest',
    offset: 0,
    total: 0,
    loading: false,
    showSubs: false,
    subsList: []
  };

  function readUrl() {
    var u = new URLSearchParams(window.location.search);
    state.cat = u.get('cat') || 'all';
    if (['makeup', 'perfumes', 'flash'].indexOf(state.cat) === -1 && state.cat !== 'all') state.cat = 'all';
    state.sub = u.get('sub') || '';
    state.q = u.get('q') || '';
    state.sort = ['newest', 'best', 'price_asc', 'price_desc'].indexOf(u.get('sort')) !== -1 ? u.get('sort') : 'newest';
  }

  function writeUrl() {
    var u = new URLSearchParams();
    if (state.cat !== 'all') u.set('cat', state.cat);
    if (state.sub) u.set('sub', state.sub);
    if (state.q) u.set('q', state.q);
    if (state.sort !== 'newest') u.set('sort', state.sort);
    var qs = u.toString();
    history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
  }

  function activeFilterCount() {
    var n = 0;
    if (state.cat !== 'all') n++;
    if (state.sub) n++;
    if (state.min !== '' || state.max !== '') n++;
    if (state.inStock) n++;
    if (state.onSale) n++;
    return n;
  }

  function buildFilters() {
    var host = document.getElementById('filters-desktop');
    if (!host) return;

    var catRows = [
      { v: 'all', label: I.t('shop_all') },
      { v: 'makeup', label: I.t('nav_makeup') },
      { v: 'perfumes', label: I.t('nav_perfumes') },
      { v: 'flash', label: I.t('nav_flash') }
    ];

    var subHtml = '';
    if (state.showSubs && state.cat === 'makeup') {
      subHtml = '<div class="filter-group"><h3>' + I.t('shop_subcategory') + '</h3><div class="chips-row">' +
        '<button type="button" class="chip' + (state.sub === '' ? ' active' : '') + '" data-sub="">' + I.t('shop_all') + '</button>' +
        state.subsList.map(function (s) {
          return '<button type="button" class="chip' + (state.sub === s.slug ? ' active' : '') + '" data-sub="' + UI.esc(s.slug) + '">' +
            UI.esc(I.lang === 'ar' ? (s.name_ar || s.name_en) : (s.name_en || s.name_ar)) + '</button>';
        }).join('') +
        '</div></div>';
    }

    host.innerHTML =
      '<div class="filter-group"><h3>' + I.t('shop_category') + '</h3><div class="filter-list">' +
      catRows.map(function (r) {
        return '<button type="button" class="linklike' + (state.cat === r.v ? ' active' : '') + '" data-cat="' + r.v + '">' + r.label + '</button>';
      }).join('') +
      '</div></div>' +
      subHtml +
      '<div class="filter-group"><h3>' + I.t('shop_price') + '</h3>' +
      '<div class="price-inputs">' +
      '<input class="input" id="price-min" inputmode="numeric" placeholder="' + I.t('shop_price_min') + '" value="' + UI.esc(state.min) + '">' +
      '<span class="dash">&ndash;</span>' +
      '<input class="input" id="price-max" inputmode="numeric" placeholder="' + I.t('shop_price_max') + '" value="' + UI.esc(state.max) + '">' +
      '</div></div>' +
      '<div class="filter-group"><h3>' + I.t('shop_avail') + '</h3>' +
      '<label class="checkbox-row"><input type="checkbox" id="f-instock"' + (state.inStock ? ' checked' : '') + '> <span>' + I.t('shop_instock_only') + '</span></label>' +
      '<label class="checkbox-row"><input type="checkbox" id="f-onsale"' + (state.onSale ? ' checked' : '') + '> <span>' + I.t('shop_sale_only') + '</span></label>' +
      '</div>' +
      '<div class="filter-group"><button type="button" class="btn btn-ghost btn-sm btn-block" id="clear-filters">' + I.t('shop_clear') + '</button></div>';

    host.querySelectorAll('[data-cat]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.cat = b.dataset.cat;
        state.sub = '';
        state.offset = 0;
        writeUrl();
        buildFilters();
        load(true);
      });
    });
    host.querySelectorAll('[data-sub]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.sub = b.dataset.sub;
        state.offset = 0;
        writeUrl();
        buildFilters();
        load(true);
      });
    });
    host.querySelector('#price-min').addEventListener('change', function () {
      state.min = this.value.replace(/[^0-9.]/g, ''); this.value = state.min; applyPrice();
    });
    host.querySelector('#price-max').addEventListener('change', function () {
      state.max = this.value.replace(/[^0-9.]/g, ''); this.value = state.max; applyPrice();
    });
    host.querySelector('#f-instock').addEventListener('change', function () {
      state.inStock = this.checked; applyFilters();
    });
    host.querySelector('#f-onsale').addEventListener('change', function () {
      state.onSale = this.checked; applyFilters();
    });
    host.querySelector('#clear-filters').addEventListener('click', clearAll);

    updateFilterCountBadge();
  }

  function applyPrice() { state.offset = 0; applyFilters(); }
  function applyFilters() { state.offset = 0; writeUrl(); updateFilterCountBadge(); load(true); }

  function clearAll() {
    state.cat = 'all'; state.sub = ''; state.q = ''; state.min = ''; state.max = '';
    state.inStock = false; state.onSale = false; state.offset = 0;
    writeUrl();
    buildFilters();
    load(true);
  }

  function updateFilterCountBadge() {
    var n = activeFilterCount();
    var el = document.querySelector('[data-filters-count]');
    if (el) {
      el.textContent = '(' + n + ')';
      el.hidden = n === 0;
    }
    var count2 = document.getElementById('filters-open-2');
    if (count2) {
      var txt = I.t('shop_filters') + (n ? ' (' + n + ')' : '');
      count2.innerHTML = '<span class="flex-between" style="display:inline-flex;gap:8px">' + UI.icon('filter', 14) + '<span>' + txt + '</span></span>';
    }
  }

  function load(reset) {
    if (state.loading) return;
    state.loading = true;
    var grid = document.getElementById('products-grid');
    if (reset) {
      state.offset = 0;
      grid.innerHTML = '<div class="skel skel-card"></div><div class="skel skel-card"></div><div class="skel skel-card"></div><div class="skel skel-card"></div>';
      document.getElementById('shop-empty').hidden = true;
    }
    document.getElementById('load-more-wrap').hidden = true;

    var opts = {
      category: state.cat === 'all' ? undefined : state.cat,
      subcategory: state.sub || undefined,
      q: state.q || undefined,
      min: state.min || undefined,
      max: state.max || undefined,
      inStock: state.inStock || undefined,
      onSale: state.onSale || undefined,
      sort: state.sort,
      limit: PAGE_SIZE,
      offset: state.offset
    };

    DB.getProducts(opts).then(function (res) {
      state.total = res.total;
      state.offset += res.items.length;
      var isFirst = state.offset === res.items.length || reset;
      if (isFirst) grid.innerHTML = '';
      if (!res.items.length && isFirst) {
        document.getElementById('shop-empty').hidden = false;
        document.getElementById('result-count').textContent = I.t('shop_count', { n: 0 });
        grid.innerHTML = '';
        state.loading = false;
        return;
      }
      grid.insertAdjacentHTML('beforeend', res.items.map(UI.productCard).join(''));
      document.getElementById('result-count').textContent = I.t('shop_count', { n: res.total });
      document.getElementById('load-more-wrap').hidden = state.offset >= res.total;
      state.loading = false;
    }).catch(function (err) {
      /* Visible error state in the grid (never a blank page): friendly
         note + the technical message (for the store owner) + retry. */
      state.loading = false;
      if (reset) grid.innerHTML = '';
      var box = document.createElement('div');
      box.className = 'grid-error';
      box.innerHTML =
        '<p class="grid-error-note">' + UI.esc(I.t('shop_error_note')) + '</p>' +
        '<p class="grid-error-detail">' + UI.esc((err && err.message) || I.t('error_generic')) + '</p>' +
        '<button type="button" class="btn btn-outline btn-sm" data-retry>' + UI.esc(I.t('retry')) + '</button>';
      box.querySelector('[data-retry]').addEventListener('click', function () {
        box.remove();
        load(true);
      });
      grid.appendChild(box);
      UI.toast((err && err.message) || I.t('error_generic'), 'error');
    });
  }

  /* Mobile filter sheet */
  function openSheet() {
    if (window.innerWidth >= 900) return;
    var wrap = document.createElement('div');
    wrap.className = 'filter-sheet-wrap';
    wrap.id = 'filter-sheet-wrap';
    wrap.innerHTML =
      '<div class="filter-sheet" role="dialog" aria-modal="true">' +
      '<div class="filter-sheet-head"><h2 class="display-2">' + I.t('shop_filters') + '</h2>' +
      '<button type="button" class="icon-btn" id="sheet-close" data-i18n-aria="close">' + UI.icon('x', 22) + '</button></div>' +
      '<div id="sheet-body"></div>' +
      '<div class="filter-sheet-foot"><button type="button" class="btn btn-primary btn-block" id="sheet-apply">' + I.t('filters_done') + '</button></div>' +
      '</div>';
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    var body = wrap.querySelector('#sheet-body');
    body.innerHTML = document.getElementById('filters-desktop').innerHTML;
    /* Re-wire events inside the sheet by reusing the same builder logic */
    wireFilterEvents(body, function () { closeSheet(); load(true); });
    wrap.querySelector('#sheet-close').addEventListener('click', closeSheet);
    wrap.querySelector('#sheet-apply').addEventListener('click', function () {
      closeSheet(); load(true);
    });
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) closeSheet();
    });
    function closeSheet() {
      wrap.remove();
      document.body.classList.remove('no-scroll');
      /* sync state-based UI into the desktop panel */
      buildFilters();
    }
  }

  function wireFilterEvents(root, onDone) {
    root.querySelectorAll('[data-cat]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.cat = b.dataset.cat; state.sub = ''; state.offset = 0;
        buildFilters();
        /* rebuild sheet content with updated chips */
        document.getElementById('sheet-body').innerHTML = document.getElementById('filters-desktop').innerHTML;
        wireFilterEvents(document.getElementById('sheet-body'), onDone);
      });
    });
    root.querySelectorAll('[data-sub]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.sub = b.dataset.sub; state.offset = 0;
        buildFilters();
        document.getElementById('sheet-body').innerHTML = document.getElementById('filters-desktop').innerHTML;
        wireFilterEvents(document.getElementById('sheet-body'), onDone);
      });
    });
    var pmin = root.querySelector('#price-min'), pmax = root.querySelector('#price-max');
    if (pmin) pmin.addEventListener('change', function () { state.min = this.value.replace(/[^0-9.]/g, ''); this.value = state.min; });
    if (pmax) pmax.addEventListener('change', function () { state.max = this.value.replace(/[^0-9.]/g, ''); this.value = state.max; });
    var si = root.querySelector('#f-instock');
    if (si) si.addEventListener('change', function () { state.inStock = this.checked; });
    var so = root.querySelector('#f-onsale');
    if (so) so.addEventListener('change', function () { state.onSale = this.checked; });
    var cf = root.querySelector('#clear-filters');
    if (cf) cf.addEventListener('click', function () {
      clearAll();
      var wrap = document.getElementById('filter-sheet-wrap');
      if (wrap) { wrap.remove(); document.body.classList.remove('no-scroll'); }
    });
  }

  function render() {
    readUrl();
    document.getElementById('crumb-current').textContent = I.t('shop_title');
    if (state.q) {
      var head = document.querySelector('.page-head h1');
      if (head) head.textContent = '"' + state.q + '"';
    }
    var sortSel = document.getElementById('sort-select');
    sortSel.value = state.sort;
    sortSel.querySelectorAll('option').forEach(function (o) { o.textContent = I.t({ newest: 'sort_newest', best: 'sort_best', price_asc: 'sort_price_asc', price_desc: 'sort_price_desc' }[o.value]); });
    document.querySelector('[data-empty-glyph]').innerHTML = UI.icon('search', 22);

    DB.getSettings().then(function (s) {
      state.showSubs = s.show_subcategories !== false;
      return DB.getCategories();
    }).then(function (cats) {
      state.subsList = cats.filter(function (c) {
        return c.parent_id && c.is_active && (c.product_count === undefined || c.product_count > 0);
      });
      /* Only subcategories that contain active products:
         ask the data layer for product presence. */
      return DB.getProducts({ category: 'makeup', limit: 500, noLimit: true });
    }).then(function (res) {
      if (state.showSubs) {
        var used = {};
        res.items.forEach(function (p) { if (p.subSlug) used[p.subSlug] = true; });
        state.subsList = state.subsList.filter(function (s) { return used[s.slug]; });
      } else {
        state.subsList = [];
      }
      buildFilters();
      load(true);
    }).catch(function (err) {
      buildFilters();
      load(true);
    });

    document.getElementById('sort-select').onchange = function () {
      state.sort = this.value; applyFilters();
    };
    document.getElementById('filters-open').onclick = openSheet;
    document.getElementById('filters-open-2').onclick = openSheet;
    document.getElementById('clear-filters-2').onclick = clearAll;
    document.getElementById('load-more').onclick = function () { load(false); };
  }

  UI.boot({ active: 'shop', rerender: function () { render(); } });
  render();
})();
