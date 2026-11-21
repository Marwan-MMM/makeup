/* ============================================================
   Blush Beauty — supabase-client.js
   Single data layer for the whole site.

   mode 'supabase' — talks to Supabase (Postgres + Auth + Storage
                     + Edge Functions) using the PUBLIC anon key.
   mode 'demo'     — no backend configured: serves the local
                     placeholder catalog (demo-catalog.js) and
                     stores demo orders in localStorage, clearly
                     labelled in the UI.

   SECURITY NOTE: this file only ever uses the anon (public) key.
   The service-role key lives only inside Supabase (Edge Function
   environment) and is never present in frontend code.
   ============================================================ */
(function () {
  'use strict';

  var CFG = window.BLUSH_CONFIG || {};
  var URL = String(CFG.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  var KEY = String(CFG.SUPABASE_ANON_KEY || '').trim();
  var ORDER_FN = String(CFG.ORDER_FUNCTION || 'create-order');
  var BUCKET_PRODUCTS = CFG.BUCKET_PRODUCTS || 'products';
  var BUCKET_BRAND = CFG.BUCKET_BRAND || 'brand';

  var READY = /^https:\/\/.+/.test(URL) && KEY.length > 20 &&
    typeof window.supabase === 'object' && window.supabase &&
    typeof window.supabase.createClient === 'function';

  var client = null;
  if (READY) {
    client = window.supabase.createClient(URL, KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  }

  var MODE = client ? 'supabase' : 'demo';

  /* The gallery MUST be embedded in the product select: product photos
     live in the product_images table, so without this join every
     storefront card and the PDP would fall back to the initials
     placeholder even for fully photographed products. If a project's
     PostgREST schema cache cannot resolve the relationship yet, the
     FALLBACK_SELECT (no embed) keeps every product query working
     instead of failing whole pages. */
  var PRODUCT_SELECT = '*, images:product_images(id,product_id,url,alt,position), cat:categories!products_category_id_fkey(id,slug,name_en,name_ar,image_url), sub:categories!products_subcategory_id_fkey(id,slug,name_en,name_ar)';
  var FALLBACK_SELECT = '*, cat:categories!products_category_id_fkey(id,slug,name_en,name_ar,image_url), sub:categories!products_subcategory_id_fkey(id,slug,name_en,name_ar)';
  var imagesEmbedBroken = false;
  function isEmbedError(err) {
    var m = String((err && err.message) || '');
    return /relationship/i.test(m) || /PGRST200/i.test(m) ||
      /does not exist/i.test(m) || /42703/i.test(String((err && err.code) || ''));
  }
  function productsSelect() { return imagesEmbedBroken ? FALLBACK_SELECT : PRODUCT_SELECT; }
  function runProductsQuery(build) {
    /* build(selectString) -> promise; retries once without the image
       embed when the database cannot resolve it. */
    return build(productsSelect()).then(function (res) {
      if (res.error && !imagesEmbedBroken && isEmbedError(res.error)) {
        imagesEmbedBroken = true;
        return build(productsSelect());
      }
      return res;
    });
  }

  /* ----------------------------------------------------------------
     Demo vs production product IDs.
     Real Supabase products have UUID ids; the local demo catalog uses
     "demo-pXX" strings. Demo IDs must NEVER reach a UUID column, so
     every id-bearing lookup is routed here first.
  ---------------------------------------------------------------- */
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function isDemoId(id) {
    return !UUID_RE.test(String(id || ''));
  }
  function withDemoFlag(items) {
    return items.map(function (p) { return Object.assign(p, { demo: true }); });
  }
  function getDemoProductsByIds(ids) {
    var rows = demoFilter({ ids: ids, noLimit: true });
    return { items: withDemoFlag(rows.map(normalise)), total: rows.length };
  }

  /* ----------------------------------------------------------------
     Helpers
  ---------------------------------------------------------------- */
  function normalizePhone(phone) {
    return String(phone || '').replace(/[^0-9]/g, '');
  }

  function genUuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function liveDiscount(row) {
    if (!row) return false;
    if (!row.discount_active || row.discount_price === null || row.discount_price === undefined) return false;
    if (!(Number(row.discount_price) < Number(row.price))) return false;
    var now = Date.now();
    if (row.discount_starts_at && new Date(row.discount_starts_at).getTime() > now) return false;
    if (row.discount_ends_at && new Date(row.discount_ends_at).getTime() < now) return false;
    return true;
  }

  function normalise(row) {
    if (!row) return null;
    var onSale = liveDiscount(row);
    var price = Number(row.price) || 0;
    var finalPrice = onSale ? Number(row.discount_price) : price;
    var pct = onSale && price > 0 ? Math.round((1 - finalPrice / price) * 100) : 0;
    /* Embedded product_images rows arrive unordered: sort by their
       admin-defined position, then map to plain URLs. String entries
       (demo catalog) pass through in their given order. */
    var images = (row.images || []).slice().sort(function (a, b) {
      if (typeof a === 'string' || typeof b === 'string') return 0;
      return (Number(a && a.position) || 0) - (Number(b && b.position) || 0);
    }).map(function (im) {
      return typeof im === 'string' ? im : (im && im.url) || '';
    }).filter(Boolean);
    return {
      id: row.id,
      sku: row.sku,
      nameEn: row.name_en, nameAr: row.name_ar,
      descEn: row.description_en || '', descAr: row.description_ar || '',
      price: price, discountPrice: onSale ? Number(row.discount_price) : null,
      discountStarts: row.discount_starts_at || null,
      discountEnds: row.discount_ends_at || null,
      finalPrice: finalPrice, onSale: onSale, pct: pct,
      savings: onSale ? Math.round((price - finalPrice) * 100) / 100 : 0,
      stock: Number(row.stock) || 0,
      lowThreshold: Number(row.low_stock_threshold) || 5,
      active: !!row.is_active,
      featured: !!row.is_featured,
      bestseller: !!row.is_bestseller,
      sales: Number(row.sales_count) || 0,
      createdAt: row.created_at,
      images: images,
      categoryId: row.category_id,
      subcategoryId: row.subcategory_id,
      catSlug: row.cat && row.cat.slug,
      catNameEn: row.cat && row.cat.name_en,
      catNameAr: row.cat && row.cat.name_ar,
      subSlug: row.sub && row.sub.slug,
      subNameEn: row.sub && row.sub.name_en,
      subNameAr: row.sub && row.sub.name_ar
    };
  }

  function locName(p) { return I18N.lang === 'ar' ? (p.nameAr || p.nameEn) : (p.nameEn || p.nameAr); }
  function locDesc(p) { return I18N.lang === 'ar' ? (p.descAr || p.descEn) : (p.descEn || p.descAr); }

  /* ----------------------------------------------------------------
     Settings / homepage / banners
  ---------------------------------------------------------------- */
  var settingsCache = null, settingsAt = 0;
  function getSettings(opts) {
    opts = opts || {};
    if (MODE === 'demo') return Promise.resolve(Object.assign({}, DEMO.settings));
    if (!opts.fresh && settingsCache && Date.now() - settingsAt < 60000) {
      return Promise.resolve(Object.assign({}, settingsCache));
    }
    return client.from('site_settings').select('*').eq('id', 1).single()
      .then(function (res) {
        if (res.error) throw res.error;
        settingsCache = res.data;
        settingsAt = Date.now();
        return Object.assign({}, res.data);
      });
  }

  function getHomepage() {
    if (MODE === 'demo') return Promise.resolve(Object.assign({}, DEMO.homepage));
    return client.from('homepage_settings').select('*').eq('id', 1).single()
      .then(function (res) {
        if (res.error) throw res.error;
        return Object.assign({}, res.data);
      });
  }

  function getBanners() {
    if (MODE === 'demo') {
      return Promise.resolve(DEMO.banners.filter(function (b) { return b.is_active; }));
    }
    return client.from('banners').select('*').eq('is_active', true).order('display_order')
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      });
  }

  /* ----------------------------------------------------------------
     Categories
  ---------------------------------------------------------------- */
  var catsCache = null, catsAt = 0;
  function getCategories(opts) {
    opts = opts || {};
    if (MODE === 'demo') {
      var list = DEMO.categories.map(function (c) { return Object.assign({}, c); });
      if (opts.activeOnly !== false) list = list.filter(function (c) { return c.is_active; });
      return Promise.resolve(list);
    }
    if (!opts.fresh && !opts.admin && catsCache && Date.now() - catsAt < 60000) {
      return Promise.resolve(catsCache.map(function (c) { return Object.assign({}, c); }));
    }
    var q = client.from('categories').select('*').order('display_order').order('name_en');
    if (!opts.admin) q = q.eq('is_active', true);
    return q.then(function (res) {
      if (res.error) throw res.error;
      var data = res.data || [];
      if (!opts.admin) { catsCache = data; catsAt = Date.now(); }
      return data;
    });
  }

  /* ----------------------------------------------------------------
     Products
  ---------------------------------------------------------------- */
  function mapBySlug(cats) {
    var m = {};
    cats.forEach(function (c) { m[c.slug] = c; });
    return m;
  }

  /* Demo mode has no server-side join: attach category objects
     so normalise() produces the same shape as Supabase rows. */
  function demoJoin(rows) {
    var byId = {};
    DEMO.categories.forEach(function (c) { byId[c.id] = c; });
    return rows.map(function (p) {
      var copy = Object.assign({}, p);
      copy.cat = byId[p.category_id] || null;
      copy.sub = byId[p.subcategory_id] || null;
      return copy;
    });
  }

  function demoFilter(opts) {
    var cats = mapBySlug(DEMO.categories);
    var rows = DEMO.products.filter(function (p) { return p.is_active; });
    if (opts.ids && opts.ids.length) {
      rows = rows.filter(function (p) { return opts.ids.indexOf(p.id) !== -1; });
    }
    if (opts.category && cats[opts.category]) {
      var cid = cats[opts.category].id;
      rows = rows.filter(function (p) { return p.category_id === cid; });
    }
    if (opts.category === 'flash') rows = rows.filter(liveDiscount);
    if (opts.subcategory && cats[opts.subcategory]) {
      var sid = cats[opts.subcategory].id;
      rows = rows.filter(function (p) { return p.subcategory_id === sid; });
    }
    if (opts.q) {
      var q = opts.q.toLowerCase();
      rows = rows.filter(function (p) {
        return (p.name_en + ' ' + p.name_ar + ' ' + p.sku).toLowerCase().indexOf(q) !== -1;
      });
    }
    if (opts.min !== undefined && opts.min !== null && opts.min !== '') {
      rows = rows.filter(function (p) { return p.price >= Number(opts.min); });
    }
    if (opts.max !== undefined && opts.max !== null && opts.max !== '') {
      rows = rows.filter(function (p) { return p.price <= Number(opts.max); });
    }
    if (opts.inStock) rows = rows.filter(function (p) { return p.stock > 0; });
    if (opts.onSale) rows = rows.filter(liveDiscount);
    if (opts.featured) rows = rows.filter(function (p) { return p.is_featured; });
    if (opts.bestseller) rows = rows.filter(function (p) { return p.is_bestseller; });

    var sort = opts.sort || 'newest';
    rows = rows.slice();
    if (sort === 'price_asc') rows.sort(function (a, b) { return a.price - b.price; });
    else if (sort === 'price_desc') rows.sort(function (a, b) { return b.price - a.price; });
    else if (sort === 'best') rows.sort(function (a, b) { return b.sales_count - a.sales_count; });
    else rows.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });

    return demoJoin(rows);
  }

  function getProducts(opts) {
    opts = opts || {};
    if (MODE === 'demo') {
      var rows = demoFilter(opts);
      var total = rows.length;
      var offset = Number(opts.offset) || 0;
      var limit = Number(opts.limit) || 12;
      if (opts.noLimit) { offset = 0; limit = rows.length; }
      return Promise.resolve({
        items: rows.slice(offset, offset + limit).map(normalise),
        total: total
      });
    }

    /* ID lookups route demo ids to the local catalog and real UUIDs to
       the database — the two never appear in one SQL statement, so a
       stale demo cart/wishlist line can never trigger a Postgres
       "invalid input syntax for type uuid" error. */
    if (opts.ids && opts.ids.length) {
      var localIds = opts.ids.filter(isDemoId);
      var remoteIds = opts.ids.filter(function (id) { return !isDemoId(id); });
      var localRes = localIds.length ? getDemoProductsByIds(localIds) : { items: [], total: 0 };
      if (!remoteIds.length) return Promise.resolve(localRes);
      return getProducts(Object.assign({}, opts, { ids: null, remoteIds: remoteIds }))
        .then(function (res) {
          return { items: localRes.items.concat(res.items), total: localRes.total + res.total };
        });
    }

    function buildQuery(sel) {
      var q = client.from('products').select(sel, { count: 'exact' }).eq('is_active', true);
      if (opts.remoteIds && opts.remoteIds.length) q = q.in('id', opts.remoteIds);
      if (opts.category && opts.category !== 'flash') {
        var cats = mapBySlug(catsCache || []);
        var c = cats[opts.category];
        if (c) q = q.eq('category_id', c.id);
      }
      /* Flash sales are discounted products: filter server-side, then
         postProcess still applies the live discount window + sorting. */
      if (opts.category === 'flash' || opts.onSale) q = q.eq('discount_active', true);
      if (opts.subcategory) {
        var subs = mapBySlug((catsCache || []).filter(function (x) { return x.parent_id; }));
        var s = subs[opts.subcategory];
        if (s) q = q.eq('subcategory_id', s.id);
      }
      if (opts.q) {
        var like = '%' + opts.q + '%';
        q = q.or('name_en.ilike.' + like + ',name_ar.ilike.' + like + ',sku.ilike.' + like);
      }
      if (opts.min !== undefined && opts.min !== null && opts.min !== '') q = q.gte('price', Number(opts.min));
      if (opts.max !== undefined && opts.max !== null && opts.max !== '') q = q.lte('price', Number(opts.max));
      if (opts.inStock) q = q.gt('stock', 0);
      if (opts.featured) q = q.eq('is_featured', true);
      if (opts.bestseller) q = q.eq('is_bestseller', true);

      var sort = opts.sort || 'newest';
      if (sort === 'price_asc') q = q.order('price', { ascending: true });
      else if (sort === 'price_desc') q = q.order('price', { ascending: false });
      else if (sort === 'best') q = q.order('sales_count', { ascending: false });
      else q = q.order('created_at', { ascending: false });
      return q;
    }

    if (opts.noLimit) {
      return runProductsQuery(function (sel) {
        return buildQuery(sel).limit(500);
      }).then(function (res) {
        if (res.error) throw res.error;
        var items = postProcess(res.data || [], opts);
        /* IMPORTANT: always return the {items, total} shape — callers
           (homepage rows, cart, wishlist, checkout, search) all read
           res.items; a bare array here broke every product page in
           Supabase mode. */
        return { items: items, total: items.length };
      });
    }
    var limit = Number(opts.limit) || 12;
    var offset = Number(opts.offset) || 0;
    return runProductsQuery(function (sel) {
      return buildQuery(sel).range(offset, offset + limit - 1);
    }).then(function (res) {
      if (res.error) throw res.error;
      var items = postProcess(res.data || [], opts);
      return { items: items, total: res.count || items.length };
    });
  }

  function postProcess(rows, opts) {
    var items = rows.map(normalise);
    if (opts.onSale || opts.category === 'flash') {
      items = items.filter(function (p) { return p.onSale; });
      if (opts.category === 'flash' || (!opts.sort || opts.sort === 'newest')) {
        items.sort(function (a, b) { return b.pct - a.pct; });
      }
    }
    return items;
  }

  function ensureCats() {
    if (MODE === 'demo') return Promise.resolve();
    if (catsCache) return Promise.resolve();
    return getCategories().then(function () {});
  }

  function getProduct(id, opts) {
    opts = opts || {};
    if (MODE === 'demo') {
      var row = DEMO.findProduct(id);
      return Promise.resolve(row ? normalise(demoJoin([row])[0]) : null);
    }
    /* Demo ids (e.g. a link shared from demo mode) resolve from the
       local catalog — never sent to a UUID column. */
    if (isDemoId(id)) {
      var demoRow = DEMO.findProduct(id);
      return Promise.resolve(demoRow ? withDemoFlag([normalise(demoJoin([demoRow])[0])])[0] : null);
    }
    return ensureCats().then(function () {
      return runProductsQuery(function (sel) {
        var q = client.from('products').select(sel).eq('id', id);
        if (!opts.admin) q = q.eq('is_active', true);
        return q.maybeSingle();
      });
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data ? normalise(res.data) : null;
    });
  }

  function getRelated(product, limit) {
    limit = limit || 4;
    return getProducts({ limit: 24, noLimit: false }).then(function (res) {
      var items = res.items.filter(function (p) {
        return p.id !== product.id;
      });
      var sameSub = items.filter(function (p) { return p.subSlug && p.subSlug === product.subSlug; });
      var sameCat = items.filter(function (p) { return p.catSlug === product.catSlug && (!p.subSlug || p.subSlug !== product.subSlug); });
      var rest = items.filter(function (p) { return p.catSlug !== product.catSlug; });
      return sameSub.concat(sameCat).concat(rest).slice(0, limit);
    });
  }

  function getFeatured(limit) {
    return getProducts({ featured: true, limit: limit || 8, noLimit: true }).then(function (res) {
      return res.items.slice(0, limit || 8);
    });
  }
  function getBestsellers(limit) {
    return getProducts({ bestseller: true, limit: limit || 8, sort: 'best', noLimit: true }).then(function (res) {
      return res.items.slice(0, limit || 8);
    });
  }
  function getFlashSales(limit) {
    return getProducts({ category: 'flash', limit: limit || 8, noLimit: true }).then(function (res) {
      return res.items.slice(0, limit || 8);
    });
  }
  function search(qstr, limit) {
    return getProducts({ q: qstr, limit: limit || 6, noLimit: true }).then(function (res) {
      return res.items.slice(0, limit || 6);
    });
  }

  /* ----------------------------------------------------------------
     Product shades — variations of ONE product. Every shade has its
     own stock and its own independent image gallery
     (products -> product_shades -> product_shade_images).
  ---------------------------------------------------------------- */
  var shadesCache = {}; /* productId -> {list, at} (storefront only) */

  function mapShade(row) {
    var images = (row.images || []).map(function (im) {
      return typeof im === 'string' ? { url: im } : im;
    }).sort(function (a, b) { return (Number(a.position) || 0) - (Number(b.position) || 0); });
    return {
      id: row.id,
      productId: row.product_id,
      number: Number(row.shade_number) || 1,
      nameEn: row.shade_name_en || '',
      nameAr: row.shade_name_ar || '',
      stock: Number(row.stock_quantity) || 0,
      lowThreshold: Number(row.low_stock_threshold) || 5,
      active: !!row.is_active,
      order: Number(row.display_order) || 0,
      images: images
    };
  }

  function getShades(productId, opts) {
    opts = opts || {};
    if (MODE === 'demo') {
      var list = DEMO.findShades(productId).map(mapShade);
      return Promise.resolve(opts.admin ? list : list.filter(function (s) { return s.active; }));
    }
    if (!opts.admin && shadesCache[productId] && Date.now() - shadesCache[productId].at < 60000) {
      return Promise.resolve(shadesCache[productId].list.map(function (s) { return Object.assign({}, s, { images: s.images.slice() }); }));
    }
    return client.from('product_shades')
      .select('*, images:product_shade_images(*)')
      .eq('product_id', productId)
      .order('display_order').order('shade_number')
      .then(function (res) {
        if (res.error) throw res.error;
        var mapped = (res.data || []).map(mapShade);
        if (!opts.admin) {
          shadesCache[productId] = { list: mapped, at: Date.now() };
          return mapped.filter(function (s) { return s.active; })
            .map(function (s) { return Object.assign({}, s, { images: s.images.slice() }); });
        }
        return mapped;
      });
  }

  /* ----------------------------------------------------------------
     Orders
  ---------------------------------------------------------------- */
  function demoOrdersAll() { return DEMO.loadOrders(); }

  function createOrder(payload) {
    var items = payload.items || [];
    var cust = payload.customer || {};
    var method = payload.payment_method;

    if (MODE === 'demo') {
      var lines = [];
      var subtotal = 0;
      for (var i = 0; i < items.length; i++) {
        var p = DEMO.findProduct(items[i].product_id);
        if (!p || !p.is_active) {
          return Promise.reject(new Error('A product in your cart is no longer available.'));
        }
        var qty = Math.max(1, Math.min(99, Number(items[i].quantity) || 1));
        /* Shade-aware stock validation: for shaded lines only the
           selected shade's stock matters. */
        var shadeRow = null;
        if (items[i].shade_id) {
          shadeRow = DEMO.findShades(p.id).find(function (s) {
            return s.id === items[i].shade_id && s.is_active;
          });
          if (!shadeRow) {
            return Promise.reject(new Error('The selected shade is no longer available.'));
          }
          if (shadeRow.stock_quantity < qty) {
            return Promise.reject(new Error('Insufficient stock: ' + p.name_en));
          }
        } else if (p.stock < qty) {
          return Promise.reject(new Error('Insufficient stock: ' + p.name_en));
        }
        var unit = DEMO.unitPrice(p);
        var line = Math.round(unit * qty * 100) / 100;
        subtotal += line;
        lines.push({
          product_id: p.id,
          shade_id: shadeRow ? shadeRow.id : null,
          shade_number: shadeRow ? shadeRow.shade_number : null,
          shade_name_en: shadeRow ? shadeRow.shade_name_en : null,
          shade_name_ar: shadeRow ? shadeRow.shade_name_ar : null,
          shade_image_url: (shadeRow && shadeRow.images.length) ? shadeRow.images[0].url : null,
          product_name_en: p.name_en, product_name_ar: p.name_ar,
          sku: p.sku, unit_price: unit, quantity: qty, line_total: line
        });
      }
      subtotal = Math.round(subtotal * 100) / 100;
      var shipping = Number(DEMO.settings.shipping_fee) || 0;
      var phone = normalizePhone(cust.phone);
      if (!/^01[0125][0-9]{8}$/.test(phone)) {
        return Promise.reject(new Error('Invalid phone number.'));
      }
      var d = new Date();
      var num = 'BB-' + ('' + d.getFullYear()).slice(2) +
        String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
        '-' + String(Math.floor(1000 + Math.random() * 9000));
      var order = {
        id: 'demo-' + genUuid(),
        order_number: num,
        is_demo: true,
        status: 'pending',
        payment_method: method,
        payment_status: 'unpaid',
        payment_reference: method === 'cod' ? null : ('SIM-' + genUuid()),
        full_name: String(cust.full_name || '').trim(),
        phone: phone,
        email: String(cust.email || '').trim(),
        governorate: cust.governorate,
        city: cust.city,
        address: cust.address,
        delivery_instructions: cust.delivery_instructions || '',
        subtotal: subtotal,
        shipping_fee: shipping,
        total: Math.round((subtotal + shipping) * 100) / 100,
        created_at: new Date().toISOString(),
        items: lines
      };
      var all = demoOrdersAll();
      all.push(order);
      DEMO.saveOrders(all);
      return Promise.resolve(Object.assign({}, order));
    }

    var body = {
      items: items.map(function (it) {
        /* shade_id present only for shaded lines; the server re-validates
           that the shade belongs to the product and has enough stock. */
        var line = { product_id: it.product_id, quantity: Number(it.quantity) };
        if (it.shade_id) line.shade_id = it.shade_id;
        return line;
      }),
      customer: {
        full_name: cust.full_name, phone: normalizePhone(cust.phone),
        email: cust.email || '', governorate: cust.governorate,
        city: cust.city, address: cust.address,
        delivery_instructions: cust.delivery_instructions || ''
      },
      payment_method: method,
      client_request_id: payload.client_request_id || genUuid()
    };

    /* Primary path: the create-order Edge Function (service role stays server-side). */
    return fetch(URL + '/functions/v1/' + ORDER_FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': KEY,
        'Authorization': 'Bearer ' + KEY
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 404 || res.status === 401) {
        /* Edge Function not deployed — fall back to the protected
           create_order database function directly. */
        return client.rpc('create_order', {
          p_items: body.items,
          p_customer: body.customer,
          p_payment_method: body.payment_method,
          p_client_request_id: body.client_request_id
        }).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          return r.data;
        });
      }
      return res.json().then(function (json) {
        if (!res.ok) throw new Error(json && json.error ? json.error : 'Order failed');
        return json.order || json;
      });
    }).catch(function (err) {
      /* Network-level failure of the fetch itself: try the RPC path. */
      if (err instanceof TypeError) {
        return client.rpc('create_order', {
          p_items: body.items,
          p_customer: body.customer,
          p_payment_method: body.payment_method,
          p_client_request_id: body.client_request_id
        }).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          return r.data;
        });
      }
      throw err;
    });
  }

  function trackOrder(orderNumber, phone) {
    var num = String(orderNumber || '').trim().toUpperCase();
    var ph = normalizePhone(phone);
    if (!num || ph.length < 6) return Promise.resolve(null);

    if (MODE === 'demo') {
      var found = demoOrdersAll().find(function (o) {
        return o.order_number.toUpperCase() === num && o.phone === ph;
      });
      return Promise.resolve(found ? sanitizeOrder(found) : null);
    }
    return client.rpc('track_order', { p_order_number: num, p_phone: ph }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || null;
    });
  }

  function sanitizeOrder(o) {
    /* Never expose email or payment tokens through tracking. */
    return {
      order_number: o.order_number,
      status: o.status,
      payment_method: o.payment_method,
      payment_status: o.payment_status,
      full_name: o.full_name,
      phone: o.phone,
      governorate: o.governorate,
      city: o.city,
      address: o.address,
      delivery_instructions: o.delivery_instructions || '',
      subtotal: o.subtotal, shipping_fee: o.shipping_fee, total: o.total,
      created_at: o.created_at,
      items: o.items
    };
  }

  function confirmSimulatedPayment(orderNumber, token) {
    if (MODE === 'demo') {
      var orders = demoOrdersAll();
      var o = orders.find(function (x) {
        return x.order_number.toUpperCase() === String(orderNumber).toUpperCase();
      });
      if (!o) return Promise.reject(new Error('Order not found.'));
      if (o.payment_method === 'cod') return Promise.reject(new Error('This order is cash on delivery.'));
      if (o.payment_status !== 'unpaid') return Promise.reject(new Error('Payment already processed.'));
      if (!o.payment_reference || o.payment_reference !== token) {
        return Promise.reject(new Error('Invalid payment token.'));
      }
      o.payment_status = 'paid';
      DEMO.saveOrders(orders);
      return Promise.resolve({ ok: true });
    }
    return client.rpc('confirm_simulated_payment', {
      p_order_number: String(orderNumber).trim(),
      p_token: token
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      return res.data;
    });
  }

  /* ----------------------------------------------------------------
     Admin helpers (all writes pass through Supabase RLS policies;
     only accounts present in admin_users may modify data).
  ---------------------------------------------------------------- */
  var adminApi = {
    signIn: function (email, password) {
      if (MODE === 'demo') return Promise.reject(new Error('demo'));
      return client.auth.signInWithPassword({ email: email, password: password });
    },
    signOut: function () {
      if (MODE === 'demo') return Promise.resolve();
      return client.auth.signOut();
    },
    getSession: function () {
      if (MODE === 'demo') return Promise.resolve(null);
      return client.auth.getSession().then(function (res) {
        return res.data && res.data.session ? res.data.session : null;
      });
    },
    amIAdmin: function () {
      if (MODE === 'demo') return Promise.resolve(false);
      return client.rpc('am_i_admin').then(function (res) {
        if (res.error) return false;
        return !!res.data;
      });
    },
    getClient: function () { return client; },
    uploadImage: function (bucket, folder, file, allowedTypes, maxMB) {
      allowedTypes = allowedTypes || ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
      maxMB = maxMB || 5;
      if (allowedTypes.indexOf(file.type) === -1) {
        return Promise.reject(new Error('Unsupported file type: ' + file.type));
      }
      if (file.size > maxMB * 1024 * 1024) {
        return Promise.reject(new Error('File is larger than ' + maxMB + ' MB.'));
      }
      var safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80);
      var path = (folder ? folder + '/' : '') + Date.now() + '-' + safe;
      return client.storage.from(bucket).upload(path, file, {
        contentType: file.type, upsert: false
      }).then(function (res) {
        if (res.error) throw res.error;
        var pub = client.storage.from(bucket).getPublicUrl(path);
        return pub.data && pub.data.publicUrl ? pub.data.publicUrl : null;
      });
    },
    deleteImage: function (publicUrl) {
      try {
        var m = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(publicUrl);
        if (!m) return Promise.resolve();
        return client.storage.from(m[1]).remove([m[2]]);
      } catch (e) { return Promise.resolve(); }
    },
    setOrderStatus: function (orderId, status) {
      return client.rpc('admin_set_order_status', { p_order_id: orderId, p_status: status });
    },
    adjustStock: function (productId, change, notes, shadeId) {
      var args = { p_product_id: productId, p_change: change, p_notes: notes || null };
      if (shadeId) args.p_shade_id = shadeId;
      return client.rpc('admin_adjust_stock', args);
    },
    cleanupPreview: function () {
      return client.rpc('cleanup_demo_preview');
    },
    cleanupRun: function () {
      return client.rpc('cleanup_demo_data');
    }
  };

  /* Public interface */
  window.DB = {
    get mode() { return MODE; },
    get ready() { return !!client; },
    getClient: function () { return client; },
    getSettings: getSettings,
    getHomepage: getHomepage,
    getBanners: getBanners,
    getCategories: getCategories,
    getProducts: getProducts,
    getProduct: getProduct,
    getRelated: getRelated,
    getFeatured: getFeatured,
    getBestsellers: getBestsellers,
    getFlashSales: getFlashSales,
    search: search,
    getShades: getShades,
    isDemoId: isDemoId,
    createOrder: createOrder,
    trackOrder: trackOrder,
    confirmSimulatedPayment: confirmSimulatedPayment,
    normalizePhone: normalizePhone,
    admin: adminApi,

    /* localisation-aware accessors used by all pages */
    locName: locName,
    locDesc: locDesc,
    liveDiscount: liveDiscount
  };
})();
