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

  /* Payment status pill for the mandatory deposit / remaining balance. */
  function payPill(kind, status) {
    var map = {
      awaiting_verification: ['pay_deposit_awaiting', 'pay-pill-await'],
      verified: ['pay_deposit_verified', 'pay-pill-verified'],
      rejected: ['pay_deposit_rejected', 'pay-pill-rejected'],
      awaiting_deposit: ['pay_deposit_none', 'pay-pill-outstanding'],
      outstanding: ['pay_remaining_outstanding', 'pay-pill-outstanding'],
      paid: ['pay_remaining_paid', 'pay-pill-paid']
    };
    var m = map[status] || [status, 'pay-pill-outstanding'];
    return '<span class="pay-pill ' + m[1] + '">' + I.t(m[0]) + '</span>';
  }
  /* Inline screenshot uploader for retries (rejected deposit) and the
     remaining-balance InstaPay proof. type: 'deposit' | 'remaining'. */
  function uploaderHtml(kind) {
    return '<div class="proof-upload" data-uploader="' + kind + '">' +
      '<p class="proof-upload-title">' + I.t(kind === 'deposit' ? 'tr_retry_title' : 'tr_remaining_title') + '</p>' +
      '<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden data-proof-input="' + kind + '">' +
      '<div class="proof-empty" data-proof-empty="' + kind + '">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-proof-pick="' + kind + '">' + I.t('co_proof_pick') + '</button>' +
      '<p class="hint">' + I.t('co_proof_hint') + '</p>' +
      '<img data-proof-thumb="' + kind + '" alt="" hidden style="width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid var(--line-strong)">' +
      '<button type="button" class="btn btn-primary btn-sm" data-proof-send="' + kind + '" hidden>' + I.t('tr_retry_submit') + '</button>' +
      '<p class="proof-error" data-proof-error="' + kind + '" hidden></p>' +
      '</div>' +
      (kind === 'remaining'
        ? '<a class="btn btn-primary btn-sm" style="margin-top:10px" href="' + ((window.BB_CONFIG && window.BB_CONFIG.INSTAPAY_URL) || '#') + '" target="_blank" rel="noopener noreferrer">' + I.t('co_deposit_open') + '</a>'
        : '') +
      '</div>';
  }
  function wireUploaders(result, number, phone) {
    result.querySelectorAll('[data-proof-pick]').forEach(function (btn) {
      var kind = btn.getAttribute('data-proof-pick');
      btn.addEventListener('click', function () {
        result.querySelector('[data-proof-input="' + kind + '"]').click();
      });
    });
    result.querySelectorAll('[data-proof-input]').forEach(function (input) {
      var kind = input.getAttribute('data-proof-input');
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        var err = result.querySelector('[data-proof-error="' + kind + '"]');
        var send = result.querySelector('[data-proof-send="' + kind + '"]');
        var thumb = result.querySelector('[data-proof-thumb="' + kind + '"]');
        if (!f) return;
        var okTypes = ['image/jpeg', 'image/png', 'image/webp'];
        var ext = String(f.name || '').split('.').pop().toLowerCase();
        if (okTypes.indexOf(f.type) === -1 && ['jpg', 'jpeg', 'png', 'webp'].indexOf(ext) === -1) {
          err.textContent = I.t('co_proof_err_type'); err.hidden = false; return;
        }
        if (f.size > 5 * 1024 * 1024) {
          err.textContent = I.t('co_proof_err_size'); err.hidden = false; return;
        }
        err.hidden = true;
        var reader = new FileReader();
        reader.onload = function () {
          thumb.src = String(reader.result || ''); thumb.hidden = false;
          send.hidden = false;
          send.onclick = function () {
            send.disabled = true;
            DB.uploadPaymentProof(f).then(function (up) {
              return kind === 'deposit'
                ? DB.submitDepositProof(number, phone, up.path)
                : DB.submitRemainingProof(number, phone, up.path);
            }).then(function () {
              UI.toast(I.t('tr_retry_ok'), 'ok');
              track(number, phone);
            }).catch(function (e2) {
              send.disabled = false;
              err.textContent = e2.message || I.t('error_generic');
              err.hidden = false;
            });
          };
        };
        reader.readAsDataURL(f);
      });
    });
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
        var shadeTxt = '';
        if (it.shade_number !== null && it.shade_number !== undefined) {
          var sname = I.lang === 'ar' ? (it.shade_name_ar || it.shade_name_en) : (it.shade_name_en || it.shade_name_ar);
          shadeTxt = I.t('shade_numbered', { n: it.shade_number }) + (sname ? ' \u2014 ' + sname : '');
        }
        return '<div class="track-item"><span>' + UI.esc(name) + ' <span class="qty num">\u00d7 ' + it.quantity + '</span>' +
          (shadeTxt ? '<span class="track-shade">' + UI.esc(shadeTxt) + '</span>' : '') + '</span>' +
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
        (o.payment_method === 'cod' ? I.t('cf_cod_label') : ({ visa: 'Visa', mastercard: 'Mastercard', meeza: 'Meeza', instapay: 'InstaPay' }[o.payment_method] || o.payment_method)) +
        ' \u00b7 ' + I.t(I.payKey(o.payment_status)) + '</b></div>' +
        '</div>' +
        /* Mandatory 50% deposit + remaining balance breakdown */
        '<div class="track-items">' +
        '<p class="overline">' + I.t('tr_deposit_title') + '</p>' +
        '<div class="track-item"><span>' + I.t('tr_deposit_amount') + '</span><span>' +
        UI.money(o.deposit_amount || 0) + ' \u00b7 InstaPay ' + payPill('dep', o.deposit_status) + '</span></div>' +
        (o.deposit_status === 'rejected' && o.deposit_rejection_reason
          ? '<div class="track-item"><span>' + I.t('tr_rejection_reason') + '</span><span>' + UI.esc(o.deposit_rejection_reason) + '</span></div>' : '') +
        '<div class="track-item"><span>' + I.t('tr_remaining_amount') + '</span><span>' +
        UI.money(o.remaining_amount || 0) + ' \u00b7 ' +
        (o.payment_method === 'cod' ? I.t('cf_cod_label') : (o.payment_method === 'instapay' ? 'InstaPay' : (o.payment_method === 'meeza' ? 'Meeza' : o.payment_method))) +
        ' ' + payPill('rem', o.remaining_status) + '</span></div>' +
        (o.remaining_status === 'rejected' && o.remaining_rejection_reason
          ? '<div class="track-item"><span>' + I.t('tr_rejection_reason') + '</span><span>' + UI.esc(o.remaining_rejection_reason) + '</span></div>' : '') +
        '</div>' +
        (o.deposit_status === 'rejected' ? uploaderHtml('deposit') : '') +
        (o.payment_method === 'instapay' && o.deposit_status === 'verified' && (o.remaining_status === 'outstanding' || o.remaining_status === 'rejected')
          ? uploaderHtml('remaining') : '') +
        '<div class="track-items">' +
        '<p class="overline">' + I.t('tr_items') + '</p>' +
        itemsHtml +
        '<div class="track-item" style="font-weight:700"><span>' + I.t('tr_total') + '</span><span class="num">' + UI.money(o.total) + '</span></div>' +
        '<div class="track-item"><span>' + I.t('cart_subtotal') + '</span><span class="num">' + UI.money(o.subtotal) + '</span></div>' +
        '<div class="track-item"><span>' + I.t('cart_shipping') + '</span><span class="num">' + UI.money(o.shipping_fee) + '</span></div>' +
        '</div>' +
        '</div>';
      wireUploaders(result, number, phone);
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
