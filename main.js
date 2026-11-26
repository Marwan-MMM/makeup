/* ============================================================
   Blush Beauty — main.js
   Shared UI layer: inline SVG icon set (no emojis), header,
   navigation, search, mobile drawer, footer, cart & wishlist
   stores (localStorage), toasts, dialogs and the shared
   product card renderer.
   ============================================================ */
(function () {
  'use strict';

  var I = window.I18N;
  var DB = window.DB;

  /* ----------------------------------------------------------------
     Inline SVG icon set (professional, consistent, no emojis)
  ---------------------------------------------------------------- */
  var ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    heart: '<path d="M19.5 13.9 12 21l-7.5-7.1A5.4 5.4 0 0 1 12 6.3a5.4 5.4 0 0 1 7.5 7.6Z"/>',
    heartFill: '<path d="M19.5 13.9 12 21l-7.5-7.1A5.4 5.4 0 0 1 12 6.3a5.4 5.4 0 0 1 7.5 7.6Z" fill="currentColor"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chevDown: '<path d="m6 9 6 6 6-6"/>',
    chevUp: '<path d="m18 15-6-6-6 6"/>',
    chevRight: '<path d="m9 18 6-6-6-6"/>',
    chevLeft: '<path d="m15 18-6-6 6-6"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
    truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35a1 1 0 0 0-.78-.38H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    whatsapp: '<path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.44-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.87 1.22 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.42-.08-.12-.28-.2-.57-.34M12.05 21.79a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.43-9.88 9.89-9.88a9.82 9.82 0 0 1 6.99 2.9 9.82 9.82 0 0 1 2.9 7c0 5.45-4.44 9.88-9.9 9.88m8.42-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .18 5.32.17 11.87c0 2.09.55 4.13 1.59 5.93L.07 24l6.33-1.66a11.9 11.9 0 0 0 5.65 1.44h.01c6.55 0 11.87-5.32 11.88-11.87a11.8 11.8 0 0 0-3.47-8.42Z"/>',
    instagram: '<rect x="2.5" y="2.5" width="19" height="19" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="0.9" fill="currentColor" stroke="none"/>',
    edit: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 9 5-5 5 5"/><path d="M12 4v10"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-4.5-4.5L7 21"/>',
    filter: '<path d="M4 6h16M7 12h10m-7 6h4"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.43 2.43 0 0 0 3.4 0l6.6-6.6a2.43 2.43 0 0 0 0-3.4Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17.5 9 5 9-5"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M2 14h4M10 8h4M18 16h4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15v-4M12 15V7M17 15v-7"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1Z"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
    palette: '<path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3-3.5 3H17a3 3 0 0 0-3 3c0 1.5.8 2 .8 3 0 1.2-1 2-2.8 2Z"/><circle cx="7.5" cy="11.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="7.5" r="1.1" fill="currentColor" stroke="none"/>'
  };

  function icon(name, size, cls) {
    var s = size || 20;
    var filled = (name === 'heartFill' || name === 'whatsapp');
    return '<svg class="icon ' + (cls || '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (filled ? '0' : '1.6') + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  /* ----------------------------------------------------------------
     Utilities
  ---------------------------------------------------------------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, type) {
    var root = document.getElementById('toast-root');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type === 'error' ? 'toast-error' : type === 'info' ? 'toast-info' : 'toast-ok');
    el.innerHTML = icon(type === 'error' ? 'alert' : type === 'info' ? 'info' : 'checkCircle', 18) +
      '<span>' + esc(msg) + '</span>';
    root.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 10);
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 300);
    }, 2800);
  }

  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var back = document.createElement('div');
      back.className = 'modal-backdrop';
      back.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
        '<h3 class="modal-title">' + esc(opts.title || I.t('close')) + '</h3>' +
        '<p class="modal-text">' + esc(opts.text || '') + '</p>' +
        (opts.typeInput ?
          '<input class="input confirm-input" type="text" autocomplete="off" placeholder="' + esc(opts.typeText || '') + '">' : '') +
        '<div class="modal-actions">' +
        '<button class="btn btn-ghost" data-act="cancel">' + esc(opts.cancelLabel || I.t('ad_cancel')) + '</button>' +
        '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok">' + esc(opts.okLabel || I.t('ad_save')) + '</button>' +
        '</div></div>';
      document.body.appendChild(back);
      document.body.classList.add('no-scroll');
      var input = back.querySelector('.confirm-input');
      var okBtn = back.querySelector('[data-act="ok"]');
      if (input) okBtn.disabled = true;
      function close(val) {
        back.remove();
        document.body.classList.remove('no-scroll');
        document.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function onKey(e) { if (e.key === 'Escape') close(false); }
      back.addEventListener('click', function (e) {
        if (e.target === back) close(false);
        var act = e.target.closest('[data-act]');
        if (!act) return;
        if (act.dataset.act === 'ok') {
          if (input && input.value.trim() !== opts.typeText) return;
          close(true);
        } else close(false);
      });
      if (input) input.addEventListener('input', function () {
        okBtn.disabled = input.value.trim() !== opts.typeText;
      });
      document.addEventListener('keydown', onKey);
      setTimeout(function () { (input || okBtn).focus(); }, 30);
    });
  }

  /* ----------------------------------------------------------------
     Share product
     Native Web Share API where supported (title + text + URL, and
     the product image as a file when the target allows it); a
     copy-link + WhatsApp dialog elsewhere. No registration, no
     fake sharing.
  ---------------------------------------------------------------- */
  var shareIndex = {}; /* id -> last rendered product snapshot */

  function registerShareProduct(p) {
    if (p && p.id) shareIndex[p.id] = p;
  }

  function productUrl(p) {
    var here = window.location;
    /* On the PDP itself, share the exact current URL so any extra
       parameters (e.g. a selected shade) are preserved. */
    if (here.pathname.split('/').pop() === 'product.html' &&
        new URLSearchParams(here.search).get('id') === String(p.id)) {
      return here.href;
    }
    return new URL('product.html?id=' + encodeURIComponent(p.id), here.href).href;
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (!ok) throw new Error('copy failed');
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
    }
    return new Promise(function (resolve, reject) {
      try { legacyCopy(text); resolve(); } catch (e) { reject(e); }
    });
  }

  function shareDialog(p, url) {
    /* never stack a second share dialog */
    var stale = document.querySelectorAll('.modal-backdrop[data-share-dialog]');
    stale.forEach(function (el) { el.remove(); });
    var back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.setAttribute('data-share-dialog', '');
    back.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      '<h3 class="modal-title">' + esc(I.t('share_title')) + '</h3>' +
      '<p class="modal-text">' + esc(DB.locName(p)) + '</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-share-wa>' + icon('whatsapp', 16) + I.t('share_wa') + '</button>' +
      '<button type="button" class="btn btn-primary" data-share-copy>' + icon('copy', 16) + I.t('share_copy') + '</button>' +
      '</div></div>';
    document.body.appendChild(back);
    document.body.classList.add('no-scroll');
    function close() {
      back.remove();
      document.body.classList.remove('no-scroll');
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    back.addEventListener('click', function (e) {
      if (e.target === back) { close(); return; }
      var wa = e.target.closest('[data-share-wa]');
      var cp = e.target.closest('[data-share-copy]');
      if (wa) {
        close();
        var text = encodeURIComponent(DB.locName(p) + ' \u2014 ' + url);
        window.open('https://wa.me/?text=' + text, '_blank', 'noopener');
      } else if (cp) {
        copyToClipboard(url).then(function () {
          close();
          toast(I.t('share_copied'), 'ok');
        }).catch(function () {
          toast(I.t('share_failed'), 'error');
        });
      }
    });
    document.addEventListener('keydown', onKey);
    setTimeout(function () { back.querySelector('[data-share-copy]').focus(); }, 30);
  }

  function shareProduct(p) {
    if (!p) return;
    registerShareProduct(p);
    var name = DB.locName(p);
    var url = productUrl(p);
    var img = p.images && p.images[0] ? String(p.images[0]) : '';

    if (!navigator.share) { shareDialog(p, url); return; }

    /* Try to attach the product image where the share target
       supports files; fall back to text + URL. */
    var fetchFile = (img && /^https?:/i.test(img) && typeof navigator.canShare === 'function')
      ? fetch(img, { mode: 'cors' })
        .then(function (r) { return r.ok ? r.blob() : null; })
        .then(function (b) {
          if (!b || !/^image\//i.test(b.type)) return null;
          var f = new File([b], 'product.' + (String(b.type).split('/')[1] || 'jpg'), { type: b.type });
          return navigator.canShare({ files: [f] }) ? [f] : null;
        })
        .catch(function () { return null; })
      : Promise.resolve(null);

    fetchFile.then(function (files) {
      var data = { title: name, text: name, url: url };
      if (files && files.length) data.files = files;
      return navigator.share(data).catch(function (err) {
        if (err && err.name === 'AbortError') return; /* user cancelled */
        return navigator.share({ title: name, text: name, url: url });
      });
    }).catch(function () {
      shareDialog(p, url);
    });
  }

  /* ----------------------------------------------------------------
     Cart & wishlist stores (localStorage, guests only)
  ---------------------------------------------------------------- */
  var CART_KEY = 'blush_cart_v1';
  var WISH_KEY = 'blush_wishlist_v1';

  function readKey(k) {
    try {
      var v = JSON.parse(localStorage.getItem(k));
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function writeKey(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ }
  }

  /* Cart items carry { id, shade, qty }: the identity of a line is the
     product id PLUS the selected shade id (null when the product has no
     shades), so the same product in two shades is two separate lines
     while the same product+shade merges into one. Entries written by
     older versions have no `shade` field and keep working unchanged. */
  var Cart = {
    items: function () { return readKey(CART_KEY); },
    count: function () {
      return readKey(CART_KEY).reduce(function (s, i) { return s + (Number(i.qty) || 0); }, 0);
    },
    /* Shade identity is the shade ID string, whether the caller passes
       the full shade snapshot object (product page) or the raw id
       (cart/checkout pages). */
    sameLine: function (item, id, shade) {
      function sid(s) {
        if (!s) return null;
        return typeof s === 'object' ? (s.id || null) : s;
      }
      return item.id === id && sid(item.shade) === sid(shade);
    },
    qtyOf: function (id, shade) {
      var f = readKey(CART_KEY).find(function (x) { return Cart.sameLine(x, id, shade); });
      return f ? f.qty : 0;
    },
    add: function (id, qty, shade) {
      qty = Math.max(1, Math.min(99, Number(qty) || 1));
      var arr = readKey(CART_KEY);
      var f = arr.find(function (x) { return Cart.sameLine(x, id, shade); });
      if (f) f.qty = Math.min(99, f.qty + qty);
      else arr.push({ id: id, shade: shade || null, qty: qty });
      writeKey(CART_KEY, arr);
      storeChanged('cart');
    },
    setQty: function (id, qty, shade) {
      var arr = readKey(CART_KEY);
      var idx = arr.findIndex(function (x) { return Cart.sameLine(x, id, shade); });
      if (idx === -1) return;
      if (qty <= 0) arr.splice(idx, 1);
      else arr[idx].qty = Math.min(99, Number(qty));
      writeKey(CART_KEY, arr);
      storeChanged('cart');
    },
    remove: function (id, shade) {
      writeKey(CART_KEY, readKey(CART_KEY).filter(function (x) { return !Cart.sameLine(x, id, shade); }));
      storeChanged('cart');
    },
    clear: function () {
      writeKey(CART_KEY, []);
      storeChanged('cart');
    }
  };

  var Wish = {
    items: function () { return readKey(WISH_KEY); },
    count: function () { return readKey(WISH_KEY).length; },
    has: function (id) { return readKey(WISH_KEY).indexOf(id) !== -1; },
    add: function (id) {
      var arr = readKey(WISH_KEY);
      if (arr.indexOf(id) === -1) { arr.push(id); writeKey(WISH_KEY, arr); storeChanged('wish'); return true; }
      return false;
    },
    remove: function (id) {
      var before = readKey(WISH_KEY).length;
      writeKey(WISH_KEY, readKey(WISH_KEY).filter(function (x) { return x !== id; }));
      if (readKey(WISH_KEY).length !== before) storeChanged('wish');
    },
    toggle: function (id) {
      if (this.has(id)) { this.remove(id); return false; }
      this.add(id);
      return true;
    }
  };

  function storeChanged(kind) {
    updateCounts();
    document.dispatchEvent(new CustomEvent(kind === 'cart' ? 'cart:change' : 'wish:change'));
  }

  /* ----------------------------------------------------------------
     Shared product rendering
  ---------------------------------------------------------------- */
  function money(n) { return I.fmtMoney(n); }

  function initials(name) {
    var words = String(name || '').trim().split(/\s+/).filter(Boolean);
    var s = (words.length ? words[0].charAt(0) : '') + (words.length > 1 ? words[1].charAt(0) : '');
    return s.toUpperCase() || 'BB';
  }

  function phHtml(name, seed, cls) {
    var tone = (seed || 0) % 3;
    return '<div class="ph ph-tone-' + tone + ' ' + (cls || '') + '"><span>' + esc(initials(name)) + '</span></div>';
  }

  function seedOf(p) {
    var s = String(p.sku || p.id || '');
    var n = 0;
    for (var i = 0; i < s.length; i++) n += s.charCodeAt(i);
    return n;
  }

  function mediaHtml(p) {
    if (p.images && p.images.length) {
      return '<img src="' + esc(p.images[0]) + '" alt="' + esc(DB.locName(p)) + '" loading="lazy">';
    }
    return phHtml(DB.locName(p), seedOf(p));
  }

  /* Thumbnail for an arbitrary image list (shade galleries, cart lines
     with a selected shade): first image, or the brand placeholder. */
  function mediaForImages(images, name, seed) {
    var url = images && images.length ? String(images[0]) : '';
    if (url) return '<img src="' + esc(url) + '" alt="' + esc(name || '') + '" loading="lazy">';
    return phHtml(name || 'BB', seed || 0);
  }

  function stockLabel(p) {
    if (p.stock <= 0) return '<span class="stock-dot dot-out"></span>' + I.t('out_of_stock');
    if (p.stock <= p.lowThreshold) {
      return '<span class="stock-dot dot-low"></span>' + I.t('low_stock', { n: p.stock });
    }
    return '<span class="stock-dot dot-ok"></span>' + I.t('in_stock');
  }

  function productCard(p) {
    var wished = Wish.has(p.id);
    registerShareProduct(p);
    var badges = '';
    if (p.onSale) badges += '<span class="badge badge-off">' + I.t('off_badge', { p: p.pct }) + '</span>';
    if (p.bestseller) badges += '<span class="badge badge-best">' + I.t('bestseller_badge') + '</span>';
    if (p.stock <= 0) badges += '<span class="badge badge-out">' + I.t('sold_out_badge') + '</span>';

    /* Shade quick-picks: active shades in admin display order (already
       mapped by the data layer). Each chip deep-links to the product
       page with that shade preselected (?shade=N) — the PDP stays the
       authoritative selection surface with per-shade stock and gallery.
       With individual shade pricing, the chip shows the shade's selling
       price only when the shades' prices actually differ. Out-of-stock
       shades render dimmed but still navigate. Products without shades
       keep their exact previous appearance. */
    var shadesHtml = '';
    /* Chip prices: shades' selling prices differ AND the store switch
       "Show Individual Shade Prices" is on. */
    var showChipPrices = !!(p.shades && p.shades.length && DB.shadePriceDisplay(p));
    if (p.shades && p.shades.length) {
      shadesHtml = '<div class="card-shades" aria-label="' + esc(I.t('shades_title')) + '">' +
        p.shades.map(function (s) {
          var label = I.t('shade_numbered', { n: s.number });
          var nm = I18N.lang === 'ar' ? (s.nameAr || s.nameEn) : (s.nameEn || s.nameAr);
          var full = nm ? (label + (nm ? ' \u2014 ' + nm : '')) : label;
          if (showChipPrices) full += ' \u00b7 ' + money(DB.shadeUnitPrice(p, s));
          return '<a class="shade-chip' + (s.stock <= 0 ? ' is-out' : '') + '" href="product.html?id=' +
            encodeURIComponent(p.id) + '&shade=' + encodeURIComponent(s.number) + '"' +
            ' title="' + esc(full) + '"' +
            ' aria-label="' + esc(full) + '">' +
            '<span class="num">' + esc(s.number) + '</span>' +
            (showChipPrices ? '<span class="shade-chip-price num">' + esc(money(DB.shadeUnitPrice(p, s))) + '</span>' : '') +
            '</a>';
        }).join('') +
        '</div>';
    }

    /* Card price: with individual shade pricing the displayed price is
       the lowest PURCHASABLE shade selling price, prefixed "from"
       (matching the shop's effective-price sorting — a sold-out cheap
       shade can no longer be bought, so quoting it would mislead);
       otherwise the existing product price / live discount exactly as
       before. */
    var priceLine;
    if (showChipPrices) {
      /* normalised shades carry `stock` (renamed from stock_quantity) */
      var purchasable = p.shades.filter(function (sh) {
        return sh.stock > 0 && sh.price !== null && sh.price !== undefined;
      });
      var pool = purchasable.length ? purchasable : p.shades;
      var minPrice = Math.min.apply(null, pool.map(function (s) { return DB.shadeUnitPrice(p, s); }));
      priceLine = '<span class="price-from">' + esc(I.t('from_price')) + '</span>' +
        '<span class="price-now">' + money(minPrice) + '</span>';
    } else {
      priceLine = '<span class="price-now">' + money(p.finalPrice) + '</span>' +
        (p.onSale ? '<span class="price-old">' + money(p.price) + '</span>' : '');
    }

    return '' +
      '<article class="product-card" data-id="' + esc(p.id) + '">' +
      '<div class="card-media">' +
      '<a class="card-link" href="product.html?id=' + encodeURIComponent(p.id) + '" aria-label="' + esc(DB.locName(p)) + '">' +
      mediaHtml(p) +
      '</a>' +
      '<div class="card-badges">' + badges + '</div>' +
      '<button type="button" class="wish-btn' + (wished ? ' active' : '') + '" data-wish-id="' + esc(p.id) + '" ' +
      'aria-label="' + (wished ? I.t('pdp_in_wish') : I.t('pdp_add_wish')) + '">' + icon(wished ? 'heartFill' : 'heart', 18) + '</button>' +
      '<button type="button" class="share-btn" data-share-id="' + esc(p.id) + '" ' +
      'aria-label="' + I.t('share_product') + '" title="' + I.t('share_product') + '">' + icon('share', 15) + '</button>' +
      '</div>' +
      '<div class="card-info">' +
      '<p class="card-cat">' + esc(catLabel(p)) + '</p>' +
      '<h3 class="card-name"><a href="product.html?id=' + encodeURIComponent(p.id) + '">' + esc(DB.locName(p)) + '</a></h3>' +
      '<div class="card-prices">' +
      priceLine +
      '</div>' +
      shadesHtml +
      '<p class="card-stock">' + stockLabel(p) + '</p>' +
      '</div>' +
      '</article>';
  }

  function catLabel(p) {
    var c = I18N.lang === 'ar' ? (p.catNameAr || p.catNameEn) : (p.catNameEn || p.catNameAr);
    var s = I18N.lang === 'ar' ? (p.subNameAr || p.subNameEn) : (p.subNameEn || p.subNameAr);
    return s ? (c + ' \u00b7 ' + s) : (c || '');
  }

  function qtyStepperHtml(qty, max, ctx) {
    max = max || 99;
    return '' +
      '<div class="qty-stepper" data-ctx="' + esc(ctx || '') + '">' +
      '<button type="button" class="qty-btn" data-dir="-1" aria-label="-">' + icon('minus', 14) + '</button>' +
      '<input class="qty-input" type="text" inputmode="numeric" value="' + qty + '" data-max="' + max + '" aria-label="' + I.t('qty') + '">' +
      '<button type="button" class="qty-btn" data-dir="1" aria-label="+" ' + (qty >= max ? 'disabled' : '') + '>' + icon('plus', 14) + '</button>' +
      '</div>';
  }

  function wireQtySteppers(rootEl, onChange) {
    var root = rootEl || document;
    root.querySelectorAll('.qty-stepper').forEach(function (st) {
      var input = st.querySelector('.qty-input');
      var max = Number(input.dataset.max) || 99;
      st.querySelectorAll('.qty-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var v = parseInt(input.value, 10) || 1;
          v += Number(btn.dataset.dir);
          v = Math.max(1, Math.min(max, v));
          input.value = v;
          syncBtns();
          if (onChange) onChange(v, st.dataset.ctx);
        });
      });
      input.addEventListener('change', function () {
        var v = parseInt(input.value, 10) || 1;
        input.value = Math.max(1, Math.min(max, v));
        syncBtns();
        if (onChange) onChange(parseInt(input.value, 10), st.dataset.ctx);
      });
      function syncBtns() {
        var v = parseInt(input.value, 10) || 1;
        st.querySelector('[data-dir="1"]').disabled = v >= max;
        st.querySelector('[data-dir="-1"]').disabled = v <= 1;
      }
    });
  }

  /* ----------------------------------------------------------------
     Header / footer
  ---------------------------------------------------------------- */
  var NAV_LINKS = [
    { key: 'home', label: 'nav_home', href: 'index.html', match: function (u) { return u.pathname.endsWith('/index.html') || u.pathname.endsWith('/'); } },
    { key: 'shop', label: 'nav_shop', href: 'shop.html', match: function (u) { return u.pathname.endsWith('/shop.html') && !u.search; } },
    { key: 'makeup', label: 'nav_makeup', href: 'shop.html?cat=makeup', match: function (u) { return u.pathname.endsWith('/shop.html') && u.search.indexOf('cat=makeup') !== -1; } },
    { key: 'perfumes', label: 'nav_perfumes', href: 'shop.html?cat=perfumes', match: function (u) { return u.pathname.endsWith('/shop.html') && u.search.indexOf('cat=perfumes') !== -1; } },
    { key: 'flash', label: 'nav_flash', href: 'shop.html?cat=flash', match: function (u) { return u.pathname.endsWith('/shop.html') && u.search.indexOf('cat=flash') !== -1; } }
  ];

  function renderHeader() {
    var host = document.getElementById('site-header');
    if (!host) return;
    var navHtml = NAV_LINKS.map(function (l) {
      return '<a data-nav="' + l.key + '" href="' + l.href + '" data-i18n="' + l.label + '"></a>';
    }).join('');

    host.innerHTML =
      '<a class="skip-link" href="#main" data-i18n="skip_content"></a>' +
      '<div class="header-main"><div class="container header-grid">' +
      '<button type="button" class="icon-btn nav-open" data-i18n-aria="menu">' + icon('menu', 22) + '</button>' +
      '<a class="brand" href="index.html" data-brand-slot>' +
      '<span class="brand-main">BLUSH</span><span class="brand-sub">BEAUTY</span>' +
      '</a>' +
      '<nav class="main-nav" aria-label="Main">' + navHtml + '</nav>' +
      '<div class="header-actions">' +
      '<button type="button" class="icon-btn search-open" data-i18n-aria="search_title">' + icon('search', 20) + '</button>' +
      '<a class="icon-btn wish-link" href="wishlist.html" data-i18n-aria="nav_wishlist">' + icon('heart', 20) +
      '<span class="count-pill" data-wish-count hidden></span></a>' +
      '<a class="icon-btn cart-link" href="cart.html" data-i18n-aria="cart_title">' + icon('bag', 20) +
      '<span class="count-pill" data-cart-count hidden></span></a>' +
      '<button type="button" class="lang-btn" data-lang-toggle></button>' +
      '</div>' +
      '</div></div>' +
      '<div class="search-panel" id="search-panel" hidden>' +
      '<div class="container search-panel-inner">' +
      '<form class="search-form" action="shop.html" method="get" role="search">' +
      icon('search', 18, 'search-glyph') +
      '<input id="site-search-input" type="search" name="q" autocomplete="off" data-i18n-ph="search_ph" aria-label="' + I.t('search_title') + '">' +
      '<button type="button" class="icon-btn search-close" data-i18n-aria="close">' + icon('x', 20) + '</button>' +
      '</form>' +
      '<div class="search-results" id="search-results" hidden></div>' +
      '</div></div>';

    I.apply(host);
    updateLangBtns();
    markActiveNav();

    /* search */
    var panel = host.querySelector('#search-panel');
    var input = host.querySelector('#site-search-input');
    var results = host.querySelector('#search-results');
    host.querySelector('.search-open').addEventListener('click', function () { openSearch(true); });
    host.querySelector('.search-close').addEventListener('click', function () { openSearch(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { openSearch(false); closeDrawer(); }
    });

    var debounceT = null;
    input.addEventListener('input', function () {
      clearTimeout(debounceT);
      var q = input.value.trim();
      if (q.length < 2) { results.hidden = true; results.innerHTML = ''; return; }
      debounceT = setTimeout(function () {
        DB.search(q, 6).then(function (items) {
          if (input.value.trim().length < 2) return;
          if (!items.length) {
            results.innerHTML = '<p class="search-empty">' + I.t('search_no', { q: esc(q) }) + '</p>';
          } else {
            results.innerHTML = '<p class="search-cap">' + I.t('search_suggestions') + '</p>' +
              items.map(function (p) {
                return '<a class="search-row" href="product.html?id=' + encodeURIComponent(p.id) + '">' +
                  '<span class="search-thumb">' + mediaHtml(p) + '</span>' +
                  '<span class="search-name">' + esc(DB.locName(p)) + '</span>' +
                  '<span class="search-price">' + money(p.finalPrice) + '</span></a>';
              }).join('') +
              '<a class="search-all" href="shop.html?q=' + encodeURIComponent(q) + '">' + I.t('search_view_all') + ' ' + icon('arrowRight', 14, 'flip-rtl') + '</a>';
          }
          results.hidden = false;
        }).catch(function () {
          results.hidden = true;
        });
      }, 220);
    });

    function openSearch(show) {
      panel.hidden = !show;
      if (show) { setTimeout(function () { input.focus(); }, 30); }
      else { results.hidden = true; }
    }

    /* mobile drawer — the drawer and its backdrop are appended to
       <body>, NOT inside the header. The sticky header uses
       backdrop-filter, which several browsers (notably Safari) treat
       as a containing block for fixed-position descendants: inside the
       header, the fixed drawer gets clipped and mispositioned. As
       direct body children the drawer positions and stacks reliably on
       every browser and every screen size. */
    var staleDrawer = document.getElementById('mobile-drawer');
    var staleBackdrop = document.getElementById('drawer-backdrop');
    if (staleDrawer) staleDrawer.remove();
    if (staleBackdrop) staleBackdrop.remove();

    var backdrop = document.createElement('div');
    backdrop.className = 'drawer-backdrop';
    backdrop.id = 'drawer-backdrop';
    backdrop.hidden = true;

    var drawer = document.createElement('nav');
    drawer.className = 'mobile-drawer';
    drawer.id = 'mobile-drawer';
    drawer.setAttribute('aria-label', I.t('menu'));
    drawer.hidden = true;
    drawer.innerHTML =
      '<div class="drawer-head">' +
      /* Two-part wordmark wrapped in .brand so the drawer CSS can stack
         it ("Blush" above "Beauty") independently of the close button. */
      '<span class="brand"><span class="brand-main">BLUSH</span><span class="brand-sub">BEAUTY</span></span>' +
      '<button type="button" class="icon-btn drawer-close" data-i18n-aria="close">' + icon('x', 22) + '</button>' +
      '</div>' +
      '<div class="drawer-links">' + navHtml +
      '<a href="wishlist.html" data-i18n="nav_wishlist"></a>' +
      '</div>' +
      '<div class="drawer-foot">' +
      '<button type="button" class="lang-btn" data-lang-toggle></button>' +
      '</div>';
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);
    I.apply(drawer);
    /* Fill the drawer language button label right away — updateLangBtns()
       previously ran only at header render (before the drawer existed),
       leaving the button empty/invisible until a language change happened. */
    updateLangBtns();

    var burger = host.querySelector('.nav-open');
    var lastFocus = null;
    var closeTimer = null;

    burger.addEventListener('click', openDrawer);
    drawer.querySelector('.drawer-close').addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);
    drawer.querySelectorAll('.drawer-links a').forEach(function (a) {
      a.addEventListener('click', closeDrawer);
    });

    function openDrawer() {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      lastFocus = document.activeElement;
      drawer.hidden = false;
      backdrop.hidden = false;
      /* two frames so the slide/fade transition runs after display
         toggles from none — forced reflow alone is not enough here */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          drawer.classList.add('open');
          backdrop.classList.add('show');
        });
      });
      document.body.classList.add('no-scroll');
      setTimeout(function () { drawer.querySelector('.drawer-close').focus(); }, 140);
    }

    function closeDrawer() {
      if (drawer.hidden) return;
      drawer.classList.remove('open');
      backdrop.classList.remove('show');
      document.body.classList.remove('no-scroll');
      closeTimer = setTimeout(function () {
        drawer.hidden = true;
        backdrop.hidden = true;
        closeTimer = null;
      }, 300);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    /* language buttons — bound DOCUMENT-WIDE. The drawer is appended to
       document.body (not inside the header host), so the old host-scoped
       query missed its button: in English the label was blank (the
       updater ran before the drawer existed) and in Arabic the visible
       button had no click listener. setLang() re-applies translations to
       the whole document and persists via localStorage. */
    document.querySelectorAll('[data-lang-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        I.setLang(I.lang === 'en' ? 'ar' : 'en');
      });
    });
    document.addEventListener('lang:change', function () {
      updateLangBtns();
      I.apply(host);
      markActiveNav();
    });

    /* brand + demo banner from settings. The wordmark ALWAYS keeps its
       two-part typography ("Blush" large, "Beauty" small): the old code
       collapsed the configured name into ONE brand-main span (or replaced
       the whole brand with the logo image), which is why the correct
       two-size logo appeared only for a moment before JS swapped it. */
    DB.getSettings().then(function (s) {
      var slot = host.querySelector('[data-brand-slot]');
      if (!slot) return;
      var name = I.lang === 'ar' ? (s.brand_name_ar || s.brand_name_en || 'Blush Beauty') : (s.brand_name_en || s.brand_name_ar || 'Blush Beauty');
      var words = String(name).trim().split(/\s+/);
      var main = words.shift() || 'Blush';
      var sub = words.join(' ') || 'Beauty';
      slot.innerHTML = '<span class="brand-main">' + esc(main) + '</span><span class="brand-sub">' + esc(sub) + '</span>';
    }).catch(function () { /* keep default wordmark */ });

    if (DB.mode === 'demo') {
      var demoBar = document.createElement('div');
      demoBar.className = 'demo-bar';
      demoBar.innerHTML = '<div class="container"><p>' + icon('info', 14) + I.t('demo_banner') + '</p></div>';
      /* placed above the sticky header so it scrolls away naturally */
      host.insertAdjacentElement('beforebegin', demoBar);
    }
  }

  function updateLangBtns() {
    document.querySelectorAll('[data-lang-toggle]').forEach(function (b) {
      b.textContent = I.t('language_name');
    });
  }

  function markActiveNav() {
    var u = window.location;
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      var l = NAV_LINKS.find(function (x) { return x.key === a.dataset.nav; });
      a.classList.toggle('active', l ? l.match(u) : false);
    });
  }

  function updateCounts() {
    var c = Cart.count(), w = Wish.count();
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = c > 99 ? '99+' : String(c);
      el.hidden = c === 0;
    });
    document.querySelectorAll('[data-wish-count]').forEach(function (el) {
      el.textContent = w > 9 ? '9+' : String(w);
      el.hidden = w === 0;
    });
  }

  function renderFooter() {
    var host = document.getElementById('site-footer');
    if (!host) return;
    host.innerHTML =
      '<div class="container footer-grid">' +
      '<div class="foot-brand">' +
      '<p class="foot-logo"><span class="brand-main">BLUSH</span><span class="brand-sub">BEAUTY</span></p>' +
      '<p class="foot-about" data-foot-about></p>' +
      '</div>' +
      '<div class="foot-col">' +
      '<h3 class="foot-title" data-i18n="ft_links"></h3>' +
      '<a href="index.html" data-i18n="ft_home"></a>' +
      '<a href="shop.html" data-i18n="ft_shop"></a>' +
      '<a href="track-order.html" data-i18n="ft_track"></a>' +
      '</div>' +
      '<div class="foot-col" data-foot-care>' +
      '<h3 class="foot-title" data-i18n="ft_care"></h3>' +
      '</div>' +
      '<div class="foot-col" data-foot-follow>' +
      '<h3 class="foot-title" data-i18n="ft_follow"></h3>' +
      '</div>' +
      '</div>' +
      '<div class="foot-bottom"><div class="container"><p data-foot-rights></p></div></div>';

    fillFooter();
    document.addEventListener('lang:change', fillFooter);

    function fillFooter() {
      I.apply(host);
      DB.getSettings().then(function (s) {
        var about = host.querySelector('[data-foot-about]');
        about.textContent = (I.lang === 'ar'
          ? (s.tagline_ar || s.tagline_en || '')
          : (s.tagline_en || s.tagline_ar || '')) || I.t('ft_about_default');

        var brandSlot = host.querySelector('.foot-logo');
        var bname = I.lang === 'ar' ? (s.brand_name_ar || 'BLUSH') : (s.brand_name_en || 'BLUSH');
        if (s.brand_name_en || s.brand_name_ar) {
          brandSlot.innerHTML = '<span class="brand-main">' + esc(bname) + '</span>';
        }

        var care = host.querySelector('[data-foot-care]');
        var careHtml = '<h3 class="foot-title">' + I.t('ft_care') + '</h3>';
        if (s.contact_email) {
          careHtml += '<a href="mailto:' + esc(s.contact_email) + '">' + esc(s.contact_email) + '</a>';
        }
        if (s.working_hours) {
          careHtml += '<p class="foot-muted">' + esc(s.working_hours) + '</p>';
        }
        careHtml += '<p class="foot-muted">' + I.t('ft_cod_note') + '</p>';
        care.innerHTML = careHtml;

        var follow = host.querySelector('[data-foot-follow]');
        var followHtml = '<h3 class="foot-title">' + I.t('ft_follow') + '</h3>';
        if (s.whatsapp_number) {
          var msg = I.lang === 'ar' ? (s.whatsapp_message_ar || s.whatsapp_message_en || '') : (s.whatsapp_message_en || s.whatsapp_message_ar || '');
          var waUrl = 'https://wa.me/' + esc(s.whatsapp_number) + (msg ? '?text=' + encodeURIComponent(msg) : '');
          followHtml += '<a href="' + waUrl + '" target="_blank" rel="noopener">' + icon('whatsapp', 16) + ' ' + I.t('ct_whatsapp') + '</a>';
        } else {
          followHtml += '<p class="foot-muted">' + I.t('ct_missing') + '</p>';
        }
        if (s.instagram_url) {
          followHtml += '<a href="' + esc(s.instagram_url) + '" target="_blank" rel="noopener">' + icon('instagram', 16) + ' ' + I.t('ct_instagram') + '</a>';
        }
        follow.innerHTML = followHtml;

        var rights = host.querySelector('[data-foot-rights]');
        rights.textContent = I.t('ft_rights', { y: new Date().getFullYear() });
      }).catch(function () {
        var rights = host.querySelector('[data-foot-rights]');
        if (rights) rights.textContent = I.t('ft_rights', { y: new Date().getFullYear() });
        var care = host.querySelector('[data-foot-care]');
        if (care && care.querySelectorAll('a, p').length <= 1) {
          care.innerHTML = '<h3 class="foot-title">' + I.t('ft_care') + '</h3><p class="foot-muted">' + I.t('ft_cod_note') + '</p>';
        }
      });
    }
  }

  /* ----------------------------------------------------------------
     Global delegated handlers
  ---------------------------------------------------------------- */
  function wireGlobal() {
    document.addEventListener('click', function (e) {
      var shareBtn = e.target.closest('[data-share-id]');
      if (shareBtn) {
        e.preventDefault();
        e.stopPropagation();
        var sp = shareIndex[shareBtn.dataset.shareId];
        if (sp) shareProduct(sp);
        return;
      }
      var wishBtn = e.target.closest('[data-wish-id]');
      if (wishBtn) {
        e.preventDefault();
        e.stopPropagation();
        var id = wishBtn.dataset.wishId;
        var added = Wish.toggle(id);
        wishBtn.classList.toggle('active', added);
        var svg = wishBtn.querySelector('svg');
        if (svg) svg.outerHTML = icon(added ? 'heartFill' : 'heart', 18);
        toast(added ? I.t('added_wish') : I.t('removed_wish'), added ? 'ok' : 'info');
        document.dispatchEvent(new CustomEvent('wish:toggled', { detail: { id: id, added: added } }));
        return;
      }
    });
    document.addEventListener('cart:change', updateCounts);
    document.addEventListener('wish:change', updateCounts);
  }

  /* ================================================================
     Run 12 — Entry Promotion Popup (admin-configured, Supabase-driven)
     Content, timing, frequency and the campaign window all come from
     homepage_settings; nothing promotional is hardcoded. The popup is
     optional by design: any failure here silently skips it and NEVER
     breaks the page. Checkout and the order-confirmation page are
     excluded so the purchase flow is never interrupted.
     ================================================================ */
  var POPUP_SEEN_KEY = 'bb_popup_seen_v1';
  var POPUP_EXCLUDED_PAGES = ['checkout.html', 'order-confirm.html'];

  function promoPageAllowed() {
    var p = (window.location.pathname || '').split('/').pop() || '';
    return POPUP_EXCLUDED_PAGES.indexOf(p) === -1;
  }

  function safeHref(url) {
    var u = String(url || '').trim();
    if (/^(https?:\/\/|\/)/i.test(u)) return u;
    if (/^[a-z0-9-]+\.html([?#].*)?$/i.test(u)) return u;
    return 'shop.html';
  }

  function popupSeen(cfg) {
    var key = cfg.popup_campaign_key || 'default';
    var freq = cfg.popup_frequency || 'per_session';
    if (freq === 'every_visit') return false;
    if (freq === 'per_session') {
      try { return sessionStorage.getItem('bb_popup_session') === key; }
      catch (e) { return false; }
    }
    var store;
    try { store = JSON.parse(localStorage.getItem(POPUP_SEEN_KEY) || '{}'); }
    catch (e2) { store = {}; }
    if (freq === 'per_day') return store.k === key && store.d === new Date().toISOString().slice(0, 10);
    return store.k === key && store.c === true; /* per_campaign */
  }

  function popupMarkSeen(cfg) {
    var key = cfg.popup_campaign_key || 'default';
    var freq = cfg.popup_frequency || 'per_session';
    try {
      if (freq === 'per_session') {
        sessionStorage.setItem('bb_popup_session', key);
        return;
      }
      var store;
      try { store = JSON.parse(localStorage.getItem(POPUP_SEEN_KEY) || '{}'); }
      catch (e) { store = {}; }
      store.k = key;
      if (freq === 'per_day') store.d = new Date().toISOString().slice(0, 10);
      else store.c = true; /* per_campaign */
      localStorage.setItem(POPUP_SEEN_KEY, JSON.stringify(store));
    } catch (e2) { /* storage unavailable — popup just becomes every-visit */ }
  }

  function popupInWindow(cfg) {
    var now = new Date();
    if (cfg.popup_start_at && new Date(cfg.popup_start_at) > now) return false;
    if (cfg.popup_end_at && new Date(cfg.popup_end_at) < now) return false;
    return true;
  }

  function renderPopup(cfg) {
    var mode = cfg.popup_mode || 'both';
    var hasImage = mode !== 'text' && !!cfg.popup_image_url;
    var hasText = mode !== 'image';
    var back = document.createElement('div');
    back.className = 'bb-popup-backdrop';
    back.innerHTML =
      '<div class="bb-popup' + (hasImage && hasText ? ' has-image' : '') + '" role="dialog" aria-modal="true">' +
      '<button type="button" class="bb-popup-x icon-btn" aria-label="' + esc(I.t('close')) + '">' + icon('x', 20) + '</button>' +
      (hasImage ? '<div class="bb-popup-media"><img src="' + esc(cfg.popup_image_url) + '" alt="' +
        esc(I.lang === 'ar' ? (cfg.popup_title_ar || cfg.popup_title_en || '') : (cfg.popup_title_en || cfg.popup_title_ar || '')) + '"></div>' : '') +
      (hasText ? '<div class="bb-popup-body">' +
        (cfg.popup_subtitle_en || cfg.popup_subtitle_ar ? '<p class="overline">' +
          esc(I.lang === 'ar' ? (cfg.popup_subtitle_ar || cfg.popup_subtitle_en) : (cfg.popup_subtitle_en || cfg.popup_subtitle_ar)) + '</p>' : '') +
        (cfg.popup_title_en || cfg.popup_title_ar ? '<h2 class="display-2">' +
          esc(I.lang === 'ar' ? (cfg.popup_title_ar || cfg.popup_title_en) : (cfg.popup_title_en || cfg.popup_title_ar)) + '</h2>' : '') +
        (cfg.popup_description_en || cfg.popup_description_ar ? '<p class="bb-popup-desc">' +
          esc(I.lang === 'ar' ? (cfg.popup_description_ar || cfg.popup_description_en) : (cfg.popup_description_en || cfg.popup_description_ar)) + '</p>' : '') +
        (cfg.popup_discount_en || cfg.popup_discount_ar ? '<p class="bb-popup-discount">' +
          esc(I.lang === 'ar' ? (cfg.popup_discount_ar || cfg.popup_discount_en) : (cfg.popup_discount_en || cfg.popup_discount_ar)) + '</p>' : '') +
        (cfg.popup_cta_text_en || cfg.popup_cta_text_ar || cfg.popup_cta_url ?
          '<a class="btn btn-primary bb-popup-cta" href="' + esc(safeHref(cfg.popup_cta_url)) + '">' +
          esc(I.lang === 'ar' ? (cfg.popup_cta_text_ar || cfg.popup_cta_text_en || I.t('banner_cta')) : (cfg.popup_cta_text_en || cfg.popup_cta_text_ar || I.t('banner_cta'))) + '</a>' : '') +
        '</div>' : '') +
      '</div>';
    document.body.appendChild(back);
    document.body.classList.add('no-scroll');
    /* Activation on the next frame so the CSS entrance transition runs
       (the stylesheet disables transforms under prefers-reduced-motion). */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { back.classList.add('open'); });
    });
    popupMarkSeen(cfg);
    function close() {
      back.classList.remove('open');
      document.body.classList.remove('no-scroll');
      setTimeout(function () { back.remove(); }, 220);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    back.querySelector('.bb-popup-x').addEventListener('click', close);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
  }

  function initPopup() {
    if (!promoPageAllowed()) return;
    DB.getHomepage().then(function (hp) {
      if (!hp || !hp.popup_enabled || !popupInWindow(hp)) return;
      if (popupSeen(hp)) return;
      var delay = Number(hp.popup_delay_seconds);
      if (isNaN(delay)) delay = 3;
      delay = Math.max(0, Math.min(60, delay));
      setTimeout(function () { renderPopup(hp); }, delay * 1000);
    }).catch(function () { /* optional feature — never break the page */ });
  }

  /* ================================================================
     Run 12 — Wheel of Fortune (storefront)
     The wheel ONLY LOOKS like the decision-maker: the winning segment
     is chosen by the wheel_spin() database function behind the
     wheel-spin Edge Function, and the result is displayed exclusively
     from the server response. The animation is choreographed to land
     on the server's segment afterwards.
     ================================================================ */
  var WHEEL_FAB_ID = 'bb-wheel-fab';

  function wheelLang(st, en, ar) {
    return I.lang === 'ar' ? (ar || en || '') : (en || ar || '');
  }

  function wheelErrorKey(message) {
    var m = String(message || '');
    if (/already/i.test(m)) return 'wheel_already';
    if (/ended/i.test(m)) return 'wheel_err_ended';
    if (/not started/i.test(m)) return 'wheel_err_notstarted';
    if (/not active/i.test(m)) return 'wheel_err_inactive';
    if (/administrator review|temporarily unavailable/i.test(m)) return 'wheel_err_review';
    if (/too many attempts/i.test(m)) return 'wheel_err_rate';
    return null;
  }

  function initWheel() {
    if (!promoPageAllowed()) return;
    if (document.getElementById(WHEEL_FAB_ID)) return;
    DB.wheelState().then(function (st) {
      if (!st || !st.active || st.participated) return;
      var segs = (st.segments || []).filter(function (s) { return !!s; });
      if (segs.length < 2) return;
      var fab = document.createElement('button');
      fab.type = 'button';
      fab.id = WHEEL_FAB_ID;
      fab.className = 'bb-wheel-fab';
      fab.setAttribute('aria-label', I.t('wheel_fab'));
      fab.innerHTML = icon('gift', 22) + '<span>' + esc(I.t('wheel_fab')) + '</span>';
      fab.addEventListener('click', function () { openWheelModal(st, segs); });
      document.body.appendChild(fab);
    }).catch(function () { /* optional feature — skip silently */ });
  }

  function wheelGradient(segs) {
    /* conic-gradient stops for the visual wheel; colours cycle through
       the brand palette when a segment has no configured colour. */
    var tones = ['#F72585', '#B5179E', '#7209B7', '#560BAD', '#F8E9F1', '#FFB3C6'];
    var stops = [], acc = 0;
    var step = 360 / segs.length;
    segs.forEach(function (s, i) {
      var c = s.color || tones[i % tones.length];
      stops.push(c + ' ' + acc.toFixed(2) + 'deg ' + (acc + step).toFixed(2) + 'deg');
      acc += step;
    });
    return 'conic-gradient(' + stops.join(', ') + ')';
  }

  function openWheelModal(st, segs) {
    var fab = document.getElementById(WHEEL_FAB_ID);
    var back = document.createElement('div');
    back.className = 'bb-wheel-backdrop';
    back.innerHTML =
      '<div class="bb-wheel" role="dialog" aria-modal="true">' +
      '<button type="button" class="bb-wheel-x icon-btn" aria-label="' + esc(I.t('close')) + '">' + icon('x', 20) + '</button>' +
      '<p class="overline">' + esc(I.t('wheel_fab')) + '</p>' +
      '<h2 class="display-2">' + esc(wheelLang(st, st.title_en, st.title_ar) || I.t('wheel_default_title')) + '</h2>' +
      (wheelLang(st, st.description_en, st.description_ar) ? '<p class="bb-wheel-desc">' + esc(wheelLang(st, st.description_en, st.description_ar)) + '</p>' : '') +
      '<div class="bb-wheel-stage">' +
      '<div class="bb-wheel-pointer">' + icon('chevDown', 18) + '</div>' +
      '<div class="bb-wheel-disc" style="background:' + wheelGradient(segs) + '">' +
      segs.map(function (s, i) {
        var seg = 360 / segs.length;
        var mid = i * seg + seg / 2;
        return '<span class="bb-wheel-label" style="transform:rotate(' + mid.toFixed(1) + 'deg)">' +
          '<b>' + esc(wheelLang(st, s.label_en, s.label_ar)) + '</b></span>';
      }).join('') +
      '</div></div>' +
      (wheelLang(st, st.instructions_en, st.instructions_ar) ? '<p class="hint bb-wheel-instr">' + esc(wheelLang(st, st.instructions_en, st.instructions_ar)) + '</p>' : '') +
      '<div class="bb-wheel-actions"><button type="button" class="btn btn-primary" id="bb-wheel-go">' + esc(I.t('wheel_spin')) + '</button></div>' +
      '<div class="bb-wheel-result" hidden></div>' +
      '</div>';
    document.body.appendChild(back);
    document.body.classList.add('no-scroll');
    if (fab) fab.style.display = 'none';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { back.classList.add('open'); });
    });

    var disc = back.querySelector('.bb-wheel-disc');
    var go = back.querySelector('#bb-wheel-go');
    var result = back.querySelector('.bb-wheel-result');
    var spinning = false;
    var rotation = 0;

    function close() {
      back.classList.remove('open');
      document.body.classList.remove('no-scroll');
      setTimeout(function () { back.remove(); }, 220);
      document.removeEventListener('keydown', onKey);
      /* After a recorded participation the FAB stays hidden — the next
         wheelState() call reports participated=true anyway. */
      if (participated && fab) fab.remove();
    }
    var participated = false;
    function onKey(e) { if (e.key === 'Escape') close(); }
    back.querySelector('.bb-wheel-x').addEventListener('click', close);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);

    function showResult(r) {
      var prize = r.prize || r; // already_participated payloads carry a snapshot
      var type = prize.type || '';
      var isNone = type === 'none';
      var lines = '';
      if (!isNone) {
        lines += '<h3 class="bb-wheel-won">' + esc(I.t('wheel_you_won')) + '</h3>';
        if (type === 'percent_discount') lines += '<p class="bb-wheel-prize">' + esc(I.t('wheel_prize_percent', { v: String(prize.value) })) + '</p>';
        else if (type === 'fixed_discount') lines += '<p class="bb-wheel-prize">' + esc(I.t('wheel_prize_fixed', { v: I.fmtMoney(prize.value) })) + '</p>';
        else if (type === 'free_shipping') lines += '<p class="bb-wheel-prize">' + esc(I.t('wheel_free_ship')) + '</p>';
        else if (type === 'gift') lines += '<p class="bb-wheel-prize">' + esc(I.t('wheel_gift_note')) + '</p>';
        var label = I.lang === 'ar' ? (prize.label_ar || prize.label_en) : (prize.label_en || prize.label_ar);
        if (label) lines += '<p class="bb-wheel-prize-label">' + esc(label) + '</p>';
        if (r.coupon_code) {
          lines += '<p class="bb-wheel-coupon"><b>' + esc(r.coupon_code) + '</b>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="bb-wheel-copy">' + esc(I.t('wheel_copy')) + '</button></p>';
        }
        if (r.coupon_expires_at) lines += '<p class="hint">' + esc(I.t('wheel_valid_until', { d: I.fmtDate(r.coupon_expires_at) })) + '</p>';
        var minOrder = r.coupon_min_order_value !== undefined ? r.coupon_min_order_value : r.min_order_value;
        if (minOrder && Number(minOrder) > 0) {
          lines += '<p class="hint">' + esc(I.t('wheel_min_order', { m: I.fmtMoney(minOrder) })) + '</p>';
        }
        var cond = I.lang === 'ar' ? (prize.conditions_ar || prize.conditions_en) : (prize.conditions_en || prize.conditions_ar);
        if (cond) lines += '<p class="hint">' + esc(I.t('wheel_conditions')) + ': ' + esc(cond) + '</p>';
      } else {
        lines += '<h3 class="bb-wheel-won">' + esc(I.t('wheel_no_prize')) + '</h3>';
      }
      if (r.already_participated) {
        lines = '<h3 class="bb-wheel-won">' + esc(I.t('wheel_already')) + '</h3>' + lines;
      }
      lines += '<p class="hint bb-wheel-anon-note">' + esc(I.t('wheel_anon_note')) + '</p>' +
        '<div class="bb-wheel-actions"><button type="button" class="btn btn-outline" id="bb-wheel-close2">' + esc(I.t('close')) + '</button></div>';
      result.innerHTML = lines;
      result.hidden = false;
      go.parentElement.hidden = true;
      participated = true;
      var copyBtn = result.querySelector('#bb-wheel-copy');
      if (copyBtn) copyBtn.addEventListener('click', function () {
        var code = r.coupon_code || '';
        function done() { UI.toast(I.t('wheel_copied'), 'ok'); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(done, function () { fallbackCopy(code); done(); });
        } else fallbackCopy(code);
        function fallbackCopy(text) {
          var ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch (e) { /* best effort */ }
          ta.remove();
        }
      });
      result.querySelector('#bb-wheel-close2').addEventListener('click', close);
    }

    function fail(message) {
      var key = wheelErrorKey(message);
      result.innerHTML = '<h3 class="bb-wheel-won">' + esc(I.t(key || 'wheel_error')) + '</h3>' +
        (!key && message ? '<p class="hint">' + esc(message) + '</p>' : '') +
        '<div class="bb-wheel-actions"><button type="button" class="btn btn-outline" id="bb-wheel-close2">' + esc(I.t('close')) + '</button></div>';
      result.hidden = false;
      go.disabled = false;
      result.querySelector('#bb-wheel-close2').addEventListener('click', close);
    }

    go.addEventListener('click', function () {
      if (spinning) return;
      spinning = true;
      go.disabled = true;
      go.textContent = I.t('wheel_spinning');
      DB.wheelSpin(st.campaign_id).then(function (r) {
        /* Choreograph the visual wheel to the SERVER-decided segment. */
        var idx = segs.findIndex(function (s) { return String(s.position) === String(r.position || (r.prize && r.prize.position)); });
        if (idx === -1) idx = 0;
        var seg = 360 / segs.length;
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var target;
        if (reduced) {
          target = rotation;
        } else {
          /* centre of the winning segment under the top pointer */
          var jitter = (Math.random() - 0.5) * seg * 0.5;
          var desired = rotation - (rotation % 360) + 360 * 5 + (360 - (idx * seg + seg / 2 + jitter));
          target = desired;
        }
        if (!reduced) {
          disc.style.transform = 'rotate(' + target.toFixed(2) + 'deg)';
          rotation = target;
          setTimeout(function () { showResult(r); }, 4200);
        } else {
          showResult(r);
        }
      }).catch(function (err) {
        spinning = false;
        go.textContent = I.t('wheel_spin');
        fail(err && err.message);
      });
    });
  }

  /* ----------------------------------------------------------------
     Boot
  ---------------------------------------------------------------- */
  function boot(opts) {
    opts = opts || {};
    renderHeader();
    renderFooter();
    wireGlobal();
    updateCounts();
    I.apply();
    initPopup();
    initWheel();
    if (opts.rerender) {
      document.addEventListener('lang:change', function () { opts.rerender(); });
    }
  }

  window.UI = {
    icon: icon,
    esc: esc,
    money: money,
    toast: toast,
    confirm: confirmDialog,
    boot: boot,
    Cart: Cart,
    Wish: Wish,
    productCard: productCard,
    mediaHtml: mediaHtml,
    mediaForImages: mediaForImages,
    phHtml: phHtml,
    seedOf: seedOf,
    stockLabel: stockLabel,
    catLabel: catLabel,
    qtyStepperHtml: qtyStepperHtml,
    wireQtySteppers: wireQtySteppers,
    registerShareProduct: registerShareProduct,
    shareProduct: shareProduct
  };
})();
