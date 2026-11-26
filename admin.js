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
  /* Run 13 fix: metric() previously lived inside renderOverview's draw(),
     so the Dashboard cleanup, Campaign Analytics and Inventory Valuation
     sections threw "metric is not defined". Hoisted to module scope. */
  function metric(label, value, sub, alert) {
    return '<div class="metric' + (alert ? ' is-alert' : '') + '"><div class="m-label">' + label + '</div>' +
      '<div class="m-value">' + value + '</div>' + (sub ? '<div class="m-sub">' + sub + '</div>' : '') + '</div>';
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
    var map = { paid: 'pill-ok', unpaid: 'pill-ink', failed: 'pill-danger', refunded: 'pill-warn', partial: 'pill-warn' };
    return pill(I.t(I.payKey(ps)), map[ps] || '');
  }
  function depPill(ds) {
    var map = {
      awaiting_verification: ['pay_deposit_awaiting', 'pill-warn'],
      verified: ['pay_deposit_verified', 'pill-ok'],
      rejected: ['pay_deposit_rejected', 'pill-danger'],
      awaiting_deposit: ['pay_deposit_none', '']
    };
    var m = map[ds || 'awaiting_deposit'] || [ds, ''];
    return pill(I.t(m[0]), m[1]);
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
    { key: 'home-categories', icon: 'image', label: 'ad_hcat_title' },
    { key: 'popup', icon: 'mail', label: 'ad_popup_title' },
    { key: 'wheel', icon: 'gift', label: 'ad_wheel_title' },
    { key: 'wheel-analytics', icon: 'calendar', label: 'ad_wa_title' },
    { key: 'inventory-valuation', icon: 'bag', label: 'ad_val_title' },
    { key: 'gross-profit', icon: 'chart', label: 'ad_gp_title' },
    { key: 'settings', icon: 'sliders', label: 'ad_settings' },
    { key: 'demo', icon: 'alert', label: 'ad_demo' }
  ];

  /* Run 12: grouped navigation — Content Management, Marketing and
     Business Overview added alongside the existing groups. The group
     order matches the requested admin structure; every key above must
     appear exactly once across all groups (asserted at boot). */
  var NAV_GROUPS = [
    { label: 'ad_group_catalog', keys: ['overview', 'products', 'categories', 'discounts'] },
    { label: 'ad_group_sales', keys: ['orders', 'customers', 'inventory'] },
    { label: 'ad_group_content', keys: ['home-categories', 'popup'] },
    { label: 'ad_group_marketing', keys: ['wheel', 'wheel-analytics'] },
    { label: 'ad_group_business', keys: ['inventory-valuation', 'gross-profit'] },
    { label: 'ad_group_system', keys: ['settings', 'demo'] }
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
    nav.innerHTML = NAV_GROUPS.map(function (g) {
      return '<div class="adm-nav-group">' + esc(I.t(g.label)) + '</div>' +
        g.keys.map(function (key) {
          var s = SECTIONS.find(function (x) { return x.key === key; });
          if (!s) return '';
          return '<a href="#/' + s.key + '" data-key="' + s.key + '" class="' + (state.section === s.key ? 'active' : '') + '">' +
            UI.icon(s.icon, 17) + I.t(s.label) + '</a>';
        }).join('');
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
      'home-categories': renderHomeCategories,
      popup: renderPopupConfig,
      wheel: renderWheel,
      'wheel-analytics': renderWheelAnalytics,
      'inventory-valuation': renderInventoryValuation,
      'gross-profit': renderGrossProfit,
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
      '<option value="flash">' + I.t('ad_flash_short') + '</option>' +
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
          if (prodUi.status === 'flash' && !p.is_flash_sale) return false;
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
              (p.is_bestseller ? ' ' + pill(I.t('ad_is_bestseller'), 'pill-info') : '') +
              (p.is_flash_sale ? ' ' + pill(I.t('ad_flash_short'), 'pill-info') : '') + '</td>' +
              '<td><div class="row-actions">' +
              '<button type="button" class="icon-sm" data-edit="' + esc(p.id) + '" aria-label="' + I.t('ad_edit') + '">' + UI.icon('edit', 15) + '</button>' +
              '<button type="button" class="icon-sm" data-del="' + esc(p.id) + '" aria-label="' + I.t('ad_delete') + '">' + UI.icon('trash', 15) + '</button>' +
              '</div></td></tr>';
          }).join('') : emptyRow(8)) +
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
              /* Storage-cleanup run: collect every image URL first,
                 delete the DB records (cascade) — only after that
                 SUCCEEDS remove files nothing else references. A failed
                 row delete never touches storage; failed file removals
                 are queued for retry. */
              collectProductImageUrls(p.id).then(function (urls) {
                return sb.from('products').delete().eq('id', p.id).then(function (res) {
                  if (res.error) throw res.error;
                  return urls;
                });
              }).then(function (urls) {
                cache.products = null;
                UI.toast(I.t('ad_deleted'), 'ok');
                draw();
                var uniq = [];
                (urls || []).forEach(function (u) {
                  if (u && uniq.indexOf(u) === -1) uniq.push(u);
                });
                Promise.all(uniq.map(function (u) {
                  return DB.admin.removeIfUnreferenced(u);
                })).then(function (results) {
                  var removed = results.filter(function (r) { return r && r.removed; }).length;
                  if (removed) UI.toast(I.t('ad_storage_cleaned', { n: removed }), 'ok');
                  DB.admin.retryPendingCleanups();
                });
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
      /* null = inherit the main product price */
      price: (row.price === null || row.price === undefined || row.price === '') ? null : Number(row.price),
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

  /* Storage-cleanup run: collect every storage URL a product owns
     (gallery + shade galleries) while its rows still exist — after the
     DB cascade the URLs would be unrecoverable. */
  function collectProductImageUrls(productId) {
    return sb.from('product_images').select('url').eq('product_id', productId)
      .then(function (r1) {
        if (r1.error) throw r1.error;
        var urls = (r1.data || []).map(function (x) { return x.url; }).filter(Boolean);
        return sb.from('product_shades').select('id').eq('product_id', productId)
          .then(function (r2) {
            if (r2.error) throw r2.error;
            var ids = (r2.data || []).map(function (x) { return x.id; });
            if (!ids.length) return urls;
            return sb.from('product_shade_images').select('url').in('shade_id', ids)
              .then(function (r3) {
                if (r3.error) throw r3.error;
                return urls.concat((r3.data || []).map(function (x) { return x.url; }).filter(Boolean));
              });
          });
      });
  }

  function openProductModal(row, onDone) {
    var isNew = !row;
    var p = row || {
      sku: '', name_en: '', name_ar: '', description_en: '', description_ar: '',
      category_id: '', subcategory_id: null, price: '', discount_price: null,
      discount_active: false, discount_starts_at: null, discount_ends_at: null,
      stock: 0, low_stock_threshold: 5, is_active: true, is_featured: false, is_bestseller: false, is_flash_sale: false,
      images: []
    };

    Promise.all([
      loadCategories(),
      isNew || state.preview ? Promise.resolve([]) :
        sb.from('product_images').select('*').eq('product_id', p.id).order('position'),
      isNew ? Promise.resolve([]) : loadShadesFor(p.id),
      /* Run 12: prefill the acquisition cost from the admin-only
         product_costs table (never exposed publicly). */
      isNew || state.preview ? Promise.resolve([]) : DB.admin.getProductCosts()
    ]).then(function (res) {
      var cats = res[0];
      /* Run 12: current acquisition cost (admin-only table), prefill. */
      var costRow = (res[3] || []).filter ? (res[3] || []).find(function (c) { return c.product_id === p.id; }) : null;
      p._cost = costRow ? costRow.cost_price : null;
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
        '<div class="adm-form-grid g3">' +
        '<div class="field"><label>' + I.t('ad_val_th_cost') + ' (' + I.t('ad_val_edit_cost') + ', EGP)</label><input class="input is-ltr" id="f-cost" inputmode="decimal" value="' + esc(p._cost === undefined || p._cost === null ? '' : p._cost) + '" placeholder="' + I.t('ad_val_missing_hint') + '"></div>' +
        '</div>' +
        '<p class="hint" id="stock-shades-hint" style="display:none">' + I.t('ad_stock_shades_hint') + '</p>' +

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
        '<label class="checkbox-row"><input type="checkbox" id="f-flash"' + (p.is_flash_sale ? ' checked' : '') + '> <span>' + I.t('ad_flash_sale') + '</span></label>' +

        '<div class="adm-section-title">' + I.t('ad_images') + '</div>' +
        '<p class="hint">' + I.t('ad_img_hint') + '</p>' +
        '<div class="upload-drop mt-1" id="img-drop">' + UI.icon('upload', 20) + '<span>' + I.t('ad_img_upload') + '</span>' +
        '<input type="file" id="img-input" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden></div>' +
        '<div class="img-manager" id="img-list"></div>' +

        '<div class="adm-section-title">' + I.t('ad_shades') + '</div>' +
        '<label class="checkbox-row"><input type="checkbox" id="f-shade-pricing"> <span>' + I.t('ad_shade_pricing') + '</span></label>' +
        '<p class="hint">' + I.t('ad_shade_pricing_hint') + '</p>' +
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
            /* Storage-cleanup run, DB-first: the row is deleted and
               confirmed BEFORE any storage call, and the file goes only
               when no other row references it. */
            sb.from('product_images').delete().eq('id', im.id).then(function (res) {
              if (res.error) throw res.error;
              return DB.admin.removeIfUnreferenced(im.url);
            }).then(function (clean) {
              images.splice(idx, 1);
              /* normalize order */
              return Promise.all(images.map(function (x, i) {
                return sb.from('product_images').update({ position: i }).eq('id', x.id);
              })).then(function () { return clean; });
            }).then(function (clean) {
              drawImages();
              UI.toast(I.t('ad_deleted'), 'ok');
              if (clean && clean.error) UI.toast(I.t('ad_storage_retry_note'), 'info');
            })
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
        var pricingToggle = q('#f-shade-pricing', m.body);
        var pricingOn = !!(pricingToggle && pricingToggle.checked);
        if (!shades.length) {
          shadeHost.innerHTML = '<p class="hint">' + I.t('ad_shade_none') + '</p>';
          refreshStockField();
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
            '<div class="field"><label>' + I.t('ad_shade_threshold') + '</label><input class="input is-ltr" data-s-field="low_stock_threshold" data-s-idx="' + sIdx + '" inputmode="numeric" value="' + esc(sh.low_stock_threshold) + '"' + dis + '></div>' +
            (pricingOn ? '<div class="field"><label>' + I.t('ad_shade_price') + '</label><input class="input is-ltr" data-s-field="price" data-s-idx="' + sIdx + '" inputmode="decimal" placeholder="\u2014" value="' + esc(sh.price === null || sh.price === undefined ? '' : sh.price) + '"' + dis + '></div>' : '') +
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
        else if (f === 'low_stock_threshold') sh.low_stock_threshold = Math.max(0, parseInt(fieldEl.value, 10) || 0);
        else if (f === 'price') {
          /* Individual shade price: empty = inherit the main product
             price (null). Numeric and non-negative; anything else is
             flagged for the save validation. */
          var raw = fieldEl.value.trim();
          if (raw === '') {
            sh.price = null;
            sh._priceInvalid = false;
          } else {
            var pv = parseFloat(raw);
            sh._priceInvalid = isNaN(pv) || pv < 0;
            sh.price = sh._priceInvalid ? null : pv;
          }
        }
        else sh[f] = fieldEl.value;
      });

      q('#shade-add', m.body).addEventListener('click', function () {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var nextNum = shades.reduce(function (m2, s) { return Math.max(m2, s.shade_number); }, 0) + 1;
        shades.push(mapShadeRow({ shade_number: nextNum, is_active: true, stock_quantity: 0, images: [] }));
        drawShades();
        refreshStockField();
      });

      /* Individual shade pricing toggle: shows/hides the per-shade
         price fields. State on save decides whether prices persist
         (disabled = every shade inherits the main product price). */
      q('#f-shade-pricing', m.body).addEventListener('change', function () {
        drawShades();
      });

      /* Main stock vs shade stock: while shades exist, inventory is
         managed per shade — the main field is disabled and never saved. */
      function refreshStockField() {
        var stockEl = q('#f-stock', m.body);
        var hint = q('#stock-shades-hint', m.body);
        var hasSh = shades.length > 0;
        if (stockEl) stockEl.disabled = hasSh;
        if (hint) hint.style.display = hasSh ? '' : 'none';
      }

      /* Init the pricing toggle from the loaded shades: individual
         pricing is "on" exactly when at least one shade carries its
         own price (single source of truth — no duplicated flag). */
      (function initPricingToggle() {
        var t = q('#f-shade-pricing', m.body);
        if (t) t.checked = shades.some(function (s) { return s.price !== null && s.price !== undefined; });
      })();

      drawShades();
      refreshStockField();

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
          /* Storage-cleanup run: files are NOT removed here — the shade
             row is only deleted when the form is saved. Stash the URLs;
             saveShades removes them AFTER the row deletion succeeds. */
          sh._orphanUrls = (sh.images || []).map(function (im) { return im.url; }).filter(Boolean);
          if (sh.id) deletedShadeIds.push(sh.id);
          shades.splice(idx, 1);
          drawShades();
          refreshStockField();
        });
      }

      function deleteShadeImage(sIdx, iIdx) {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var sh = shades[sIdx];
        var im = sh.images[iIdx];
        if (!im) return;
        /* DB-first (storage-cleanup run): the row is deleted and
           confirmed BEFORE the file is touched. */
        sb.from('product_shade_images').delete().eq('id', im.id).then(function (res) {
          if (res.error) throw res.error;
          return DB.admin.removeIfUnreferenced(im.url);
        }).then(function (clean) {
          sh.images.splice(iIdx, 1);
          return Promise.all(sh.images.map(function (x, i) {
            return sb.from('product_shade_images').update({ position: i }).eq('id', x.id);
          })).then(function () { return clean; });
        }).then(function (clean) {
          drawShades();
          UI.toast(I.t('ad_deleted'), 'ok');
          if (clean && clean.error) UI.toast(I.t('ad_storage_retry_note'), 'info');
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
              /* DB row already points at the NEW url — the old file is
                 removed only when no other row references it. */
              return DB.admin.removeIfUnreferenced(im.url);
            })
            .then(function () { return url; });
        }).then(function (url) {
          im.url = url;
          drawShades();
          UI.toast(I.t('ad_saved'), 'ok');
        }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
      }

      /* Persists the shade working objects after the product row is
         saved. uploadedNow (optional) collects every file uploaded
         during this save so the caller can roll back unreferenced ones
         if a later step fails. */
      function saveShades(productId, uploadedNow) {
        if (state.preview) return Promise.resolve();
        if (!shades.length && !deletedShadeIds.length) return Promise.resolve();
        var delTask = deletedShadeIds.length
          ? sb.from('product_shades').delete().in('id', deletedShadeIds)
          : Promise.resolve({ error: null });
        return delTask.then(function (r0) {
          if (r0.error) throw r0.error;
          /* Shade rows are really gone — only NOW the files they
             pointed at become cleanup candidates (reference-checked;
             shared files survive). Fire-and-forget: a later step in
             this save must not be able to strand these files. */
          var orphanUrls = [];
          shades.forEach(function (sh) {
            if (sh._orphanUrls) orphanUrls = orphanUrls.concat(sh._orphanUrls);
          });
          var uniq = [];
          orphanUrls.forEach(function (u) { if (u && uniq.indexOf(u) === -1) uniq.push(u); });
          if (uniq.length) {
            Promise.all(uniq.map(function (u) { return DB.admin.removeIfUnreferenced(u); }))
              .then(function () { DB.admin.retryPendingCleanups(); });
          }
          /* insert/update in display order */
          return shades.reduce(function (chain, sh, idx) {
            return chain.then(function () {
              var pt = q('#f-shade-pricing', m.body);
              var pricingOff = !(pt && pt.checked);
              var payload = {
                shade_number: sh.shade_number,
                shade_name_en: sh.shade_name_en.trim(),
                /* English fallback when the Arabic shade name is empty */
                shade_name_ar: sh.shade_name_ar.trim() || sh.shade_name_en.trim(),
                stock_quantity: sh.stock_quantity,
                low_stock_threshold: sh.low_stock_threshold,
                /* Individual shade price; null = inherit main price.
                   With the pricing toggle OFF every shade is saved
                   without its own price, so all shades inherit. */
                price: pricingOff ? null : (sh.price === undefined ? null : sh.price),
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
                    if (uploadedNow) uploadedNow.push(url);
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
        /* Main stock: managed per shade while shades exist — the main
           field is disabled and its value is NOT validated or saved. */
        if (!shades.length) {
          var stock = parseInt(q('#f-stock', m.body).value, 10);
          if (isNaN(stock) || stock < 0) errs.push(I.t('ad_err_stock'));
        }
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
          /* individual shade prices must be numeric and non-negative */
          if (sh._priceInvalid) {
            if (errs.indexOf(I.t('ad_err_price')) === -1) errs.push(I.t('ad_err_price'));
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
          low_stock_threshold: parseInt(q('#f-threshold', m.body).value, 10) || 0,
          is_active: q('#f-active', m.body).checked,
          is_featured: q('#f-featured', m.body).checked,
          is_bestseller: q('#f-best', m.body).checked,
          is_flash_sale: q('#f-flash', m.body).checked
        };
        /* Main stock is managed per shade while shades exist: the field
           is disabled and its value is deliberately NOT sent, so shade
           inventory can never be overwritten by the product form. When
           the last shade is deleted, the admin re-enables the field and
           sets stock explicitly (no silent inventory changes). */
        if (!shades.length) {
          payload.stock = parseInt(q('#f-stock', m.body).value, 10) || 0;
        }

        /* Set once the product row itself is in the database. Every
           later Save UPDATES that row — a retry after a failed image or
           shade step can never create a duplicate product. */
        var savedProductId = null;
        /* Storage-cleanup run: files uploaded during THIS save attempt;
           on failure everything still unreferenced is rolled back. */
        var uploadedNow = [];

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
                uploadedNow.push(url);
                return sb.from('product_images').insert({
                  product_id: saved.id, url: url, alt: saved.name_en,
                  position: images.length + i
                }).then(function (r2) { if (r2.error) throw r2.error; });
              });
            });
          }, Promise.resolve()).then(function () {
            /* persist the shade definitions (inserts, updates, deletions,
               staged shade-image uploads) */
            return saveShades(saved.id, uploadedNow);
          }).then(function () {
            /* Run 12: persist the acquisition cost into the admin-only
               product_costs table (empty field removes the row). A
               rejection lands in the partial-save path below, so the
               next Save retries ONLY the failed step on the same row. */
            var costRaw = q('#f-cost', m.body) ? q('#f-cost', m.body).value.trim() : '';
            if (costRaw === '') {
              if (!isNew && !state.preview) return DB.admin.removeProductCost(saved.id);
              return;
            }
            var costVal = Number(costRaw);
            if (isNaN(costVal) || costVal < 0) throw new Error(I.t('ad_val_cost_err'));
            return DB.admin.saveProductCost(saved.id, costVal);
          }).then(function () {
            cache.products = null;
            cache.shades = null;
            UI.toast(I.t('ad_saved'), 'ok');
            m.close();
            onDone && onDone();
          });
        }).catch(function (err) {
          /* Storage-cleanup run: files uploaded during this failed save
             that never got a database row are removed (reference-checked,
             so rows that DID land keep their files). Failures queue for
             retry — never silent. */
          if (uploadedNow.length) DB.admin.rollbackUploads(uploadedNow);
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
    var PAYMENTS = ['unpaid', 'partial', 'paid', 'failed', 'refunded'];

    host.innerHTML =
      '<div class="adm-toolbar">' +
      '<input class="input search-input" id="o-search" placeholder="' + I.t('ad_search_orders') + '">' +
      '<select class="input" id="o-status"><option value="all">' + I.t('ad_all_status') + '</option>' +
      STATUSES.map(function (s) { return '<option value="' + s + '">' + I.t(I.statusKey(s)) + '</option>'; }).join('') +
      '</select>' +
      '<select class="input" id="o-pay"><option value="all">' + I.t('ad_all_payment') + '</option>' +
      PAYMENTS.map(function (s) { return '<option value="' + s + '">' + I.t(I.payKey(s)) + '</option>'; }).join('') +
      '</select>' +
      '<select class="input" id="o-dep"><option value="all">' + I.t('ad_all_deposit') + '</option>' +
      ['awaiting_verification', 'verified', 'rejected'].map(function (s) { return '<option value="' + s + '">' + I.t('pay_deposit_' + (s === 'awaiting_verification' ? 'awaiting' : s)) + '</option>'; }).join('') +
      '</select>' +
      '<input class="input" type="date" id="o-from" aria-label="' + I.t('ad_from_date') + '">' +
      '<input class="input" type="date" id="o-to" aria-label="' + I.t('ad_to_date') + '">' +
      '</div>' +
      '<div id="o-table"></div>';

    q('#o-search').value = ordUi.search;
    q('#o-status').value = ordUi.status;
    q('#o-pay').value = ordUi.payment;
    q('#o-dep').value = ordUi.deposit || 'all';
    q('#o-from').value = ordUi.from;
    q('#o-to').value = ordUi.to;
    ['o-search', 'o-status', 'o-pay', 'o-dep', 'o-from', 'o-to'].forEach(function (id) {
      var el = q('#' + id);
      var ev = id === 'o-search' ? 'input' : 'change';
      el.addEventListener(ev, function () {
        ordUi.search = q('#o-search').value;
        ordUi.status = q('#o-status').value;
        ordUi.payment = q('#o-pay').value;
        ordUi.deposit = q('#o-dep').value;
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
          if ((ordUi.deposit || 'all') !== 'all' && (o.deposit_status || 'awaiting_deposit') !== ordUi.deposit) return false;
          if (ordUi.from && new Date(o.created_at) < new Date(ordUi.from + 'T00:00:00')) return false;
          if (ordUi.to && new Date(o.created_at) > new Date(ordUi.to + 'T23:59:59')) return false;
          return true;
        });
        var rows = list.slice(0, ordUi.shown);
        q('#o-table').innerHTML =
          '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
          '<th>' + I.t('ad_th_order') + '</th><th>' + I.t('ad_th_customer') + '</th><th>' + I.t('ad_th_date') + '</th>' +
          '<th>' + I.t('ad_th_status') + '</th><th>' + I.t('ad_th_payment') + '</th><th>' + I.t('ad_th_deposit') + '</th><th>' + I.t('ad_th_total') + '</th><th></th>' +
          '</tr></thead><tbody>' +
          (rows.length ? rows.map(function (o) {
            return '<tr>' +
              '<td class="t-name num">' + esc(o.order_number) + '</td>' +
              '<td>' + esc(o.full_name) + '<div class="t-sub num">' + esc(o.phone) + '</div></td>' +
              '<td>' + I.fmtDateTime(o.created_at) + '</td>' +
              '<td>' + statusPill(o.status) + '</td>' +
              '<td>' + payPill(o.payment_status) + '</td>' +
              '<td>' + depPill(o.deposit_status) + '</td>' +
              '<td class="num-cell"><b>' + money(o.total) + '</b></td>' +
              '<td><div class="row-actions"><button type="button" class="icon-sm" data-open="' + esc(o.id) + '" aria-label="' + I.t('ad_order_details') + '">' + UI.icon('eye', 15) + '</button></div></td>' +
              '</tr>';
          }).join('') : emptyRow(8)) +
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
      var PAYMENTS = ['unpaid', 'partial', 'paid', 'failed', 'refunded'];

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

        '<div class="od-payment mt-3">' +
        '<p class="adm-section-title">' + I.t('ad_deposit_title') + '</p>' +
        '<div class="od-kv"><span>' + I.t('tr_deposit_amount') + '</span><b class="num">' + money(order.deposit_amount || 0) + ' \u00b7 InstaPay</b> ' + depPill(order.deposit_status) + '</div>' +
        '<div class="od-kv"><span>' + I.t('tr_remaining_amount') + '</span><b class="num">' + money(order.remaining_amount || 0) + '</b> ' + pill(I.t(I.payKey(order.payment_status)), order.payment_status === 'paid' ? 'pill-ok' : (order.payment_status === 'partial' ? 'pill-warn' : '')) + '</div>' +
        (order.deposit_submitted_at ? '<div class="od-kv"><span>' + I.t('ad_dep_submitted') + '</span><b>' + I.fmtDateTime(order.deposit_submitted_at) + '</b></div>' : '') +
        (order.deposit_verified_at ? '<div class="od-kv"><span>' + I.t('ad_dep_verified') + '</span><b>' + I.fmtDateTime(order.deposit_verified_at) + (order.deposit_verified_by ? ' \u00b7 ' + esc(String(order.deposit_verified_by).slice(0, 8)) : '') + '</b></div>' : '') +
        (order.deposit_rejection_reason ? '<div class="od-kv"><span>' + I.t('tr_rejection_reason') + '</span><b>' + esc(order.deposit_rejection_reason) + '</b></div>' : '') +
        (order.remaining_verified_at ? '<div class="od-kv"><span>' + I.t('ad_dep_verified') + ' (' + I.t('tr_remaining_amount') + ')</span><b>' + I.fmtDateTime(order.remaining_verified_at) + '</b></div>' : '') +
        '<div class="proof-review">' +
        '<p class="hint mb-1">' + I.t('ad_dep_proof_hint') + '</p>' +
        '<div class="proof-box" id="od-proof-deposit">' + I.t('ad_dep_loading') + '</div>' +
        (order.payment_method === 'instapay' && order.deposit_status === 'verified'
          ? '<p class="hint mt-2">' + I.t('ad_rem_proof_hint') + '</p><div class="proof-box" id="od-proof-remaining">' + (order.remaining_proof_path ? I.t('ad_dep_loading') : I.t('ad_rem_no_proof')) + '</div>' : '') +
        '</div>' +
        (order.deposit_status === 'awaiting_verification'
          ? '<div class="adm-form-grid g2 mt-2" id="od-deposit-actions">' +
            '<div class="field"><label>' + I.t('ad_dep_reject_reason') + '</label>' +
            '<input class="input" id="od-reject-reason" placeholder="' + I.t('ad_dep_reject_ph') + '"></div>' +
            '<div class="field"><label>&nbsp;</label><div class="flex-between">' +
            '<button type="button" class="btn btn-primary btn-sm" id="od-dep-approve">' + I.t('ad_dep_approve') + '</button>' +
            '<button type="button" class="btn btn-danger btn-sm" id="od-dep-reject">' + I.t('ad_dep_reject') + '</button>' +
            '</div></div></div>' : '') +
        (order.payment_method === 'instapay' && order.deposit_status === 'verified' && order.remaining_status === 'awaiting_verification'
          ? '<div class="flex-between mt-2" id="od-remaining-actions">' +
            '<button type="button" class="btn btn-primary btn-sm" id="od-rem-approve">' + I.t('ad_rem_approve') + '</button>' +
            '<button type="button" class="btn btn-danger btn-sm" id="od-rem-reject">' + I.t('ad_rem_reject') + '</button>' +
            '</div>' : '') +
        '<div class="track-events"><p class="adm-section-title">' + I.t('ad_events_title') + '</p><ul id="od-events" class="track-events"><li>' + I.t('ad_dep_loading') + '</li></ul></div>' +
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

      /* ---- payment screenshot review + verification (async fills) ---- */
      function loadProof(path, hostId) {
        var host = q('#' + hostId, m.body);
        if (!host) return;
        if (state.preview) {
          /* demo preview: the demo proof is an in-memory data URL */
          DB.admin.getProofUrl(path).then(function (url) {
            if (!url) { host.textContent = I.t('ad_dep_no_proof'); return; }
            host.innerHTML = '<img src="' + url + '" alt="payment proof" style="max-width:100%;max-height:280px;object-fit:contain;border-radius:8px">';
          }).catch(function () { host.textContent = I.t('ad_dep_no_proof'); });
          return;
        }
        DB.admin.getProofUrl(path).then(function (url) {
          if (!url) { host.textContent = I.t('ad_dep_no_proof'); return; }
          host.innerHTML = '<a href="' + url + '" target="_blank" rel="noopener noreferrer"><img src="' + url + '" alt="payment proof" style="max-width:100%;max-height:280px;object-fit:contain;border-radius:8px"></a>';
        }).catch(function (err) {
          host.textContent = err.message || I.t('ad_dep_no_proof');
        });
      }
      if (order.deposit_proof_path) loadProof(order.deposit_proof_path, 'od-proof-deposit');
      var remHost = q('#od-proof-remaining', m.body);
      if (remHost && order.remaining_proof_path) loadProof(order.remaining_proof_path, 'od-proof-remaining');

      DB.admin.getOrderEvents(order.id).then(function (events) {
        var ul = q('#od-events', m.body);
        if (!ul) return;
        ul.innerHTML = (events || []).map(function (ev) {
          return '<li><b>' + esc(I.t('ev_' + ev.event_type)) + '</b> \u00b7 ' +
            I.fmtDateTime(ev.created_at) + ' \u00b7 ' + esc(ev.actor || '') +
            (ev.amount ? ' \u00b7 <span class="num">' + money(ev.amount) + '</span>' : '') +
            (ev.note ? '<div class="t-sub">' + esc(ev.note) + '</div>' : '') + '</li>';
        }).join('') || '<li>' + I.t('ad_none') + '</li>';
      }).catch(function () {
        var ul2 = q('#od-events', m.body);
        if (ul2) ul2.innerHTML = '<li>' + I.t('ad_none') + '</li>';
      });

      function runVerify(kind, approve) {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var reasonInput = q('#od-reject-reason', m.body);
        var reason = reasonInput ? reasonInput.value.trim() : '';
        if (!approve && !reason) { UI.toast(I.t('ad_dep_reason_required'), 'error'); return; }
        var call = kind === 'deposit'
          ? DB.admin.verifyDeposit(order.id, approve, reason)
          : DB.admin.verifyRemainingPayment(order.id, approve, approve ? null : reason);
        call.then(function () {
          cache.orders = null;
          UI.toast(I.t(approve ? 'ad_dep_approved' : 'ad_dep_rejected'), 'ok');
          m.close();
          onDone && onDone();
        }).catch(function (err) {
          UI.toast(err.message || I.t('error_generic'), 'error');
        });
      }
      var approveBtn = q('#od-dep-approve', m.body);
      if (approveBtn) approveBtn.addEventListener('click', function () { runVerify('deposit', true); });
      var rejectBtn = q('#od-dep-reject', m.body);
      if (rejectBtn) rejectBtn.addEventListener('click', function () { runVerify('deposit', false); });
      var remApprove = q('#od-rem-approve', m.body);
      if (remApprove) remApprove.addEventListener('click', function () { runVerify('remaining', true); });
      var remReject = q('#od-rem-reject', m.body);
      if (remReject) remReject.addEventListener('click', function () { runVerify('remaining', false); });

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
        /* Migration guard: when the connected database has not run the
           shade-price-display migration yet, the column is missing and
           saving the switch would fail with a Postgres error — say so
           here instead of leaving the toggle silently broken. */
        (!state.preview && s.show_shade_prices === undefined
          ? '<p class="hint mb-2" style="color:var(--danger)">' + I.t('ad_set_migration_missing') + '</p>'
          : '') +
        switchRow('sw-subs', I.t('ad_set_show_subs'), s.show_subcategories) +
        switchRow('sw-flash', I.t('ad_set_show_flash'), s.show_flash_sales) +
        switchRow('sw-feat', I.t('ad_set_show_featured'), s.show_featured) +
        switchRow('sw-best', I.t('ad_set_show_best'), s.show_bestsellers) +
        switchRow('sw-shade-prices', I.t('ad_set_shade_prices'), s.show_shade_prices !== false) +
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
        field(f('catsub-en'), I.t('ad_set_catsub_en'), hp.home_categories_sub_en) +
        field(f('catsub-ar'), I.t('ad_set_catsub_ar'), hp.home_categories_sub_ar, 'rtl') +
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
          return '<tr><td><span class="adm-thumb">' +
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
        '</div></div>' +

        /* Storage audit (storage-cleanup run): REPORT-ONLY trigger for
           the server-side cleanup Edge Function. The browser sends only
           the signed-in admin's own access token — the privileged
           service key never leaves the server. */
        '<div class="adm-card"><div class="flex-between mb-2"><h2 style="margin:0">' + I.t('ad_audit_title') + '</h2>' +
        '<button type="button" class="btn btn-primary btn-sm" id="st-audit-run">' + I.t('ad_audit_run') + '</button></div>' +
        '<p class="hint mb-2">' + I.t('ad_audit_desc') + '</p>' +
        '<p class="hint" id="st-audit-retry"></p>' +
        '<div id="st-audit-out"></div></div>';

      /* Storage audit trigger + failed-cleanup retry visibility. */
      q('#st-audit-retry').textContent = DB.admin.pendingCleanupCount()
        ? I.t('ad_audit_pending', { n: DB.admin.pendingCleanupCount() }) : '';
      q('#st-audit-run').addEventListener('click', function () {
        var btn = this;
        var out = q('#st-audit-out');
        btn.disabled = true;
        btn.textContent = I.t('ad_audit_running');
        out.innerHTML = '';
        DB.admin.getSession().then(function (session) {
          if (!session || !session.access_token) throw new Error(I.t('ad_audit_fail'));
          var cfg = (window.BLUSH_CONFIG || {});
          if (!cfg.SUPABASE_URL) throw new Error(I.t('ad_audit_nofn'));
          return fetch(cfg.SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/storage-cleanup', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + session.access_token,
              'apikey': cfg.SUPABASE_ANON_KEY || '',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mode: 'report' })
          }).then(function (res) {
            return res.json().then(function (data) {
              if (!res.ok) throw new Error((data && data.error) || I.t('ad_audit_fail'));
              return data;
            });
          });
        }).then(function (report) {
          var t = report.totals || {};
          function fmtBytes(b) {
            if (b === null || b === undefined) return '\u2014';
            if (b > 1048576) return (b / 1048576).toFixed(2) + ' MB';
            if (b > 1024) return (b / 1024).toFixed(1) + ' KB';
            return b + ' B';
          }
          var rows = (report.candidates || []).slice(0, 50).map(function (c) {
            return '<tr><td>' + esc(c.bucket) + '</td><td class="is-ltr">' + esc(c.path) + '</td>' +
              '<td>' + fmtBytes(c.size) + '</td><td>' + (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '\u2014') + '</td></tr>';
          }).join('');
          out.innerHTML =
            '<table class="adm-table"><thead><tr>' +
            '<th>' + I.t('ad_audit_th_scanned') + '</th><th>' + I.t('ad_audit_th_ref') + '</th><th>' + I.t('ad_audit_th_cand') + '</th><th>' + I.t('ad_audit_th_recov') + '</th>' +
            '</tr></thead><tbody><tr><td>' + (t.scanned || 0) + '</td><td>' + (t.referenced || 0) + '</td><td>' + (t.orphanedCandidates || 0) + '</td><td>' + fmtBytes(report.recoverable && report.recoverable.totalBytes) + '</td></tr></tbody></table>' +
            '<p class="hint mt-1">' + esc(I.t('ad_audit_excl', { g: t.graceExcluded || 0, p: t.protectedExcluded || 0, a: t.ambiguousExcluded || 0 })) + '</p>' +
            (rows ? '<table class="adm-table mt-2"><thead><tr><th>Bucket</th><th>Path</th><th>Size</th><th>Created</th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
            '<p class="hint mt-1">' + esc(I.t('ad_audit_note')) + '</p>';
        }).catch(function (err) {
          out.innerHTML = '<p class="hint">' + esc((err && err.message) || I.t('ad_audit_fail')) + '</p>';
        }).then(function () {
          btn.disabled = false;
          btn.textContent = I.t('ad_audit_run');
        });
      });

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
            show_shade_prices: swVal('sw-shade-prices'),
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
          bestsellers_title_en: val(f('best-en')), bestsellers_title_ar: val(f('best-ar')),
          home_categories_sub_en: val(f('catsub-en')), home_categories_sub_ar: val(f('catsub-ar'))
        }).eq('id', 1);

        /* Storage-cleanup run: remember the previous logo so it can be
           removed once the new one is safely referenced, and track the
           fresh upload for rollback if the settings update fails. */
        var oldLogoUrl = (s && s.logo_url) || '';
        var uploadedLogoUrl = null;
        var pre = logoFile
          ? DB.admin.uploadImage('brand', 'logo', logoFile).then(function (url) {
            uploadedLogoUrl = url;
            return { logo_url: url };
          })
          : Promise.resolve(null);

        pre.then(function (extra) {
          return Promise.all([updSettings(extra), updHomepage]);
        }).then(function (results) {
          if (results[0].error) throw results[0].error;
          if (results[1].error) throw results[1].error;
          if (uploadedLogoUrl && oldLogoUrl && oldLogoUrl !== uploadedLogoUrl) {
            DB.admin.removeIfUnreferenced(oldLogoUrl);
          }
          cache.settings = null; cache.homepage = null;
          /* Warm the shared settings cache with the fresh values so any
             storefront render on this session reads the saved switch
             immediately (customers get it on their next page load). */
          if (typeof DB !== 'undefined' && DB.getSettings) DB.getSettings({ fresh: true }).catch(function () {});
          UI.toast(I.t('ad_set_saved'), 'ok');
          renderSettings(host);
        }).catch(function (err) {
          if (uploadedLogoUrl) DB.admin.rollbackUploads([uploadedLogoUrl]);
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
              /* row gone — file removed only if nothing else references
                 it (storage-cleanup run) */
              if (banner.image_url) DB.admin.removeIfUnreferenced(banner.image_url);
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
          var newUrl = null;
          DB.admin.uploadImage('brand', 'categories', file).then(function (url) {
            newUrl = url;
            return sb.from('categories').update({ image_url: url }).eq('id', cat.id).then(function (r) {
              if (r.error) throw r.error;
              return url;
            });
          }).then(function () {
            /* old file removed only after the new URL is live — and only
               when no other row references it (storage-cleanup run) */
            if (oldUrl) DB.admin.removeIfUnreferenced(oldUrl);
            cache.categories = null;
            UI.toast(I.t('ad_cat_saved'), 'ok');
            renderSettings(host);
          }).catch(function (err) {
            /* the fresh upload has no row — roll it back */
            if (newUrl) DB.admin.rollbackUploads([newUrl]);
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
              /* row cleared first — file goes only if nothing else
                 references it (storage-cleanup run) */
              DB.admin.removeIfUnreferenced(oldUrl);
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
      /* Storage-cleanup run: remember the old image (edit case) so it is
         removed once the new one is live, and track the fresh upload
         for rollback if the DB update fails. */
      var oldBannerUrl = (!isNew && banner && banner.image_url) ? banner.image_url : '';
      var uploadedBannerUrl = null;
      var op = isNew
        ? sb.from('banners').insert(payload).select().single()
        : sb.from('banners').update(payload).eq('id', banner.id).select().single();
      op.then(function (r1) {
        if (r1.error) throw r1.error;
        if (file) {
          return DB.admin.uploadImage('brand', 'banners', file).then(function (url) {
            if (!url) return null;
            uploadedBannerUrl = url;
            return sb.from('banners').update({ image_url: url }).eq('id', r1.data.id)
              .then(function (r2) {
                if (r2.error) throw r2.error;
                if (oldBannerUrl && oldBannerUrl !== uploadedBannerUrl) {
                  DB.admin.removeIfUnreferenced(oldBannerUrl);
                }
                return null;
              });
          });
        }
      }).then(function () {
        cache.banners = null;
        UI.toast(I.t('ad_saved'), 'ok');
        m.close();
        onDone && onDone();
      }).catch(function (err) {
        if (uploadedBannerUrl) DB.admin.rollbackUploads([uploadedBannerUrl]);
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

  /* ============================================================
     Run 12 — Content Management: Homepage Categories
     Manages the SAME categories table the storefront grid reads
     (show_on_home / display_order / image_url / slug). No duplicate
     category system. Every image operation follows the storage-cleanup
     run: upload → DB update confirmed → old file removed ONLY when
     unreferenced; failed saves roll back freshly uploaded files.
  ============================================================ */
  function renderHomeCategories(host) {
    Promise.all([loadCategories(true), loadProducts()]).then(function (res) {
      var cats = res[0], products = res[1];
      var mains = cats.filter(function (c) { return !c.parent_id; })
        .sort(function (a, b) {
          return (a.display_order || 0) - (b.display_order || 0) ||
            String(a.name_en || '').localeCompare(String(b.name_en || ''));
        });
      var countFor = function (catId) {
        return products.filter(function (p) { return p.category_id === catId || (p.sub && p.sub.parent_id === catId); }).length;
      };
      var ordered = mains.slice();
      function renumber(list) {
        /* sequential updates; a mid-chain failure leaves display_order
           values that still sort the SAME way (relative order intact) */
        return list.reduce(function (chain, c, i) {
          return chain.then(function () {
            return sb.from('categories').update({ display_order: (i + 1) * 10 }).eq('id', c.id)
              .then(function (r) { if (r.error) throw r.error; });
          });
        }, Promise.resolve()).then(function () {
          cache.categories = null;
        });
      }

      host.innerHTML =
        '<div class="adm-card"><h2>' + I.t('ad_hcat_title') + '</h2>' +
        '<p class="hint mt-1">' + I.t('ad_hcat_hint') + '</p>' +
        '<div class="flex-between mt-2"><span></span>' +
        '<button type="button" class="btn btn-primary btn-sm" id="hcat-add">' + UI.icon('plus', 14) + I.t('ad_add_cat') + '</button></div>' +
        '</div>' +
        '<div class="adm-card">' +
        (mains.length ? '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
          '<th>' + I.t('ad_th_name') + '</th><th>' + I.t('ad_hcat_link') + '</th><th>' + I.t('ad_th_products') + '</th>' +
          '<th>' + I.t('ad_hcat_order') + '</th><th>' + I.t('ad_hcat_visible') + '</th><th></th>' +
          '</tr></thead><tbody>' +
          mains.map(function (c) {
            return '<tr data-cat-row="' + esc(c.id) + '">' +
              '<td><div class="adm-cell-flex">' + hcatThumb(c) + '<div><div class="t-name">' + esc(catName(c)) + '</div>' +
              '<div class="t-sub">' + esc(c.name_en) + ' / ' + esc(c.name_ar) + '</div></div></div></td>' +
              '<td><a class="adm-link-chip" href="shop.html?cat=' + encodeURIComponent(c.slug) + '" target="_blank" rel="noopener">shop.html?cat=' + esc(c.slug) + '</a></td>' +
              '<td>' + countFor(c.id) + '</td>' +
              '<td><div class="row-actions">' +
              '<button type="button" class="icon-sm" data-up="' + esc(c.id) + '" aria-label="' + I.t('ad_hcat_up') + '">' + UI.icon('chevUp', 14) + '</button>' +
              '<button type="button" class="icon-sm" data-down="' + esc(c.id) + '" aria-label="' + I.t('ad_hcat_down') + '">' + UI.icon('chevDown', 14) + '</button>' +
              '</div></td>' +
              '<td><button type="button" class="switch' + (c.show_on_home ? ' on' : '') + '" data-home="' + esc(c.id) + '" aria-label="' + I.t('ad_hcat_visible') + '"></button></td>' +
              '<td><div class="row-actions">' +
              '<button type="button" class="icon-sm" data-edit="' + esc(c.id) + '" aria-label="' + I.t('ad_edit') + '">' + UI.icon('edit', 15) + '</button>' +
              '<button type="button" class="icon-sm" data-del="' + esc(c.id) + '" aria-label="' + I.t('ad_delete') + '">' + UI.icon('trash', 15) + '</button>' +
              '</div></td></tr>';
          }).join('') +
          '</tbody></table></div>' : '<p class="muted">' + I.t('ad_hcat_none') + '</p>') +
        '</div>';

      q('#hcat-add').addEventListener('click', function () {
        openHomeCategoryModal(null, function () { renderHomeCategories(host); });
      });
      qa('[data-up]', host).concat(qa('[data-down]', host)).forEach(function (b) {
        b.addEventListener('click', function () {
          if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
          var isUp = b.dataset.up !== undefined;
          var id = isUp ? b.dataset.up : b.dataset.down;
          var idx = ordered.findIndex(function (c) { return c.id === id; });
          var swapWith = isUp ? idx - 1 : idx + 1;
          if (idx < 0 || swapWith < 0 || swapWith >= ordered.length) return;
          var tmp = ordered[idx]; ordered[idx] = ordered[swapWith]; ordered[swapWith] = tmp;
          renumber(ordered).then(function () { renderHomeCategories(host); })
            .catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
        });
      });
      qa('[data-home]', host).forEach(function (b) {
        b.addEventListener('click', function () {
          if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
          var c = cats.find(function (x) { return x.id === b.dataset.home; });
          if (!c) return;
          var next = !b.classList.contains('on');
          b.classList.toggle('on', next);
          sb.from('categories').update({ show_on_home: next }).eq('id', c.id).then(function (r) {
            if (r.error) throw r.error;
            cache.categories = null;
            UI.toast(I.t('ad_saved'), 'ok');
          }).catch(function (err) {
            b.classList.toggle('on', !next);
            UI.toast(err.message || I.t('error_generic'), 'error');
          });
        });
      });
      qa('[data-edit]', host).forEach(function (b) {
        b.addEventListener('click', function () {
          var c = cats.find(function (x) { return x.id === b.dataset.edit; });
          if (c) openHomeCategoryModal(c, function () { renderHomeCategories(host); });
        });
      });
      qa('[data-del]', host).forEach(function (b) {
        b.addEventListener('click', function () {
          var c = cats.find(function (x) { return x.id === b.dataset.del; });
          if (!c) return;
          var used = countFor(c.id);
          if (used > 0) { UI.toast(I.t('ad_cat_delete_err'), 'error'); return; }
          UI.confirm({
            title: I.t('ad_delete'),
            text: I.t('ad_confirm_delete', { name: catName(c) }),
            okLabel: I.t('ad_delete'),
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
            /* DB-first: the row is deleted, then the image file is
               removed ONLY when no other row references it (shared
               images survive — storage-cleanup run protections). */
            sb.from('categories').delete().eq('id', c.id).then(function (r) {
              if (r.error) throw r.error;
              cache.categories = null;
              UI.toast(I.t('ad_deleted'), 'ok');
              renderHomeCategories(host);
              if (c.image_url) return DB.admin.removeIfUnreferenced(c.image_url);
            }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
          });
        });
      });

      function hcatThumb(c) {
        return '<span class="adm-thumb">' + (c.image_url
          ? '<img src="' + esc(c.image_url) + '" alt="">'
          : UI.phHtml(catName(c), (c.display_order || 0))) + '</span>';
      }
    }).catch(function (err) {
      host.innerHTML = '<div class="adm-card adm-danger"><p>' + esc(err.message || I.t('error_generic')) + '</p></div>';
    });
  }

  function openHomeCategoryModal(row, onDone) {
    var isNew = !row;
    var c = row || { name_en: '', name_ar: '', slug: '', display_order: 0, is_active: true, show_on_home: true, image_url: '' };
    var m = modal(isNew ? I.t('ad_add_cat') : I.t('ad_edit_cat'),
      '<div class="adm-form-grid g2">' +
      '<div class="field"><label>' + I.t('ad_name_en') + '</label><input class="input is-ltr" id="hc-en" value="' + esc(c.name_en) + '"></div>' +
      '<div class="field"><label>' + I.t('ad_name_ar') + '</label><input class="input" id="hc-ar" value="' + esc(c.name_ar) + '" dir="rtl"></div>' +
      '</div>' +
      (isNew
        ? '<div class="field"><label>slug</label><input class="input is-ltr" id="hc-slug" value="' + esc(c.slug) + '" placeholder="makeup"></div>'
        : '<p class="hint">' + I.t('ad_hcat_link') + ': <b>shop.html?cat=' + esc(c.slug) + '</b> (' + I.t('ad_hcat_hint') + ')</p>') +
      '<div class="adm-form-grid g2">' +
      '<div class="field"><label>' + I.t('ad_cat_image') + '</label><input type="file" class="input" id="hc-image" accept="image/jpeg,image/png,image/webp,image/avif"></div>' +
      '<div class="field"><label>' + I.t('ad_hcat_order') + '</label><input class="input is-ltr" id="hc-order" inputmode="numeric" value="' + esc(c.display_order) + '"></div>' +
      '</div>' +
      (c.image_url ? '<div class="hc-current"><span class="adm-thumb"><img src="' + esc(c.image_url) + '" alt=""></span></div>' : '') +
      '<label class="checkbox-row"><input type="checkbox" id="hc-home"' + (c.show_on_home ? ' checked' : '') + '> <span>' + I.t('ad_hcat_visible') + '</span></label>' +
      '<label class="checkbox-row"><input type="checkbox" id="hc-active"' + (c.is_active ? ' checked' : '') + '> <span>' + I.t('ad_is_active') + '</span></label>' +
      '<div class="adm-modal-footer">' +
      '<button type="button" class="btn btn-ghost" data-close-x>' + I.t('ad_cancel') + '</button>' +
      '<button type="button" class="btn btn-primary" id="hc-save">' + I.t('ad_save') + '</button>' +
      '</div>');

    m.back.querySelector('[data-close-x]').addEventListener('click', m.close);
    q('#hc-save', m.body).addEventListener('click', function () {
      var en = q('#hc-en', m.body).value.trim();
      var ar = q('#hc-ar', m.body).value.trim();
      if (!en || !ar) { UI.toast(I.t('ad_err_cat_name'), 'error'); return; }
      if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
      var btn = this;
      btn.disabled = true;
      var uploadedNow = []; /* Run 9: files uploaded in THIS attempt */

      function buildPayload(slug) {
        return {
          parent_id: null,
          name_en: en, name_ar: ar, slug: slug,
          display_order: parseInt(q('#hc-order', m.body).value, 10) || 0,
          is_active: q('#hc-active', m.body).checked,
          show_on_home: q('#hc-home', m.body).checked
        };
      }
      var op;
      if (isNew) {
        var slug = (q('#hc-slug', m.body).value.trim() || en).toLowerCase()
          .replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
        op = loadCategories().then(function (cats) {
          if (cats.some(function (x) { return x.slug === slug; })) {
            throw new Error(I.t('ad_err_cat_name') + ' (slug exists)');
          }
          return sb.from('categories').insert(buildPayload(slug)).select().single();
        });
      } else {
        op = sb.from('categories').update(buildPayload(c.slug)).eq('id', c.id).select().single();
      }

      op.then(function (r1) {
        if (r1.error) throw r1.error;
        var saved = r1.data;
        var fileInput = q('#hc-image', m.body);
        var file = fileInput && fileInput.files && fileInput.files[0];
        if (!file) return saved;
        return DB.admin.uploadImage('brand', 'categories', file).then(function (url) {
          if (!url) return saved;
          uploadedNow.push(url);
          return sb.from('categories').update({ image_url: url }).eq('id', saved.id)
            .then(function (r2) {
              if (r2.error) throw r2.error;
              /* New URL is live and referenced: now the previous image
                 is removed ONLY when no other row references it. */
              if (c.image_url && c.image_url !== url) {
                return DB.admin.removeIfUnreferenced(c.image_url);
              }
              return saved;
            });
        });
      }).then(function () {
        cache.categories = null; cache.products = null;
        UI.toast(I.t('ad_saved'), 'ok');
        m.close();
        onDone && onDone();
      }).catch(function (err) {
        /* Run 9: a failed save rolls back files uploaded during THIS
           attempt (reference-checked, so rows that did land survive). */
        if (uploadedNow.length) DB.admin.rollbackUploads(uploadedNow);
        btn.disabled = false;
        UI.toast(err.message || I.t('error_generic'), 'error');
      });
    });
  }

  /* ============================================================
     Run 12 — Content Management: Entry Promotion / Welcome Popup
  ============================================================ */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
      var r = Math.random() * 16 | 0;
      return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function renderPopupConfig(host) {
    loadSettingsAll(true).then(function (res) {
      var hp = res.homepage || {};
      var pop = {
        popup_enabled: hp.popup_enabled !== false && hp.popup_enabled === true,
        popup_mode: hp.popup_mode || 'both',
        popup_image_url: hp.popup_image_url || '',
        popup_title_en: hp.popup_title_en || '',
        popup_title_ar: hp.popup_title_ar || '',
        popup_subtitle_en: hp.popup_subtitle_en || '',
        popup_subtitle_ar: hp.popup_subtitle_ar || '',
        popup_description_en: hp.popup_description_en || '',
        popup_description_ar: hp.popup_description_ar || '',
        popup_discount_en: hp.popup_discount_en || '',
        popup_discount_ar: hp.popup_discount_ar || '',
        popup_cta_text_en: hp.popup_cta_text_en || '',
        popup_cta_text_ar: hp.popup_cta_text_ar || '',
        popup_cta_url: hp.popup_cta_url || '',
        popup_frequency: hp.popup_frequency || 'per_session',
        popup_delay_seconds: hp.popup_delay_seconds === undefined ? 3 : hp.popup_delay_seconds,
        popup_start_at: hp.popup_start_at || '',
        popup_end_at: hp.popup_end_at || '',
        popup_campaign_key: hp.popup_campaign_key || ''
      };

      host.innerHTML =
        '<div class="adm-card"><h2>' + I.t('ad_popup_title') + '</h2>' +
        '<p class="hint mt-1">' + I.t('ad_popup_hint') + '</p>' +
        '<div class="switch-row"><span>' + I.t('ad_popup_enable') + '</span>' +
        '<button type="button" class="switch' + (pop.popup_enabled ? ' on' : '') + '" id="pp-enabled" aria-label="' + I.t('ad_popup_enable') + '"></button></div>' +
        '<div class="adm-form-grid g3 mt-2">' +
        '<div class="field"><label>' + I.t('ad_popup_mode') + '</label><select class="input" id="pp-mode">' +
        '<option value="both"' + (pop.popup_mode === 'both' ? ' selected' : '') + '>' + I.t('ad_popup_mode_both') + '</option>' +
        '<option value="image"' + (pop.popup_mode === 'image' ? ' selected' : '') + '>' + I.t('ad_popup_mode_image') + '</option>' +
        '<option value="text"' + (pop.popup_mode === 'text' ? ' selected' : '') + '>' + I.t('ad_popup_mode_text') + '</option>' +
        '</select></div>' +
        '<div class="field"><label>' + I.t('ad_popup_frequency') + '</label><select class="input" id="pp-frequency">' +
        '<option value="every_visit"' + (pop.popup_frequency === 'every_visit' ? ' selected' : '') + '>' + I.t('ad_popup_freq_every') + '</option>' +
        '<option value="per_session"' + (pop.popup_frequency === 'per_session' ? ' selected' : '') + '>' + I.t('ad_popup_freq_session') + '</option>' +
        '<option value="per_day"' + (pop.popup_frequency === 'per_day' ? ' selected' : '') + '>' + I.t('ad_popup_freq_day') + '</option>' +
        '<option value="per_campaign"' + (pop.popup_frequency === 'per_campaign' ? ' selected' : '') + '>' + I.t('ad_popup_freq_campaign') + '</option>' +
        '</select></div>' +
        '<div class="field"><label>' + I.t('ad_popup_delay') + '</label><input class="input is-ltr" id="pp-delay" inputmode="numeric" value="' + esc(pop.popup_delay_seconds) + '"></div>' +
        '</div>' +
        '<div class="adm-form-grid g3">' +
        '<div class="field"><label>' + I.t('ad_popup_image') + '</label><input type="file" class="input" id="pp-image" accept="image/jpeg,image/png,image/webp,image/avif"></div>' +
        '<div class="field"><label>' + I.t('ad_popup_start') + '</label><input class="input is-ltr" type="datetime-local" id="pp-start" value="' + esc(isoToLocal(pop.popup_start_at)) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_popup_end') + '</label><input class="input is-ltr" type="datetime-local" id="pp-end" value="' + esc(isoToLocal(pop.popup_end_at)) + '"></div>' +
        '</div>' +
        (pop.popup_image_url ? '<div class="hc-current"><span class="adm-thumb"><img src="' + esc(pop.popup_image_url) + '" alt=""></span></div>' : '') +
        '<p class="hint">' + I.t('ad_popup_image_hint') + '</p>' +
        '<div class="adm-section-title">' + I.t('ad_popup_title_en') + ' / ' + I.t('ad_popup_title_ar') + '</div>' +
        '<div class="adm-form-grid g2">' +
        '<div class="field"><label>' + I.t('ad_popup_subtitle_en') + '</label><input class="input is-ltr" id="pp-sub-en" value="' + esc(pop.popup_subtitle_en) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_popup_subtitle_ar') + '</label><input class="input" id="pp-sub-ar" value="' + esc(pop.popup_subtitle_ar) + '" dir="rtl"></div>' +
        '<div class="field"><label>' + I.t('ad_popup_title_en') + '</label><input class="input is-ltr" id="pp-title-en" value="' + esc(pop.popup_title_en) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_popup_title_ar') + '</label><input class="input" id="pp-title-ar" value="' + esc(pop.popup_title_ar) + '" dir="rtl"></div>' +
        '<div class="field"><label>' + I.t('ad_popup_desc_en') + '</label><textarea class="input" id="pp-desc-en">' + esc(pop.popup_description_en) + '</textarea></div>' +
        '<div class="field"><label>' + I.t('ad_popup_desc_ar') + '</label><textarea class="input" id="pp-desc-ar" dir="rtl">' + esc(pop.popup_description_ar) + '</textarea></div>' +
        '<div class="field"><label>' + I.t('ad_popup_discount_en') + '</label><input class="input is-ltr" id="pp-disc-en" value="' + esc(pop.popup_discount_en) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_popup_discount_ar') + '</label><input class="input" id="pp-disc-ar" value="' + esc(pop.popup_discount_ar) + '" dir="rtl"></div>' +
        '<div class="field"><label>' + I.t('ad_popup_cta_text_en') + '</label><input class="input is-ltr" id="pp-cta-en" value="' + esc(pop.popup_cta_text_en) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_popup_cta_text_ar') + '</label><input class="input" id="pp-cta-ar" value="' + esc(pop.popup_cta_text_ar) + '" dir="rtl"></div>' +
        '<div class="field"><label>' + I.t('ad_popup_cta_url') + '</label><input class="input is-ltr" id="pp-cta-url" value="' + esc(pop.popup_cta_url) + '" placeholder="shop.html"></div>' +
        '</div>' +
        '<div class="adm-modal-footer" style="justify-content:flex-start">' +
        '<button type="button" class="btn btn-primary" id="pp-save">' + I.t('ad_save') + '</button>' +
        '<button type="button" class="btn btn-outline" id="pp-preview">' + I.t('ad_popup_preview') + '</button>' +
        '<button type="button" class="btn btn-ghost" id="pp-new-campaign">' + I.t('ad_popup_new_campaign') + '</button>' +
        '</div>' +
        '<p class="hint">' + I.t('ad_popup_new_campaign_hint') + '</p>' +
        '</div>' +
        '<div class="adm-card" id="pp-preview-card" hidden></div>';

      var readForm = function () {
        return {
          popup_enabled: q('#pp-enabled').classList.contains('on'),
          popup_mode: q('#pp-mode').value,
          popup_frequency: q('#pp-frequency').value,
          popup_delay_seconds: parseInt(q('#pp-delay').value, 10) || 0,
          popup_title_en: q('#pp-title-en').value.trim(),
          popup_title_ar: q('#pp-title-ar').value.trim(),
          popup_subtitle_en: q('#pp-sub-en').value.trim(),
          popup_subtitle_ar: q('#pp-sub-ar').value.trim(),
          popup_description_en: q('#pp-desc-en').value.trim(),
          popup_description_ar: q('#pp-desc-ar').value.trim(),
          popup_discount_en: q('#pp-disc-en').value.trim(),
          popup_discount_ar: q('#pp-disc-ar').value.trim(),
          popup_cta_text_en: q('#pp-cta-en').value.trim(),
          popup_cta_text_ar: q('#pp-cta-ar').value.trim(),
          popup_cta_url: q('#pp-cta-url').value.trim(),
          popup_start_at: localToIso(q('#pp-start').value),
          popup_end_at: localToIso(q('#pp-end').value),
          popup_image_url: pop.popup_image_url /* replaced when a file is chosen */
        };
      };

      q('#pp-enabled').addEventListener('click', function () { this.classList.toggle('on'); });
      q('#pp-preview').addEventListener('click', function () {
        var card = q('#pp-preview-card');
        var v = readForm();
        card.hidden = false;
        card.innerHTML = renderPopupPreviewHtml(v);
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      q('#pp-new-campaign').addEventListener('click', function () {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        UI.confirm({
          title: I.t('ad_popup_new_campaign'),
          text: I.t('ad_popup_new_campaign_hint'),
          okLabel: I.t('ad_save')
        }).then(function (ok) {
          if (!ok) return;
          sb.from('homepage_settings').update({ popup_campaign_key: uuid() }).eq('id', 1).then(function (r) {
            if (r.error) throw r.error;
            cache.homepage = null;
            UI.toast(I.t('ad_popup_saved'), 'ok');
          }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
        });
      });
      q('#pp-save').addEventListener('click', function () {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var v = readForm();
        if (v.popup_start_at && v.popup_end_at && new Date(v.popup_start_at) >= new Date(v.popup_end_at)) {
          UI.toast(I.t('ad_popup_err_dates'), 'error');
          return;
        }
        var btn = this;
        btn.disabled = true;
        var uploadedNow = [];
        var previousImage = pop.popup_image_url;
        var fileInput = q('#pp-image');
        var file = fileInput && fileInput.files && fileInput.files[0];
        var payload = Object.assign({}, v);
        delete payload.popup_image_url;

        var chain = Promise.resolve(pop.popup_image_url);
        if (file) {
          chain = DB.admin.uploadImage('brand', 'popup', file).then(function (url) {
            if (!url) throw new Error(I.t('error_generic'));
            uploadedNow.push(url);
            payload.popup_image_url = url;
            return url;
          });
        }
        chain.then(function () {
          return sb.from('homepage_settings').update(payload).eq('id', 1).select().single();
        }).then(function (r) {
          if (r.error) throw r.error;
          cache.homepage = null;
          var newUrl = payload.popup_image_url || previousImage;
          /* Replaced image removed ONLY when nothing else references it
             (storage-cleanup run protections). */
          if (file && previousImage && previousImage !== newUrl) {
            return DB.admin.removeIfUnreferenced(previousImage);
          }
        }).then(function () {
          UI.toast(I.t('ad_popup_saved'), 'ok');
          btn.disabled = false;
          renderPopupConfig(host);
        }).catch(function (err) {
          if (uploadedNow.length) DB.admin.rollbackUploads(uploadedNow);
          btn.disabled = false;
          UI.toast(err.message || I.t('error_generic'), 'error');
        });
      });

      /* Faithful re-rendering of the storefront popup (same structure
         and classes as UI.Popup's markup) using the CURRENT form
         values — clearly labelled as a preview. */
      function renderPopupPreviewHtml(v) {
        var hasImage = v.popup_mode !== 'text' && v.popup_image_url;
        var hasText = v.popup_mode !== 'image';
        return '<div class="flex-between mb-2"><h2 style="margin:0">' + I.t('ad_popup_preview') + '</h2>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="pp-preview-close">' + I.t('close') + '</button></div>' +
          '<p class="hint mb-2">' + I.t('ad_popup_preview_note') + '</p>' +
          '<div class="pp-preview-stage' + (I.lang === 'ar' ? ' rtl' : '') + '">' +
          '<div class="bb-popup' + (hasImage && hasText ? ' has-image' : '') + '" style="position:static;transform:none;opacity:1">' +
          '<button type="button" class="bb-popup-x icon-btn" aria-label="' + I.t('close') + '">' + UI.icon('x', 20) + '</button>' +
          (hasImage ? '<div class="bb-popup-media"><img src="' + esc(v.popup_image_url) + '" alt=""></div>' : '') +
          (hasText ? '<div class="bb-popup-body">' +
            (v.popup_subtitle_en || v.popup_subtitle_ar ? '<p class="overline">' + esc(I.lang === 'ar' ? (v.popup_subtitle_ar || v.popup_subtitle_en) : (v.popup_subtitle_en || v.popup_subtitle_ar)) + '</p>' : '') +
            (v.popup_title_en || v.popup_title_ar ? '<h2 class="display-2">' + esc(I.lang === 'ar' ? (v.popup_title_ar || v.popup_title_en) : (v.popup_title_en || v.popup_title_ar)) + '</h2>' : '') +
            (v.popup_description_en || v.popup_description_ar ? '<p class="bb-popup-desc">' + esc(I.lang === 'ar' ? (v.popup_description_ar || v.popup_description_en) : (v.popup_description_en || v.popup_description_ar)) + '</p>' : '') +
            (v.popup_discount_en || v.popup_discount_ar ? '<p class="bb-popup-discount">' + esc(I.lang === 'ar' ? (v.popup_discount_ar || v.popup_discount_en) : (v.popup_discount_en || v.popup_discount_ar)) + '</p>' : '') +
            (v.popup_cta_text_en || v.popup_cta_text_ar || v.popup_cta_url ? '<a class="btn btn-primary bb-popup-cta" href="javascript:void(0)">' +
              esc(I.lang === 'ar' ? (v.popup_cta_text_ar || v.popup_cta_text_en || I.t('banner_cta')) : (v.popup_cta_text_en || v.popup_cta_text_ar || I.t('banner_cta'))) + '</a>' : '') +
            '</div>' : '') +
          '</div></div>';
      }

      var wirePreview = function () {
        var x = q('#pp-preview-close');
        if (x) x.addEventListener('click', function () {
          q('#pp-preview-card').hidden = true;
          q('#pp-preview-card').innerHTML = '';
        });
      };
      wirePreview();
    }).catch(function (err) {
      host.innerHTML = '<div class="adm-card adm-danger"><p>' + esc(err.message || I.t('error_generic')) + '</p></div>';
    });
  }

  /* ============================================================
     Run 12 — Marketing: Wheel of Fortune (campaign + prizes)
     Probability rule enforced in the UI AND re-checked server-side by
     wheel_spin(): enabled prize probabilities must total EXACTLY 100%.
     Invalid totals are rejected — never normalized. Availability
     changes (limits reached / prizes disabled) require an explicit
     Review & Publish before spins resume.
  ============================================================ */
  /* Run 13: brand palette guaranteeing distinct segment colors — prizes
     saved with an empty color get a position-based palette tone instead
     (fix for the one-solid-color published wheel). */
  var WHEEL_PALETTE = ['#F72585', '#B5179E', '#7209B7', '#560BAD', '#F8E9F1', '#FFB3C6'];

  function wheelGradient(segs) {
    var tones = WHEEL_PALETTE;
    var stops = [], acc = 0;
    var step = 360 / segs.length;
    segs.forEach(function (s, i) {
      var c = s.color || tones[i % tones.length];
      stops.push(c + ' ' + acc.toFixed(2) + 'deg ' + (acc + step).toFixed(2) + 'deg');
      acc += step;
    });
    return 'conic-gradient(' + stops.join(', ') + ')';
  }

  /* Run 15: same seamless-segment rule as the storefront wheel (see
     main.js) — white lines only between identical adjacent colours, so
     the admin preview renders exactly what visitors will see. */
  function wheelDividers(segs) {
    var tones = ['#F72585', '#B5179E', '#7209B7', '#560BAD', '#F8E9F1', '#FFB3C6'];
    var n = segs.length, step = 360 / n;
    var html = '';
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var c1 = (segs[i].color || tones[i % tones.length]).toLowerCase();
      var c2 = (segs[j].color || tones[j % tones.length]).toLowerCase();
      if (c1 === c2) {
        html += '<div class="bb-wheel-line" style="transform:rotate(' + ((i + 1) * step).toFixed(2) + 'deg)" aria-hidden="true"></div>';
      }
    }
    return html;
  }

  /* Run 13: shared label sizing for preview + storefront parity — the
     width follows the segment's chord at the label radius, the font
     scales with segment count and text length (wraps, never ellipses). */
  function wheelLabelHtml(text, n, mid) {
    var maxW = Math.min(46, Math.round(63 * Math.sin(Math.PI / n)));
    var sizeCls = n > 8 ? ' lbl-9' : (n > 6 ? ' lbl-10' : '');
    text = String(text || '');
    if (text.length > 26) sizeCls += ' lbl-xs';
    else if (text.length > 16) sizeCls += ' lbl-sm';
    return '<span class="bb-wheel-label" style="transform:rotate(' + mid.toFixed(1) + 'deg)">' +
      '<b class="' + sizeCls.trim() + '" style="max-width:' + maxW + '%">' + esc(text) + '</b></span>';
  }

  function loadWheel(force) {
    if (state.preview) return Promise.resolve({ campaign: null, prizes: [], settings: null });
    if (cache.wheel && cache.wheel.prizes && !force) return Promise.resolve(cache.wheel);
    /* Run 13: also loads the order-spin settings singleton. */
    return Promise.all([
      sb.from('wheel_campaigns').select('*').order('created_at', { ascending: false }).limit(1),
      sb.from('wheel_settings').select('*').limit(1)
    ]).then(function (rs) {
      if (rs[0].error) throw rs[0].error;
      if (rs[1].error) throw rs[1].error;
      var campaign = (rs[0].data || [])[0] || null;
      var settings = (rs[1].data || [])[0] || null;
      if (!campaign) return { campaign: null, prizes: [], settings: settings };
      return sb.from('wheel_prizes').select('*').eq('campaign_id', campaign.id).order('position')
        .then(function (r2) {
          if (r2.error) throw r2.error;
          return { campaign: campaign, prizes: r2.data || [], settings: settings };
        });
    }).then(function (w) {
      cache.wheel = w;
      return w;
    });
  }

  function wheelProbSum(prizes) {
    return prizes.reduce(function (s, p) {
      return p.is_enabled && (p.max_awards === null || p.max_awards === undefined || Number(p.awards_granted || 0) < Number(p.max_awards))
        ? s + Number(p.probability || 0) : s;
    }, 0);
  }

  function renderWheel(host) {
    loadWheel(true).then(function (w) {
      var campaign = w.campaign;
      var prizes = (w.prizes || []).map(function (p) { return Object.assign({}, p); });
      var removedIds = [];
      var isNewCampaign = !campaign;

      /* Run 13: wheel state summary (quick enable/disable + status pill)
         and the independent order-based free-spin settings. */
      var settings = w.settings || {};
      var osEnabled = settings.order_spin_enabled === true;
      var osMin = (settings.order_spin_min_total === undefined || settings.order_spin_min_total === null)
        ? 0 : Number(settings.order_spin_min_total);
      var whState;
      if (campaign && campaign.status === 'enabled' && campaign.published_at) {
        whState = { txt: I.t('ad_wheel_state_live'), cls: 'pill-ok' };
      } else if (campaign && campaign.status === 'enabled') {
        whState = { txt: I.t('ad_wheel_state_enabled_np'), cls: 'pill-warn' };
      } else if (campaign && campaign.status === 'paused') {
        whState = { txt: I.t('ad_wheel_state_paused'), cls: 'pill-warn' };
      } else {
        whState = { txt: I.t('ad_wheel_state_disabled'), cls: 'pill-ink' };
      }

      host.innerHTML =
        '<div class="adm-card"><h2>' + I.t('ad_wheel_title') + '</h2>' +
        '<p class="hint mt-1">' + I.t('ad_wheel_hint') + '</p>' +
        '<div class="switch-row">' +
        '<div><b>' + I.t('ad_wheel_state') + '</b> <span class="pill ' + whState.cls + '">' + whState.txt + '</span>' +
        '<p class="hint mt-1" style="margin:0">' + I.t('ad_wheel_state_hint') + '</p></div>' +
        '<button type="button" class="switch' + (campaign && campaign.status === 'enabled' ? ' on' : '') + '" id="wh-enabled" aria-label="' + I.t('ad_wheel_state') + '"></button>' +
        '</div>' +
        '<div class="adm-form-grid g3 mt-2">' +
        '<div class="field"><label>' + I.t('ad_wheel_title_en') + '</label><input class="input is-ltr" id="wh-title-en" value="' + esc(campaign ? campaign.title_en : '') + '"></div>' +
        '<div class="field"><label>' + I.t('ad_wheel_title_ar') + '</label><input class="input" id="wh-title-ar" value="' + esc(campaign ? campaign.title_ar : '') + '" dir="rtl"></div>' +
        '<div class="field"><label>' + I.t('ad_wheel_status') + '</label><select class="input" id="wh-status">' +
        '<option value="disabled"' + (!campaign || campaign.status === 'disabled' ? ' selected' : '') + '>' + I.t('ad_wheel_status_disabled') + '</option>' +
        '<option value="paused"' + (campaign && campaign.status === 'paused' ? ' selected' : '') + '>' + I.t('ad_wheel_status_paused') + '</option>' +
        '<option value="enabled"' + (campaign && campaign.status === 'enabled' ? ' selected' : '') + '>' + I.t('ad_wheel_status_enabled') + '</option>' +
        '</select></div>' +
        '<div class="field"><label>' + I.t('ad_wheel_start') + '</label><input class="input is-ltr" type="datetime-local" id="wh-start" value="' + esc(isoToLocal(campaign ? campaign.start_at : null)) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_wheel_end') + '</label><input class="input is-ltr" type="datetime-local" id="wh-end" value="' + esc(isoToLocal(campaign ? campaign.end_at : null)) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_wheel_published_at') + '</label><input class="input" disabled value="' + (campaign && campaign.published_at ? isoToLocal(campaign.published_at) : '\u2014') + '"></div>' +
        '<div class="field"><label>' + I.t('ad_wheel_desc_en') + '</label><textarea class="input" id="wh-desc-en">' + esc(campaign ? campaign.description_en : '') + '</textarea></div>' +
        '<div class="field"><label>' + I.t('ad_wheel_desc_ar') + '</label><textarea class="input" id="wh-desc-ar" dir="rtl">' + esc(campaign ? campaign.description_ar : '') + '</textarea></div>' +
        '</div>' +
        '<div class="adm-form-grid g2">' +
        '<div class="field"><label>' + I.t('ad_wheel_instr_en') + '</label><textarea class="input" id="wh-instr-en">' + esc(campaign ? campaign.instructions_en : '') + '</textarea></div>' +
        '<div class="field"><label>' + I.t('ad_wheel_instr_ar') + '</label><textarea class="input" id="wh-instr-ar" dir="rtl">' + esc(campaign ? campaign.instructions_ar : '') + '</textarea></div>' +
        '</div></div>' +
        /* Run 13: order-based free-spin settings — independent control;
           disabling this NEVER disables the wheel itself. */
        '<div class="adm-card"><h2>' + I.t('ad_wof_title') + '</h2>' +
        '<p class="hint mt-1">' + I.t('ad_wof_hint') + '</p>' +
        '<div class="switch-row">' +
        '<div><b>' + I.t('ad_wof_enable') + '</b>' +
        '<p class="hint mt-1" style="margin:0">' + I.t('ad_wof_enable_hint') + '</p></div>' +
        '<button type="button" class="switch' + (osEnabled ? ' on' : '') + '" id="wof-enabled" aria-label="' + I.t('ad_wof_enable') + '"></button>' +
        '</div>' +
        '<div class="adm-form-grid g3 mt-2">' +
        '<div class="field"><label>' + I.t('ad_wof_threshold') + '</label>' +
        '<input class="input is-ltr" inputmode="decimal" id="wof-threshold" value="' + esc(String(osMin)) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_wof_amount_rule') + '</label>' +
        '<input class="input" disabled value="' + esc(I.t('ad_wof_amount_rule_value')) + '"></div>' +
        '<div class="field"><label>' + I.t('ad_wof_status') + '</label>' +
        '<input class="input" disabled id="wof-status-box" value="' + esc(osEnabled ? I.t('ad_wof_status_on') : I.t('ad_wof_status_off')) + '"></div>' +
        '</div>' +
        '<div class="row-actions mt-2"><button type="button" class="btn btn-primary btn-sm" id="wof-save">' + I.t('ad_save') + '</button>' +
        '<span class="hint">' + esc(I.t('ad_wof_once_note')) + '</span></div>' +
        '</div>' +
        '<div class="adm-card"><div class="flex-between mb-2"><h2 style="margin:0">' + I.t('ad_wheel_prizes') + '</h2>' +
        '<div class="row-actions">' +
        '<span id="wh-prob-badge"></span>' +
        '<button type="button" class="btn btn-outline btn-sm" id="wh-preview">' + I.t('ad_wheel_preview') + '</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="wh-publish">' + I.t('ad_wheel_publish') + '</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="wh-save">' + I.t('ad_save') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="wh-add">' + UI.icon('plus', 14) + I.t('ad_wheel_add_prize') + '</button>' +
        '</div></div>' +
        '<div id="wh-drift" class="adm-warn" hidden></div>' +
        '<div class="adm-table-wrap"><table class="adm-table wh-prizes"><thead><tr>' +
        '<th>' + I.t('ad_wheel_th_label') + '</th><th>' + I.t('ad_wheel_th_type') + '</th><th>' + I.t('ad_wheel_th_value') + '</th>' +
        '<th>' + I.t('ad_wheel_th_prob') + '</th><th>' + I.t('ad_wheel_th_limit') + '</th><th>' + I.t('ad_wheel_expiry') + '</th>' +
        '<th>' + I.t('ad_wheel_min_order') + '</th><th>' + I.t('ad_wheel_prefix') + '</th><th>' + I.t('ad_wheel_th_color') + '</th>' +
        '<th>' + I.t('ad_wheel_th_enabled') + '</th><th></th>' +
        '</tr></thead><tbody id="wh-prize-rows"></tbody></table></div>' +
        '<p class="hint mt-1">' + I.t('ad_wheel_max_awards_hint') + ' ' + I.t('ad_wheel_prob_err', { t: '' }).replace('\u2014 currently %.', '').replace('{t}', '') + '</p>' +
        '</div>' +
        '<div class="adm-card" id="wh-preview-card" hidden></div>';

      var tbody = q('#wh-prize-rows');

      function drawRows() {
        tbody.innerHTML = prizes.map(function (p, i) {
          return '<tr data-pi="' + i + '">' +
            '<td><div class="adm-form-grid g2 wh-compact">' +
            '<input class="input is-ltr" data-f="label_en" value="' + esc(p.label_en) + '" placeholder="EN">' +
            '<input class="input" data-f="label_ar" value="' + esc(p.label_ar) + '" dir="rtl" placeholder="AR">' +
            '<input class="input is-ltr" data-f="conditions_en" value="' + esc(p.conditions_en || '') + '" placeholder="' + I.t('ad_wheel_conditions_en') + '">' +
            '<input class="input" data-f="conditions_ar" value="' + esc(p.conditions_ar || '') + '" dir="rtl" placeholder="' + I.t('ad_wheel_conditions_ar') + '">' +
            '</div></td>' +
            '<td><select class="input" data-f="prize_type">' +
            ['percent_discount', 'fixed_discount', 'free_shipping', 'gift', 'none'].map(function (t) {
              return '<option value="' + t + '"' + (p.prize_type === t ? ' selected' : '') + '>' + I.t('ad_wheel_type_' + ({ percent_discount: 'percent', fixed_discount: 'fixed', free_shipping: 'free', gift: 'gift', none: 'none' }[t])) + '</option>';
            }).join('') + '</select></td>' +
            '<td><input class="input is-ltr wh-narrow" data-f="value" inputmode="decimal" value="' + esc(p.value) + '"></td>' +
            '<td><input class="input is-ltr wh-narrow" data-f="probability" inputmode="decimal" value="' + esc(p.probability) + '"></td>' +
            '<td><input class="input is-ltr wh-narrow" data-f="max_awards" inputmode="numeric" value="' + esc(p.max_awards === null || p.max_awards === undefined ? '' : p.max_awards) + '" placeholder="&infin;"></td>' +
            '<td><input class="input is-ltr wh-narrow" data-f="expiry_days" inputmode="numeric" value="' + esc(p.expiry_days === null || p.expiry_days === undefined ? '' : p.expiry_days) + '"></td>' +
            '<td><input class="input is-ltr wh-narrow" data-f="min_order_value" inputmode="decimal" value="' + esc(p.min_order_value) + '"></td>' +
            '<td><input class="input is-ltr wh-narrow" data-f="coupon_prefix" value="' + esc(p.coupon_prefix || 'BLUSH') + '"></td>' +
            '<td><input class="input wh-color" type="color" data-f="color" value="' + esc(p.color || '#F72585') + '"></td>' +
            '<td><button type="button" class="switch' + (p.is_enabled ? ' on' : '') + '" data-act="toggle"></button></td>' +
            '<td><div class="row-actions">' +
            '<button type="button" class="icon-sm" data-act="up" aria-label="' + I.t('ad_hcat_up') + '">' + UI.icon('chevUp', 14) + '</button>' +
            '<button type="button" class="icon-sm" data-act="down" aria-label="' + I.t('ad_hcat_down') + '">' + UI.icon('chevDown', 14) + '</button>' +
            '<button type="button" class="icon-sm" data-act="del" aria-label="' + I.t('ad_delete') + '">' + UI.icon('trash', 15) + '</button>' +
            '</div></td></tr>';
        }).join('');

        qa('[data-pi]', tbody).forEach(function (tr) {
          var i = Number(tr.dataset.pi);
          qa('[data-f]', tr).forEach(function (inp) {
            var f = inp.dataset.f;
            if (inp.type === 'checkbox') return;
            inp.addEventListener('change', function () {
              prizes[i][f] = (f === 'value' || f === 'probability' || f === 'min_order_value')
                ? (parseFloat(this.value) || 0)
                : (f === 'max_awards' || f === 'expiry_days')
                  ? (this.value.trim() === '' ? null : parseInt(this.value, 10))
                  : this.value;
              if (f === 'probability') prizes[i].probability = Math.min(100, Math.max(0, prizes[i].probability || 0));
              updateBadge();
            });
            if (inp.tagName === 'SELECT' || inp.type === 'color') {
              inp.addEventListener('input', function () {
                prizes[i][f] = this.value;
                updateBadge();
              });
            }
          });
          qa('[data-act]', tr).forEach(function (b) {
            b.addEventListener('click', function () {
              var act = b.dataset.act;
              if (act === 'toggle') {
                prizes[i].is_enabled = !prizes[i].is_enabled;
                b.classList.toggle('on', prizes[i].is_enabled);
                updateBadge();
              } else if (act === 'up' && i > 0) {
                var t = prizes[i]; prizes[i] = prizes[i - 1]; prizes[i - 1] = t; drawRows();
              } else if (act === 'down' && i < prizes.length - 1) {
                var t2 = prizes[i]; prizes[i] = prizes[i + 1]; prizes[i + 1] = t2; drawRows();
              } else if (act === 'del') {
                if (prizes[i].id) removedIds.push(prizes[i].id);
                prizes.splice(i, 1);
                drawRows();
              }
            });
          });
        });
        updateBadge();
      }

      function updateBadge() {
        var badge = q('#wh-prob-badge');
        if (!badge) return;
        var sum = Math.round(wheelProbSum(prizes) * 100) / 100;
        var ok = Math.abs(sum - 100) < 0.005;
        badge.outerHTML = '<span id="wh-prob-badge">' + pill(
          sum + '%',
          ok ? 'pill-ok' : 'pill-err'
        ) + '</span>';
        var drift = q('#wh-drift');
        if (drift) {
          var capacityChanged = prizes.some(function (p) {
            return p.is_enabled && p.max_awards !== null && p.max_awards !== undefined &&
              Number(p.awards_granted || 0) >= Number(p.max_awards);
          });
          drift.hidden = !(campaign && campaign.published_at && (!ok || capacityChanged));
          if (!drift.hidden) drift.textContent = I.t('ad_wheel_drift');
        }
      }

      function validate() {
        if (!q('#wh-title-en', host).value.trim()) { UI.toast(I.t('ad_wheel_err_title'), 'error'); return null; }
        for (var i = 0; i < prizes.length; i++) {
          var p = prizes[i];
          if (!String(p.label_en || '').trim()) { UI.toast(I.t('ad_wheel_err_prize_label'), 'error'); return null; }
          if (p.prize_type === 'percent_discount' && (Number(p.value) < 0 || Number(p.value) > 100)) {
            UI.toast(I.t('ad_wheel_err_value'), 'error'); return null;
          }
          if (p.prize_type === 'fixed_discount' && Number(p.value) < 0) {
            UI.toast(I.t('ad_wheel_err_value'), 'error'); return null;
          }
          if (p.is_enabled && (Number(p.probability) < 0 || Number(p.probability) > 100)) {
            UI.toast(I.t('ad_wheel_err_prob'), 'error'); return null;
          }
        }
        var sum = Math.round(wheelProbSum(prizes) * 100) / 100;
        if (prizes.length && Math.abs(sum - 100) >= 0.005) {
          UI.toast(I.t('ad_wheel_prob_err', { t: String(sum) }), 'error');
          return null;
        }
        return true;
      }

      function saveCampaign(extra) {
        var payload = {
          title_en: q('#wh-title-en', host).value.trim(),
          title_ar: q('#wh-title-ar', host).value.trim(),
          description_en: q('#wh-desc-en', host).value.trim(),
          description_ar: q('#wh-desc-ar', host).value.trim(),
          instructions_en: q('#wh-instr-en', host).value.trim(),
          instructions_ar: q('#wh-instr-ar', host).value.trim(),
          status: q('#wh-status', host).value,
          start_at: localToIso(q('#wh-start', host).value),
          end_at: localToIso(q('#wh-end', host).value)
        };
        if (payload.start_at && payload.end_at && new Date(payload.start_at) >= new Date(payload.end_at)) {
          UI.toast(I.t('ad_popup_err_dates'), 'error');
          return Promise.reject(new Error('dates'));
        }
        if (payload.start_at || payload.end_at) { /* window validated by the check above */ }
        if (extra && extra.publish) {
          payload.status = 'enabled';
          payload.published_at = new Date().toISOString();
        }
        /* Run 13: quick enable/disable — the configuration and prizes are
           never touched, so re-enabling restores the campaign as-is. */
        if (extra && extra.enable) {
          payload.status = 'enabled';
          if (!campaign || !campaign.published_at) payload.published_at = new Date().toISOString();
        }
        if (extra && extra.disable) {
          payload.status = 'disabled';
        }
        return (campaign
          ? sb.from('wheel_campaigns').update(payload).eq('id', campaign.id).select().single()
          : sb.from('wheel_campaigns').insert(payload).select().single()
        ).then(function (r) {
          if (r.error) throw r.error;
          campaign = r.data;
          isNewCampaign = false;
          return campaign;
        });
      }

      function savePrizes() {
        var chain = Promise.resolve();
        removedIds.forEach(function (id) {
          chain = chain.then(function () {
            return sb.from('wheel_prizes').delete().eq('id', id)
              .then(function (r) { if (r.error) throw r.error; });
          });
        });
        removedIds = [];
        prizes.forEach(function (p, i) {
          var row = {
            campaign_id: campaign.id,
            position: i,
            label_en: String(p.label_en || '').trim(),
            label_ar: String(p.label_ar || '').trim(),
            prize_type: p.prize_type,
            value: Number(p.value) || 0,
            probability: Math.min(100, Math.max(0, Number(p.probability) || 0)),
            max_awards: p.max_awards === null || p.max_awards === undefined || p.max_awards === '' ? null : parseInt(p.max_awards, 10),
            expiry_days: p.expiry_days === null || p.expiry_days === undefined || p.expiry_days === '' ? null : parseInt(p.expiry_days, 10),
            min_order_value: Number(p.min_order_value) || 0,
            conditions_en: String(p.conditions_en || '').trim(),
            conditions_ar: String(p.conditions_ar || '').trim(),
            coupon_prefix: String(p.coupon_prefix || 'BLUSH').trim(),
            /* Run 13: never store an empty color — the per-position brand
               palette keeps every segment distinct after publishing. */
            color: p.color || WHEEL_PALETTE[i % WHEEL_PALETTE.length],
            is_enabled: !!p.is_enabled
          };
          chain = chain.then(function () {
            var op = p.id
              ? sb.from('wheel_prizes').update(row).eq('id', p.id).select().single()
              : sb.from('wheel_prizes').insert(row).select().single();
            return op.then(function (r) {
              if (r.error) throw r.error;
              prizes[i] = Object.assign({}, r.data);
            });
          });
        });
        return chain;
      }

      q('#wh-add').addEventListener('click', function () {
        prizes.push({
          label_en: '', label_ar: '', prize_type: 'none', value: 0,
          probability: prizes.length ? 0 : 100, color: '',
          max_awards: null, awards_granted: 0, expiry_days: 30,
          min_order_value: 0, conditions_en: '', conditions_ar: '',
          coupon_prefix: 'BLUSH', is_enabled: true
        });
        drawRows();
      });
      q('#wh-save').addEventListener('click', function () {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        if (!validate()) return;
        var btn = this;
        btn.disabled = true;
        saveCampaign({}).then(savePrizes).then(function () {
          cache.wheel = null;
          UI.toast(I.t('ad_wheel_saved'), 'ok');
          renderWheel(host);
        }).catch(function (err) {
          btn.disabled = false;
          UI.toast(err.message || I.t('error_generic'), 'error');
        });
      });
      /* Run 13: server-backed enable/disable quick control. Disabling
         freezes spins WITHOUT deleting anything — wheel_spin() refuses
         non-enabled campaigns server-side, so the FAB and the modal are
         never the only guard. */
      q('#wh-enabled').addEventListener('click', function () {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        if (!campaign) { UI.toast(I.t('ad_wheel_err_nocampaign'), 'error'); return; }
        var btn = this;
        btn.disabled = true;
        var enabling = campaign.status !== 'enabled';
        saveCampaign(enabling ? { enable: true } : { disable: true }).then(function () {
          cache.wheel = null;
          UI.toast(I.t(enabling ? 'ad_wheel_enabled_toast' : 'ad_wheel_disabled_toast'), 'ok');
          renderWheel(host);
        }).catch(function (err) {
          btn.disabled = false;
          UI.toast(err.message || I.t('error_generic'), 'error');
        });
      });
      /* Run 13: order-based free-spin settings. The threshold and the
         switch live in wheel_settings and are enforced by the grant
         trigger at order-confirmation time. */
      q('#wof-enabled').addEventListener('click', function () {
        this.classList.toggle('on');
        var box = q('#wof-status-box');
        if (box) box.value = I.t(this.classList.contains('on') ? 'ad_wof_status_on' : 'ad_wof_status_off');
      });
      q('#wof-save').addEventListener('click', function () {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        var min = parseFloat(q('#wof-threshold').value);
        if (isNaN(min) || min < 0) { UI.toast(I.t('ad_wof_err_min'), 'error'); return; }
        var btn = this;
        btn.disabled = true;
        sb.from('wheel_settings').update({
          order_spin_enabled: q('#wof-enabled').classList.contains('on'),
          order_spin_min_total: Math.round(min * 100) / 100,
          updated_by: state.session && state.session.user ? state.session.user.id : null
        }).eq('id', true).select().single().then(function (r) {
          if (r.error) throw r.error;
          cache.wheel = null;
          UI.toast(I.t('ad_wof_saved'), 'ok');
          renderWheel(host);
        }).catch(function (err) {
          btn.disabled = false;
          UI.toast(err.message || I.t('error_generic'), 'error');
        });
      });
      q('#wh-publish').addEventListener('click', function () {
        if (state.preview) { UI.toast(I.t('ad_demo_readonly'), 'info'); return; }
        if (!validate()) return;
        var sum = Math.round(wheelProbSum(prizes) * 100) / 100;
        if (!prizes.length || Math.abs(sum - 100) >= 0.005) {
          UI.toast(I.t('ad_wheel_prob_err', { t: String(sum) }), 'error');
          return;
        }
        var btn = this;
        btn.disabled = true;
        saveCampaign({ publish: true }).then(savePrizes).then(function () {
          cache.wheel = null;
          UI.toast(I.t('ad_wheel_published'), 'ok');
          renderWheel(host);
        }).catch(function (err) {
          btn.disabled = false;
          UI.toast(err.message || I.t('error_generic'), 'error');
        });
      });
      q('#wh-preview').addEventListener('click', function () {
        var segs = prizes.filter(function (p) { return p.is_enabled; }).map(function (p) {
          return { color: p.color || '', label_en: p.label_en, label_ar: p.label_ar, position: prizes.indexOf(p) };
        });
        if (segs.length < 2) { UI.toast(I.t('ad_wheel_err_prize_label'), 'error'); return; }
        var card = q('#wh-preview-card');
        card.hidden = false;
        card.innerHTML =
          '<div class="flex-between mb-2"><h2 style="margin:0">' + I.t('ad_wheel_preview') + '</h2>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="wh-preview-close">' + I.t('close') + '</button></div>' +
          '<p class="hint mb-2">' + I.t('ad_wheel_preview_note') + '</p>' +
          '<div class="bb-wheel-stage bb-wheel-stage-admin">' +
          '<div class="bb-wheel-pointer">' + UI.icon('chevDown', 18) + '</div>' +
          '<div class="bb-wheel-disc bb-wheel-disc-admin" style="background:' + wheelGradient(segs) + '">' +
          '<div class="bb-wheel-lines" aria-hidden="true">' + wheelDividers(segs) + '</div>' +
          segs.map(function (s, i) {
            var seg = 360 / segs.length;
            var mid = i * seg + seg / 2;
            return wheelLabelHtml(I.lang === 'ar' ? (s.label_ar || s.label_en) : (s.label_en || s.label_ar), segs.length, mid);
          }).join('') +
          '</div></div>' +
          '<div class="adm-modal-footer" style="justify-content:center">' +
          '<button type="button" class="btn btn-primary" id="wh-preview-spin">' + I.t('wheel_spin') + '</button></div>';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        q('#wh-preview-close').addEventListener('click', function () {
          card.hidden = true; card.innerHTML = '';
        });
        q('#wh-preview-spin').addEventListener('click', function () {
          var disc = q('.bb-wheel-disc-admin', card);
          var idx = Math.floor(Math.random() * segs.length);
          var seg = 360 / segs.length;
          /* Run 13: same spin feel as the storefront (6 preview rotations
             in 4.6s; visual-only — never records a participation). */
          disc.style.transform = 'rotate(' + (360 * 6 + (360 - (idx * seg + seg / 2))).toFixed(2) + 'deg)';
          setTimeout(function () { UI.toast(I.t('ad_wheel_preview_note'), 'info'); }, 4600);
        });
      });

      drawRows();
    }).catch(function (err) {
      host.innerHTML = '<div class="adm-card adm-danger"><p>' + esc(err.message || I.t('error_generic')) + '</p></div>';
    });
  }

  /* ============================================================
     Run 12 — Marketing: Campaign Analytics
  ============================================================ */
  function renderWheelAnalytics(host) {
    if (state.preview) {
      host.innerHTML = '<div class="adm-card"><h2>' + I.t('ad_wa_title') + '</h2>' +
        '<p class="hint mt-1">' + I.t('ad_wa_hint') + '</p>' +
        '<p class="muted">' + I.t('ad_wa_offline') + '</p></div>';
      return;
    }
    Promise.all([
      sb.from('wheel_campaigns').select('*').order('created_at', { ascending: false }),
      sb.from('wheel_participations').select('*').order('created_at', { ascending: false }),
      sb.from('wheel_prizes').select('*'),
      sb.from('wheel_coupons').select('*'),
      /* Run 13: order-earned spin entitlements + the feature settings,
         so the dashboard also shows the configured threshold/status. */
      sb.from('wheel_order_entitlements').select('*').order('granted_at', { ascending: false }),
      sb.from('wheel_settings').select('*').limit(1)
    ]).then(function (res) {
      if (res[0].error) throw res[0].error;
      if (res[1].error) throw res[1].error;
      if (res[2].error) throw res[2].error;
      if (res[3].error) throw res[3].error;
      if (res[4].error) throw res[4].error;
      if (res[5].error) throw res[5].error;
      var campaigns = res[0].data || [];
      var participations = res[1].data || [];
      var prizes = res[2].data || [];
      var coupons = res[3].data || [];
      var entitlements = res[4].data || [];
      var osSettings = (res[5].data || [])[0] || {};
      var campById = {};
      campaigns.forEach(function (c) { campById[c.id] = c; });

      host.innerHTML =
        '<div class="adm-card"><h2>' + I.t('ad_wa_title') + '</h2>' +
        '<p class="hint mt-1">' + I.t('ad_wa_hint') + '</p>' +
        '<div class="adm-toolbar" style="margin-top:12px">' +
        '<span class="overline">' + I.t('ad_period') + '</span>' +
        '<input class="input" type="date" id="wa-from" aria-label="' + I.t('ad_wa_from') + '">' +
        '<input class="input" type="date" id="wa-to" aria-label="' + I.t('ad_wa_to') + '">' +
        '<button type="button" class="btn btn-sm btn-primary" id="wa-apply">' + I.t('ad_apply') + '</button>' +
        '</div><div id="wa-body"></div></div>';

      function inRange(iso) {
        var f = q('#wa-from').value ? new Date(q('#wa-from').value + 'T00:00:00') : null;
        var t = q('#wa-to').value ? new Date(q('#wa-to').value + 'T23:59:59') : null;
        var d = iso ? new Date(iso) : null;
        if (!d || isNaN(d.getTime())) return false;
        return (!f || d >= f) && (!t || d <= t);
      }

      function draw() {
        var spins = participations.filter(function (p) { return inRange(p.created_at); });
        var seen = {};
        spins.forEach(function (p) {
          var k = p.user_id ? 'u:' + p.user_id : 't:' + p.participant_token;
          seen[k] = true;
        });
        var awarded = spins.filter(function (p) {
          var snap = p.prize_snapshot || {};
          return snap.type && snap.type !== 'none';
        });
        var redeemed = coupons.filter(function (c) { return c.redeemed_at && inRange(c.redeemed_at); });
        var conversion = awarded.length ? Math.round((redeemed.length / awarded.length) * 100) : 0;
        /* Run 13: order-earned free-spin metrics. */
        var entGranted = entitlements.filter(function (e) { return inRange(e.granted_at); });
        var entUsed = entGranted.filter(function (e) { return !!e.consumed_at; });
        var entSpins = spins.filter(function (p) { return p.source === 'order_entitlement'; });
        var osOn = osSettings.order_spin_enabled === true;
        var osMin = osSettings.order_spin_min_total === undefined || osSettings.order_spin_min_total === null
          ? 0 : Number(osSettings.order_spin_min_total);

        var perPrize = prizes.map(function (pz) {
          var count = spins.filter(function (p) {
            return p.prize_id === pz.id || (p.prize_snapshot && p.prize_snapshot.prize_id === pz.id);
          }).length;
          var red = coupons.filter(function (c) { return c.prize_id === pz.id && c.redeemed_at; }).length;
          var limit = pz.max_awards;
          var remaining = limit === null || limit === undefined ? null : Math.max(0, Number(limit) - Number(pz.awards_granted || 0));
          return { label: I.lang === 'ar' ? (pz.label_ar || pz.label_en) : (pz.label_en || pz.label_ar), count: count, limit: limit, remaining: remaining, redeemed: red, enabled: pz.is_enabled };
        }).filter(function (r) { return r.count > 0 || r.redeemed > 0 || r.enabled; });

        q('#wa-body').innerHTML =
          '<div class="metric-grid" style="margin-top:14px">' +
          metric(I.t('ad_wa_spins'), String(spins.length), '', false) +
          metric(I.t('ad_wa_unique'), String(Object.keys(seen).length), '', false) +
          metric(I.t('ad_wa_redemptions'), String(redeemed.length), '', false) +
          metric(I.t('ad_wa_conversion'), conversion + '%', '', false) +
          metric(I.t('ad_wa_ent_granted'), String(entGranted.length),
            osOn ? I.t('ad_wa_wof_line', { m: I.fmtMoney(osMin) }) : I.t('ad_wa_wof_off'), false) +
          metric(I.t('ad_wa_ent_used'), String(entUsed.length),
            I.t('ad_wa_ent_spins', { n: entSpins.length }), false) +
          '</div>' +
          (perPrize.length
            ? '<div class="adm-table-wrap mt-2"><table class="adm-table"><thead><tr>' +
              '<th>' + I.t('ad_wa_th_prize') + '</th><th>' + I.t('ad_wa_th_awarded') + '</th><th>' + I.t('ad_wa_th_limit') + '</th>' +
              '<th>' + I.t('ad_wa_th_remaining') + '</th><th>' + I.t('ad_wa_th_redeemed') + '</th>' +
              '</tr></thead><tbody>' +
              perPrize.map(function (r) {
                return '<tr><td>' + esc(r.label || '\u2014') + '</td><td>' + r.count + '</td>' +
                  '<td>' + (r.limit === null || r.limit === undefined ? '\u221e' : r.limit) + '</td>' +
                  '<td>' + (r.remaining === null ? '\u221e' : r.remaining) + '</td>' +
                  '<td>' + r.redeemed + '</td></tr>';
              }).join('') + '</tbody></table></div>'
            : '<p class="muted mt-2">' + I.t('ad_wa_empty') + '</p>');
      }

      q('#wa-apply').addEventListener('click', draw);
      draw();
    }).catch(function (err) {
      host.innerHTML = '<div class="adm-card adm-danger"><p>' + esc(err.message || I.t('error_generic')) + '</p></div>';
    });
  }

  /* ============================================================
     Run 12 — Business Overview: Inventory Valuation + Gross Profit
     All numbers come from the inventory_valuation() security-definer
     RPC (server-side). Cost data is admin-only by design and is NEVER
     rendered on the storefront or through any public API.
  ============================================================ */
  var valState = { data: null, search: '', cat: 'all', sortKey: 'sku', sortDir: 1 };

  function loadValuation() {
    if (state.preview) return Promise.resolve(null);
    return DB.getInventoryValuation().then(function (data) {
      valState.data = data;
      return data;
    });
  }

  function valuationOffline(host, titleKey, hintKey) {
    host.innerHTML = '<div class="adm-card"><h2>' + I.t(titleKey) + '</h2>' +
      '<p class="hint mt-1">' + I.t(hintKey) + '</p>' +
      '<p class="muted">' + I.t('ad_val_offline') + '</p></div>';
  }

  function renderValuationView(host, titleKey, hintKey) {
    if (state.preview) return valuationOffline(host, titleKey, hintKey);
    host.innerHTML = '<div class="skel" style="height:120px"></div>';
    loadValuation().then(function (v) {
      if (!v) return valuationOffline(host, titleKey, hintKey);
      var totals = v.totals || {};
      var products = v.products || [];
      var missing = v.missing_cost || { count: 0, skus: [] };
      var excl = v.excluded || {};

      /* category filter options from the returned rows */
      var cats = {};
      products.forEach(function (p) {
        var name = I.lang === 'ar' ? (p.category_name_ar || p.category_name_en) : (p.category_name_en || p.category_name_ar);
        if (p.category_id && name) cats[p.category_id] = name;
      });

      host.innerHTML =
        '<div class="adm-card"><h2>' + I.t(titleKey) + '</h2>' +
        '<p class="hint mt-1">' + I.t(hintKey) + '</p>' +
        '<div class="metric-grid" style="margin-top:14px">' +
        metric(I.t('ad_val_cost'), money(totals.inventory_cost_value || 0), I.t('ad_val_note'), false) +
        metric(I.t('ad_val_retail'), money(totals.inventory_retail_value || 0), '', false) +
        metric(I.t('ad_val_profit'), money(totals.expected_gross_profit || 0),
          missing.count ? I.t('ad_val_missing', { n: missing.count }) : '', false) +
        metric(I.t('ad_val_margin'), (totals.expected_gross_margin_pct === null || totals.expected_gross_margin_pct === undefined) ? '\u2014' : totals.expected_gross_margin_pct + '%', '', false) +
        '</div>' +
        '<p class="hint mt-2">' + UI.icon('info', 13) + ' ' + I.t('ad_val_note') + '</p>' +
        '<p class="hint">' + UI.icon('info', 13) + ' ' + I.t('ad_val_excluded', { i: excl.inactive || 0, d: excl.demo || 0, o: excl.out_of_stock || 0 }) + '</p>' +
        '</div>' +

        (missing.count
          ? '<div class="adm-card adm-warn"><h2>' + I.t('ad_val_missing', { n: missing.count }) + '</h2>' +
            '<p class="hint mt-1">' + I.t('ad_val_missing_hint') + '</p>' +
            '<div class="row-actions mt-2">' +
            (missing.skus || []).slice(0, 12).map(function (sku) { return pill(sku, 'pill-err'); }).join(' ') +
            ((missing.skus || []).length > 12 ? pill('+' + (missing.skus.length - 12), '') : '') +
            '</div></div>'
          : '') +

        '<div class="adm-card">' +
        '<div class="adm-toolbar" style="margin-bottom:12px">' +
        '<input class="input" id="val-search" placeholder="' + I.t('ad_val_search') + '" value="' + esc(valState.search) + '">' +
        '<select class="input" id="val-cat"><option value="all">' + I.t('ad_val_cat_all') + '</option>' +
        Object.keys(cats).map(function (id) {
          return '<option value="' + esc(id) + '"' + (valState.cat === id ? ' selected' : '') + '>' + esc(cats[id]) + '</option>';
        }).join('') + '</select>' +
        '</div>' +
        '<div class="adm-table-wrap"><table class="adm-table" id="val-table"><thead><tr>' +
        valTh('sku', 'ad_sku') + valTh('name', 'ad_th_name') + valTh('quantity', 'ad_val_th_qty') +
        valTh('unit_cost', 'ad_val_th_cost') + valTh('unit_price', 'ad_val_th_price') +
        valTh('total_cost', 'ad_val_th_total_cost') + valTh('potential_revenue', 'ad_val_th_revenue') +
        valTh('expected_gross_profit', 'ad_val_th_profit') + '<th></th>' +
        '</tr></thead><tbody id="val-rows"></tbody></table></div>' +
        '</div>';

      function valTh(key, labelKey) {
        var arrow = valState.sortKey === key ? (valState.sortDir === 1 ? ' \u2191' : ' \u2193') : '';
        return '<th><button type="button" class="th-sort" data-sort="' + key + '">' + I.t(labelKey) + arrow + '</button></th>';
      }

      function rows() {
        var term = valState.search.toLowerCase();
        return products.filter(function (p) {
          if (valState.cat !== 'all' && p.category_id !== valState.cat) return false;
          if (!term) return true;
          return (String(p.sku || '') + ' ' + String(p.name_en || '') + ' ' + String(p.name_ar || '')).toLowerCase().indexOf(term) !== -1;
        }).sort(function (a, b) {
          var ka = a[valState.sortKey], kb = b[valState.sortKey];
          if (valState.sortKey === 'name') {
            ka = I.lang === 'ar' ? (a.name_ar || a.name_en) : (a.name_en || a.name_ar);
            kb = I.lang === 'ar' ? (b.name_ar || b.name_en) : (b.name_en || b.name_ar);
            return String(ka || '').localeCompare(String(kb || '')) * valState.sortDir;
          }
          if (ka === null || ka === undefined) return 1;
          if (kb === null || kb === undefined) return -1;
          return (Number(ka) - Number(kb)) * valState.sortDir;
        });
      }

      function drawRows() {
        q('#val-rows').innerHTML = rows().map(function (p) {
          var name = I.lang === 'ar' ? (p.name_ar || p.name_en) : (p.name_en || p.name_ar);
          return '<tr>' +
            '<td class="is-ltr">' + esc(p.sku) + '</td>' +
            '<td>' + esc(name) + '</td>' +
            '<td>' + p.quantity + '</td>' +
            '<td>' + (p.has_cost ? money(p.unit_cost) : '\u2014') + '</td>' +
            '<td>' + money(p.unit_price) + '</td>' +
            '<td>' + (p.has_cost ? money(p.total_cost) : '\u2014') + '</td>' +
            '<td>' + money(p.potential_revenue) + '</td>' +
            '<td>' + (p.has_cost ? money(p.expected_gross_profit) : '\u2014') + '</td>' +
            '<td><button type="button" class="icon-sm" data-cost="' + esc(p.product_id) + '" data-sku="' + esc(p.sku) + '" data-cur="' + esc(p.unit_cost === null ? '' : p.unit_cost) + '" aria-label="' + I.t('ad_val_edit_cost') + '">' + UI.icon('edit', 15) + '</button></td>' +
            '</tr>';
        }).join('') || '<tr><td colspan="9" class="muted">' + I.t('ad_val_empty') + '</td></tr>';
        qa('[data-cost]').forEach(function (b) {
          b.addEventListener('click', function () {
            UI.confirm({
              title: I.t('ad_val_edit_cost') + ' \u2014 ' + b.dataset.sku,
              text: I.t('ad_val_cost_prompt'),
              typeInput: true,
              typeText: b.dataset.cur || '',
              okLabel: I.t('ad_save')
            }).then(function (val) {
              if (val === null) return;
              var raw = String(val).trim();
              if (raw === '') {
                DB.admin.removeProductCost(b.dataset.cost).then(function () {
                  UI.toast(I.t('ad_val_cost_removed'), 'ok');
                  renderValuationView(host, titleKey, hintKey);
                }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
                return;
              }
              var cost = Number(raw);
              if (isNaN(cost) || cost < 0) { UI.toast(I.t('ad_val_cost_err'), 'error'); return; }
              DB.admin.saveProductCost(b.dataset.cost, cost).then(function () {
                UI.toast(I.t('ad_val_cost_saved'), 'ok');
                renderValuationView(host, titleKey, hintKey);
              }).catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
            });
          });
        });
      }

      function drawHead() {
        q('#val-table thead').innerHTML = '<tr>' +
          valTh('sku', 'ad_sku') + valTh('name', 'ad_th_name') + valTh('quantity', 'ad_val_th_qty') +
          valTh('unit_cost', 'ad_val_th_cost') + valTh('unit_price', 'ad_val_th_price') +
          valTh('total_cost', 'ad_val_th_total_cost') + valTh('potential_revenue', 'ad_val_th_revenue') +
          valTh('expected_gross_profit', 'ad_val_th_profit') + '<th></th>' +
          '</tr>';
        qa('[data-sort]').forEach(function (bb) {
          bb.addEventListener('click', function () {
            var k2 = bb.dataset.sort;
            if (valState.sortKey === k2) valState.sortDir = -valState.sortDir;
            else { valState.sortKey = k2; valState.sortDir = 1; }
            drawHead();
            drawRows();
          });
        });
      }

      drawHead();
      var searchEl = q('#val-search');
      searchEl.addEventListener('input', function () {
        valState.search = this.value;
        drawRows();
      });
      q('#val-cat').addEventListener('change', function () {
        valState.cat = this.value;
        drawRows();
      });
      drawRows();
    }).catch(function (err) {
      host.innerHTML = '<div class="adm-card adm-danger"><p>' + esc(I.t('ad_val_error', { msg: err.message || I.t('error_generic') })) + '</p></div>';
    });
  }

  function renderInventoryValuation(host) {
    renderValuationView(host, 'ad_val_title', 'ad_val_hint');
  }
  function renderGrossProfit(host) {
    renderValuationView(host, 'ad_gp_title', 'ad_gp_hint');
  }

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
        /* Storage-cleanup run: retry image-file cleanups that failed in
           earlier sessions (reference-checked again before each try). */
        DB.admin.retryPendingCleanups();
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
