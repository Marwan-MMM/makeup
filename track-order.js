/* ============================================================
   Blush Beauty — track-order.js
   Guest order tracking. Requires BOTH the order number and
   the phone number used at checkout; the backend function
   returns nothing unless both match, so no other customer's
   data can be reached.
   Customer-facing status is a simplified 3-step progression:
   Order Received -> In Progress -> Delivered (cancelled has
   its own panel). Internal admin statuses map to these steps.
   ============================================================ */
(function () {
  'use strict';

  var UI = window.UI, DB = window.DB, I = window.I18N;

  function statusPill(status) {
    var step = I.STATUS_MAP[status];
    var cls = status === 'cancelled' ? 'st-cancelled'
      : step === 2 ? 'st-done'
      : step === 1 ? 'st-progress' : 'st-pending';
    return '<span class="status-pill ' + cls + '">' + I.t(I.statusKey(status)) + '</span>';
  }

  function stepper(status) {
    var step = I.STATUS_MAP[status];
    var steps = [
      { key: 'tr_step_received', at: 0 },
      { key: 'tr_step_progress', at: 1 },
      { key: 'tr_step_delivered', at: 2 }
    ];
    return '<div class="stepper">' + steps.map(function (s) {
      var cls = step === -1 ? '' : (step > s.at ? 'done' : step === s.at ? 'current' : '');
      var dot = step > s.at || (step === 2 && s.at === 2)
        ? UI.icon('check', 13)
        : '';
      return '<div class="step ' + cls + '">' +
        '<div class="step-dot">' + dot + '</div>' +
        '<div class="step-label">' + I.t(s.key) + '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function track(number, phone) {
    var result = document.getElementById('track-result');
    var btn = document.getElementById('track-btn');
    btn.disabled = true;
    result.hidden = true;

    DB.trackOrder(number, phone).then(function (o) {
      btn.disabled = false;
      if (!o) {
        result.hidden = false;
        result.innerHTML =
          '<div class="cancelled-panel">' + UI.icon('alert', 18) +
          '<span>' + I.t('tr_not_found') + '</span></div>';
        return;
      }

      var itemsHtml = (o.items || []).map(function (it) {
        var name = I.lang === 'ar' ? (it.product_name_ar || it.product_name_en) : (it.product_name_en || it.product_name_ar);
        return '<div class="track-item"><span>' + UI.esc(name) + ' <span class="qty num">\u00d7 ' + it.quantity + '</span></span>' +
          '<span class="num">' + UI.money(it.line_total) + '</span></div>';
      }).join('');

      result.hidden = false;
      result.innerHTML =
        '<div class="summary-card">' +
        '<div class="flex-between mb-2">' +
        '<h2>' + I.t('tr_status') + '</h2>' + statusPill(o.status) +
        '</div>' +
        (o.status === 'cancelled'
          ? '<div class="cancelled-panel">' + UI.icon('alert', 18) + '<span>' + I.t('tr_cancelled_text') + '</span></div>'
          : stepper(o.status)) +
        '<p class="overline mb-2">' + I.t('tr_number') + ': <span class="num">' + UI.esc(o.order_number) + '</span> \u00b7 ' + I.fmtDateTime(o.created_at) + '</p>' +
        '<div class="track-details">' +
        '<div class="row"><span>' + I.t('tr_deliver_to') + '</span><b>' + UI.esc(o.full_name) + '</b></div>' +
        '<div class="row"><span>' + I.t('co_gov') + ' / ' + I.t('co_city') + '</span><b>' + UI.esc(I.govLabel(o.governorate)) + ' \u2014 ' + UI.esc(o.city) + '</b></div>' +
        '<div class="row"><span>' + I.t('co_address') + '</span><b>' + UI.esc(o.address) + '</b></div>' +
        (o.delivery_instructions ? '<div class="row"><span>' + I.t('co_instructions') + '</span><b>' + UI.esc(o.delivery_instructions) + '</b></div>' : '') +
        '<div class="row"><span>' + I.t('tr_payment') + '</span><b>' +
        (o.payment_method === 'cod' ? I.t('cf_cod_label') : ({ visa: 'Visa', mastercard: 'Mastercard', meeza: 'Meeza' }[o.payment_method] || o.payment_method)) +
        ' \u00b7 ' + I.t(I.payKey(o.payment_status)) + '</b></div>' +
        '</div>' +
        '<div class="track-items">' +
        '<p class="overline">' + I.t('tr_items') + '</p>' +
        itemsHtml +
        '<div class="track-item" style="font-weight:700"><span>' + I.t('tr_total') + '</span><span class="num">' + UI.money(o.total) + '</span></div>' +
        '<div class="track-item"><span>' + I.t('cart_subtotal') + '</span><span class="num">' + UI.money(o.subtotal) + '</span></div>' +
        '<div class="track-item"><span>' + I.t('cart_shipping') + '</span><span class="num">' + UI.money(o.shipping_fee) + '</span></div>' +
        '</div>' +
        '</div>';
    }).catch(function (err) {
      btn.disabled = false;
      UI.toast(err.message || I.t('error_generic'), 'error');
    });
  }

  document.getElementById('track-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var number = document.getElementById('t-number').value.trim();
    var phone = document.getElementById('t-phone').value.trim();
    if (!number || !phone) {
      UI.toast(I.t('ad_required'), 'error');
      return;
    }
    track(number, phone);
  });

  UI.boot({ rerender: function () { I.apply(); } });
})();
