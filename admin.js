/* ============================================================
   Blush Beauty — admin.js
   Secure admin dashboard on Supabase Auth + RLS.
   - No public registration; accounts are created in Supabase
     and authorized via the admin_users table (server-checked).
   - All writes pass RLS policies that require is_admin().
   - Without Supabase credentials the dashboard opens in a
     clearly-labelled read-only PREVIEW mode using demo data.
   ============================================================ */
(function () {
  'use strict';

  var UI = window.UI, DB = window.DB, I = window.I18N;
  var sb = DB.getClient();
  var app = document.getElementById('admin-app');

  var state = {
    preview: DB.mode === 'demo',
    session: null,
    isAdmin: false,
    section: 'overview'
  };

  /* Shared caches (refetched after mutations) */
  var cache = {
    products: null,
    orders: null,
    customers: null,
    categories: null,
    settings: null,
    homepage: null,
    banners: null,
    shades: null
  };

  /* ============================================================
     Tiny helpers
  ============================================================ */
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return UI.esc(s); }
  function money(n) { return I.fmtMoney(n); }
  function prodName(p) { return I.lang === 'ar' ? (p.name_ar || p.name_en) : (p.name_en || p.name_ar); }
  function catName(c) { return I.lang === 'ar' ? (c.name_ar || c.name_en) : (c.name_en || c.name_ar); }
  function govName(v) { return I.govLabel(v); }

  function pill(text, cls) {
    return '<span class="pill ' + (cls || '') + '">' + esc(text) + '</span>';
  }
  function statusPill(status) {
    var map = {
      pending: 'pill-ink', confirmed: 'pill-info', processing: 'pill-info',
      shipped: 'pill-info', out_for_delivery: 'pill-warn',
      delivered: 'pill-ok', cancelled: 'pill-danger'
    };
    return pill(I.t(I.statusKey(status)), map[status] || '');
  }
  function payPill(ps) {
    var map = { paid: 'pill-ok', unpaid: 'pill-ink', failed: 'pill-danger', refunded: 'pill-warn' };
    return pill(I.t(I.payKey(ps)), map[ps] || '');
  }
  function stockPill(p) {
    if (Number(p.stock) === 0) return pill(I.t('ad_inv_out_alert'), 'pill-danger');
    if (Number(p.stock) <= Number(p.low_stock_threshold || 5)) return pill(I.t('ad_inv_low_alert'), 'pill-warn');
    return pill(String(p.stock), 'pill-ok');
  }

  function isoToLocal(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function localToIso(v) { return v ? new Date(v).toISOString() : null; }

  function thumbHtml(row) {
    /* Real product photo instead of initials: the products query now
       embeds product_images; pick the lowest admin-defined position.
       Object rows come from Supabase, plain URL strings from the demo
       catalog. Neutral initials placeholder only when there is no
       image at all. */
    var url = '';
    if (row.images && row.images.length) {
      var first = row.images.slice().sort(function (a, b) {
        if (typeof a === 'string' || typeof b === 'string') return 0;
        return (Number(a && a.position) || 0) - (Number(b && b.position) || 0);
      })[0];
      url = typeof first === 'string' ? first : ((first && first.url) || '');
    }
    return '<span class="adm-thumb">' + (url
      ? '<img src="' + esc(url) + '" alt="" loading="lazy">'
      : UI.phHtml(prodName(row), UI.seedOf(row))) + '</span>';
  }

  function modal(title, bodyHtml, wide) {
    var back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML =
      '<div class="modal ' + (wide ? 'modal-wide' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="flex-between mb-2"><h3 class="modal-title">' + esc(title) + '</h3>' +
      '<button type="button" class="icon-btn" data-close>' + UI.icon('x', 18) + '</button></div>' +
      '<div class="modal-body">' + bodyHtml + '</div></div>';
    document.body.appendChild(back);
    document.body.classList.add('no-scroll');
    function close() {
      back.remove();
      document.body.classList.remove('no-scroll');
    }
    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('[data-close]')) close();
    });
    return { back: back, body: q('.modal-body', back), close: close };
  }

  function requireBackend() {
    if (state.preview) {
      UI.toast(I.t('ad_demo_readonly'), 'info');
      return false;
    }
    return true;
  }

  function discState(p) {
    if (!p.discount_active || p.discount_price === null || p.discount_price === undefined) return 'disabled';
    var now = Date.now();
    if (p.discount_starts_at && new Date(p.discount_starts_at).getTime() > now) return 'scheduled';
    if (p.discount_ends_at && new Date(p.discount_ends_at).getTime() < now) return 'expired';
    return 'live';
  }

  function emptyRow(cols, text) {
    return '<tr><td class="adm-empty-row" colspan="' + cols + '">' + esc(text || I.t('ad_none')) + '</td></tr>';
  }

  /* ============================================================
     Data adapters (Supabase primary, demo preview fallback)
  ============================================================ */
  function demoJoined() {
    var byId = {};
    DEMO.categories.forEach(function (c) { byId[c.id] = c; });
    return DEMO.products.map(function (p) {
      var copy = Object.assign({}, p);
      copy.cat = byId[p.category_id] || null;
      copy.sub = byId[p.subcategory_id] || null;
      copy.images = p.images || [];
      return copy;
    });
  }

  function loadProducts(force) {
    if (state.preview) {
      return Promise.resolve(demoJoined());
    }
    if (cache.products && !force) return Promise.resolve(cache.products);
    return sb.from('products')
      .select('*, images:product_images(id,product_id,url,alt,position), cat:categories!products_category_id_fkey(id,slug,name_en,name_ar), sub:categories!products_subcategory_id_fkey(id,slug,name_en,name_ar)')
      .order('created_at', { ascending: false })
      .limit(1000)
      .then(function (res) {
        if (res.error) throw res.error;
        cache.products = res.data || [];
        return cache.products;
      });
  }

  function loadOrders(force) {
    if (state.preview) {
      return Promise.resolve(DEMO.loadOrders().slice());
    }
    if (cache.orders && !force) return Promise.resolve(cache.orders);
    return sb.from('orders').select('*').order('created_at', { ascending: false }).limit(1000)
      .then(function (res) {
        if (res.error) throw res.error;
        cache.orders = res.data || [];
        return cache.orders;
      });
  }

  function loadOrderItems(order) {
    if (state.preview) return Promise.resolve(order.items || []);
    return sb.from('order_items').select('*').eq('order_id', order.id).then(function (res) {
      if (res.error) throw res.error;
      return res.data || [];
    });
  }

  function loadCategories(force) {
    if (state.preview) return Promise.resolve(DEMO.categories.slice());
    if (cache.categories && !force) return Promise.resolve(cache.categories);
    return sb.from('categories').select('*').order('display_order').then(function (res) {
      if (res.error) throw res.error;
      cache.categories = res.data || [];
      return cache.categories;
    });
  }

  function loadSettingsAll(force) {
    var tasks = [
      DB.getSettings({ fresh: true }).then(function (s) { cache.settings = s; }),
      DB.getHomepage().then(function (h) { cache.homepage = h; }),
      loadBanners(force)
    ];
    return Promise.all(tasks).then(function () {
      return { settings: cache.settings, homepage: cache.homepage, banners: cache.banners };
    });
  }

  function loadBanners(force) {
    if (state.preview) { cache.banners = DEMO.banners.slice(); return Promise.resolve(cache.banners); }
    if (cache.banners && !force) return Promise.resolve(cache.banners);
    return sb.from('banners').select('*').order('display_order').then(function (res) {
      if (res.error) throw res.error;
      cache.banners = res.data || [];
      return cache.banners;
    });
  }

  function loadCustomers(force) {
    if (state.preview) {
      /* Build customer records from demo orders (as in production). */
      var orders = DEMO.loadOrders();
      var map = {};
      orders.forEach(function (o) {
        if (!map[o.phone]) {
          map[o.phone] = {
            id: 'demo-c-' + o.phone, full_name: o.full_name, phone: o.phone,
            email: o.email || '', governorate: o.governorate, city: o.city,
            address: o.address, is_demo: true, created_at: o.created_at, orders: []
          };
        }
        map[o.phone].orders.push(o);
      });
      var list = Object.keys(map).map(function (k) {
        var c = map[k];
        var live = c.orders.filter(function (o) { return o.status !== 'cancelled'; });
        c.orders_count = c.orders.length;
        c.total_spent = live.reduce(function (s, o) { return s + o.total; }, 0);
        c.first_order_at = c.orders.reduce(function (m, o) { return o.created_at < (m || o.created_at) ? o.created_at : (m || o.created_at); }, null);
        return c;
      });
      return Promise.resolve(list);
    }
    if (cache.customers && !force) return Promise.resolve(cache.customers);
    return Promise.all([
      sb.from('customers').select('*').order('created_at', { ascending: false }).limit(1000),
      loadOrders(force)
    ]).then(function (results) {
      var rows = results[0].data || [];
      var orders = results[1];
      var byCust = {};
      orders.forEach(function (o) {
        if (!o.customer_id) return;
        if (!byCust[o.customer_id]) byCust[o.customer_id] = [];
        byCust[o.customer_id].push(o);
      });
      rows.forEach(function (c) {
        var list = byCust[c.id] || [];
        var live = list.filter(function (o) { return o.status !== 'cancelled'; });
        c.orders_count = list.length;
        c.total_spent = live.reduce(function (s, o) { return s + Number(o.total || 0); }, 0);
        c.first_order_at = list.reduce(function (m, o) {
          return o.created_at < (m || o.created_at) ? o.created_at : (m || o.created_at);
        }, null);
        c._orders = list;
      });
      cache.customers = rows;
      return rows;
    });
  }

  function demoMovements() {
    /* Preview: synthesize movement history from demo orders. */
    var out = [];
    DEMO.loadOrders().forEach(function (o) {
      (o.items || []).forEach(function (it) {
        out.push({
          id: 'mv-' + o.order_number + '-' + it.sku,
          product_id: it.product_id,
          product: { name_en: it.product_name_en, name_ar: it.product_name_ar, sku: it.sku },
          movement_type: o.status === 'cancelled' ? 'order_cancelled' : 'order',
          change: o.status === 'cancelled' ? it.quantity : -it.quantity,
          reference: o.order_number,
          notes: null,
          created_at: o.created_at
        });
      });
    });
    return out;
  }

  function loadMovements() {
    if (state.preview) return Promise.resolve(demoMovements());
    return sb.from('inventory_movements')
      .select('*, product:products(name_en,name_ar,sku)')
      .order('created_at', { ascending: false })
      .limit(60)
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      });
  }

  /* ============================================================
     Auth views
  ============================================================ */
  function renderLogin(prefillError) {
    app.innerHTML =
      '<div class="adm-login-wrap"><div class="adm-login-card">' +
      '<div class="brand"><span class="brand-main">BLUSH</span><span class="brand-sub">BEAUTY</span></div>' +
      '<h1>' + I.t('ad_login_title') + '</h1>' +
      '<p class="sub">' + I.t('ad_login_sub') + '</p>' +
      (prefillError ? '<div class="adm-login-error">' + UI.icon('alert', 16) + '<span>' + esc(prefillError) + '</span></div>' : '<div class="adm-login-error" id="login-error" hidden></div>') +
      '<form id="login-form" novalidate>' +
      '<div class="field"><label for="a-email">' + I.t('ad_email') + '</label>' +
      '<input class="input is-ltr" id="a-email" type="email" autocomplete="email"></div>' +
      '<div class="field"><label for="a-password">' + I.t('ad_password') + '</label>' +
      '<input class="input is-ltr" id="a-password" type="password" autocomplete="current-password"></div>' +
      '<button type="submit" class="btn btn-primary btn-block" id="login-btn">' + I.t('ad_sign_in') + '</button>' +
      '</form>' +
      '<p class="adm-login-note">' + I.t('ad_login_hint') + '</p>' +
      (state.preview ? '<button type="button" class="btn btn-ghost btn-block mt-2" id="login-preview">' + I.t('ad_preview') + '</button>' : '') +
      '</div></div>';

    q('#login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = q('#a-email').value.trim();
      var password = q('#a-password').value;
      var errBox = q('#login-error');
      var btn = q('#login-btn');
      btn.disabled = true;
      btn.textContent = I.t('ad_signing') + '\u2026';
      DB.admin.signIn(email, password).then(function () {
        return DB.admin.amIAdmin();
      }).then(function (ok) {
        if (!ok) {
          return DB.admin.signOut().then(function () {
            errBox.hidden = false;
            errBox.innerHTML = UI.icon('alert', 16) + '<span>' + I.t('ad_not_admin') + '</span>';
            btn.disabled = false;
            btn.textContent = I.t('ad_sign_in');
          });
        }
        window.location.reload();
      }).catch(function (err) {
        errBox.hidden = false;
        errBox.innerHTML = UI.icon('alert', 16) + '<span>' + esc(err.message || I.t('ad_bad_credentials')) + '</span>';
        btn.disabled = false;
        btn.textContent = I.t('ad_sign_in');
      });
    });
    if (state.preview) {
      q('#login-preview').addEventListener('click', function () { buildShell(); route(); });
    }
  }

  function renderNotAdmin() {
    app.innerHTML =
      '<div class="adm-login-wrap"><div class="adm-login-card">' +
      '<div class="adm-login-error">' + UI.icon('alert', 16) + '<span>' + I.t('ad_not_admin') + '</span></div>' +
      '<button type="button" class="btn btn-outline btn-block" id="logout-btn">' + I.t('ad_logout') + '</button>' +
      '</div></div>';
    q('#logout-btn').addEventListener('click', function () {
      DB.admin.signOut().then(function () { window.location.reload(); });
    });
  }

  /* ============================================================
     Shell + routing
  ============================================================ */
  var SECTIONS = [
    { key: 'overview', icon: 'chart', label: 'ad_overview' },
    { key: 'products', icon: 'grid', label: 'ad_products' },
    { key: 'categories', icon: 'layers', label: 'ad_categories' },
    { key: 'discounts', icon: 'tag', label: 'ad_discounts' },
    { key: 'orders', icon: 'box', label: 'ad_orders' },
    { key: 'customers', icon: 'users', label: 'ad_customers' },
    { key: 'inventory', icon: 'truck', label: 'ad_inventory' },
    { key: 'settings', icon: 'sliders', label: 'ad_settings' },
    { key: 'demo', icon: 'alert', label: 'ad_demo' }
  ];

  function buildShell() {
    app.innerHTML =
      (state.preview ? '<div class="adm-preview-banner">' + UI.icon('info', 15) + '<span>' + I.t('ad_preview_banner') + '</span></div>' : '') +
      '<div class="adm-shell">' +
      '<aside class="adm-side" id="adm-side">' +
      '<div class="adm-brand"><span class="brand-main">BLUSH</span><span class="brand-sub">BEAUTY</span><p>' + I.t('ad_login_sub') + '</p></div>' +
      '<nav class="adm-nav" id="adm-nav"></nav>' +
      '<div class="adm-side-foot">' +
      '<a href="index.html" target="_blank" rel="noopener">' + UI.icon('external', 16) + I.t('ad_view_site') + '</a>' +
      '<button type="button" id="adm-logout">' + UI.icon('logout', 16) + I.t('ad_logout') + '</button>' +
      '<div class="adm-lang-row">' +
      '<button type="button" class="adm-lang-btn" data-set-lang="en">EN</button>' +
      '<button type="button" class="adm-lang-btn" data-set-lang="ar">AR</button>' +
      '</div></div>' +
      '</aside>' +
      '<div class="adm-side-backdrop" id="adm-side-backdrop" hidden></div>' +
      '<div class="adm-main">' +
      '<header class="adm-top">' +
      '<button type="button" class="icon-btn adm-menu-btn" id="adm-menu">' + UI.icon('menu', 22) + '</button>' +
      '<h1 id="adm-title"></h1>' +
      '<div class="adm-top-actions"><span class="overline" id="adm-role-badge"></span></div>' +
      '</header>' +
      '<div class="adm-content" id="adm-content"></div>' +
      '</div></div>';

    renderSidebar();
    q('#adm-logout').addEventListener('click', function () {
      if (state.preview) { window.location.reload(); return; }
      DB.admin.signOut().then(function () { window.location.reload(); });
    });
    qa('[data-set-lang]').forEach(function (b) {
      b.addEventListener('click', function () { I.setLang(b.dataset.setLang); });
    });
    q('#adm-menu').addEventListener('click', function () {
      q('#adm-side').classList.add('open');
      q('#adm-side-backdrop').hidden = false;
    });
    q('#adm-side-backdrop').addEventListener('click', closeDrawer);
    qa('#adm-nav a').forEach(function (a) { a.addEventListener('click', closeDrawer); });

    function closeDrawer() {
      q('#adm-side').classList.remove('open');
      q('#adm-side-backdrop').hidden = true;
    }
    updateLangButtons();
    q('#adm-role-badge').textContent = state.preview ? 'PREVIEW' : (state.session && state.session.user ? state.session.user.email : '');
  }

  function renderSidebar() {
    var nav = q('#adm-nav');
    if (!nav) return;
    nav.innerHTML = SECTIONS.map(function (s) {
      return '<a href="#/' + s.key + '" data-key="' + s.key + '" class="' + (state.section === s.key ? 'active' : '') + '">' +
        UI.icon(s.icon, 17) + I.t(s.label) + '</a>';
    }).join('');
    updateLangButtons();
  }

  function updateLangButtons() {
    qa('[data-set-lang]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.setLang === I.lang);
    });
  }

  function route() {
    var key = (window.location.hash || '').replace(/^#\//, '') || 'overview';
    if (!SECTIONS.find(function (s) { return s.key === key; })) key = 'overview';
    state.section = key;
    var meta = SECTIONS.find(function (s) { return s.key === key; });
    var titleEl = q('#adm-title');
    if (titleEl) titleEl.textContent = I.t(meta.label);
    renderSidebar();
    var host = q('#adm-content');
    if (!host) return;
    host.innerHTML = '<div class="skel" style="height:120px"></div>';
    renderSection(key, host);
  }

  function renderSection(key, host) {
    var fns = {
      overview: renderOverview,
      products: renderProducts,
      categories: renderCategories,
      discounts: renderDiscounts,
      orders: renderOrders,
      customers: renderCustomers,
      inventory: renderInventory,
      settings: renderSettings,
      demo: renderDemo
    };
    (fns[key] || renderOverview)(host);
  }

  /* ============================================================
     Overview
  ============================================================ */
  function renderOverview(host) {
    host.innerHTML =
      '<div class="adm-card"><div class="adm-toolbar" style="margin-bottom:0">' +
      '<span class="overline">' + I.t('ad_period') + '</span>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-period="today">' + I.t('ad_period_today') + '</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-period="7">' + I.t('ad_period_7') + '</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-period="30">' + I.t('ad_period_30') + '</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-period="custom">' + I.t('ad_period_custom') + '</button>' +
      '<input class="input" type="date" id="ov-from" aria-label="' + I.t('ad_from') + '">' +
      '<input class="input" type="date" id="ov-to" aria-label="' + I.t('ad_to') + '">' +
      '<button type="button" class="btn btn-sm btn-primary" id="ov-apply">' + I.t('ad_apply') + '</button>' +
      '</div></div>' +
      '<div id="ov-metrics"></div>' +
      '<div class="adm-two-col" id="ov-lists"></div>';

    var period = '30';
    qa('[data-period]').forEach(function (b) {
      b.addEventListener('click', function () {
        period = b.dataset.period;
        qa('[data-period]').forEach(function (x) { x.classList.toggle('btn-primary', x === b); x.classList.toggle('btn-ghost', x !== b); });
        if (period !== 'custom') draw();
      });
    });
    q('#ov-apply').addEventListener('click', draw);
    qa('[data-period]')[2].click(); /* default: last 30 days */

    function rangeOf() {
      var now = new Date();
      var from;
      if (period === 'today') {
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (period === '7') {
        from = new Date(now.getTime() - 7 * 86400000);
      } else if (period === '30') {
        from = new Date(now.getTime() - 30 * 86400000);
      } else {
        var f = q('#ov-from').value ? new Date(q('#ov-from').value + 'T00:00:00') : null;
        var t = q('#ov-to').value ? new Date(q('#ov-to').value + 'T23:59:59') : null;
        return { from: f, to: t };
      }
      return { from: from, to: now };
    }

    function draw() {
      Promise.all([loadProducts(), loadOrders()]).then(function (res) {
        var products = res[0], orders = res[1];
        var r = rangeOf();
        var inRange = orders.filter(function (o) {
          var d = new Date(o.created_at);
          return (!r.from || d >= r.from) && (!r.to || d <= r.to);
        });
        var live = inRange.filter(function (o) { return o.status !== 'cancelled'; });
        var totalSales = live.reduce(function (s, o) { return s + Number(o.total || 0); }, 0);
        var pending = inRange.filter(function (o) { return o.status === 'pending'; }).length;
        var completed = inRange.filter(function (o) { return o.status === 'delivered'; }).length;
        var low = products.filter(function (p) { return p.stock > 0 && p.stock <= (p.low_stock_threshold || 5); }).length;
        var out = products.filter(function (p) { return Number(p.stock) === 0; }).length;

        q('#ov-metrics').innerHTML =
          '<div class="metric-grid" style="margin-bottom:22px">' +
          metric(I.t('ad_m_total_sales'), money(Math.round(totalSales * 100) / 100), I.t('ad_sales_note'), false) +
          metric(I.t('ad_m_total_orders'), String(inRange.length), '', false) +
          metric(I.t('ad_m_pending'), String(pending), '', pending > 0) +
          metric(I.t('ad_m_completed'), String(completed), '', false) +
          '</div>' +
          '<div class="metric-grid">' +
          metric(I.t('ad_m_products'), String(products.length), '', false) +
          metric(I.t('ad_m_low'), String(low), '', low > 0) +
          metric(I.t('ad_m_out'), String(out), '', out > 0) +
          '<div class="metric" style="visibility:hidden"></div>' +
          '</div>';

        var best = products.slice().sort(function (a, b) { return (b.sales_count || 0) - (a.sales_count || 0); }).slice(0, 5);
        var recent = orders.slice(0, 8);
        q('#ov-lists').innerHTML =
          '<div class="adm-card"><h2>' + I.t('ad_best') + '</h2>' +
          (best.length ? best.map(function (p, i) {
            return '<div class="best-row"><span class="rank num">' + (i + 1) + '</span>' +
              '<span class="t-name">' + esc(prodName(p)) + '</span>' +
              '<span class="sold">' + I.t('ad_th_qty') + ': <b class="num">' + (p.sales_count || 0) + '</b> \u00b7 ' + money(p.price) + '</span></div>';
          }).join('') : '<p class="muted">' + I.t('ad_none') + '</p>') +
          '</div>' +
          '<div class="adm-card"><h2>' + I.t('ad_recent') + '</h2>' +
          '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
          '<th>' + I.t('ad_th_order') + '</th><th>' + I.t('ad_th_customer') + '</th><th>' + I.t('ad_th_status') + '</th><th>' + I.t('ad_th_total') + '</th><th></th>' +
          '</tr></thead><tbody>' +
          (recent.length ? recent.map(function (o) {
            return '<tr><td class="t-name num">' + esc(o.order_number) + '</td>' +
              '<td>' + esc(o.full_name) + '<div class="t-sub num">' + esc(o.phone) + '</div></td>' +
              '<td>' + statusPill(o.status) + '</td>' +
              '<td class="num-cell">' + money(o.total) + '</td>' +
              '<td><div class="row-actions"><button type="button" class="icon-sm" data-open-order="' + esc(o.id) + '" aria-label="' + I.t('ad_order_details') + '">' + UI.icon('eye', 15) + '</button></div></td></tr>';
          }).join('') : emptyRow(5)) +
          '</tbody></table></div></div>';

        qa('[data-open-order]').forEach(function (b) {
          b.addEventListener('click', function () {
            var o = orders.find(function (x) { return x.id === b.dataset.openOrder; });
            if (o) openOrderModal(o, function () { draw(); });
          });
        });
      }).catch(function (err) {
        host.innerHTML = '<div class="adm-card adm-danger"><h2>' + I.t('error_generic') + '</h2><p class="muted">' + esc(err.message || '') + '</p></div>';
      });
    }

    function metric(label, value, sub, alert) {
      return '<div class="metric' + (alert ? ' is-alert' : '') + '"><div class="m-label">' + label + '</div>' +
        '<div class="m-value">' + value + '</div>' + (sub ? '<div class="m-sub">' + sub + '</div>' : '') + '</div>';
    }
  }

  /* ============================================================
     Products
  ============================================================ */
  var prodUi = { search: '', cat: 'all', status: 'all', shown: 25 };

  function renderProducts(host) {
    host.innerHTML =
      '<div class="adm-toolbar">' +
      '<input class="input search-input" id="p-search" placeholder="' + I.t('ad_search_products') + '">' +
      '<select class="input" id="p-cat"></select>' +
      '<select class="input" id="p-status">' +
      '<option value="all">' + I.t('ad_all') + '</option>' +
      '<option value="active">' + I.t('ad_f_active') + '</option>' +
      '<option value="inactive">' + I.t('ad_f_inactive') + '</option>' +
      '<option value="low">' + I.t('ad_f_low') + '</option>' +
      '<option value="out">' + I.t('ad_f_out') + '</option>' +
      '</select>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn btn-primary" id="p-add">' + UI.icon('plus', 15) + I.t('ad_add_product') + '</button>' +
      '</div>' +
      '<div id="p-table"></div>';

    q('#p-search').value = prodUi.search;
    q('#p-status').value = prodUi.status;
    q('#p-search').addEventListener('input', function () { prodUi.search = this.value; prodUi.shown = 25; draw(); });
    q('#p-status').addEventListener('change', function () { prodUi.status = this.value; prodUi.shown = 25; draw(); });
    q('#p-cat').addEventListener('change', function () { prodUi.cat = this.value; prodUi.shown = 25; draw(); });
    q('#p-add').addEventListener('click', function () { openProductModal(null, function () { draw(); }); });

    draw();

    function draw() {
      Promise.all([loadProducts(), loadCategories()]).then(function (res) {
        var products = res[0], cats = res[1];
        var sel = q('#p-cat');
        var current = prodUi.cat;
        sel.innerHTML = '<option value="all">' + I.t('ad_all_categories') + '</option>' +
          cats.filter(function (c) { return !c.parent_id; }).map(function (c) {
            return '<option value="' + esc(c.id) + '">' + esc(catName(c)) + '</option>';
          }).join('');
        sel.value = current;
        if (sel.value !== current) { prodUi.cat = 'all'; sel.value = 'all'; }

        var term = prodUi.search.toLowerCase();
        var list = products.filter(function (p) {
          if (term && (p.name_en + ' ' + p.name_ar + ' ' + (p.sku || '')).toLowerCase().indexOf(term) === -1) return false;
          if (prodUi.cat !== 'all' && p.category_id !== prodUi.cat && (p.sub && p.sub.parent_id) !== prodUi.cat) return false;
          if (prodUi.status === 'active' && !p.is_active) return false;
          if (prodUi.status === 'inactive' && p.is_active) return false;
          if (prodUi.status === 'low' && !(p.stock > 0 && p.stock <= (p.low_stock_threshold || 5))) return false;
          if (prodUi.status === 'out' && Number(p.stock) !== 0) return false;
          return true;
        });

        var rows = list.slice(0, prodUi.shown);
        q('#p-table').innerHTML =
          '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
          '<th>' + I.t('ad_th_name') + '</th><th>' + I.t('ad_th_sku') + '</th><th>' + I.t('ad_th_category') + '</th>' +
          '<th>' + I.t('ad_th_price') + '</th><th>' + I.t('ad_th_stock') + '</th><th>' + I.t('ad_th_status') + '</th><th></th>' +
          '</tr></thead><tbody>' +
          (rows.length ? rows.map(function (p) {
            var catLabel = p.sub ? catName(p.sub) : (p.cat ? catName(p.cat) : '');
            var onSale = DB.liveDiscount(p);
            var priceCell = '<b>' + money(onSale ? p.discount_price : p.price) + '</b>' +
              (onSale ? '<div class="t-sub"><s>' + money(p.price) + '</s> \u00b7 ' +
                Math.round((1 - p.discount_price / p.price) * 100) + '%</div>' : '');
            return '<tr>' +
              '<td><div class="adm-cell-flex">' + thumbHtml(p) +
              '<div><div class="t-name">' + esc(prodName(p)) + '</div><div class="t-sub">' + esc(I.lang === 'ar' ? p.name_en : p.name_ar) + '</div></div></div></td>' +
              '<td class="num-cell">' + esc(p.sku) + '</td>' +
              '<td>' + esc(catLabel) + '</td>' +
              '<td class="num-cell">' + priceCell + '</td>' +
              '<td>' + stockPill(p) + '</td>' +
              '<td>' + (p.is_active ? pill(I.t('ad_f_active'), 'pill-ok') : pill(I.t('ad_f_inactive'), '')) +
              (p.is_featured ? ' ' + pill(I.t('ad_is_featured'), 'pill-info') : '') +
              (p.is_bestseller ? ' ' + pill(I.t('ad_is_bestseller'), 'pill-info') : '') + '</td>' +
              '<td><div class="row-actions">' +
              '<button type="button" class="icon-sm" data-edit="' + esc(p.id) + '" aria-label="' + I.t('ad_edit') + '">' + UI.icon('edit', 15) + '</button>' +
              '<button type="button" class="icon-sm" data-del="' + esc(p.id) + '" aria-label="' + I.t('ad_delete') + '">' + UI.icon('trash', 15) + '</button>' +
              '</div></td></tr>';
          }).join('') : emptyRow(7)) +
          '</tbody></table></div>' +
          (list.length > prodUi.shown ? '<div class="adm-load-more"><button type="button" class="btn btn-ghost btn-sm" id="p-more">' + I.t('ad_load_more') + '</button></div>' : '');

        var more = q('#p-more');
        if (more) more.addEventListener('click', function () { prodUi.shown += 25; draw(); });
        qa('[data-edit]').forEach(function (b) {
          b.addEventListener('click', function () {
            var p = products.find(function (x) { return x.id === b.dataset.edit; });
            openProductModal(p, function () { draw(); });
          });
        });
        qa('[data-del]').forEach(function (b) {
          b.addEventListener('click', function () {
            var p = products.find(function (x) { return x.id === b.dataset.del; });
            if (!p) return;
            UI.confirm({
              title: I.t('ad_delete'),
              text: I.t('ad_confirm_delete', { name: prodName(p) }),
              okLabel: I.t('ad_delete'),
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
              sb.from('products').delete().eq('id', p.id).then(function (res) {
                if (res.error) throw res.error;
                cache.products = null;
                UI.toast(I.t('ad_deleted'), 'ok');
                draw();
              }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
            });
          });
        });
      }).catch(function (err) {
        q('#p-table').innerHTML = '<div class="adm-card adm-danger"><p>' + esc(err.message || I.t('error_generic')) + '</p></div>';
      });
    }
  }

  /* ============================================================
     Product shades (admin)
     Each shade: independent stock + independent image gallery.
     Working objects: {id|null, shade_number, shade_name_en,
     shade_name_ar, stock_quantity, is_active, display_order,
     images:[rows], staged:[files]} — edits persist with the
     product "Save" button; image delete/replace/reorder apply
     immediately (same pattern as product images).
  ============================================================ */
  function mapShadeRow(row) {
    return {
      id: row.id || null,
      product_id: row.product_id || null,
      shade_number: Number(row.shade_number) || 1,
      shade_name_en: row.shade_name_en || '',
      shade_name_ar: row.shade_name_ar || '',
      stock_quantity: Number(row.stock_quantity) || 0,
      low_stock_threshold: Number(row.low_stock_threshold) || 5,
      is_active: row.is_active !== false,
      display_order: Number(row.display_order) || 0,
      images: (row.images || []).slice().sort(function (a, b) {
        return (Number(a.position) || 0) - (Number(b.position) || 0);
      }),
      staged: [],
      _removed: false
    };
  }

  function loadShadesFor(productId) {
    if (state.preview) return Promise.resolve(DEMO.findShades(productId).map(mapShadeRow));
    return sb.from('product_shades')
      .select('*, images:product_shade_images(*)')
      .eq('product_id', productId)
      .order('display_order').order('shade_number')
      .then(function (res) {
        if (res.error) throw res.error;
        return (res.data || []).map(mapShadeRow);
      });
  }

  /* Light shade list for the inventory table (no images). */
  function loadAllShades(force) {
    if (state.preview) {
      return Promise.resolve(DEMO.shades.map(function (s) {
        return { id: s.id, product_id: s.product_id, shade_number: s.shade_number,
          shade_name_en: s.shade_name_en, shade_name_ar: s.shade_name_ar,
          stock_quantity: s.stock_quantity, is_active: s.is_active, display_order: s.display_order };
      }));
    }
    if (cache.shades && !force) return Promise.resolve(cache.shades);
    return sb.from('product_shades')
      .select('id,product_id,shade_number,shade_name_en,shade_name_ar,stock_quantity,is_active,display_order')
      .limit(2000)
      .then(function (res) {
        if (res.error) throw res.error;
        cache.shades = res.data || [];
        return cache.shades;
      });
  }

  function shadeStoragePath(url) {
    /* derive the storage object path from a public URL (best effort) */
    try {
      var m = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(url);
      return m ? { bucket: m[1], path: m[2] } : null;
    } catch (e) { return null; }
  }

  function removeShadeImageFile(url) {
    if (state.preview) return Promise.resolve();
    try {
      var m = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(url);
      if (!m) return Promise.resolve();
      return sb.storage.from(m[1]).remove([m[2]]);
    } catch (e) { return Promise.resolve(); }
  }

  function openProductModal(row, onDone) {
    var isNew = !row;
    var p = row || {
      sku: '', name_en: '', name_ar: '', description_en: '', description_ar: '',
      category_id: '', subcategory_id: null, price: '', discount_price: null,
      discount_active: false, discount_starts_at: null, discount_ends_at: null,
      stock: 0, low_stock_threshold: 5, is_active: true, is_featured: false, is_bestseller: false,
      images: []
    };

    Promise.all([
      loadCategories(),
      isNew || state.preview ? Promise.resolve([]) :
        sb.from('product_images').select('*').eq('product_id', p.id).order('position'),
      isNew ? Promise.resolve([]) : loadShadesFor(p.id)
    ]).then(function (res) {
      var cats = res[0];
      var images = (res[1] && res[1].data) ? res[1].data : (res[1] || []);
      var shades = res[2] || []; /* working shade objects (see mapShadeRow) */
      var deletedShadeIds = []; /* shades removed in the UI, deleted on save */
      var staged = []; /* [{file}] */
      var mainCats = cats.filter(function (c) { return !c.parent_id; });
      var subs = cats.filter(function (c) { return c.parent_id === (p.category_id || '__none__'); });

      var m = modal(isNew ? I.t('ad_add_product') : I.t('ad_edit_product'),
        '<div class="adm-section-title">' + I.t('ad_name_en') + ' / ' + I.t('ad_name_ar') + '</div>' +
        '<div class="adm-form-grid g2">' +
        '<div class="field"><label>' + I.t('ad_name_en') + '</label><input class="input" id="f-name-en" value="' + esc(p.name_en) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_name_ar') + '</label><input class="input" id="f-name-ar" value="' + esc(p.name_ar) + '" dir="rtl"></div>' +
        '</div>' +
        '<div class="field"><label>' + I.t('ad_desc_en') + '</label><textarea class="input" id="f-desc-en">' + esc(p.description_en) + '</textarea></div>' +
        '<div class="field"><label>' + I.t('ad_desc_ar') + '</label><textarea class="input" id="f-desc-ar" dir="rtl">' + esc(p.description_ar) + '</textarea></div>' +

        '<div class="adm-section-title">' + I.t('ad_sku') + ' / ' + I.t('ad_category') + '</div>' +
        '<div class="adm-form-grid g3">' +
        '<div class="field"><label>' + I.t('ad_sku') + '</label><input class="input is-ltr" id="f-sku" value="' + esc(p.sku) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_category') + '</label><select class="input" id="f-cat">' +
        mainCats.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === p.category_id ? ' selected' : '') + '>' + esc(catName(c)) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>' + I.t('ad_subcategory') + '</label><select class="input" id="f-sub"></select></div>' +
        '</div>' +

        '<div class="adm-section-title">' + I.t('ad_price') + '</div>' +
        '<div class="adm-form-grid g3">' +
        '<div class="field"><label>' + I.t('ad_price') + '</label><input class="input is-ltr" id="f-price" inputmode="decimal" value="' + esc(p.price) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_stock') + '</label><input class="input is-ltr" id="f-stock" inputmode="numeric" value="' + esc(p.stock) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_low_threshold') + '</label><input class="input is-ltr" id="f-threshold" inputmode="numeric" value="' + esc(p.low_stock_threshold) + '"></div>' +
        '</div>' +

        '<div class="field checkbox-row"><input type="checkbox" id="f-disc"' + (p.discount_active ? ' checked' : '') + '> <label for="f-disc" style="margin:0">' + I.t('ad_discount_on') + '</label></div>' +
        '<div id="disc-fields" class="adm-form-grid g3" style="' + (p.discount_active ? '' : 'display:none') + '">' +
        '<div class="field"><label>' + I.t('ad_discount_price') + '</label><input class="input is-ltr" id="f-disc-price" inputmode="decimal" value="' + esc(p.discount_price === null ? '' : p.discount_price) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_discount_start') + '</label><input class="input is-ltr" type="datetime-local" id="f-disc-start" value="' + esc(isoToLocal(p.discount_starts_at)) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_discount_end') + '</label><input class="input is-ltr" type="datetime-local" id="f-disc-end" value="' + esc(isoToLocal(p.discount_ends_at)) + '"></div>' +
        '</div>' +

        '<div class="adm-section-title">' + I.t('ad_is_active') + '</div>' +
        '<label class="checkbox-row"><input type="checkbox" id="f-active"' + (p.is_active ? ' checked' : '') + '> <span>' + I.t('ad_is_active') + '</span></label>' +
        '<label class="checkbox-row"><input type="checkbox" id="f-featured"' + (p.is_featured ? ' checked' : '') + '> <span>' + I.t('ad_is_featured') + '</span></label>' +
        '<label class="checkbox-row"><input type="checkbox" id="f-best"' + (p.is_bestseller ? ' checked' : '') + '> <span>' + I.t('ad_is_bestseller') + '</span></label>' +

        '<div class="adm-section-title">' + I.t('ad_images') + '</div>' +
        '<p class="hint">' + I.t('ad_img_hint') + '</p>' +
        '<div class="upload-drop mt-1" id="img-drop">' + UI.icon('upload', 20) + '<span>' + I.t('ad_img_upload') + '</span>' +
        '<input type="file" id="img-input" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden></div>' +
        '<div class="img-manager" id="img-list"></div>' +

        '<div class="adm-section-title">' + I.t('ad_shades') + '</div>' +
        '<p class="hint">' + I.t('ad_shades_hint') + '</p>' +
        '<div id="shade-list" class="mt-1"></div>' +
        '<button type="button" class="btn btn-ghost btn-sm mt-1" id="shade-add">' + UI.icon('plus', 14) + I.t('ad_add_shade') + '</button>' +
        '<div class="adm-modal-footer">' +
        '<button type="button" class="btn btn-ghost" data-close-x>' + I.t('ad_cancel') + '</button>' +
        '<button type="button" class="btn btn-primary" id="p-save">' + I.t('ad_save') + '</button>' +
        '</div>', true);

      fillSubs(q('#f-cat').value);
      drawImages();

      q('#f-cat', m.body).addEventListener('change', function () {
        fillSubs(this.value);
      });
      q('#f-disc', m.body).addEventListener('change', function () {
        q('#disc-fields', m.body).style.display = this.checked ? '' : 'none';
      });
      var drop = q('#img-drop', m.body);
      var input = q('#img-input', m.body);
      drop.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        Array.prototype.slice.call(input.files).forEach(function (f) { staged.push(f); });
        input.value = '';
        drawImages();
      });
      m.back.querySelector('[data-close-x]').addEventListener('click', m.close);
      q('#p-save', m.body).addEventListener('click', save);

      function fillSubs(catId) {
        var list = cats.filter(function (c) { return c.parent_id === catId; });
        q('#f-sub', m.body).innerHTML = '<option value="">' + I.t('ad_sub_none') + '</option>' +
          list.map(function (c) {
            return '<option value="' + esc(c.id) + '"' + (c.id === p.subcategory_id ? ' selected' : '') + '>' + esc(catName(c)) + '</option>';
          }).join('');
      }

      function drawImages() {
        var hostList = q('#img-list', m.body);
        var tiles = images.map(function (im, idx) {
          return '<div class="img-tile" data-url="' + esc(im.url) + '">' +
            '<div class="box"><img src="' + esc(im.url) + '" alt=""></div>' +
            (idx === 0 ? '<span class="main-flag">' + I.t('ad_img_main_badge') + '</span>' : '') +
            '<div class="tile-actions">' +
            (idx !== 0 ? '<button type="button" data-make-main="' + idx + '">' + I.t('ad_img_make_main') + '</button>' : '<button type="button" data-del-img="' + idx + '">' + I.t('ad_img_delete') + '</button>') +
            '</div></div>';
        });
        tiles = tiles.concat(staged.map(function (f, idx) {
          return '<div class="img-tile"><div class="box"><img src="' + URL.createObjectURL(f) + '" alt=""></div>' +
            '<span class="main-flag" style="background:var(--accent-strong)">' + I.t('ad_img_upload') + '</span>' +
            '<div class="tile-actions"><button type="button" data-del-staged="' + idx + '">' + I.t('ad_img_delete') + '</button></div></div>';
        }));
        hostList.innerHTML = tiles.join('');
        qa('[data-del-staged]', hostList).forEach(function (b) {
          b.addEventListener('click', function () { staged.splice(Number(b.dataset.delStaged), 1); drawImages(); });
        });
        qa('[data-del-img]', hostList).forEach(function (b) {
          b.addEventListener('click', function () {
            if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
            var idx = Number(b.dataset.delImg);
            var im = images[idx];
            DB.admin.deleteImage(im.url).then(function () {
              return sb.from('product_images').delete().eq('id', im.id);
            }).then(function (res) {
              if (res.error) throw res.error;
              images.splice(idx, 1);
              /* normalize order */
              return Promise.all(images.map(function (x, i) {
                return sb.from('product_images').update({ position: i }).eq('id', x.id);
              }));
            }).then(function () { drawImages(); UI.toast(I.t('ad_deleted'), 'ok'); })
              .catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
          });
        });
        qa('[data-make-main]', hostList).forEach(function (b) {
          b.addEventListener('click', function () {
            if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
            var idx = Number(b.dataset.makeMain);
            var target = images[idx];
            var first = images[0];
            Promise.all([
              sb.from('product_images').update({ position: idx }).eq('id', first.id),
              sb.from('product_images').update({ position: 0 }).eq('id', target.id)
            ]).then(function (r1) {
              if (r1[0].error) throw r1[0].error;
              if (r1[1].error) throw r1[1].error;
              images[idx] = first; images[0] = target;
              drawImages();
            }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
          });
        });
      }

      /* ---------- shades UI ---------- */
      var shadeHost = q('#shade-list', m.body);
      var filePicker = document.createElement('input');
      filePicker.type = 'file';
      filePicker.accept = 'image/jpeg,image/png,image/webp,image/avif';
      filePicker.hidden = true;
      m.body.appendChild(filePicker);
      var pickTarget = null; /* {type: 'upload'|'replace', shadeIdx, imgIdx} */
      filePicker.addEventListener('change', function () {
        var files = Array.prototype.slice.call(filePicker.files);
        filePicker.value = '';
        if (!files.length || !pickTarget) return;
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); pickTarget = null; return; }
        if (pickTarget.type === 'upload') {
          shades[pickTarget.shadeIdx].staged = shades[pickTarget.shadeIdx].staged.concat(files);
          drawShades();
        } else if (pickTarget.type === 'replace') {
          replaceShadeImage(pickTarget.shadeIdx, pickTarget.imgIdx, files[0]);
        }
        pickTarget = null;
      });

      function drawShades() {
        if (!shades.length) {
          shadeHost.innerHTML = '<p class="hint">' + I.t('ad_shade_none') + '</p>';
          return;
        }
        shadeHost.innerHTML = shades.map(function (sh, sIdx) {
          var tiles = sh.images.map(function (im, iIdx) {
            return '<div class="img-tile" data-url="' + esc(im.url) + '">' +
              '<div class="box"><img src="' + esc(im.url) + '" alt=""></div>' +
              (iIdx === 0 ? '<span class="main-flag">' + I.t('ad_img_main_badge') + '</span>' : '') +
              '<div class="tile-actions">' +
              (iIdx > 0 ? '<button type="button" data-s-imgleft="' + sIdx + ':' + iIdx + '">' + UI.icon('chevLeft', 12) + I.t('ad_img_move') + '</button>' : '') +
              (iIdx < sh.images.length - 1 ? '<button type="button" data-s-imgright="' + sIdx + ':' + iIdx + '">' + I.t('ad_img_move') + UI.icon('chevRight', 12) + '</button>' : '') +
              '<button type="button" data-s-replace="' + sIdx + ':' + iIdx + '">' + I.t('ad_img_replace') + '</button>' +
              '<button type="button" data-s-delimg="' + sIdx + ':' + iIdx + '">' + I.t('ad_img_delete') + '</button>' +
              '</div></div>';
          });
          tiles = tiles.concat(sh.staged.map(function (f, stIdx) {
            return '<div class="img-tile"><div class="box"><img src="' + URL.createObjectURL(f) + '" alt=""></div>' +
              '<span class="main-flag" style="background:var(--pink-deep)">' + I.t('ad_img_upload') + '</span>' +
              '<div class="tile-actions"><button type="button" data-s-delstaged="' + sIdx + ':' + stIdx + '">' + I.t('ad_img_delete') + '</button></div></div>';
          }));
          var dis = state.preview ? ' disabled' : '';
          return '<div class="adm-shade-card">' +
            '<div class="adm-shade-head">' +
            '<span class="adm-shade-badge num">' + esc(I.t('shade_label')) + ' ' + (sIdx + 1) + '</span>' +
            '<span class="spacer"></span>' +
            '<button type="button" class="icon-sm" data-s-up="' + sIdx + '" aria-label="' + esc(I.t('ad_img_move')) + '"' + (sIdx === 0 || state.preview ? ' disabled' : '') + '>' + UI.icon('chevUp', 14) + '</button>' +
            '<button type="button" class="icon-sm" data-s-down="' + sIdx + '" aria-label="' + esc(I.t('ad_img_move')) + '"' + (sIdx === shades.length - 1 || state.preview ? ' disabled' : '') + '>' + UI.icon('chevDown', 14) + '</button>' +
            '<button type="button" class="icon-sm" data-s-del="' + sIdx + '" aria-label="' + esc(I.t('ad_delete')) + '">' + UI.icon('trash', 15) + '</button>' +
            '</div>' +
            '<div class="adm-form-grid g4">' +
            '<div class="field"><label>' + I.t('ad_shade_number') + '</label><input class="input is-ltr" data-s-field="shade_number" data-s-idx="' + sIdx + '" inputmode="numeric" value="' + esc(sh.shade_number) + '"' + dis + '></div>' +
            '<div class="field"><label>' + I.t('ad_shade_stock') + '</label><input class="input is-ltr" data-s-field="stock_quantity" data-s-idx="' + sIdx + '" inputmode="numeric" value="' + esc(sh.stock_quantity) + '"' + dis + '></div>' +
            '<div class="field"><label>' + I.t('ad_shade_name_en') + '</label><input class="input" data-s-field="shade_name_en" data-s-idx="' + sIdx + '" value="' + esc(sh.shade_name_en) + '"' + dis + '></div>' +
            '<div class="field"><label>' + I.t('ad_shade_name_ar') + '</label><input class="input" dir="rtl" data-s-field="shade_name_ar" data-s-idx="' + sIdx + '" value="' + esc(sh.shade_name_ar) + '"' + dis + '></div>' +
            '</div>' +
            '<label class="checkbox-row"><input type="checkbox" data-s-field="is_active" data-s-idx="' + sIdx + '"' + (sh.is_active ? ' checked' : '') + dis + '> <span>' + I.t('ad_shade_active') + '</span></label>' +
            '<p class="hint mt-1">' + esc(I.t('ad_shade_images')) + ' \u00b7 ' + esc(I.t('ad_shade_images_hint')) + '</p>' +
            '<div class="upload-drop" data-s-upload="' + sIdx + '"' + dis + '>' + UI.icon('upload', 18) + '<span>' + I.t('ad_img_upload') + '</span></div>' +
            (tiles.length ? '<div class="img-manager">' + tiles.join('') + '</div>' : '') +
            '</div>';
        }).join('');
      }

      function parseIdx(v) {
        var parts = String(v).split(':');
        return [Number(parts[0]), Number(parts[1])];
      }

      shadeHost.addEventListener('click', function (e) {
        var up = e.target.closest('[data-s-up]');
        var down = e.target.closest('[data-s-down]');
        var del = e.target.closest('[data-s-del]');
        var delStaged = e.target.closest('[data-s-delstaged]');
        var delImg = e.target.closest('[data-s-delimg]');
        var imgLeft = e.target.closest('[data-s-imgleft]');
        var imgRight = e.target.closest('[data-s-imgright]');
        var replaceBtn = e.target.closest('[data-s-replace]');
        var uploadDrop = e.target.closest('[data-s-upload]');
        if (up) {
          moveShade(Number(up.dataset.sUp), -1);
        } else if (down) {
          moveShade(Number(down.dataset.sDown), 1);
        } else if (del) {
          deleteShade(Number(del.dataset.sDel));
        } else if (uploadDrop) {
          if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
          pickTarget = { type: 'upload', shadeIdx: Number(uploadDrop.dataset.sUpload) };
          filePicker.multiple = true;
          filePicker.click();
        } else if (replaceBtn) {
          if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
          var pr = parseIdx(replaceBtn.dataset.sReplace);
          pickTarget = { type: 'replace', shadeIdx: pr[0], imgIdx: pr[1] };
          filePicker.multiple = false;
          filePicker.click();
        } else if (delStaged) {
          var ds = parseIdx(delStaged.dataset.sDelstaged);
          shades[ds[0]].staged.splice(ds[1], 1);
          drawShades();
        } else if (delImg) {
          var di = parseIdx(delImg.dataset.sDelimg);
          deleteShadeImage(di[0], di[1]);
        } else if (imgLeft || imgRight) {
          var mv = parseIdx((imgLeft || imgRight).dataset[imgLeft ? 'sImgleft' : 'sImgright']);
          moveShadeImage(mv[0], mv[1], imgLeft ? -1 : 1);
        }
      });

      shadeHost.addEventListener('change', function (e) {
        var fieldEl = e.target.closest('[data-s-field]');
        if (!fieldEl || state.preview) return;
        var sh = shades[Number(fieldEl.dataset.sIdx)];
        if (!sh) return;
        var f = fieldEl.dataset.sField;
        if (f === 'is_active') sh.is_active = fieldEl.checked;
        else if (f === 'shade_number') sh.shade_number = parseInt(fieldEl.value, 10) || 1;
        else if (f === 'stock_quantity') sh.stock_quantity = Math.max(0, parseInt(fieldEl.value, 10) || 0);
        else sh[f] = fieldEl.value;
      });

      q('#shade-add', m.body).addEventListener('click', function () {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var nextNum = shades.reduce(function (m2, s) { return Math.max(m2, s.shade_number); }, 0) + 1;
        shades.push(mapShadeRow({ shade_number: nextNum, is_active: true, stock_quantity: 0, images: [] }));
        drawShades();
      });

      drawShades();

      function moveShade(idx, dir) {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var j = idx + dir;
        if (j < 0 || j >= shades.length) return;
        var tmp = shades[idx]; shades[idx] = shades[j]; shades[j] = tmp;
        drawShades();
      }

      function deleteShade(idx) {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var sh = shades[idx];
        UI.confirm({
          title: I.t('ad_delete'),
          text: I.t('ad_shade_delete_confirm'),
          okLabel: I.t('ad_delete'),
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          /* best-effort cleanup of the shade's stored image files */
          Promise.all(sh.images.map(function (im) { return removeShadeImageFile(im.url); }))
            .catch(function () { /* non-fatal */ });
          if (sh.id) deletedShadeIds.push(sh.id);
          shades.splice(idx, 1);
          drawShades();
        });
      }

      function deleteShadeImage(sIdx, iIdx) {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var sh = shades[sIdx];
        var im = sh.images[iIdx];
        if (!im) return;
        removeShadeImageFile(im.url).then(function () {
          return sb.from('product_shade_images').delete().eq('id', im.id);
        }).then(function (res) {
          if (res.error) throw res.error;
          sh.images.splice(iIdx, 1);
          return Promise.all(sh.images.map(function (x, i) {
            return sb.from('product_shade_images').update({ position: i }).eq('id', x.id);
          }));
        }).then(function () {
          drawShades();
          UI.toast(I.t('ad_deleted'), 'ok');
        }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
      }

      function moveShadeImage(sIdx, iIdx, dir) {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var sh = shades[sIdx];
        var j = iIdx + dir;
        if (j < 0 || j >= sh.images.length) return;
        var a = sh.images[iIdx], b = sh.images[j];
        Promise.all([
          sb.from('product_shade_images').update({ position: j }).eq('id', a.id),
          sb.from('product_shade_images').update({ position: iIdx }).eq('id', b.id)
        ]).then(function (r1) {
          if (r1[0].error) throw r1[0].error;
          if (r1[1].error) throw r1[1].error;
          sh.images[iIdx] = b; sh.images[j] = a;
          drawShades();
        }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
      }

      function replaceShadeImage(sIdx, iIdx, file) {
        var sh = shades[sIdx];
        var im = sh.images[iIdx];
        if (!im || !sh.id || !p.id) return;
        var folder = 'products/' + p.id + '/shades/' + sh.id;
        DB.admin.uploadImage('products', folder, file).then(function (url) {
          if (!url) throw new Error(I.t('error_generic'));
          return sb.from('product_shade_images').update({ url: url, alt: im.alt || '' }).eq('id', im.id)
            .then(function (res) {
              if (res.error) throw res.error;
              return removeShadeImageFile(im.url);
            })
            .then(function () { return url; });
        }).then(function (url) {
          im.url = url;
          drawShades();
          UI.toast(I.t('ad_saved'), 'ok');
        }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
      }

      /* Persists the shade working objects after the product row is saved. */
      function saveShades(productId) {
        if (state.preview) return Promise.resolve();
        if (!shades.length && !deletedShadeIds.length) return Promise.resolve();
        var delTask = deletedShadeIds.length
          ? sb.from('product_shades').delete().in('id', deletedShadeIds)
          : Promise.resolve({ error: null });
        return delTask.then(function (r0) {
          if (r0.error) throw r0.error;
          /* insert/update in display order */
          return shades.reduce(function (chain, sh, idx) {
            return chain.then(function () {
              var payload = {
                shade_number: sh.shade_number,
                shade_name_en: sh.shade_name_en.trim(),
                /* English fallback when the Arabic shade name is empty */
                shade_name_ar: sh.shade_name_ar.trim() || sh.shade_name_en.trim(),
                stock_quantity: sh.stock_quantity,
                is_active: sh.is_active,
                display_order: idx
              };
              if (sh.id) {
                return sb.from('product_shades').update(payload).eq('id', sh.id)
                  .then(function (r) { if (r.error) throw r.error; });
              }
              return sb.from('product_shades').insert(Object.assign({ product_id: productId }, payload)).select().single()
                .then(function (r) {
                  if (r.error) throw r.error;
                  sh.id = r.data.id;
                  sh.product_id = productId;
                });
            });
          }, Promise.resolve());
        }).then(function () {
          /* upload staged files into each shade's own gallery */
          return shades.reduce(function (chain, sh) {
            return chain.then(function () {
              if (!sh.staged.length) return Promise.resolve();
              var folder = 'products/' + productId + '/shades/' + sh.id;
              return sh.staged.reduce(function (inner, file, i) {
                return inner.then(function () {
                  return DB.admin.uploadImage('products', folder, file).then(function (url) {
                    if (!url) return;
                    return sb.from('product_shade_images').insert({
                      shade_id: sh.id, url: url,
                      alt: sh.shade_name_en || '', position: sh.images.length + i
                    }).select('id').single().then(function (r2) {
                      if (r2.error) throw r2.error;
                      /* .select() is REQUIRED: without it Supabase returns
                         data:null even on success, and reading r2.data.id
                         threw "Cannot read properties of null (reading
                         'id')" — after the product row was already saved. */
                      if (!r2.data || !r2.data.id) throw new Error('shade image row not returned');
                      sh.images.push({ id: r2.data.id, shade_id: sh.id, url: url, position: sh.images.length });
                    });
                  });
                });
              }, Promise.resolve());
            });
          }, Promise.resolve());
        });
      }

      function validate() {
        var errs = [];
        /* Arabic fields are OPTIONAL: an empty Arabic name falls back to
           the English name at save time (products.name_ar is NOT NULL in
           the database, and the storefront already prefers the Arabic
           value and falls back to English when displaying). */
        if (!q('#f-name-en', m.body).value.trim()) errs.push(I.t('ad_err_names'));
        if (!q('#f-sku', m.body).value.trim()) errs.push(I.t('ad_err_sku'));
        var price = parseFloat(q('#f-price', m.body).value);
        if (isNaN(price) || price < 0) errs.push(I.t('ad_err_price'));
        var discOn = q('#f-disc', m.body).checked;
        if (discOn) {
          var dp = parseFloat(q('#f-disc-price', m.body).value);
          if (isNaN(dp) || dp < 0 || dp >= price) errs.push(I.t('ad_err_disc'));
        }
        var stock = parseInt(q('#f-stock', m.body).value, 10);
        if (isNaN(stock) || stock < 0) errs.push(I.t('ad_err_stock'));
        if (!q('#f-cat', m.body).value) errs.push(I.t('ad_err_category'));
        /* shades: unique positive numbers, stock >= 0 */
        var seenNums = {};
        shades.forEach(function (sh) {
          if (!sh.shade_number || sh.shade_number < 1 || seenNums[sh.shade_number]) {
            if (errs.indexOf(I.t('ad_err_shade_number')) === -1) errs.push(I.t('ad_err_shade_number'));
          }
          seenNums[sh.shade_number] = true;
          if (isNaN(sh.stock_quantity) || sh.stock_quantity === null || sh.stock_quantity < 0) {
            if (errs.indexOf(I.t('ad_err_shade_stock')) === -1) errs.push(I.t('ad_err_shade_stock'));
          }
        });
        return errs;
      }

      function save() {
        var errs = validate();
        if (errs.length) { UI.toast(errs[0], 'error'); return; }
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }

        var btn = q('#p-save', m.body);
        btn.disabled = true;
        btn.textContent = I.t('ad_saving') + '\u2026';

        var payload = {
          sku: q('#f-sku', m.body).value.trim(),
          name_en: q('#f-name-en', m.body).value.trim(),
          /* English fallback when the Arabic name is left empty */
          name_ar: q('#f-name-ar', m.body).value.trim() || q('#f-name-en', m.body).value.trim(),
          description_en: q('#f-desc-en', m.body).value.trim(),
          description_ar: q('#f-desc-ar', m.body).value.trim(),
          category_id: q('#f-cat', m.body).value,
          subcategory_id: q('#f-sub', m.body).value || null,
          price: parseFloat(q('#f-price', m.body).value),
          discount_active: q('#f-disc', m.body).checked,
          discount_price: q('#f-disc', m.body).checked ? parseFloat(q('#f-disc-price', m.body).value) : null,
          discount_starts_at: q('#f-disc', m.body).checked ? localToIso(q('#f-disc-start', m.body).value) : null,
          discount_ends_at: q('#f-disc', m.body).checked ? localToIso(q('#f-disc-end', m.body).value) : null,
          stock: parseInt(q('#f-stock', m.body).value, 10),
          low_stock_threshold: parseInt(q('#f-threshold', m.body).value, 10) || 0,
          is_active: q('#f-active', m.body).checked,
          is_featured: q('#f-featured', m.body).checked,
          is_bestseller: q('#f-best', m.body).checked
        };

        /* Set once the product row itself is in the database. Every
           later Save UPDATES that row — a retry after a failed image or
           shade step can never create a duplicate product. */
        var savedProductId = null;

        var saveRow = (isNew && !savedProductId)
          ? sb.from('products').insert(payload).select().single()
          : sb.from('products').update(payload).eq('id', savedProductId || p.id).select().single();

        saveRow.then(function (res) {
          if (res.error) throw res.error;
          /* .single() returns the row object; normalise defensively so a
             non-standard response shape can never read .id off an array */
          var saved = Array.isArray(res.data) ? res.data[0] : res.data;
          /* never trust the response shape: the row must come back with
             an id before images/shades are attached to it */
          if (!saved || !saved.id) throw new Error(I.t('ad_err_row_missing'));
          savedProductId = saved.id;
          /* upload staged images then link them */
          var folder = 'products/' + (saved.sku || 'misc').toLowerCase().replace(/[^a-z0-9-_]/g, '-');
          return staged.reduce(function (chain, file, i) {
            return chain.then(function () {
              return DB.admin.uploadImage('products', folder, file).then(function (url) {
                if (!url) return;
                return sb.from('product_images').insert({
                  product_id: saved.id, url: url, alt: saved.name_en,
                  position: images.length + i
                }).then(function (r2) { if (r2.error) throw r2.error; });
              });
            });
          }, Promise.resolve()).then(function () {
            /* persist the shade definitions (inserts, updates, deletions,
               staged shade-image uploads) */
            return saveShades(saved.id);
          }).then(function () {
            cache.products = null;
            cache.shades = null;
            UI.toast(I.t('ad_saved'), 'ok');
            m.close();
            onDone && onDone();
          });
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = I.t('ad_save');
          var msg = err && err.message ? err.message : I.t('error_generic');
          if (msg.indexOf('duplicate key') !== -1) msg = I.t('ad_err_sku') + ' (SKU must be unique)';
          /* Partial save: the product row exists but a follow-up step
             (images / shades) failed. Report the ACTUAL failure and make
             the next Save update the same row instead of duplicating. */
          if (savedProductId) {
            msg = I.t('ad_saved_partial', { msg: msg });
            isNew = false;
            p = { id: savedProductId, sku: payload.sku };
          }
          UI.toast(msg, 'error');
        });
      }
    }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
  }

  /* ============================================================
     Categories
  ============================================================ */
  function renderCategories(host) {
    Promise.all([loadCategories(), loadProducts(), loadSettingsAll()]).then(function (res) {
      var cats = res[0], products = res[1], settings = res[2].settings;
      var mains = cats.filter(function (c) { return !c.parent_id; });
      var subs = cats.filter(function (c) { return c.parent_id; });
      var countFor = function (catId) {
        return products.filter(function (p) { return p.category_id === catId || (p.sub && p.sub.parent_id === catId); }).length;
      };
      var countSub = function (subId) {
        return products.filter(function (p) { return p.subcategory_id === subId; }).length;
      };

      host.innerHTML =
        '<div class="adm-card"><h2>' + I.t('ad_set_store') + '</h2>' +
        '<div class="switch-row"><span>' + I.t('ad_show_subs') + '</span>' +
        '<button type="button" class="switch' + (settings.show_subcategories ? ' on' : '') + '" id="subs-switch" aria-label="' + I.t('ad_show_subs') + '"></button>' +
        '</div><p class="hint mt-1">' + I.t('ad_cat_hint') + '</p></div>' +

        '<div class="adm-card"><div class="flex-between mb-2"><h2 style="margin:0">' + I.t('ad_cat_main') + '</h2>' +
        '<button type="button" class="btn btn-primary btn-sm" id="add-main">' + UI.icon('plus', 14) + I.t('ad_add_cat') + '</button></div>' +
        '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
        '<th>' + I.t('ad_th_name') + '</th><th>' + I.t('ad_th_products') + '</th><th>' + I.t('ad_th_status') + '</th><th></th>' +
        '</tr></thead><tbody>' +
        mains.map(function (c) {
          return '<tr><td><div class="adm-cell-flex">' + catThumb(c) + '<div><div class="t-name">' + esc(catName(c)) + '</div>' +
            '<div class="t-sub">' + esc(c.name_en) + ' / ' + esc(c.name_ar) + '</div></div></div></td>' +
            '<td>' + countFor(c.id) + '</td>' +
            '<td>' + (c.is_active ? pill(I.t('ad_f_active'), 'pill-ok') : pill(I.t('ad_f_inactive'), '')) +
            (c.show_on_home ? ' ' + pill(I.t('home_categories_title'), 'pill-info') : '') + '</td>' +
            '<td><div class="row-actions">' +
            '<button type="button" class="icon-sm" data-edit-cat="' + esc(c.id) + '" aria-label="' + I.t('ad_edit') + '">' + UI.icon('edit', 15) + '</button>' +
            '<button type="button" class="icon-sm" data-del-cat="' + esc(c.id) + '" aria-label="' + I.t('ad_delete') + '">' + UI.icon('trash', 15) + '</button>' +
            '</div></td></tr>';
        }).join('') +
        '</tbody></table></div></div>' +

        '<div class="adm-card"><div class="flex-between mb-2"><h2 style="margin:0">' + I.t('ad_cat_subs') + '</h2>' +
        '<button type="button" class="btn btn-primary btn-sm" id="add-sub">' + UI.icon('plus', 14) + I.t('ad_add_sub') + '</button></div>' +
        '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
        '<th>' + I.t('ad_th_name') + '</th><th>' + I.t('ad_th_products') + '</th><th>' + I.t('ad_th_status') + '</th><th></th>' +
        '</tr></thead><tbody>' +
        subs.map(function (c) {
          return '<tr><td><div class="t-name">' + esc(catName(c)) + '</div><div class="t-sub">' + esc(c.name_en) + ' / ' + esc(c.name_ar) + '</div></td>' +
            '<td>' + countSub(c.id) + '</td>' +
            '<td>' + (c.is_active ? pill(I.t('ad_f_active'), 'pill-ok') : pill(I.t('ad_f_inactive'), '')) + '</td>' +
            '<td><div class="row-actions">' +
            '<button type="button" class="icon-sm" data-edit-cat="' + esc(c.id) + '" aria-label="' + I.t('ad_edit') + '">' + UI.icon('edit', 15) + '</button>' +
            '<button type="button" class="icon-sm" data-del-cat="' + esc(c.id) + '" aria-label="' + I.t('ad_delete') + '">' + UI.icon('trash', 15) + '</button>' +
            '</div></td></tr>';
        }).join('') +
        '</tbody></table></div></div>';

      q('#subs-switch').addEventListener('click', function () {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var next = !this.classList.contains('on');
        this.classList.toggle('on', next);
        sb.from('site_settings').update({ show_subcategories: next }).eq('id', 1).then(function (r) {
          if (r.error) throw r.error;
          cache.settings = null;
          UI.toast(I.t('ad_saved'), 'ok');
        }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
      });
      q('#add-main').addEventListener('click', function () { openCategoryModal(null, false, function () { renderCategories(host); }); });
      q('#add-sub').addEventListener('click', function () { openCategoryModal(null, true, function () { renderCategories(host); }); });
      qa('[data-edit-cat]').forEach(function (b) {
        b.addEventListener('click', function () {
          var c = cats.find(function (x) { return x.id === b.dataset.editCat; });
          openCategoryModal(c, !!c.parent_id, function () { renderCategories(host); });
        });
      });
      qa('[data-del-cat]').forEach(function (b) {
        b.addEventListener('click', function () {
          var c = cats.find(function (x) { return x.id === b.dataset.delCat; });
          if (!c) return;
          var used = c.parent_id ? countSub(c.id) : countFor(c.id);
          if (used > 0) { UI.toast(I.t('ad_cat_delete_err'), 'error'); return; }
          UI.confirm({
            title: I.t('ad_delete'),
            text: I.t('ad_confirm_delete', { name: catName(c) }),
            okLabel: I.t('ad_delete'),
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
            sb.from('categories').delete().eq('id', c.id).then(function (r) {
              if (r.error) throw r.error;
              cache.categories = null;
              UI.toast(I.t('ad_deleted'), 'ok');
              renderCategories(host);
            }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
          });
        });
      });

      function catThumb(c) {
        return '<span class="adm-thumb">' + (c.image_url
          ? '<img src="' + esc(c.image_url) + '" alt="">'
          : UI.phHtml(catName(c), (c.display_order || 0))) + '</span>';
      }
    }).catch(function (err) {
      host.innerHTML = '<div class="adm-card adm-danger"><p>' + esc(err.message || I.t('error_generic')) + '</p></div>';
    });
  }

  function openCategoryModal(row, isSub, onDone) {
    var isNew = !row;
    var c = row || {
      name_en: '', name_ar: '', slug: '', display_order: 0,
      is_active: true, show_on_home: false, image_url: ''
    };
    Promise.all([loadCategories(), loadProducts()]).then(function (res) {
      var cats = res[0], products = res[1];
      var m = modal(isNew ? (isSub ? I.t('ad_add_sub') : I.t('ad_add_cat')) : I.t('ad_edit_cat'),
        '<div class="adm-form-grid g2">' +
        '<div class="field"><label>' + I.t('ad_name_en') + '</label><input class="input is-ltr" id="c-en" value="' + esc(c.name_en) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_name_ar') + '</label><input class="input" id="c-ar" value="' + esc(c.name_ar) + '" dir="rtl"></div>' +
        '</div>' +
        '<div class="adm-form-grid g3">' +
        '<div class="field"><label>' + I.t('ad_sku') + ' (slug)</label><input class="input is-ltr" id="c-slug" value="' + esc(c.slug) + '" placeholder="lipstick"></div>' +
        '<div class="field"><label>' + I.t('ad_th_qty') + ' (order)</label><input class="input is-ltr" id="c-order" inputmode="numeric" value="' + esc(c.display_order) + '"></div>' +
        (isSub ? '' : '<div class="field"><label>' + I.t('ad_cat_image') + '</label><input type="file" class="input" id="c-image" accept="image/jpeg,image/png,image/webp,image/avif"></div>') +
        '</div>' +
        (isSub ? '' : '<label class="checkbox-row"><input type="checkbox" id="c-home"' + (c.show_on_home ? ' checked' : '') + '> <span>' + I.t('home_categories_title') + '</span></label>') +
        '<label class="checkbox-row"><input type="checkbox" id="c-active"' + (c.is_active ? ' checked' : '') + '> <span>' + I.t('ad_is_active') + '</span></label>' +
        '<div class="adm-modal-footer">' +
        '<button type="button" class="btn btn-ghost" data-close-x>' + I.t('ad_cancel') + '</button>' +
        '<button type="button" class="btn btn-primary" id="c-save">' + I.t('ad_save') + '</button>' +
        '</div>');

      m.back.querySelector('[data-close-x]').addEventListener('click', m.close);
      q('#c-save', m.body).addEventListener('click', function () {
        var en = q('#c-en', m.body).value.trim();
        var ar = q('#c-ar', m.body).value.trim();
        if (!en || !ar) { UI.toast(I.t('ad_err_cat_name'), 'error'); return; }
        var slug = (q('#c-slug', m.body).value.trim() || en).toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
        var dupe = cats.find(function (x) { return x.slug === slug && (!row || x.id !== row.id); });
        if (dupe) { UI.toast(I.t('ad_err_cat_name') + ' (slug exists)', 'error'); return; }
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }

        var btn = this;
        btn.disabled = true;
        var payload = {
          parent_id: isSub ? (cats.find(function (x) { return x.slug === 'makeup'; }) || {}).id || null : null,
          name_en: en, name_ar: ar, slug: slug,
          display_order: parseInt(q('#c-order', m.body).value, 10) || 0,
          is_active: q('#c-active', m.body).checked,
          show_on_home: isSub ? false : q('#c-home', m.body).checked
        };
        var fileInput = q('#c-image', m.body);
        var file = fileInput && fileInput.files && fileInput.files[0];

        var op = isNew
          ? sb.from('categories').insert(payload).select().single()
          : sb.from('categories').update(payload).eq('id', row.id).select().single();

        op.then(function (r1) {
          if (r1.error) throw r1.error;
          var saved = r1.data;
          if (file) {
            return DB.admin.uploadImage('brand', 'categories', file).then(function (url) {
              if (url) {
                return sb.from('categories').update({ image_url: url }).eq('id', saved.id);
              }
            });
          }
        }).then(function () {
          cache.categories = null; cache.products = null;
          UI.toast(I.t('ad_saved'), 'ok');
          m.close();
          onDone && onDone();
        }).catch(function (err) {
          btn.disabled = false;
          UI.toast(err.message || I.t('error_generic'), 'error');
        });
      });
    }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
  }

  /* ============================================================
     Discounts
  ============================================================ */
  function renderDiscounts(host) {
    var filter = 'all';
    var rowsAll = [];

    host.innerHTML =
      '<div class="adm-toolbar">' +
      [['all', 'ad_disc_all'], ['live', 'ad_disc_active'], ['scheduled', 'ad_disc_scheduled'], ['expired', 'ad_disc_expired'], ['disabled', 'ad_disc_disabled']].map(function (pair) {
        return '<button type="button" class="btn btn-sm btn-ghost" data-df="' + pair[0] + '">' + I.t(pair[1]) + '</button>';
      }).join('') +
      '</div>' +
      '<div id="d-table"></div>';

    qa('[data-df]').forEach(function (b) {
      b.addEventListener('click', function () {
        filter = b.dataset.df;
        qa('[data-df]').forEach(function (x) { x.classList.toggle('btn-primary', x === b); x.classList.toggle('btn-ghost', x !== b); });
        draw();
      });
    });
    qa('[data-df]')[0].click();

    loadProducts().then(function (products) {
      rowsAll = products.filter(function (p) {
        return p.discount_active || (p.discount_price !== null && p.discount_price !== undefined);
      });
      draw();
    }).catch(function (err) {
      q('#d-table').innerHTML = '<div class="adm-card adm-danger"><p>' + esc(err.message || I.t('error_generic')) + '</p></div>';
    });

    function draw() {
      var list = rowsAll.filter(function (p) { return filter === 'all' || discState(p) === filter; });
      q('#d-table').innerHTML =
        '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
        '<th>' + I.t('ad_th_name') + '</th><th>' + I.t('ad_th_price') + '</th><th>' + I.t('ad_disc_price') + '</th>' +
        '<th>' + I.t('ad_disc_starts') + '</th><th>' + I.t('ad_disc_ends') + '</th><th>' + I.t('ad_th_status') + '</th><th></th>' +
        '</tr></thead><tbody>' +
        (list.length ? list.map(function (p) {
          var st = discState(p);
          var cls = { live: 'pill-ok', scheduled: 'pill-info', expired: 'pill-danger', disabled: '' }[st];
          return '<tr>' +
            '<td><div class="adm-cell-flex">' + thumbHtml(p) + '<div class="t-name">' + esc(prodName(p)) + '</div></div></td>' +
            '<td class="num-cell">' + money(p.price) + '</td>' +
            '<td class="num-cell">' + (p.discount_price !== null ? money(p.discount_price) + ' (' + Math.round((1 - p.discount_price / p.price) * 100) + '%)' : I.t('ad_never')) + '</td>' +
            '<td>' + (p.discount_starts_at ? I.fmtDate(p.discount_starts_at) : I.t('ad_never')) + '</td>' +
            '<td>' + (p.discount_ends_at ? I.fmtDate(p.discount_ends_at) : I.t('ad_never')) + '</td>' +
            '<td>' + pill(I.t('ad_disc_' + st), cls) + (st === 'live' ? ' ' + pill(I.t('ad_disc_live_badge'), 'pill-live') : '') + '</td>' +
            '<td><div class="row-actions"><button type="button" class="icon-sm" data-edit-disc="' + esc(p.id) + '" aria-label="' + I.t('ad_edit') + '">' + UI.icon('edit', 15) + '</button></div></td>' +
            '</tr>';
        }).join('') : '<tr><td class="adm-empty-row" colspan="7">' + I.t('ad_disc_none') + '</td></tr>') +
        '</tbody></table></div>';

      qa('[data-edit-disc]').forEach(function (b) {
        b.addEventListener('click', function () {
          var p = rowsAll.find(function (x) { return x.id === b.dataset.editDisc; });
          if (p) openDiscountModal(p, function () { renderDiscounts(host); });
        });
      });
    }
  }

  function openDiscountModal(p, onDone) {
    var m = modal(I.t('ad_disc_edit') + ' \u2014 ' + prodName(p),
      '<p class="modal-text">' + I.t('ad_price') + ': <b>' + money(p.price) + '</b></p>' +
      '<div class="switch-row"><span>' + I.t('ad_discount_on') + '</span>' +
      '<button type="button" class="switch' + (p.discount_active ? ' on' : '') + '" id="d-switch"></button></div>' +
      '<div class="adm-form-grid g3 mt-2">' +
      '<div class="field"><label>' + I.t('ad_discount_price') + '</label><input class="input is-ltr" id="d-price" inputmode="decimal" value="' + esc(p.discount_price === null ? '' : p.discount_price) + '"></div>' +
      '<div class="field"><label>' + I.t('ad_discount_start') + '</label><input class="input is-ltr" type="datetime-local" id="d-start" value="' + esc(isoToLocal(p.discount_starts_at)) + '"></div>' +
      '<div class="field"><label>' + I.t('ad_discount_end') + '</label><input class="input is-ltr" type="datetime-local" id="d-end" value="' + esc(isoToLocal(p.discount_ends_at)) + '"></div>' +
      '</div>' +
      '<div class="adm-modal-footer">' +
      '<button type="button" class="btn btn-ghost" data-close-x>' + I.t('ad_cancel') + '</button>' +
      '<button type="button" class="btn btn-primary" id="d-save">' + I.t('ad_save') + '</button>' +
      '</div>');

    m.back.querySelector('[data-close-x]').addEventListener('click', m.close);
    q('#d-switch', m.body).addEventListener('click', function () { this.classList.toggle('on'); });
    q('#d-save', m.body).addEventListener('click', function () {
      var on = q('#d-switch', m.body).classList.contains('on');
      var dp = parseFloat(q('#d-price', m.body).value);
      var start = localToIso(q('#d-start', m.body).value);
      var end = localToIso(q('#d-end', m.body).value);
      if (on) {
        if (isNaN(dp) || dp < 0 || dp >= Number(p.price)) { UI.toast(I.t('ad_err_disc'), 'error'); return; }
        if (start && end && new Date(start) >= new Date(end)) { UI.toast(I.t('ad_err_disc'), 'error'); return; }
      }
      if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
      var btn = this;
      btn.disabled = true;
      sb.from('products').update({
        discount_active: on,
        discount_price: on ? dp : (p.discount_price !== null ? p.discount_price : null),
        discount_starts_at: on ? start : p.discount_starts_at,
        discount_ends_at: on ? end : p.discount_ends_at
      }).eq('id', p.id).then(function (r) {
        if (r.error) throw r.error;
        cache.products = null;
        UI.toast(I.t('ad_saved'), 'ok');
        m.close();
        onDone && onDone();
      }).catch(function (err) {
        btn.disabled = false;
        UI.toast(err.message || I.t('error_generic'), 'error');
      });
    });
  }

  /* ============================================================
     Orders
  ============================================================ */
  var ordUi = { search: '', status: 'all', payment: 'all', from: '', to: '', shown: 25 };

  function renderOrders(host) {
    var STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];
    var PAYMENTS = ['unpaid', 'paid', 'failed', 'refunded'];

    host.innerHTML =
      '<div class="adm-toolbar">' +
      '<input class="input search-input" id="o-search" placeholder="' + I.t('ad_search_orders') + '">' +
      '<select class="input" id="o-status"><option value="all">' + I.t('ad_all_status') + '</option>' +
      STATUSES.map(function (s) { return '<option value="' + s + '">' + I.t(I.statusKey(s)) + '</option>'; }).join('') +
      '</select>' +
      '<select class="input" id="o-pay"><option value="all">' + I.t('ad_all_payment') + '</option>' +
      PAYMENTS.map(function (s) { return '<option value="' + s + '">' + I.t(I.payKey(s)) + '</option>'; }).join('') +
      '</select>' +
      '<input class="input" type="date" id="o-from" aria-label="' + I.t('ad_from_date') + '">' +
      '<input class="input" type="date" id="o-to" aria-label="' + I.t('ad_to_date') + '">' +
      '</div>' +
      '<div id="o-table"></div>';

    q('#o-search').value = ordUi.search;
    q('#o-status').value = ordUi.status;
    q('#o-pay').value = ordUi.payment;
    q('#o-from').value = ordUi.from;
    q('#o-to').value = ordUi.to;
    ['o-search', 'o-status', 'o-pay', 'o-from', 'o-to'].forEach(function (id) {
      var el = q('#' + id);
      var ev = id === 'o-search' ? 'input' : 'change';
      el.addEventListener(ev, function () {
        ordUi.search = q('#o-search').value;
        ordUi.status = q('#o-status').value;
        ordUi.payment = q('#o-pay').value;
        ordUi.from = q('#o-from').value;
        ordUi.to = q('#o-to').value;
        ordUi.shown = 25;
        draw();
      });
    });

    draw();

    function draw() {
      loadOrders().then(function (orders) {
        var term = ordUi.search.toLowerCase();
        var list = orders.filter(function (o) {
          if (term && (o.order_number + ' ' + (o.phone || '') + ' ' + (o.full_name || '')).toLowerCase().indexOf(term) === -1) return false;
          if (ordUi.status !== 'all' && o.status !== ordUi.status) return false;
          if (ordUi.payment !== 'all' && o.payment_status !== ordUi.payment) return false;
          if (ordUi.from && new Date(o.created_at) < new Date(ordUi.from + 'T00:00:00')) return false;
          if (ordUi.to && new Date(o.created_at) > new Date(ordUi.to + 'T23:59:59')) return false;
          return true;
        });
        var rows = list.slice(0, ordUi.shown);
        q('#o-table').innerHTML =
          '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
          '<th>' + I.t('ad_th_order') + '</th><th>' + I.t('ad_th_customer') + '</th><th>' + I.t('ad_th_date') + '</th>' +
          '<th>' + I.t('ad_th_status') + '</th><th>' + I.t('ad_th_payment') + '</th><th>' + I.t('ad_th_total') + '</th><th></th>' +
          '</tr></thead><tbody>' +
          (rows.length ? rows.map(function (o) {
            return '<tr>' +
              '<td class="t-name num">' + esc(o.order_number) + '</td>' +
              '<td>' + esc(o.full_name) + '<div class="t-sub num">' + esc(o.phone) + '</div></td>' +
              '<td>' + I.fmtDateTime(o.created_at) + '</td>' +
              '<td>' + statusPill(o.status) + '</td>' +
              '<td>' + payPill(o.payment_status) + '</td>' +
              '<td class="num-cell"><b>' + money(o.total) + '</b></td>' +
              '<td><div class="row-actions"><button type="button" class="icon-sm" data-open="' + esc(o.id) + '" aria-label="' + I.t('ad_order_details') + '">' + UI.icon('eye', 15) + '</button></div></td>' +
              '</tr>';
          }).join('') : emptyRow(7)) +
          '</tbody></table></div>' +
          (list.length > ordUi.shown ? '<div class="adm-load-more"><button type="button" class="btn btn-ghost btn-sm" id="o-more">' + I.t('ad_load_more') + '</button></div>' : '');

        var more = q('#o-more');
        if (more) more.addEventListener('click', function () { ordUi.shown += 25; draw(); });
        qa('[data-open]').forEach(function (b) {
          b.addEventListener('click', function () {
            var o = orders.find(function (x) { return x.id === b.dataset.open; });
            if (o) openOrderModal(o, function () { draw(); });
          });
        });
      }).catch(function (err) {
        q('#o-table').innerHTML = '<div class="adm-card adm-danger"><p>' + esc(err.message || I.t('error_generic')) + '</p></div>';
      });
    }
  }

  function openOrderModal(order, onDone) {
    loadOrderItems(order).then(function (items) {
      var itemsHtml = (items || []).map(function (it) {
        var nm = I.lang === 'ar' ? (it.product_name_ar || it.product_name_en) : (it.product_name_en || it.product_name_ar);
        var shadeTxt = '';
        if (it.shade_number !== null && it.shade_number !== undefined) {
          var sname = I.lang === 'ar' ? (it.shade_name_ar || it.shade_name_en) : (it.shade_name_en || it.shade_name_ar);
          shadeTxt = I.t('shade_numbered', { n: it.shade_number }) + (sname ? ' \u2014 ' + sname : '');
        }
        return '<div class="od-item"><span>' + esc(nm) + ' <span class="qty num">\u00d7 ' + it.quantity + '</span>' +
          '<div class="t-sub num">' + esc(it.sku) + '</div>' +
          (shadeTxt ? '<div class="od-shade">' + UI.icon('palette', 12) + ' ' + esc(shadeTxt) + '</div>' : '') +
          '</span>' +
          '<span class="num">' + money(it.unit_price) + ' \u00d7 ' + it.quantity + ' = <b>' + money(it.line_total) + '</b></span></div>';
      }).join('');

      var STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];
      var PAYMENTS = ['unpaid', 'paid', 'failed', 'refunded'];

      var m = modal(I.t('ad_order_details') + ' \u2014 ' + order.order_number,
        '<div class="od-grid">' +
        '<div>' +
        '<p class="adm-section-title">' + I.t('ad_customer_info') + '</p>' +
        '<div class="od-kv"><span>' + I.t('ad_th_name') + '</span><b>' + esc(order.full_name) + '</b></div>' +
        '<div class="od-kv"><span>' + I.t('ad_th_phone') + '</span><b class="num">' + esc(order.phone) + '</b></div>' +
        (order.email ? '<div class="od-kv"><span>' + I.t('ad_th_email') + '</span><b>' + esc(order.email) + '</b></div>' : '') +
        '<p class="adm-section-title">' + I.t('ad_delivery_info') + '</p>' +
        '<div class="od-kv"><span>' + I.t('co_gov') + '</span><b>' + esc(govName(order.governorate)) + '</b></div>' +
        '<div class="od-kv"><span>' + I.t('co_city') + '</span><b>' + esc(order.city) + '</b></div>' +
        '<div class="od-kv"><span>' + I.t('co_address') + '</span><b>' + esc(order.address) + '</b></div>' +
        (order.delivery_instructions ? '<div class="od-kv"><span>' + I.t('co_instructions') + '</span><b>' + esc(order.delivery_instructions) + '</b></div>' : '') +
        '<div class="od-kv"><span>' + I.t('ad_th_date') + '</span><b>' + I.fmtDateTime(order.created_at) + '</b></div>' +
        '</div>' +
        '<div>' +
        '<p class="adm-section-title">' + I.t('ad_purchased') + '</p>' +
        '<div class="od-items">' + (itemsHtml || '<p class="muted">' + I.t('ad_none') + '</p>') + '</div>' +
        '<div class="od-kv mt-2"><span>' + I.t('cart_subtotal') + '</span><b class="num">' + money(order.subtotal) + '</b></div>' +
        '<div class="od-kv"><span>' + I.t('cart_shipping') + '</span><b class="num">' + money(order.shipping_fee) + '</b></div>' +
        '<div class="od-kv"><span>' + I.t('co_total') + '</span><b class="num">' + money(order.total) + '</b></div>' +
        '</div>' +
        '</div>' +

        '<div class="adm-form-grid g3 mt-3">' +
        '<div class="field"><label>' + I.t('ad_mark_status') + '</label>' +
        '<select class="input" id="od-status">' +
        STATUSES.map(function (s) { return '<option value="' + s + '"' + (s === order.status ? ' selected' : '') + '>' + I.t(I.statusKey(s)) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>' + I.t('ad_mark_payment') + '</label>' +
        '<select class="input" id="od-pay">' +
        PAYMENTS.map(function (s) { return '<option value="' + s + '"' + (s === order.payment_status ? ' selected' : '') + '>' + I.t(I.payKey(s)) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>' + I.t('ad_th_note') + '</label>' +
        '<input class="input" id="od-note" value="' + esc(order.admin_note || '') + '" placeholder="' + I.t('ad_order_note_ph') + '"></div>' +
        '</div>' +
        (order.status === 'cancelled' ? '<div class="cancelled-panel mt-1">' + UI.icon('info', 16) + '<span>' + I.t('ad_restocked_note') + '</span></div>' : '') +
        '<div class="adm-modal-footer">' +
        (order.status !== 'cancelled' ? '<button type="button" class="btn btn-danger" id="od-cancel">' + I.t('ad_cancel_order') + '</button>' : '') +
        '<button type="button" class="btn btn-primary" id="od-save">' + I.t('ad_save') + '</button>' +
        '</div>', true);

      q('#od-save', m.body).addEventListener('click', function () {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var btn = this;
        btn.disabled = true;
        var status = q('#od-status', m.body).value;
        var pay = q('#od-pay', m.body).value;
        var note = q('#od-note', m.body).value.trim();

        var tasks = [];
        if (status !== order.status) {
          tasks.push(DB.admin.setOrderStatus(order.id, status));
        }
        if (pay !== order.payment_status || note !== (order.admin_note || '')) {
          tasks.push(sb.from('orders').update({ payment_status: pay, admin_note: note }).eq('id', order.id));
        }
        if (!tasks.length) { m.close(); return; }
        Promise.all(tasks).then(function (results) {
          for (var i = 0; i < results.length; i++) {
            if (results[i] && results[i].error) throw results[i].error;
          }
          cache.orders = null;
          UI.toast(I.t('ad_status_changed'), 'ok');
          m.close();
          onDone && onDone();
        }).catch(function (err) {
          btn.disabled = false;
          UI.toast(err.message || I.t('error_generic'), 'error');
        });
      });

      var cancelBtn = q('#od-cancel', m.body);
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
          UI.confirm({
            title: I.t('ad_cancel_order'),
            text: I.t('ad_cancel_confirm', { num: order.order_number }),
            okLabel: I.t('ad_cancel_order'),
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
            DB.admin.setOrderStatus(order.id, 'cancelled').then(function (res) {
              if (res.error) throw res.error;
              cache.orders = null;
              UI.toast(I.t('ad_status_changed'), 'ok');
              m.close();
              onDone && onDone();
            }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
          });
        });
      }
    }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
  }

  /* ============================================================
     Customers
  ============================================================ */
  function renderCustomers(host) {
    host.innerHTML =
      '<div class="adm-toolbar">' +
      '<input class="input search-input" id="c-search" placeholder="' + I.t('ad_search_cust') + '">' +
      '</div>' +
      '<div id="c-table"></div>';

    draw();

    function draw() {
      loadCustomers().then(function (customers) {
        var term = (q('#c-search').value || '').toLowerCase();
        var list = customers.filter(function (c) {
          if (!term) return true;
          return ((c.full_name || '') + ' ' + (c.phone || '') + ' ' + (c.email || '')).toLowerCase().indexOf(term) !== -1;
        });
        q('#c-table').innerHTML =
          '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
          '<th>' + I.t('ad_th_name') + '</th><th>' + I.t('ad_th_phone') + '</th><th>' + I.t('ad_th_email') + '</th>' +
          '<th>' + I.t('ad_cust_orders') + '</th><th>' + I.t('ad_cust_spent') + '</th><th>' + I.t('ad_cust_joined') + '</th>' +
          '</tr></thead><tbody>' +
          (list.length ? list.map(function (c) {
            return '<tr style="cursor:pointer" data-cust="' + esc(c.id) + '">' +
              '<td class="t-name">' + esc(c.full_name) + '</td>' +
              '<td class="num-cell">' + esc(c.phone) + '</td>' +
              '<td>' + esc(c.email || I.t('ad_never')) + '</td>' +
              '<td>' + (c.orders_count || 0) + '</td>' +
              '<td class="num-cell"><b>' + money(c.total_spent || 0) + '</b></td>' +
              '<td>' + (c.first_order_at ? I.fmtDate(c.first_order_at) : I.t('ad_never')) + '</td>' +
              '</tr>';
          }).join('') : '<tr><td class="adm-empty-row" colspan="6">' + I.t('ad_cust_none') + '</td></tr>') +
          '</tbody></table></div>';

        qa('[data-cust]').forEach(function (tr) {
          tr.addEventListener('click', function () {
            var c = customers.find(function (x) { return x.id === tr.dataset.cust; });
            if (c) openCustomerModal(c);
          });
        });
      }).catch(function (err) {
        q('#c-table').innerHTML = '<div class="adm-card adm-danger"><p>' + esc(err.message || I.t('error_generic')) + '</p></div>';
      });
    }

    q('#c-search').addEventListener('input', draw);
  }

  function openCustomerModal(c) {
    var orders = (c._orders || []).slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    var m = modal(I.t('ad_customer_info') + ' \u2014 ' + c.full_name,
      '<div class="od-kv"><span>' + I.t('ad_th_phone') + '</span><b class="num">' + esc(c.phone) + '</b></div>' +
      '<div class="od-kv"><span>' + I.t('ad_th_email') + '</span><b>' + esc(c.email || I.t('ad_never')) + '</b></div>' +
      '<div class="od-kv"><span>' + I.t('co_gov') + ' / ' + I.t('co_city') + '</span><b>' + esc(govName(c.governorate)) + ' \u2014 ' + esc(c.city || '') + '</b></div>' +
      '<div class="od-kv"><span>' + I.t('co_address') + '</span><b>' + esc(c.address || I.t('ad_never')) + '</b></div>' +
      '<div class="od-kv"><span>' + I.t('ad_cust_spent') + '</span><b>' + money(c.total_spent || 0) + ' \u00b7 ' + (c.orders_count || 0) + ' ' + I.t('ad_cust_orders') + '</b></div>' +
      '<p class="adm-section-title">' + I.t('ad_cust_history') + '</p>' +
      '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
      '<th>' + I.t('ad_th_order') + '</th><th>' + I.t('ad_th_date') + '</th><th>' + I.t('ad_th_status') + '</th><th>' + I.t('ad_th_total') + '</th>' +
      '</tr></thead><tbody>' +
      (orders.length ? orders.map(function (o) {
        return '<tr><td class="t-name num">' + esc(o.order_number) + '</td>' +
          '<td>' + I.fmtDate(o.created_at) + '</td>' +
          '<td>' + statusPill(o.status) + '</td>' +
          '<td class="num-cell">' + money(o.total) + '</td></tr>';
      }).join('') : '<tr><td class="adm-empty-row" colspan="4">' + I.t('ad_none') + '</td></tr>') +
      '</tbody></table></div>', true);
  }

  /* ============================================================
     Inventory
  ============================================================ */
  var invUi = { filter: 'all' };

  function renderInventory(host) {
    host.innerHTML =
      '<div class="adm-toolbar">' +
      '<select class="input" id="inv-filter">' +
      '<option value="all">' + I.t('ad_inv_all') + '</option>' +
      '<option value="low">' + I.t('ad_f_low') + '</option>' +
      '<option value="out">' + I.t('ad_f_out') + '</option>' +
      '</select>' +
      '</div>' +
      '<div class="adm-card"><h2>' + I.t('ad_inv_title') + '</h2><div id="inv-table"></div></div>' +
      '<div class="adm-card"><h2>' + I.t('ad_inv_movements') + '</h2><div id="inv-movements"></div></div>';

    q('#inv-filter').value = invUi.filter;
    q('#inv-filter').addEventListener('change', function () { invUi.filter = this.value; drawStock(); });

    drawStock();
    loadMovements().then(function (movements) {
      q('#inv-movements').innerHTML =
        '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
        '<th>' + I.t('ad_th_date') + '</th><th>' + I.t('ad_th_name') + '</th><th>' + I.t('ad_th_type') + '</th>' +
        '<th>' + I.t('ad_th_change') + '</th><th>' + I.t('ad_th_note') + '</th>' +
        '</tr></thead><tbody>' +
        (movements.length ? movements.map(function (mv) {
          var typeKey = { order: 'ad_mv_order', order_cancelled: 'ad_mv_cancel', restock: 'ad_mv_restock', adjustment: 'ad_mv_adjust', initial: 'ad_mv_initial', demo_seed: 'ad_mv_demo' }[mv.movement_type] || 'ad_mv_adjust';
          var cls = mv.change > 0 ? 'pill-ok' : 'pill-danger';
          return '<tr>' +
            '<td>' + I.fmtDateTime(mv.created_at) + '</td>' +
            '<td><div class="t-name">' + esc(mv.product ? prodName(mv.product) : I.t('ad_never')) + '</div>' +
            '<div class="t-sub num">' + esc(mv.product && mv.product.sku ? mv.product.sku : '') + '</div></td>' +
            '<td>' + pill(I.t(typeKey), mv.movement_type === 'order_cancelled' ? 'pill-warn' : mv.movement_type === 'order' ? 'pill-ink' : 'pill-info') + '</td>' +
            '<td class="num-cell"><b style="color:' + (mv.change > 0 ? 'var(--green)' : 'var(--danger)') + '">' + (mv.change > 0 ? '+' : '') + mv.change + '</b></td>' +
            '<td>' + esc(mv.reference || mv.notes || I.t('ad_never')) + '</td>' +
            '</tr>';
        }).join('') : '<tr><td class="adm-empty-row" colspan="5">' + I.t('ad_none') + '</td></tr>') +
        '</tbody></table></div>';
    }).catch(function (err) {
      q('#inv-movements').innerHTML = '<p class="muted">' + esc(err.message || '') + '</p>';
    });

    function drawStock() {
      Promise.all([loadProducts(), loadAllShades()]).then(function (res) {
        var products = res[0];
        var allShades = res[1];
        var shadesByProduct = {};
        allShades.forEach(function (s) {
          if (!shadesByProduct[s.product_id]) shadesByProduct[s.product_id] = [];
          shadesByProduct[s.product_id].push(s);
        });
        var list = products.filter(function (p) {
          if (invUi.filter === 'low') return p.stock > 0 && p.stock <= (p.low_stock_threshold || 5);
          if (invUi.filter === 'out') return Number(p.stock) === 0;
          return true;
        });
        q('#inv-table').innerHTML =
          '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
          '<th>' + I.t('ad_th_name') + '</th><th>' + I.t('ad_th_sku') + '</th><th>' + I.t('ad_th_stock') + '</th><th>' + I.t('ad_low_threshold') + '</th><th></th>' +
          '</tr></thead><tbody>' +
          (list.length ? list.map(function (p) {
            var sh = shadesByProduct[p.id] || [];
            var shadeCell = sh.length
              ? '<div class="shade-stock-list">' + sh.map(function (s) {
                  var cls = Number(s.stock_quantity) === 0 ? 'pill-danger' : (Number(s.stock_quantity) <= (p.low_stock_threshold || 5) ? 'pill-warn' : 'pill-ok');
                  var nm = I.lang === 'ar' ? (s.shade_name_ar || s.shade_name_en) : (s.shade_name_en || s.shade_name_ar);
                  return '<span class="pill ' + cls + '">' + esc(I.t('shade_label')) + ' ' + esc(s.shade_number) + (nm ? ' \u00b7 ' + esc(nm) : '') + ': <b class="num">' + esc(s.stock_quantity) + '</b></span>';
                }).join('') + '</div>'
              : '';
            return '<tr>' +
              '<td><div class="adm-cell-flex">' + thumbHtml(p) + '<div class="t-name">' + esc(prodName(p)) + '</div></div></td>' +
              '<td class="num-cell">' + esc(p.sku) + '</td>' +
              '<td>' + stockPill(p) + shadeCell + '</td>' +
              '<td class="num-cell">' + (p.low_stock_threshold || 0) + '</td>' +
              '<td><div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-adjust="' + esc(p.id) + '">' + I.t('ad_inv_adjust') + '</button></div></td>' +
              '</tr>';
          }).join('') : emptyRow(5)) +
          '</tbody></table></div>';

        qa('[data-adjust]').forEach(function (b) {
          b.addEventListener('click', function () {
            var p = products.find(function (x) { return x.id === b.dataset.adjust; });
            if (p) openAdjustModal(p, shadesByProduct[p.id] || [], function () { drawStock(); renderInventory(host); });
          });
        });
      }).catch(function (err) {
        q('#inv-table').innerHTML = '<p class="muted">' + esc(err.message || '') + '</p>';
      });
    }
  }

  function openAdjustModal(p, productShades, onDone) {
    var shadeSelect = productShades.length
      ? '<div class="field"><label>' + I.t('ad_shade_pick') + '</label>' +
        '<select class="input" id="adj-shade">' +
        '<option value="">' + esc(I.t('ad_th_stock')) + '</option>' +
        productShades.map(function (s) {
          var nm = I.lang === 'ar' ? (s.shade_name_ar || s.shade_name_en) : (s.shade_name_en || s.shade_name_ar);
          return '<option value="' + esc(s.id) + '">' + esc(I.t('shade_label')) + ' ' + esc(s.shade_number) + (nm ? ' \u2014 ' + esc(nm) : '') + ' (' + esc(s.stock_quantity) + ')</option>';
        }).join('') +
        '</select></div>'
      : '';
    var m = modal(I.t('ad_inv_adjust') + ' \u2014 ' + prodName(p),
      '<p class="modal-text">' + I.t('ad_th_stock') + ': <b>' + p.stock + '</b></p>' +
      shadeSelect +
      '<div class="field"><label>' + I.t('ad_inv_new') + '</label>' +
      '<input class="input is-ltr" id="adj-qty" inputmode="numeric" value="' + p.stock + '"></div>' +
      '<div class="field"><label>' + I.t('ad_inv_reason') + '</label>' +
      '<input class="input" id="adj-note" maxlength="200"></div>' +
      '<div class="adm-modal-footer">' +
      '<button type="button" class="btn btn-ghost" data-close-x>' + I.t('ad_cancel') + '</button>' +
      '<button type="button" class="btn btn-primary" id="adj-save">' + I.t('ad_save') + '</button>' +
      '</div>');
    var shadeSel = q('#adj-shade', m.body);
    if (shadeSel) {
      shadeSel.addEventListener('change', function () {
        var s = productShades.find(function (x) { return x.id === shadeSel.value; });
        q('#adj-qty', m.body).value = s ? s.stock_quantity : p.stock;
      });
    }
    m.back.querySelector('[data-close-x]').addEventListener('click', m.close);
    q('#adj-save', m.body).addEventListener('click', function () {
      var newQty = parseInt(q('#adj-qty', m.body).value, 10);
      var note = q('#adj-note', m.body).value.trim();
      if (isNaN(newQty) || newQty < 0) { UI.toast(I.t('ad_inv_err'), 'error'); return; }
      if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
      var shadeId = shadeSel && shadeSel.value ? shadeSel.value : null;
      var current = p.stock;
      if (shadeId) {
        var s = productShades.find(function (x) { return x.id === shadeId; });
        current = s ? Number(s.stock_quantity) : 0;
      }
      var delta = newQty - current;
      var btn = this;
      btn.disabled = true;
      DB.admin.adjustStock(p.id, delta, note, shadeId).then(function (res) {
        if (res.error) throw res.error;
        cache.products = null;
        cache.shades = null;
        UI.toast(I.t('ad_inv_adjusted'), 'ok');
        m.close();
        onDone && onDone();
      }).catch(function (err) {
        btn.disabled = false;
        UI.toast(err.message || I.t('error_generic'), 'error');
      });
    });
  }

  /* ============================================================
     Settings + banners
  ============================================================ */
  function renderSettings(host) {
    Promise.all([loadSettingsAll(), loadCategories()]).then(function (res) {
      var data = res[0], catRows = res[1] || [];
      var s = data.settings, hp = data.homepage, banners = data.banners;
      var f = function (id) { return 'st-' + id; };

      /* Homepage category-card images (Makeup / Perfumes): stored in
         categories.image_url — the same field the homepage cards read —
         with the photo file in the brand storage bucket. */
      function catImagePanel(slug) {
        var labelKey = slug === 'makeup' ? 'ad_cat_makeup' : 'ad_cat_perfumes';
        var c = catRows.find(function (x) { return x.slug === slug; }) ||
                catRows.find(function (x) { return String(x.name_en || '').toLowerCase() === slug; });
        if (!c) {
          return '<div class="cat-img-panel"><h3>' + I.t(labelKey) + '</h3>' +
            '<p class="hint">' + I.t('ad_cat_missing') + '</p></div>';
        }
        return '<div class="cat-img-panel">' +
          '<h3>' + I.t(labelKey) + '</h3>' +
          '<div class="cat-img-preview">' +
          (c.image_url
            ? '<img src="' + esc(c.image_url) + '" alt="' + esc(c.name_en || '') + '">'
            : '<div class="ph ph-tone-0"><span>' + esc(String(c.name_en || 'B').charAt(0)) + '</span></div>') +
          '</div>' +
          '<p class="hint">' + (c.image_url ? I.t('ad_cat_current') : I.t('ad_cat_none')) + '</p>' +
          '<input type="file" class="input" id="cat-img-' + esc(slug) + '" accept="image/jpeg,image/png,image/webp,image/avif">' +
          '<div class="row-actions mt-1">' +
          '<button type="button" class="btn btn-primary btn-sm" data-cat-save="' + esc(slug) + '">' + I.t('ad_save') + '</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-cat-remove="' + esc(slug) + '"' + (c.image_url ? '' : ' disabled') + '>' + I.t('ad_cat_remove') + '</button>' +
          '</div></div>';
      }

      host.innerHTML =
        '<div class="adm-card"><h2>' + I.t('ad_set_brand') + '</h2>' +
        '<div class="adm-form-grid g2">' +
        field(f('brand-en'), I.t('ad_set_brand_en'), s.brand_name_en) +
        field(f('brand-ar'), I.t('ad_set_brand_ar'), s.brand_name_ar, 'rtl') +
        '</div>' +
        '<div class="adm-form-grid g2">' +
        field(f('tag-en'), I.t('ad_set_tagline_en'), s.tagline_en) +
        field(f('tag-ar'), I.t('ad_set_tagline_ar'), s.tagline_ar, 'rtl') +
        '</div>' +
        '<div class="field mt-2"><label>' + I.t('ad_set_logo') + '</label>' +
        '<input type="file" class="input" id="st-logo" accept="image/jpeg,image/png,image/webp,image/avif">' +
        '<p class="hint">' + I.t('ad_set_logo_hint') + '</p>' +
        (s.logo_url ? '<div class="mt-1"><img src="' + esc(s.logo_url) + '" alt="" style="max-height:52px;border:1px solid var(--line);border-radius:2px"></div>' : '') +
        '</div></div>' +

        '<div class="adm-card"><h2>' + I.t('ad_set_contact') + '</h2>' +
        '<div class="adm-form-grid g2">' +
        field(f('email'), I.t('ad_set_email'), s.contact_email, 'ltr', 'email') +
        field(f('phone'), I.t('ad_set_phone'), s.contact_phone, 'ltr') +
        field(f('wa'), I.t('ad_set_whatsapp'), s.whatsapp_number, 'ltr') +
        field(f('ig'), I.t('ad_set_ig'), s.instagram_url, 'ltr') +
        '</div>' +
        field(f('wa-msg-en'), I.t('ad_set_wa_msg') + ' (EN)', s.whatsapp_message_en) +
        field(f('wa-msg-ar'), I.t('ad_set_wa_msg') + ' (AR)', s.whatsapp_message_ar, 'rtl') +
        field(f('hours'), I.t('ad_set_hours'), s.working_hours) +
        '</div>' +

        '<div class="adm-card"><h2>' + I.t('ad_set_store') + '</h2>' +
        switchRow('sw-subs', I.t('ad_set_show_subs'), s.show_subcategories) +
        switchRow('sw-flash', I.t('ad_set_show_flash'), s.show_flash_sales) +
        switchRow('sw-feat', I.t('ad_set_show_featured'), s.show_featured) +
        switchRow('sw-best', I.t('ad_set_show_best'), s.show_bestsellers) +
        switchRow('sw-sim', I.t('ad_set_sim'), s.payment_simulation) +
        '<div class="field mt-2" style="max-width:240px"><label>' + I.t('ad_set_shipping') + '</label>' +
        '<input class="input is-ltr" id="st-shipping" inputmode="decimal" value="' + esc(s.shipping_fee) + '"></div>' +
        '</div>' +

        '<div class="adm-card"><h2>' + I.t('ad_set_ribbon') + '</h2>' +
        '<p class="hint mb-2">' + I.t('ad_set_ribbon_hint') + '</p>' +
        switchRow('sw-ribbon', I.t('ad_set_ribbon_enable'), s.promo_ribbon_enabled !== false) +
        '<div class="adm-form-grid g2 mt-2">' +
        field(f('ribbon-en'), I.t('ad_set_ribbon_text_en'), s.promo_ribbon_text_en) +
        field(f('ribbon-ar'), I.t('ad_set_ribbon_text_ar'), s.promo_ribbon_text_ar, 'rtl') +
        '</div>' +
        '<div class="field mt-2" style="max-width:240px"><label>' + I.t('ad_set_ribbon_color') + '</label>' +
        '<input type="color" class="input is-ltr" id="st-ribbon-color" value="' + esc(s.promo_ribbon_color || '#F72585') + '"></div>' +
        '</div>' +

        '<div class="adm-card"><h2>' + I.t('ad_set_home') + '</h2>' +
        '<div class="adm-form-grid g2">' +
        field(f('flash-en'), I.t('ad_set_flash_t_en'), hp.flash_title_en) +
        field(f('flash-ar'), I.t('ad_set_flash_t_ar'), hp.flash_title_ar, 'rtl') +
        field(f('feat-en'), I.t('ad_set_feat_t_en'), hp.featured_title_en) +
        field(f('feat-ar'), I.t('ad_set_feat_t_ar'), hp.featured_title_ar, 'rtl') +
        field(f('best-en'), I.t('ad_set_best_t_en'), hp.bestsellers_title_en) +
        field(f('best-ar'), I.t('ad_set_best_t_ar'), hp.bestsellers_title_ar, 'rtl') +
        '</div></div>' +

        '<div class="adm-card"><h2>' + I.t('ad_cat_images') + '</h2>' +
        '<p class="hint mb-2">' + I.t('ad_cat_images_hint') + '</p>' +
        '<div class="adm-form-grid g2">' +
        catImagePanel('makeup') +
        catImagePanel('perfumes') +
        '</div></div>' +

        '<div class="adm-card"><div class="flex-between mb-2"><h2 style="margin:0">' + I.t('ad_set_banners') + '</h2>' +
        '<button type="button" class="btn btn-primary btn-sm" id="add-banner">' + UI.icon('plus', 14) + I.t('ad_set_add_banner') + '</button></div>' +
        '<p class="hint mb-2">' + I.t('ad_set_banner_hint') + '</p>' +
        '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
        '<th>' + I.t('ad_banner_image') + '</th><th>' + I.t('ad_th_name') + '</th><th>' + I.t('ad_th_status') + '</th><th></th>' +
        '</tr></thead><tbody>' +
        (banners.length ? banners.map(function (b) {
          return '<tr><td><span class="adm-thumb" style="width:64px">' +
            (b.image_url ? '<img src="' + esc(b.image_url) + '" alt="">' : UI.phHtml(b.title_en || 'B', 1)) + '</span></td>' +
            '<td><div class="t-name">' + esc(b.title_en || '') + '</div><div class="t-sub">' + esc(b.title_ar || '') + '</div></td>' +
            '<td>' + (b.is_active ? pill(I.t('ad_f_active'), 'pill-ok') : pill(I.t('ad_f_inactive'), '')) + '</td>' +
            '<td><div class="row-actions">' +
            '<button type="button" class="icon-sm" data-edit-banner="' + esc(b.id) + '" aria-label="' + I.t('ad_edit') + '">' + UI.icon('edit', 15) + '</button>' +
            '<button type="button" class="icon-sm" data-del-banner="' + esc(b.id) + '" aria-label="' + I.t('ad_delete') + '">' + UI.icon('trash', 15) + '</button>' +
            '</div></td></tr>';
        }).join('') : '<tr><td class="adm-empty-row" colspan="4">' + I.t('ad_none') + '</td></tr>') +
        '</tbody></table></div>' +
        '<div class="adm-modal-footer" style="justify-content:flex-start">' +
        '<button type="button" class="btn btn-primary" id="st-save">' + I.t('ad_save') + '</button>' +
        '</div></div>';

      qa('.switch', host).forEach(function (sw) {
        sw.addEventListener('click', function () { sw.classList.toggle('on'); });
      });
      q('#st-save').addEventListener('click', function () {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var btn = this;
        btn.disabled = true;
        var logoFile = q('#st-logo').files[0];

        var updSettings = function (extra) {
          return sb.from('site_settings').update(Object.assign({
            brand_name_en: val(f('brand-en')),
            brand_name_ar: val(f('brand-ar')),
            tagline_en: val(f('tag-en')),
            tagline_ar: val(f('tag-ar')),
            contact_email: val(f('email')),
            contact_phone: val(f('phone')),
            whatsapp_number: val(f('wa')).replace(/[^0-9]/g, ''),
            whatsapp_message_en: val(f('wa-msg-en')),
            whatsapp_message_ar: val(f('wa-msg-ar')),
            instagram_url: val(f('ig')),
            working_hours: val(f('hours')),
            show_subcategories: swVal('sw-subs'),
            show_flash_sales: swVal('sw-flash'),
            show_featured: swVal('sw-feat'),
            show_bestsellers: swVal('sw-best'),
            payment_simulation: swVal('sw-sim'),
            shipping_fee: parseFloat(val(f('shipping'))) || 0,
            promo_ribbon_enabled: swVal('sw-ribbon'),
            promo_ribbon_text_en: val(f('ribbon-en')),
            promo_ribbon_text_ar: val(f('ribbon-ar')),
            promo_ribbon_color: val(f('ribbon-color'))
          }, extra || {})).eq('id', 1);
        };
        var updHomepage = sb.from('homepage_settings').update({
          flash_title_en: val(f('flash-en')), flash_title_ar: val(f('flash-ar')),
          featured_title_en: val(f('feat-en')), featured_title_ar: val(f('feat-ar')),
          bestsellers_title_en: val(f('best-en')), bestsellers_title_ar: val(f('best-ar'))
        }).eq('id', 1);

        var pre = logoFile
          ? DB.admin.uploadImage('brand', 'logo', logoFile).then(function (url) {
            return { logo_url: url };
          })
          : Promise.resolve(null);

        pre.then(function (extra) {
          return Promise.all([updSettings(extra), updHomepage]);
        }).then(function (results) {
          if (results[0].error) throw results[0].error;
          if (results[1].error) throw results[1].error;
          cache.settings = null; cache.homepage = null;
          UI.toast(I.t('ad_set_saved'), 'ok');
          renderSettings(host);
        }).catch(function (err) {
          btn.disabled = false;
          UI.toast(err.message || I.t('error_generic'), 'error');
        });
      });

      q('#add-banner').addEventListener('click', function () { openBannerModal(null, function () { renderSettings(host); }); });
      qa('[data-edit-banner]').forEach(function (b) {
        b.addEventListener('click', function () {
          var banner = banners.find(function (x) { return x.id === b.dataset.editBanner; });
          openBannerModal(banner, function () { renderSettings(host); });
        });
      });
      qa('[data-del-banner]').forEach(function (b) {
        b.addEventListener('click', function () {
          var banner = banners.find(function (x) { return x.id === b.dataset.delBanner; });
          UI.confirm({
            title: I.t('ad_delete'),
            text: I.t('ad_confirm_delete', { name: banner.title_en || banner.title_ar || '' }),
            okLabel: I.t('ad_delete'),
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
            sb.from('banners').delete().eq('id', banner.id).then(function (r) {
              if (r.error) throw r.error;
              cache.banners = null;
              UI.toast(I.t('ad_deleted'), 'ok');
              renderSettings(host);
            }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
          });
        });
      });

      /* Category image wiring: save (upload + update) and remove. */
      function findCatBySlug(slug) {
        return catRows.find(function (x) { return x.slug === slug; }) ||
          catRows.find(function (x) { return String(x.name_en || '').toLowerCase() === slug; });
      }
      qa('[data-cat-save]').forEach(function (b) {
        b.addEventListener('click', function () {
          var slug = b.dataset.catSave;
          var input = document.getElementById('cat-img-' + slug);
          var file = input && input.files && input.files[0];
          if (!file) { UI.toast(I.t('ad_cat_choose'), 'info'); return; }
          if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
          var cat = findCatBySlug(slug);
          if (!cat) { UI.toast(I.t('ad_cat_missing'), 'error'); return; }
          b.disabled = true;
          var oldUrl = cat.image_url || '';
          DB.admin.uploadImage('brand', 'categories', file).then(function (url) {
            return sb.from('categories').update({ image_url: url }).eq('id', cat.id).then(function (r) {
              if (r.error) throw r.error;
              return url;
            });
          }).then(function () {
            /* old file deleted only after the new URL is live */
            if (oldUrl) DB.admin.deleteImage(oldUrl).catch(function () { /* non-fatal */ });
            cache.categories = null;
            UI.toast(I.t('ad_cat_saved'), 'ok');
            renderSettings(host);
          }).catch(function (err) {
            b.disabled = false;
            UI.toast(err.message || I.t('error_generic'), 'error');
          });
        });
      });
      qa('[data-cat-remove]').forEach(function (b) {
        b.addEventListener('click', function () {
          var slug = b.dataset.catRemove;
          if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
          var cat = findCatBySlug(slug);
          if (!cat || !cat.image_url) return;
          UI.confirm({
            title: I.t('ad_cat_remove'),
            text: I.t('ad_cat_remove_hint'),
            okLabel: I.t('ad_cat_remove'),
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            var oldUrl = cat.image_url;
            b.disabled = true;
            sb.from('categories').update({ image_url: null }).eq('id', cat.id).then(function (r) {
              if (r.error) throw r.error;
              DB.admin.deleteImage(oldUrl).catch(function () { /* non-fatal */ });
              cache.categories = null;
              UI.toast(I.t('ad_cat_removed'), 'ok');
              renderSettings(host);
            }).catch(function (err) {
              b.disabled = false;
              UI.toast(err.message || I.t('error_generic'), 'error');
            });
          });
        });
      });

      function val(id) {
        var el = document.getElementById(id);
        return el ? String(el.value).trim() : '';
      }
      function swVal(id) {
        var el = document.getElementById(id);
        return el ? el.classList.contains('on') : false;
      }
      function field(id, label, value, dir, type) {
        return '<div class="field"><label for="' + id + '">' + label + '</label>' +
          '<input class="input' + (dir === 'ltr' ? ' is-ltr' : '') + (dir === 'rtl' ? '" dir="rtl' : '') + '" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value === null || value === undefined ? '' : value) + '"></div>';
      }
      function switchRow(id, label, on) {
        return '<div class="switch-row"><span>' + label + '</span>' +
          '<button type="button" class="switch' + (on ? ' on' : '') + '" id="' + id + '" aria-label="' + esc(label) + '"></button></div>';
      }
    }).catch(function (err) {
      host.innerHTML = '<div class="adm-card adm-danger"><p>' + esc(err.message || I.t('error_generic')) + '</p></div>';
    });
  }

  function openBannerModal(banner, onDone) {
    var isNew = !banner;
    var b = banner || { title_en: '', title_ar: '', subtitle_en: '', subtitle_ar: '', link_url: '', display_order: 0, is_active: true, image_url: '' };
    var m = modal(isNew ? I.t('ad_set_add_banner') : I.t('ad_edit') + ' \u2014 ' + (b.title_en || ''),
      '<div class="adm-form-grid g2">' +
      '<div class="field"><label>' + I.t('ad_banner_title_en') + '</label><input class="input is-ltr" id="b-en" value="' + esc(b.title_en) + '"></div>' +
      '<div class="field"><label>' + I.t('ad_banner_title_ar') + '</label><input class="input" id="b-ar" value="' + esc(b.title_ar) + '" dir="rtl"></div>' +
      '<div class="field"><label>' + I.t('ad_banner_sub_en') + '</label><input class="input is-ltr" id="b-sub-en" value="' + esc(b.subtitle_en) + '"></div>' +
      '<div class="field"><label>' + I.t('ad_banner_sub_ar') + '</label><input class="input" id="b-sub-ar" value="' + esc(b.subtitle_ar) + '" dir="rtl"></div>' +
      '<div class="field"><label>' + I.t('ad_banner_link') + '</label><input class="input is-ltr" id="b-link" value="' + esc(b.link_url) + '"></div>' +
      '<div class="field"><label>' + I.t('ad_th_qty') + ' (order)</label><input class="input is-ltr" id="b-order" inputmode="numeric" value="' + esc(b.display_order) + '"></div>' +
      '</div>' +
      '<div class="field"><label>' + I.t('ad_banner_image') + '</label>' +
      '<input type="file" class="input" id="b-image" accept="image/jpeg,image/png,image/webp,image/avif"></div>' +
      '<label class="checkbox-row"><input type="checkbox" id="b-active"' + (b.is_active ? ' checked' : '') + '> <span>' + I.t('ad_is_active') + '</span></label>' +
      '<div class="adm-modal-footer">' +
      '<button type="button" class="btn btn-ghost" data-close-x>' + I.t('ad_cancel') + '</button>' +
      '<button type="button" class="btn btn-primary" id="b-save">' + I.t('ad_save') + '</button>' +
      '</div>');
    m.back.querySelector('[data-close-x]').addEventListener('click', m.close);
    q('#b-save', m.body).addEventListener('click', function () {
      if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
      var btn = this;
      btn.disabled = true;
      var file = q('#b-image', m.body).files[0];
      var payload = {
        title_en: q('#b-en', m.body).value.trim(),
        title_ar: q('#b-ar', m.body).value.trim(),
        subtitle_en: q('#b-sub-en', m.body).value.trim(),
        subtitle_ar: q('#b-sub-ar', m.body).value.trim(),
        link_url: q('#b-link', m.body).value.trim(),
        display_order: parseInt(q('#b-order', m.body).value, 10) || 0,
        is_active: q('#b-active', m.body).checked
      };
      var op = isNew
        ? sb.from('banners').insert(payload).select().single()
        : sb.from('banners').update(payload).eq('id', banner.id).select().single();
      op.then(function (r1) {
        if (r1.error) throw r1.error;
        if (file) {
          return DB.admin.uploadImage('brand', 'banners', file).then(function (url) {
            if (url) return sb.from('banners').update({ image_url: url }).eq('id', r1.data.id);
          });
        }
      }).then(function () {
        cache.banners = null;
        UI.toast(I.t('ad_saved'), 'ok');
        m.close();
        onDone && onDone();
      }).catch(function (err) {
        btn.disabled = false;
        UI.toast(err.message || I.t('error_generic'), 'error');
      });
    });
  }

  /* ============================================================
     Demo data cleanup
  ============================================================ */
  function renderDemo(host) {
    host.innerHTML =
      '<div class="adm-card adm-danger">' +
      '<h2>' + I.t('ad_demo_title') + '</h2>' +
      '<p class="modal-text">' + I.t('ad_demo_text') + '</p>' +
      '<div class="adm-toolbar" style="margin-bottom:0">' +
      '<button type="button" class="btn btn-ghost" id="demo-preview">' + I.t('ad_demo_preview') + '</button>' +
      '<button type="button" class="btn btn-danger" id="demo-run">' + I.t('ad_demo_run') + '</button>' +
      '</div>' +
      '<div id="demo-counts" class="mt-2"></div>' +
      '</div>' +
      (state.preview ? '<div class="adm-card"><h2>' + I.t('ad_preview') + '</h2><p class="muted">' + I.t('ad_demo_readonly') + '</p></div>' : '');

    q('#demo-preview').addEventListener('click', function () {
      if (state.preview) {
        var orders = DEMO.loadOrders().length;
        var products = DEMO.products.length;
        var shades = DEMO.shades.length;
        q('#demo-counts').innerHTML =
          '<div class="metric-grid">' +
          '<div class="metric"><div class="m-label">' + I.t('ad_products') + '</div><div class="m-value">' + products + '</div></div>' +
          '<div class="metric"><div class="m-label">' + I.t('shades_title') + '</div><div class="m-value">' + shades + '</div></div>' +
          '<div class="metric"><div class="m-label">' + I.t('ad_orders') + '</div><div class="m-value">' + orders + '</div></div>' +
          '<div class="metric"><div class="m-label">' + I.t('ad_customers') + '</div><div class="m-value">' + new Set(DEMO.loadOrders().map(function (o) { return o.phone; })).size + '</div></div>' +
          '</div><p class="hint mt-1">' + I.t('ad_demo_readonly') + '</p>';
        return;
      }
      DB.admin.cleanupPreview().then(function (res) {
        if (res.error) throw res.error;
        var c = res.data || {};
        q('#demo-counts').innerHTML =
          '<div class="metric-grid">' +
          metric(I.t('ad_products'), c.products || 0) +
          metric(I.t('shades_title'), c.shades || 0) +
          metric(I.t('ad_orders'), c.orders || 0) +
          metric(I.t('ad_customers'), c.customers || 0) +
          metric(I.t('ad_set_banners'), c.banners || 0) +
          '</div><p class="hint mt-1">' + I.t('ad_demo_counts') + '</p>';
      }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
    });

    q('#demo-run').addEventListener('click', function () {
      if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
      UI.confirm({
        title: I.t('ad_demo_run'),
        text: I.t('ad_demo_text'),
        typeInput: true,
        typeText: 'DELETE DEMO DATA',
        okLabel: I.t('ad_demo_confirm_btn'),
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        DB.admin.cleanupRun().then(function (res) {
          if (res.error) throw res.error;
          cache.products = cache.orders = cache.customers = null;
          UI.toast(I.t('ad_demo_done'), 'ok');
          renderDemo(host);
        }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
      });
    });

    function metric(label, value) {
      return '<div class="metric"><div class="m-label">' + label + '</div><div class="m-value">' + value + '</div></div>';
    }
  }

  /* ============================================================
     Boot
  ============================================================ */
  window.addEventListener('hashchange', function () {
    if (state.preview || (state.session && state.isAdmin)) route();
  });

  boot();

  function boot() {
    document.addEventListener('lang:change', function () {
      if (state.preview) { renderSidebar(); route(); }
      else if (state.session && state.isAdmin) { renderSidebar(); route(); }
    });
    if (state.preview) {
      buildShell();
      route();
      return;
    }
    DB.admin.getSession().then(function (session) {
      state.session = session;
      if (!session) { renderLogin(); return null; }
      return DB.admin.amIAdmin().then(function (ok) {
        state.isAdmin = ok;
        if (!ok) { renderNotAdmin(); return null; }
        buildShell();
        route();
        return null;
      });
    }).catch(function () {
      renderLogin();
    });
    if (sb) {
      try {
        sb.auth.onAuthStateChange(function () {
          DB.admin.getSession().then(function (s) {
            if ((!!s) !== (!!state.session)) window.location.reload();
          });
        });
      } catch (e) { /* listener optional */ }
    }
  }
})();
