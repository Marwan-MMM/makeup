/* ============================================================
   Blush Beauty — checkout.js
   Guest checkout. Collects contact + Egyptian governorate +
   address + payment method. Order creation goes through the
   secure backend path (Edge Function / create_order database
   function) which re-validates stock and recalculates every
   total server-side. Card payments run in a clearly-labelled
   simulation for the prototype; no card data is collected.
   ============================================================ */
(function () {
  'use strict';

  var UI = window.UI, DB = window.DB, I = window.I18N;

  var rows = [];
  var shippingFee = 0;
  var submitting = false;

  function fillGovernorates() {
    var sel = document.getElementById('f-gov');
    I.GOVS.forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = g[0];
      opt.textContent = I.lang === 'ar' ? g[1] : g[0];
      sel.appendChild(opt);
    });
  }

  function render() {
    document.getElementById('co-empty-glyph').innerHTML = UI.icon('bag', 22);
    document.getElementById('sim-notice-icon').innerHTML = UI.icon('info', 16);
    fillGovernorates();

    var items = UI.Cart.items();
    if (!items.length) {
      document.getElementById('checkout-root').querySelector('.checkout-layout').style.display = 'none';
      document.getElementById('co-empty').hidden = false;
      return;
    }
    document.getElementById('co-empty').hidden = true;

    var shadedIds = [];
    items.forEach(function (it) { if (it.shade && shadedIds.indexOf(it.id) === -1) shadedIds.push(it.id); });

    Promise.all([
      DB.getProducts({ ids: items.map(function (x) { return x.id; }), limit: 100, noLimit: true }),
      shadedIds.length
        ? Promise.all(shadedIds.map(function (pid) {
            return DB.getShades(pid).catch(function () { return []; });
          }))
        : Promise.resolve([])
    ]).then(function (res) {
      var prods = res[0].items;
      var shadesByProduct = {};
      res[1].forEach(function (list) {
        if (list.length) shadesByProduct[list[0].productId] = list;
      });
      rows = items.map(function (it) {
        var p = prods.find(function (x) { return x.id === it.id; });
        if (!p) return null;
        var shadeRow = null;
        if (it.shade && shadesByProduct[p.id]) {
          shadeRow = shadesByProduct[p.id].find(function (s) { return s.id === it.shade.id; }) || null;
          if (!shadeRow) return null;
        }
        var cap = shadeRow ? shadeRow.stock : p.stock;
        return { p: p, shade: it.shade || null, shadeRow: shadeRow, qty: Math.min(it.qty, cap) };
      }).filter(Boolean);
      if (!rows.length) {
        document.getElementById('co-empty').hidden = false;
        document.getElementById('checkout-root').querySelector('.checkout-layout').style.display = 'none';
        return;
      }
      drawSummary();
    })
      .catch(function (err) { UI.toast(err.message || I.t('error_generic'), 'error'); });
  }

  function shadeLabelOf(r) {
    var s = r.shadeRow;
    if (!s) return '';
    var name = I.lang === 'ar' ? (s.nameAr || s.nameEn) : (s.nameEn || s.nameAr);
    return I.t('shade_numbered', { n: s.number }) + (name ? ' \u2014 ' + name : '');
  }

  function drawSummary() {
    var host = document.getElementById('co-items');
    var subtotal = 0;
    host.innerHTML = rows.map(function (r) {
      /* Individual shade pricing: the line sells at the shade's own
         price when one is set; otherwise the product's discount logic. */
      var unit = DB.shadeUnitPrice(r.p, r.shadeRow);
      subtotal += unit * r.qty;
      var img = (r.shadeRow && r.shadeRow.images.length) ? r.shadeRow.images[0].url
        : (r.shade && r.shade.img ? r.shade.img : '');
      var thumb = img
        ? '<img src="' + UI.esc(img) + '" alt="" loading="lazy">'
        : UI.mediaHtml(r.p);
      return '<div class="summary-item">' +
        '<span class="thumb">' + thumb + '</span>' +
        '<span class="nm">' + UI.esc(DB.locName(r.p)) + ' <span class="q num">\u00d7 ' + r.qty + '</span>' +
        (r.shadeRow ? '<span class="summary-shade">' + UI.esc(shadeLabelOf(r)) + '</span>' : '') +
        '</span>' +
        '<span class="pr">' + UI.money(Math.round(unit * r.qty * 100) / 100) + '</span>' +
        '</div>';
    }).join('');
    subtotal = Math.round(subtotal * 100) / 100;

    /* Demo/production separation: preview items added while the site
       ran in demo mode stay visible (they resolve from the local
       catalog), but they can never be sent to the live order
       pipeline, whose product ids are UUIDs. */
    var hasDemoLines = rows.some(function (r) { return r.p.demo; });
    if (hasDemoLines && DB.mode === 'supabase') {
      var note = document.getElementById('co-demo-note');
      if (!note) {
        note = document.createElement('p');
        note.id = 'co-demo-note';
        note.className = 'co-demo-note';
        host.insertAdjacentElement('afterend', note);
      }
      note.innerHTML = UI.icon('alert', 14) + ' ' + UI.esc(I.t('co_demo_blocked'));
      note.hidden = false;
      var blockBtn = document.getElementById('place-order');
      if (blockBtn) blockBtn.disabled = true;
    } else {
      var note2 = document.getElementById('co-demo-note');
      if (note2) note2.hidden = true;
      var goBtn = document.getElementById('place-order');
      if (goBtn) goBtn.disabled = false;
    }

    DB.getSettings().then(function (s) {
      shippingFee = Number(s.shipping_fee) || 0;
      document.getElementById('co-subtotal').textContent = UI.money(subtotal);
      document.getElementById('co-shipping').textContent = UI.money(shippingFee);
      document.getElementById('co-total').textContent = UI.money(Math.round((subtotal + shippingFee) * 100) / 100);
    });
    document.getElementById('co-items-count').textContent = I.t('cart_items', {
      n: rows.reduce(function (a, r) { return a + r.qty; }, 0)
    });
  }

  /* ---------- validation ---------- */
  function setErr(field, msg) {
    var wrap = document.querySelector('[data-field="' + field + '"]');
    if (!wrap) return;
    var input = wrap.querySelector('.input');
    var err = wrap.querySelector('.field-error');
    if (msg) {
      if (input) input.classList.add('invalid');
      if (err) { err.textContent = msg; err.classList.add('show'); }
    } else {
      if (input) input.classList.remove('invalid');
      if (err) { err.textContent = ''; err.classList.remove('show'); }
    }
  }

  function validate() {
    var ok = true;
    var name = document.getElementById('f-name').value.trim();
    var phone = document.getElementById('f-phone').value.trim();
    var email = document.getElementById('f-email').value.trim();
    var gov = document.getElementById('f-gov').value;
    var city = document.getElementById('f-city').value.trim();
    var address = document.getElementById('f-address').value.trim();

    if (name.length < 3) { setErr('full_name', I.t('co_err_name')); ok = false; } else setErr('full_name', '');
    if (!/^01[0125][0-9]{8}$/.test(phone.replace(/[^0-9]/g, ''))) { setErr('phone', I.t('co_err_phone')); ok = false; } else setErr('phone', '');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr('email', I.t('co_err_email')); ok = false; } else setErr('email', '');
    if (!gov) { setErr('governorate', I.t('co_err_gov')); ok = false; } else setErr('governorate', '');
    if (city.length < 2) { setErr('city', I.t('co_err_city')); ok = false; } else setErr('city', '');
    if (address.length < 10) { setErr('address', I.t('co_err_address')); ok = false; } else setErr('address', '');
    return ok;
  }

  /* ---------- submission ---------- */
  function placeOrder() {
    if (submitting) return;
    if (!validate()) {
      UI.toast(I.t('ad_required'), 'error');
      var firstBad = document.querySelector('.input.invalid');
      if (firstBad) firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!rows.length) return;
    /* Hard guard: demo ids must never reach the UUID-based order
       pipeline (defense in depth — the button is already disabled). */
    if (DB.mode === 'supabase' && rows.some(function (r) { return r.p.demo; })) {
      UI.toast(I.t('co_demo_blocked'), 'error');
      return;
    }

    var btn = document.getElementById('place-order');
    submitting = true;
    btn.disabled = true;
    btn.textContent = I.t('co_placing') + '\u2026';

    var method = document.querySelector('input[name="payment"]:checked').value;
    var payload = {
      items: rows.map(function (r) {
        var line = { product_id: r.p.id, quantity: r.qty };
        if (r.shadeRow) line.shade_id = r.shadeRow.id;
        return line;
      }),
      customer: {
        full_name: document.getElementById('f-name').value.trim(),
        phone: document.getElementById('f-phone').value.trim(),
        email: document.getElementById('f-email').value.trim(),
        governorate: document.getElementById('f-gov').value,
        city: document.getElementById('f-city').value.trim(),
        address: document.getElementById('f-address').value.trim(),
        delivery_instructions: document.getElementById('f-instructions').value.trim()
      },
      payment_method: method
    };

    DB.createOrder(payload).then(function (order) {
      sessionStorage.setItem('blush_last_order', JSON.stringify(order));
      if (method === 'cod') {
        UI.Cart.clear();
        window.location.href = 'order-confirm.html?order=' + encodeURIComponent(order.order_number);
        return;
      }
      /* Online payment: clearly-labelled simulation (prototype). */
      return UI.confirm({
        title: I.t('sim_title'),
        text: I.t('sim_text') + '\n\n' + I.t('cf_number') + ': ' + order.order_number + ' \u00b7 ' + UI.money(order.total),
        okLabel: I.t('sim_pay'),
        cancelLabel: I.t('sim_cancel')
      }).then(function (confirmed) {
        if (!confirmed) {
          UI.Cart.clear();
          window.location.href = 'order-confirm.html?order=' + encodeURIComponent(order.order_number);
          return;
        }
        return DB.confirmSimulatedPayment(order.order_number, order.payment_reference)
          .then(function () {
            var stored = JSON.parse(sessionStorage.getItem('blush_last_order'));
            if (stored) stored.payment_status = 'paid';
            sessionStorage.setItem('blush_last_order', JSON.stringify(stored));
            UI.toast(I.t('sim_success'), 'ok');
            UI.Cart.clear();
            window.location.href = 'order-confirm.html?order=' + encodeURIComponent(order.order_number);
          })
          .catch(function (err) {
            UI.toast(err.message || I.t('error_generic'), 'error');
            UI.Cart.clear();
            window.location.href = 'order-confirm.html?order=' + encodeURIComponent(order.order_number);
          });
      });
    }).catch(function (err) {
      submitting = false;
      btn.disabled = false;
      btn.textContent = I.t('co_place');
      var msg = err && err.message ? err.message : I.t('error_generic');
      UI.toast(I.t('co_err_generic', { msg: msg }), 'error');
      /* Stock may have changed server-side — refresh what we know. */
      render();
    });
  }

  UI.boot({ rerender: function () {
    var sel = document.getElementById('f-gov');
    var current = sel.value;
    sel.querySelectorAll('option:not([value=""])').forEach(function (o) { o.remove(); });
    fillGovernorates();
    sel.value = current;
    I.apply();
    if (rows.length) drawSummary();
  } });

  document.getElementById('place-order').addEventListener('click', placeOrder);
  document.querySelectorAll('input[name="payment"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var isCard = this.value !== 'cod';
      document.getElementById('card-flow-note').hidden = !isCard;
    });
  });

  render();
})();
