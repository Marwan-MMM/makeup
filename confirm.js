/* ============================================================
   Blush Beauty — confirm.js
   Order confirmation page. Renders the order created in this
   session (sessionStorage). If the page is opened later, the
   customer is pointed to the tracking page (order number +
   phone). In demo mode an explicit note says the order lives
   in this browser only.
   ============================================================ */
(function () {
  'use strict';

  var UI = window.UI, DB = window.DB, I = window.I18N;

  function payLabel(order) {
    /* The method shown is the one used for the REMAINING balance;
       the deposit is always InstaPay. */
    var base = {
      cod: I.t('cf_cod_label'),
      visa: 'Visa', mastercard: 'Mastercard', meeza: 'Meeza',
      instapay: 'InstaPay'
    }[order.payment_method] || order.payment_method;
    if (order.payment_method !== 'cod' && order.payment_status === 'paid') {
      return base + ' \u00b7 ' + I.t('cf_paid_sim');
    }
    return base + ' \u00b7 ' + I.t('pay_unpaid');
  }
  function depositStatusLabel(ds) {
    return {
      awaiting_verification: I.t('pay_deposit_awaiting'),
      verified: I.t('pay_deposit_verified'),
      rejected: I.t('pay_deposit_rejected'),
      awaiting_deposit: I.t('pay_deposit_none')
    }[ds] || ds;
  }

  function render() {
    document.getElementById('confirm-icon').innerHTML = UI.icon('checkCircle', 30);
    document.getElementById('cf-demo-icon').innerHTML = UI.icon('info', 15);

    var raw = sessionStorage.getItem('blush_last_order');
    var orderNumber = new URLSearchParams(window.location.search).get('order') || '';
    var order = null;

    try { order = raw ? JSON.parse(raw) : null; } catch (e) { order = null; }
    if (order && orderNumber && order.order_number !== orderNumber) order = null;
    if (!order && orderNumber) {
      /* Try to find the order without asking for the phone again
         only if it is the last order of this session; otherwise
         fall back to tracking. */
      order = null;
    }

    if (order) {
      document.getElementById('cf-number').textContent = order.order_number;
      document.getElementById('cf-date').textContent = I.fmtDateTime(order.created_at);
      document.getElementById('cf-payment').textContent = payLabel(order);
      document.getElementById('cf-total').textContent = UI.money(order.total);
      /* Mandatory deposit breakdown: the deposit is NEVER reported as
         paid here — only an admin verification changes its status. */
      var deposit = Number(order.deposit_amount) || 0;
      var remaining = Number(order.remaining_amount);
      if (!remaining && deposit) remaining = Math.round((order.total - deposit) * 100) / 100;
      document.getElementById('cf-deposit').textContent = deposit ? UI.money(deposit) + ' \u00b7 InstaPay' : I.t('cf_deposit_na');
      document.getElementById('cf-remaining').textContent = remaining ? UI.money(remaining) : I.t('cf_deposit_na');
      document.getElementById('cf-deposit-status').textContent = depositStatusLabel(order.deposit_status);
      document.getElementById('cf-deposit-note').textContent = I.t('cf_deposit_note');
      if (DB.mode === 'demo') document.getElementById('cf-demo-note').hidden = false;
      var trackBtn = document.querySelector('.confirm-actions .btn-primary');
      trackBtn.href = 'track-order.html';
    } else if (orderNumber) {
      /* Order exists on the server but this session has no snapshot:
         show number and direct to tracking. */
      document.getElementById('cf-number').textContent = orderNumber;
      document.getElementById('cf-date').textContent = '';
      document.getElementById('cf-payment').textContent = '';
      document.getElementById('cf-total').textContent = '';
      document.getElementById('cf-deposit').textContent = '';
      document.getElementById('cf-remaining').textContent = '';
      document.getElementById('cf-deposit-status').textContent = '';
      document.getElementById('cf-deposit-note').textContent = '';
    } else {
      /* Nothing to confirm — send the customer to the shop. */
      window.location.replace('shop.html');
    }
  }

  UI.boot({ rerender: render });
  render();
})();
