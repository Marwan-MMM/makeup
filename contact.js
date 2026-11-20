/* ============================================================
   Blush Beauty — contact.js
   Contact page driven by admin-editable site settings.
   WhatsApp opens a chat with a pre-filled message. Channels
   that are not configured are shown as disabled cards with an
   honest note — no fake links, no placeholder contact details
   presented as real business information.
   ============================================================ */
(function () {
  'use strict';

  var UI = window.UI, DB = window.DB, I = window.I18N;

  function card(opts) {
    var inner = '' +
      '<div class="contact-glyph">' + UI.icon(opts.icon, 20) + '</div>' +
      '<h3>' + I.t(opts.title) + '</h3>' +
      '<p>' + I.t(opts.text) + '</p>';
    if (opts.value) {
      inner += '<span class="value">' + UI.esc(opts.value) + '</span>';
    }
    if (opts.disabled) {
      inner += '<span class="muted small mt-1">' + I.t('ct_missing') + '</span>';
      return '<div class="contact-card is-disabled">' + inner + '</div>';
    }
    inner += '<a class="text-link" href="' + UI.esc(opts.href) + '" ' + (opts.external ? 'target="_blank" rel="noopener"' : '') + '>' + I.t(opts.cta) + ' ' + UI.icon('arrowRight', 14, 'flip-rtl') + '</a>';
    return '<div class="contact-card">' + inner + '</div>';
  }

  function render() {
    DB.getSettings().then(function (s) {
      var html = '';

      if (s.whatsapp_number) {
        var msg = I.lang === 'ar'
          ? (s.whatsapp_message_ar || s.whatsapp_message_en || '')
          : (s.whatsapp_message_en || s.whatsapp_message_ar || '');
        var waUrl = 'https://wa.me/' + String(s.whatsapp_number).replace(/[^0-9]/g, '') + (msg ? '?text=' + encodeURIComponent(msg) : '');
        html += card({ icon: 'whatsapp', title: 'ct_whatsapp', text: 'ct_whatsapp_text', href: waUrl, cta: 'ct_chat', external: true, value: '+' + String(s.whatsapp_number).replace(/[^0-9]/g, '') });
      } else {
        html += card({ icon: 'whatsapp', title: 'ct_whatsapp', text: 'ct_whatsapp_text', disabled: true });
      }

      if (s.instagram_url) {
        html += card({ icon: 'instagram', title: 'ct_instagram', text: 'ct_instagram_text', href: s.instagram_url, cta: 'ct_follow', external: true });
      } else {
        html += card({ icon: 'instagram', title: 'ct_instagram', text: 'ct_instagram_text', disabled: true });
      }

      if (s.contact_phone) {
        html += card({ icon: 'phone', title: 'ct_phone', text: 'ct_phone_text', href: 'tel:' + String(s.contact_phone).replace(/[^0-9+]/g, ''), cta: 'ct_call', value: s.contact_phone });
      } else {
        html += card({ icon: 'phone', title: 'ct_phone', text: 'ct_phone_text', disabled: true });
      }

      if (s.contact_email) {
        html += card({ icon: 'mail', title: 'ct_email', text: 'ct_email_text', href: 'mailto:' + s.contact_email, cta: 'ct_write', value: s.contact_email });
      } else {
        html += card({ icon: 'mail', title: 'ct_email', text: 'ct_email_text', disabled: true });
      }

      document.getElementById('contact-grid').innerHTML = html;

      var hours = document.getElementById('contact-hours');
      if (s.working_hours) {
        hours.hidden = false;
        hours.innerHTML = '<b>' + I.t('ct_hours') + ':</b> ' + UI.esc(s.working_hours);
      } else {
        hours.hidden = true;
      }
    }).catch(function (err) {
      document.getElementById('contact-grid').innerHTML =
        '<div class="contact-card is-disabled"><div class="contact-glyph">' + UI.icon('alert', 20) + '</div><h3>' + I.t('ct_title') + '</h3><p>' + (err.message || I.t('error_generic')) + '</p></div>';
    });
  }

  UI.boot({ rerender: render });
  render();
})();
