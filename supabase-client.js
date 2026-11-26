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
  var PRODUCT_SELECT = '*, images:product_images(id,product_id,url,alt,position), shades:product_shades(id,product_id,shade_number,shade_name_en,shade_name_ar,stock_quantity,low_stock_threshold,price,is_active,display_order), cat:categories!products_category_id_fkey(id,slug,name_en,name_ar,image_url), sub:categories!products_subcategory_id_fkey(id,slug,name_en,name_ar)';
  var FALLBACK_SELECT = '*, shades:product_shades(id,product_id,shade_number,shade_name_en,shade_name_ar,stock_quantity,low_stock_threshold,price,is_active,display_order), cat:categories!products_category_id_fkey(id,slug,name_en,name_ar,image_url), sub:categories!products_subcategory_id_fkey(id,slug,name_en,name_ar)';
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
    /* Embedded product_shades rows (product cards show shade
       quick-picks): keep only active shades in admin display order.
       The PDP keeps using getShades(), which also loads each shade's
       own gallery. */
    var shades = (row.shades || []).filter(function (s) {
      return s && s.is_active !== false;
    }).sort(function (a, b) {
      return (Number(a && a.display_order) || 0) - (Number(b && b.display_order) || 0);
    }).map(function (s) {
      return {
        id: s.id,
        number: Number(s.shade_number) || 0,
        nameEn: s.shade_name_en || '',
        nameAr: s.shade_name_ar || '',
        stock: Number(s.stock_quantity) || 0,
        price: (s.price === null || s.price === undefined || s.price === '') ? null : Number(s.price),
        lowThreshold: Number(s.low_stock_threshold) || 5
      };
    });
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
      flash: !!row.is_flash_sale,
      sales: Number(row.sales_count) || 0,
      createdAt: row.created_at,
      images: images,
      shades: shades,
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
     Individual shade pricing (product_shades.price, migration).
     Rule: a shade's own DB price IS the selling price for that shade —
     the product-level discount never stacks on top of it, so nothing
     is ever discounted twice. Shades without an individual price
     follow the product's live-discount logic exactly as before.
     The storefront never invents prices: cart/checkout lines resolve
     through here and orders re-validate server-side in create_order().
  ---------------------------------------------------------------- */
  function shadePriceOverride(p, shade) {
    return !!(shade && shade.price !== null && shade.price !== undefined);
  }
  function shadeUnitPrice(p, shade) {
    if (shadePriceOverride(p, shade)) return Number(shade.price);
    if (p.finalPrice !== undefined && p.finalPrice !== null) return p.finalPrice;
    /* Raw rows (demo catalog, admin previews) carry no normalised
       finalPrice: apply the same live-discount rule from base fields
       so order totals can never become NaN. */
    return liveDiscount(p) && Number(p.discount_price) < Number(p.price)
      ? Number(p.discount_price)
      : Number(p.price);
  }
  function shadeBasePrice(p, shade) {
    if (shadePriceOverride(p, shade)) return Number(shade.price);
    return p.price;
  }
  /* Prices appear inside shade buttons only when individual shade
     pricing is in effect AND the shades' selling prices differ. */
  function shadePricesDiffer(p) {
    var shades = p.shades || [];
    if (!shades.length) return false;
    var hasIndividual = shades.some(function (s) {
      return s.price !== null && s.price !== undefined;
    });
    if (!hasIndividual) return false;
    var first = shadeUnitPrice(p, shades[0]);
    return shades.some(function (s) { return shadeUnitPrice(p, s) !== first; });
  }
  /* Display gate for shade buttons/card chips: prices differ AND the
     Store Configuration switch allows showing them. Charging is NEVER
     gated by this — orders always use the shade's real DB price. */
  function shadePriceDisplay(p) {
    return shadePricesVisible && shadePricesDiffer(p);
  }

  /* ----------------------------------------------------------------
     Settings / homepage / banners
  ---------------------------------------------------------------- */
  var settingsCache = null, settingsAt = 0;
  /* Store-configuration switch "Show Individual Shade Prices"
     (site_settings.show_shade_prices). It ONLY controls the visibility
     of prices inside shade buttons/cards — it never changes the actual
     selling price, which always comes from the shade/product data. */
  var shadePricesVisible = true;
  function getSettings(opts) {
    opts = opts || {};
    if (MODE === 'demo') {
      shadePricesVisible = DEMO.settings.show_shade_prices !== false;
      return Promise.resolve(Object.assign({}, DEMO.settings));
    }
    if (!opts.fresh && settingsCache && Date.now() - settingsAt < 60000) {
      return Promise.resolve(Object.assign({}, settingsCache));
    }
    return client.from('site_settings').select('*').eq('id', 1).single()
      .then(function (res) {
        if (res.error) throw res.error;
        settingsCache = res.data;
        settingsAt = Date.now();
        shadePricesVisible = res.data.show_shade_prices !== false;
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
      /* Demo shade rows share the database column names, so normalise()
         maps them identically and demo cards show shade quick-picks. */
      copy.shades = DEMO.findShades(p.id) || [];
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
    if (opts.category === 'flash') rows = rows.filter(function (p) { return p.is_flash_sale && liveDiscount(p); });
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
    if (opts.inStock) {
      rows = rows.filter(function (p) {
        return p.stock > 0 || DEMO.findShades(p.id).some(function (s) {
          return s.is_active && s.stock_quantity > 0;
        });
      });
    }
    if (opts.onSale) rows = rows.filter(liveDiscount);
    if (opts.featured) rows = rows.filter(function (p) { return p.is_featured; });
    if (opts.bestseller) rows = rows.filter(function (p) { return p.is_bestseller; });

    /* Effective price: mirrors shop_product_ids() — the live-discount
       price, or the lowest PURCHASABLE shade price, whichever is lower. */
    function demoEffPrice(p) {
      var base = liveDiscount(p) ? Number(p.discount_price) : Number(p.price);
      var purchasable = DEMO.findShades(p.id).filter(function (sh) {
        return sh.is_active && sh.price !== null && sh.price !== undefined && sh.stock_quantity > 0;
      });
      if (purchasable.length) {
        var minShade = Math.min.apply(null, purchasable.map(function (sh) { return Number(sh.price); }));
        if (minShade < base) return minShade;
      }
      return base;
    }
    if ((opts.min !== undefined && opts.min !== null && opts.min !== '') ||
        (opts.max !== undefined && opts.max !== null && opts.max !== '')) {
      rows = rows.filter(function (p) {
        var eff = demoEffPrice(p);
        if (opts.min !== undefined && opts.min !== null && opts.min !== '' && eff < Number(opts.min)) return false;
        if (opts.max !== undefined && opts.max !== null && opts.max !== '' && eff > Number(opts.max)) return false;
        return true;
      });
    }

    var sort = opts.sort || 'newest';
    rows = rows.slice();
    if (sort === 'price_asc') rows.sort(function (a, b) { return demoEffPrice(a) - demoEffPrice(b); });
    else if (sort === 'price_desc') rows.sort(function (a, b) { return demoEffPrice(b) - demoEffPrice(a); });
    else if (sort === 'best') rows.sort(function (a, b) { return (b.sales_count || 0) - (a.sales_count || 0) || new Date(b.created_at || 0) - new Date(a.created_at || 0); });
    else rows.sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });

    return demoJoin(rows);
  }

  function getProducts(opts) {
    opts = opts || {};
    /* Shop page: the search / filter / sort / pagination pipeline runs
       SERVER-SIDE in shop_product_ids() over the COMPLETE dataset, so
       price sorting uses the effective selling price (live product
       discount or the lowest purchasable shade price) and Best Selling
       uses real maintained sales counts — never just the loaded page.
       The RPC returns the ordered page of product IDs + the total; the
       rows are then fetched through the normal ids path (which keeps
       the image/shade/category embeds and the demo-id routing) and
       reordered to the server's order. If the RPC is missing (database
       not yet migrated) the legacy direct-query path runs unchanged. */
    if (opts.shopQuery && MODE !== 'demo') {
      return client.rpc('shop_product_ids', {
        p: {
          category: opts.category || null, subcategory: opts.subcategory || null,
          q: opts.q || null, min: (opts.min !== undefined && opts.min !== null && opts.min !== '') ? String(opts.min) : null,
          max: (opts.max !== undefined && opts.max !== null && opts.max !== '') ? String(opts.max) : null,
          inStock: !!opts.inStock, onSale: !!opts.onSale, sort: opts.sort || 'newest',
          limit: Number(opts.limit) || 12, offset: Number(opts.offset) || 0
        }
      }).then(function (res) {
        if (res.error || !res.data || !Array.isArray(res.data.ids)) throw new Error('rpc-missing');
        var pageIds = res.data.ids;
        var total = Number(res.data.total) || 0;
        if (!pageIds.length) return { items: [], total: total };
        return getProducts({ ids: pageIds, noLimit: true }).then(function (rows) {
          var byId = {};
          rows.items.forEach(function (p) { byId[p.id] = p; });
          return {
            items: pageIds.map(function (id) { return byId[id]; }).filter(Boolean),
            total: total
          };
        });
      }).catch(function (err) {
        if (/rpc-missing|function public.shop_product_ids|404|PGRST202/i.test(err.message || String(err))) {
          /* Database not migrated yet: fall back to the legacy query. */
          return getProducts(Object.assign({}, opts, { shopQuery: false }));
        }
        throw err;
      });
    }
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
      /* Flash sales: the admin Flash Sale flag AND a live discount.
         postProcess still applies the live discount window + sorting. */
      if (opts.category === 'flash') q = q.eq('is_flash_sale', true);
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
      items = items.filter(function (p) {
        return p.onSale && (opts.category !== 'flash' || p.flash);
      });
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
      /* Individual shade price (migration: product_shades.price).
         null = the shade inherits the main product price. */
      price: (row.price === null || row.price === undefined || row.price === '') ? null : Number(row.price),
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
        var unit = shadeUnitPrice(p, shadeRow);
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
      /* Mandatory 50% deposit — same rule as the database function:
         computed here from the final total, never taken from the
         browser; the proof path is required (checkout blocks submission
         without one). */
      var proof = String((payload.payment && payload.payment.proof_path) || '').trim();
      if (!proof) {
        return Promise.reject(new Error('A payment screenshot is required: pay the 50% deposit via InstaPay and upload the transfer screenshot.'));
      }
      var total = Math.round((subtotal + shipping) * 100) / 100;
      var deposit = Math.round(total / 2 * 100) / 100;
      var order = {
        id: 'demo-' + genUuid(),
        order_number: num,
        is_demo: true,
        status: 'pending',
        payment_method: method,
        payment_status: 'unpaid',
        payment_reference: method === 'cod' ? null : ('SIM-' + genUuid()),
        deposit_required: true,
        deposit_amount: deposit,
        deposit_method: 'instapay',
        deposit_status: 'awaiting_verification',
        deposit_proof_path: proof,
        deposit_submitted_at: new Date().toISOString(),
        deposit_verified_at: null,
        deposit_rejection_reason: '',
        remaining_amount: Math.round((total - deposit) * 100) / 100,
        remaining_status: 'outstanding',
        remaining_proof_path: '',
        remaining_rejection_reason: '',
        full_name: String(cust.full_name || '').trim(),
        phone: phone,
        email: String(cust.email || '').trim(),
        governorate: cust.governorate,
        city: cust.city,
        address: cust.address,
        delivery_instructions: cust.delivery_instructions || '',
        subtotal: subtotal,
        shipping_fee: shipping,
        total: total,
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
      /* Optional wheel coupon code (Run 12). The server validates and
         consumes it; the browser-supplied code is only a lookup key —
         the discount itself is recomputed server-side. */
      coupon_code: String((payload.coupon_code || '')).trim() || undefined,
      /* Mandatory InstaPay deposit screenshot path (private bucket).
         The server verifies the object exists and computes the deposit
         amount itself — the browser never sends amounts. */
      payment: { proof_path: String((payload.payment && payload.payment.proof_path) || '') },
      /* Run 13: the visitor's server-issued wheel identity uuid, so a
         qualifying order can grant the order-based free spin. The uuid
         alone cannot mint identities — the HMAC secret stays on the
         server; the Edge Function (service role) persists it. */
      wheel_participant_uuid: wheelTokenUuid() || undefined,
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
          p_client_request_id: body.client_request_id,
          p_payment: body.payment,
          p_coupon_code: body.coupon_code || null
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
          p_client_request_id: body.client_request_id,
          p_payment: body.payment,
          p_coupon_code: body.coupon_code || null
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
      deposit_required: o.deposit_required !== false,
      deposit_amount: o.deposit_amount,
      deposit_method: o.deposit_method,
      deposit_status: o.deposit_status,
      deposit_rejection_reason: o.deposit_rejection_reason || '',
      remaining_amount: o.remaining_amount,
      remaining_status: o.remaining_status,
      remaining_rejection_reason: o.remaining_rejection_reason || '',
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
  /* ----------------------------------------------------------------
     Mandatory 50% deposit — customer-side helpers.
     uploadPaymentProof: uploads the InstaPay screenshot to the PRIVATE
     payment-proofs bucket (orders/<uuid>.<ext>) and returns only the
     storage path — the image itself is never publicly reachable and
     never stored in the database. Demo mode keeps the data URL in
     memory so the whole flow is testable without a server.
  ---------------------------------------------------------------- */
  var PROOF_BUCKET = 'payment-proofs';
  function uploadPaymentProof(file) {
    if (MODE === 'demo') {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          var id = 'demo-proof-' + genUuid();
          DEMO.proofs = DEMO.proofs || {};
          DEMO.proofs[id] = String(reader.result || '');
          resolve({ path: id });
        };
        reader.onerror = function () { reject(new Error('The screenshot could not be read.')); };
        reader.readAsDataURL(file);
      });
    }
    var ext = String(file.name || '').split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].indexOf(ext) === -1) ext = 'jpg';
    var path = 'orders/' + genUuid() + '.' + ext;
    return client.storage.from(PROOF_BUCKET).upload(path, file, {
      contentType: file.type || 'image/jpeg',
      cacheControl: '3600',
      upsert: false
    }).then(function (res) {
      if (res.error) throw res.error;
      return { path: path };
    });
  }
  function submitDepositProof(orderNumber, phone, proofPath) {
    return client.rpc('submit_deposit_proof', {
      p_order_number: String(orderNumber || '').trim().toUpperCase(),
      p_phone: normalizePhone(phone),
      p_proof_path: String(proofPath || '')
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }
  function submitRemainingProof(orderNumber, phone, proofPath) {
    return client.rpc('submit_remaining_proof', {
      p_order_number: String(orderNumber || '').trim().toUpperCase(),
      p_phone: normalizePhone(phone),
      p_proof_path: String(proofPath || '')
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

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

    /* ---------- Storage lifecycle helpers (storage-cleanup run) ----------
       Reference-guarded deletion: an object is removed ONLY when no
       database row anywhere still points at it. Every image-owning
       table/column from the schema is checked (product galleries, shade
       galleries, categories, banners, site logo). Failed removals are
       queued in localStorage and retried on the next admin session so a
       transient network failure can never silently lose a cleanup. */

    /* Every table/column pair that can legally reference an uploaded
       image. Orders' proof paths live in the PRIVATE payment-proofs
       bucket and are deliberately absent — that bucket is never touched
       by the storefront/admin cleanup helpers. */
    IMAGE_REF_TABLES: [
      { table: 'product_images', column: 'url' },
      { table: 'product_shade_images', column: 'url' },
      { table: 'categories', column: 'image_url' },
      { table: 'banners', column: 'image_url' },
      { table: 'site_settings', column: 'logo_url' },
      /* Run 12: entry-popup images (homepage_settings) — kept in sync
         with the storage-cleanup Edge Function's IMAGE_REF_TABLES. */
      { table: 'homepage_settings', column: 'popup_image_url' }
    ],

    /* Buckets the admin helpers may ever write to — payment-proofs is
       protected and can never be deleted through these helpers. */
    CLEANUP_ALLOWED_BUCKETS: ['products', 'brand'],

    parseStorageUrl: function (url) {
      /* Extract {bucket, path} from a Supabase public object URL.
         Tolerates whitespace, query strings and percent-encoding; the
         path stays encoded exactly as it appears in the URL so it can
         be matched against storage listing paths after decode. Returns
         null for anything unparseable (the caller must skip, not
         guess). */
      if (!url || typeof url !== 'string') return null;
      try {
        var u = url.trim();
        var m = /\/storage\/v1\/object\/public\/([^/]+)\/(.+?)(\?|$)/.exec(u);
        if (!m) return null;
        var bucket = m[1];
        var path = m[2];
        try { path = decodeURIComponent(path); } catch (e2) { /* keep raw */ }
        if (!bucket || !path || path.indexOf('..') !== -1) return null;
        return { bucket: bucket, path: path, decoded: true };
      } catch (e) { return null; }
    },

    /* How many rows across ALL image-owning tables still reference this
       URL. Exact match first (URLs in the DB come verbatim from
       getPublicUrl), then a resilient suffix pass for rows saved with a
       variant encoding. opts.exclude skips one row (the record being
       edited). */
    countReferences: function (publicUrl, opts) {
      var parsed = this.parseStorageUrl(publicUrl);
      var tables = this.IMAGE_REF_TABLES;
      function tally(rows) {
        var n = 0;
        (rows || []).forEach(function () { n++; });
        return n;
      }
      var chain = Promise.resolve(0);
      tables.forEach(function (t) {
        chain = chain.then(function (total) {
          if (total > 0) return total; /* referenced somewhere already */
          var q = client.from(t.table).select(t.column);
          if (opts && opts.exclude && opts.exclude.table === t.table && opts.exclude.id) {
            q = q.ne('id', opts.exclude.id);
          }
          return q.eq(t.column, publicUrl).then(function (r1) {
            if (r1.error) throw r1.error;
            if (tally(r1.data) > 0) return tally(r1.data);
            /* suffix fallback: catch variant-encoded duplicates */
            if (parsed) {
              return client.from(t.table).select(t.column)
                .like(t.column, '%' + parsed.path).then(function (r2) {
                  if (r2.error) throw r2.error;
                  return tally(r2.data);
                });
            }
            return 0;
          });
        });
      });
      return chain;
    },

    /* Remove a storage object ONLY when nothing references it. Returns
       {removed, refs, error?}. Uncertainty always resolves to "skip". */
    removeIfUnreferenced: function (publicUrl, opts) {
      var self = this;
      return self.countReferences(publicUrl, opts).then(function (refs) {
        if (refs > 0) return { removed: false, refs: refs, skipped: true };
        var parsed = self.parseStorageUrl(publicUrl);
        if (!parsed || self.CLEANUP_ALLOWED_BUCKETS.indexOf(parsed.bucket) === -1) {
          return { removed: false, refs: 0, skipped: true, ambiguous: true };
        }
        return client.storage.from(parsed.bucket).remove([parsed.path])
          .then(function (res) {
            if (res.error) throw res.error;
            return { removed: true, refs: 0 };
          })
          .catch(function (err) {
            self.recordFailedCleanup(parsed.bucket, parsed.path, publicUrl,
              'storage remove failed: ' + ((err && err.message) || err));
            return { removed: false, refs: 0, error: err };
          });
      }).catch(function (err) {
        /* Reference check itself failed (network/RLS) — never delete. */
        var parsed = self.parseStorageUrl(publicUrl);
        if (parsed) {
          self.recordFailedCleanup(parsed.bucket, parsed.path, publicUrl,
            'reference check failed: ' + ((err && err.message) || err));
        }
        return { removed: false, refs: -1, error: err, uncertain: true };
      });
    },

    /* Roll back files uploaded during THIS save attempt that never got
       a database row (failed insert, later step threw, network drop).
       Each URL is reference-checked before removal — a row that did get
       written survives. */
    rollbackUploads: function (urls) {
      var self = this;
      return Promise.all((urls || []).filter(Boolean).map(function (u) {
        return self.removeIfUnreferenced(u).catch(function () {
          return { removed: false, uncertain: true };
        });
      })).then(function () { return true; });
    },

    /* -------- failed-cleanup retry queue (localStorage) -------- */
    CLEANUP_QUEUE_KEY: 'bb_storage_cleanup_retry',

    recordFailedCleanup: function (bucket, path, publicUrl, reason) {
      try {
        var raw = localStorage.getItem(this.CLEANUP_QUEUE_KEY);
        var list = raw ? JSON.parse(raw) : [];
        list.push({
          bucket: bucket, path: path, publicUrl: publicUrl,
          reason: String(reason || ''), ts: Date.now(), attempts: 0
        });
        localStorage.setItem(this.CLEANUP_QUEUE_KEY, JSON.stringify(list));
      } catch (e) { /* storage unavailable — nothing else to do */ }
      return true;
    },

    pendingCleanupCount: function () {
      try {
        var raw = localStorage.getItem(this.CLEANUP_QUEUE_KEY);
        return raw ? (JSON.parse(raw) || []).length : 0;
      } catch (e) { return 0; }
    },

    /* Retry queued cleanups (admin session only): reference-checked
       again before every attempt, capped at 5 tries per file. A file
       that became referenced meanwhile is DROPPED — it is no longer
       orphaned and must never be deleted. */
    retryPendingCleanups: function () {
      var self = this;
      var list;
      try {
        var raw = localStorage.getItem(self.CLEANUP_QUEUE_KEY);
        list = raw ? JSON.parse(raw) : [];
      } catch (e) { return Promise.resolve(0); }
      if (!list || !list.length) return Promise.resolve(0);
      return Promise.all(list.map(function (item) {
        /* Files parked after 5 attempts stay queued for manual review. */
        if ((item.attempts || 0) >= 5) return Promise.resolve('parked');
        return self.removeIfUnreferenced(item.publicUrl).then(function (r) {
          if (r.removed) return 'resolved';   /* cleaned up now */
          if (r.refs > 0) return 'resolved';  /* referenced again — drop */
          return 'failed';
        }).catch(function () { return 'failed'; });
      })).then(function (verdicts) {
        var kept = [], resolved = 0;
        list.forEach(function (item, i) {
          var v = verdicts[i];
          if (v === 'resolved') { resolved++; return; } /* remove from queue */
          if (v === 'parked') { kept.push(item); return; }
          item.attempts = (item.attempts || 0) + 1;     /* failed again */
          kept.push(item);
        });
        try {
          localStorage.setItem(self.CLEANUP_QUEUE_KEY, JSON.stringify(kept));
        } catch (e2) { /* ignore */ }
        return resolved;
      });
    },
    setOrderStatus: function (orderId, status) {
      return client.rpc('admin_set_order_status', { p_order_id: orderId, p_status: status });
    },
    /* -------- mandatory 50% deposit verification (admin-only; the
       server re-checks is_admin() so a crafted request cannot approve) */
    verifyDeposit: function (orderId, approve, reason) {
      return client.rpc('verify_order_deposit', {
        p_order_id: orderId, p_approve: !!approve, p_reason: reason || null
      }).then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    },
    verifyRemainingPayment: function (orderId, approve, reason) {
      return client.rpc('verify_remaining_payment', {
        p_order_id: orderId, p_approve: !!approve, p_reason: reason || null
      }).then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    },
    /* Secure screenshot preview: a short-lived SIGNED URL from the
       private bucket — never a public URL, never the raw object. */
    getProofUrl: function (path) {
      if (!path) return Promise.resolve(null);
      if (path.indexOf('demo-proof-') === 0) {
        return Promise.resolve((DEMO.proofs && DEMO.proofs[path]) || null);
      }
      return client.storage.from(PROOF_BUCKET).createSignedUrl(path, 300)
        .then(function (res) {
          if (res.error) throw res.error;
          return res.data && res.data.signedUrl ? res.data.signedUrl : null;
        });
    },
    getOrderEvents: function (orderId) {
      return client.from('order_payment_events')
        .select('*').eq('order_id', orderId)
        .order('created_at', { ascending: true })
        .then(function (res) {
          if (res.error) throw res.error;
          return res.data || [];
        });
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
    },
    /* ---- Run 12: inventory valuation cost editing (admin-only table;
       RLS on product_costs restricts all access to administrators) ---- */
    getProductCosts: function () {
      if (MODE === 'demo') return Promise.resolve([]);
      return client.from('product_costs').select('product_id,cost_price,updated_at')
        .then(function (res) {
          if (res.error) throw res.error;
          return res.data || [];
        });
    },
    saveProductCost: function (productId, costPrice) {
      if (MODE === 'demo') {
        return Promise.reject(new Error('Product costs are stored in Supabase.'));
      }
      var self = this;
      return self.getSession().then(function (session) {
        return client.from('product_costs').upsert({
          product_id: productId,
          cost_price: costPrice,
          updated_by: session && session.user ? session.user.id : null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'product_id' });
      }).then(function (res) {
        if (res.error) throw res.error;
        return true;
      });
    },
    removeProductCost: function (productId) {
      if (MODE === 'demo') return Promise.resolve(true);
      return client.from('product_costs').delete().eq('product_id', productId)
        .then(function (res) {
          if (res.error) throw res.error;
          return true;
        });
    }
  };

  /* ----------------------------------------------------------------
     Run 12 — Wheel of Fortune (storefront, server-authoritative)
     The browser only ASKS: the winning prize, its probability weights,
     the coupon value and the participation record are decided by the
     wheel_spin() database function behind the wheel-spin Edge Function.
  ---------------------------------------------------------------- */
  var WHEEL_TOKEN_KEY = 'bb_wheel_token';

  function wheelStoredToken() {
    try { return localStorage.getItem(WHEEL_TOKEN_KEY) || ''; }
    catch (e) { return ''; }
  }
  function wheelSaveToken(token) {
    try {
      if (token && typeof token === 'string' && token.indexOf('.') > 0) {
        localStorage.setItem(WHEEL_TOKEN_KEY, token);
      }
    } catch (e2) { /* storage unavailable — anonymous state check degrades */ }
  }
  function wheelTokenUuid() {
    var t = wheelStoredToken();
    return t.indexOf('.') > 0 ? t.slice(0, t.indexOf('.')) : '';
  }

  /* Campaign display state for the current visitor. Display fields
     only — probabilities, values and limits never leave the server. */
  function wheelState() {
    if (MODE === 'demo') return Promise.resolve({ active: false });
    return client.rpc('wheel_public_state', { p_participant_token: wheelTokenUuid() })
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || { active: false };
      });
  }

  /* Spin: POST to the wheel-spin Edge Function.
     Run 13 fixes:
       * The 401 bootstrap retry now re-reads the token the server just
         issued and saved (previously the retry was sent WITHOUT any
         token, so a first-time visitor always failed twice).
       * fetch-level failures and non-JSON responses (undeployed
         function, platform error pages) surface as CLEAR diagnostics
         instead of a raw browser TypeError such as "Load failed".
       * consume_entitlement passthrough for the order-earned spin. */
  function wheelSpin(campaignId, opts) {
    if (MODE === 'demo') {
      return Promise.reject(new Error(I18N_WHEEL_UNAVAILABLE));
    }
    opts = opts || {};
    var nonce = genUuid();
    var sessionToken = null;
    var proceed = client && client.auth && client.auth.getSession
      ? client.auth.getSession().then(function (s) {
          sessionToken = s && s.data && s.data.session ? s.data.session.access_token : null;
        })
      : Promise.resolve();
    return proceed.then(function () {
      function diag(status) {
        if (status === 404) return 'The wheel-spin Edge Function is not deployed on the server yet (HTTP 404). Deploy it from the Supabase CLI or dashboard, then retry.';
        if (status === 502 || status === 503) return 'The wheel-spin service is temporarily unavailable (HTTP ' + status + '). Please try again shortly.';
        return null;
      }
      function call(token) {
        var headers = {
          'Content-Type': 'application/json',
          'apikey': KEY
        };
        if (sessionToken) headers.Authorization = 'Bearer ' + sessionToken;
        var body = { campaign_id: campaignId, nonce: nonce };
        if (opts.consumeEntitlement) body.consume_entitlement = true;
        if (token) body.participant_token = token;
        return fetch(URL + '/functions/v1/wheel-spin', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body)
        }).catch(function (netErr) {
          /* fetch-level failure: offline, DNS, blocked CORS or an
             undeployed function — surfaced honestly, never faked. */
          var e = new Error('Could not reach the wheel service. If this persists, the wheel-spin Edge Function is likely not deployed on the server yet.');
          e.status = 0;
          e.diagnostic = String((netErr && netErr.message) || netErr || 'network error');
          throw e;
        }).then(function (res) {
          return res.json().catch(function () {
            /* Non-JSON body (error page / empty body) — diagnose by status. */
            var e = new Error(diag(res.status) || ('Wheel service returned an invalid response (HTTP ' + res.status + ').'));
            e.status = res.status;
            throw e;
          }).then(function (json) {
            if (json && json.participant_token) wheelSaveToken(json.participant_token);
            if (!res.ok) {
              var e2 = new Error((json && json.error) || diag(res.status) || 'Spin failed');
              e2.status = res.status;
              throw e2;
            }
            return json.result;
          });
        });
      }
      return call(wheelStoredToken() || undefined).catch(function (err) {
        if (err && err.status === 401) {
          /* The 401 response carried a freshly issued token which
             call() already saved — retry ONCE with that identity. */
          return call(wheelStoredToken() || undefined);
        }
        throw err;
      });
    });
  }
  var I18N_WHEEL_UNAVAILABLE = 'Wheel of Fortune requires the live backend.';

  /* Coupon preview for checkout (never consumes anything). */
  function validateCoupon(code) {
    if (MODE === 'demo') {
      return Promise.resolve({ valid: false, reason: 'Demo mode: coupons are unavailable.' });
    }
    return client.rpc('validate_wheel_coupon', { p_code: String(code || '') })
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
  }

  /* ----------------------------------------------------------------
     Run 12 — Inventory valuation (admin-only, server-side calc)
  ---------------------------------------------------------------- */
  function getInventoryValuation() {
    if (MODE === 'demo') return Promise.resolve(null);
    return client.rpc('inventory_valuation').then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  /* Public interface */
  window.DB = {
    get mode() { return MODE; },
    get ready() { return !!client; },
    getClient: function () { return client; },
    getSettings: getSettings,
    uploadPaymentProof: uploadPaymentProof,
    submitDepositProof: submitDepositProof,
    submitRemainingProof: submitRemainingProof,
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
    shadeUnitPrice: shadeUnitPrice,
    shadePriceOverride: shadePriceOverride,
    shadePricesDiffer: shadePricesDiffer,
    shadePriceDisplay: shadePriceDisplay,
    isDemoId: isDemoId,
    createOrder: createOrder,
    trackOrder: trackOrder,
    confirmSimulatedPayment: confirmSimulatedPayment,
    normalizePhone: normalizePhone,
    admin: adminApi,

    /* Run 12: wheel of fortune + coupons + inventory valuation */
    wheelState: wheelState,
    wheelSpin: wheelSpin,
    validateCoupon: validateCoupon,
    getInventoryValuation: getInventoryValuation,

    /* localisation-aware accessors used by all pages */
    locName: locName,
    locDesc: locDesc,
    liveDiscount: liveDiscount
  };

  /* Eager settings fetch so the "Show Individual Shade Prices" switch
     is correct on the first render of every page (cached for 60s, so
     the header/home/admin calls below reuse it). */
  getSettings().catch(function () { /* storefront keeps defaults */ });
})();
