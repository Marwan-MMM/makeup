/* ============================================================
   Blush Beauty — home.js
   Homepage: category shortcuts, promo banners, flash sales
   (with countdown), featured and bestseller rows.
   ============================================================ */
(function () {
  'use strict';

  var UI = window.UI, DB = window.DB, I = window.I18N;
  var countdownTimer = null;

  function render() {
    stopCountdown();
    DB.getSettings().then(function (s) { return renderAll(s); })
      .catch(function () { return renderAll({}); });

    function renderAll(s) {
      DB.getHomepage().then(function (hp) {
        setIf('flash-title', I.lang === 'ar' ? (hp.flash_title_ar || hp.flash_title_en) : (hp.flash_title_en || hp.flash_title_ar));
        setIf('featured-title', I.lang === 'ar' ? (hp.featured_title_ar || hp.featured_title_en) : (hp.featured_title_en || hp.featured_title_ar));
        setIf('best-title', I.lang === 'ar' ? (hp.bestsellers_title_ar || hp.bestsellers_title_en) : (hp.bestsellers_title_en || hp.bestsellers_title_ar));
        /* Run 15: the caption above "Shop by Category" is admin-editable
           (homepage_settings.home_categories_sub_en/_ar). An empty value
           falls back to the dictionary text — same rule as the titles. */
        setIf('home-categories-sub', I.lang === 'ar' ? (hp.home_categories_sub_ar || hp.home_categories_sub_en) : (hp.home_categories_sub_en || hp.home_categories_sub_ar));
      }).catch(function () { /* keep dictionary titles */ });

      renderCategories();
      renderBanners();
      renderRibbon(s);

      if (s.show_flash_sales === false) {
        hide('section-flash');
      } else {
        DB.getFlashSales(8).then(function (items) {
          /* Empty state instead of hiding: the section stays visible
             with an explanatory note (never a blank page). */
          if (!items.length) return showNote('section-flash', 'flash-row', 'empty');
          show('section-flash');
          document.getElementById('flash-row').innerHTML = items.map(UI.productCard).join('');
          startCountdown(items);
        }).catch(function () { showNote('section-flash', 'flash-row', 'error'); });
      }

      if (s.show_featured === false) {
        hide('section-featured');
      } else {
        DB.getFeatured(8).then(function (items) {
          if (!items.length) return showNote('section-featured', 'featured-row', 'empty');
          show('section-featured');
          document.getElementById('featured-row').innerHTML = items.map(UI.productCard).join('');
        }).catch(function () { showNote('section-featured', 'featured-row', 'error'); });
      }

      if (s.show_bestsellers === false) {
        hide('section-best');
      } else {
        DB.getBestsellers(8).then(function (items) {
          if (!items.length) return showNote('section-best', 'best-row', 'empty');
          show('section-best');
          document.getElementById('best-row').innerHTML = items.map(UI.productCard).join('');
        }).catch(function () { showNote('section-best', 'best-row', 'error'); });
      }
    }
  }

  function setIf(id, value) {
    var el = document.getElementById(id);
    if (el && value) el.textContent = value;
  }
  function hide(id) { var el = document.getElementById(id); if (el) el.hidden = true; }
  function show(id) { var el = document.getElementById(id); if (el) el.hidden = false; }

  /* Sections render a visible note instead of disappearing when the
     database returns no rows or the query fails — the homepage must
     never collapse to an empty shell because of a data error. */
  function showNote(sectionId, rowId, kind) {
    show(sectionId);
    var row = document.getElementById(rowId);
    if (row) {
      row.innerHTML = '<p class="row-note' + (kind === 'error' ? ' row-note-error' : '') + '">' +
        UI.esc(kind === 'error' ? I.t('home_error_note') : I.t('home_empty_note')) + '</p>';
    }
  }

  function renderCategories() {
    DB.getCategories().then(function (cats) {
      var main = cats
        .filter(function (c) { return !c.parent_id && c.is_active && c.show_on_home; })
        .sort(function (a, b) { return (a.display_order || 0) - (b.display_order || 0); });
      var grid = document.getElementById('cat-grid');
      if (!grid) return;
      if (!main.length) {
        grid.innerHTML = '<p class="muted">' + I.t('home_empty_note') + '</p>';
        return;
      }
      grid.innerHTML = main.map(function (c, i) {
        var name = I.lang === 'ar' ? (c.name_ar || c.name_en) : (c.name_en || c.name_ar);
        var seed = i + name.length;
        return '<a class="cat-card" href="shop.html?cat=' + encodeURIComponent(c.slug) + '" aria-label="' + UI.esc(name) + '">' +
          (c.image_url
            ? '<img src="' + UI.esc(c.image_url) + '" alt="' + UI.esc(name) + '">'
            : '<div class="ph ph-tone-' + (i % 3) + '"><span>' + UI.esc(initialsOf(name)) + '</span><span class="ph-note">' + I.t('cat_placeholder_note') + '</span></div>') +
          '<div class="cat-caption"><span class="cat-name">' + UI.esc(name) + '</span>' +
          UI.icon('arrowRight', 16, 'flip-rtl') +
          '</div></a>';
      }).join('');
    }).catch(function () {
      /* Query failed (permissions, connectivity): show the note rather
         than leaving the category grid silently empty. */
      var grid = document.getElementById('cat-grid');
      if (grid) grid.innerHTML = '<p class="muted">' + UI.esc(I.t('home_error_note')) + '</p>';
    });
  }

  function initialsOf(name) {
    var w = String(name || '').trim().split(/\s+/);
    return ((w[0] || '').charAt(0) + (w[1] ? w[1].charAt(0) : '')).toUpperCase() || 'B';
  }

  /* Animated promo ribbon under "Shop by Category".
     Enabled by default; text, Arabic text and background color come
     from site settings (admin: Settings -> Promo Ribbon). When the
     setting is absent (column not migrated yet) the defaults apply. */
  var RIBBON_DEFAULT_TEXT = 'Glow, girl, glow! \u2728';
  var RIBBON_DEFAULT_COLOR = '#F72585';
  var RIBBON_REPEATS = 20; /* per group; keeps one group wider than any viewport */

  function renderRibbon(s) {
    s = s || {};
    var sec = document.getElementById('section-promo-ribbon');
    var ribbon = document.getElementById('promo-ribbon');
    var track = document.getElementById('ribbon-track');
    if (!sec || !ribbon || !track) return;

    if (s.promo_ribbon_enabled === false) { sec.hidden = true; return; }

    var textEn = s.promo_ribbon_text_en || RIBBON_DEFAULT_TEXT;
    var text = I.lang === 'ar' ? (s.promo_ribbon_text_ar || textEn) : textEn;
    var color = s.promo_ribbon_color || RIBBON_DEFAULT_COLOR;

    ribbon.style.background = color;
    var item = '<span class="ribbon-item">' + UI.esc(text) + '</span>';
    var group = '<span class="ribbon-group">' + item.repeat(RIBBON_REPEATS) + '</span>';
    track.innerHTML = group +
      '<span class="ribbon-group" aria-hidden="true">' + item.repeat(RIBBON_REPEATS) + '</span>';
    sec.hidden = false;
  }

  function renderBanners() {
    DB.getBanners().then(function (banners) {
      var section = document.getElementById('section-banner');
      var stack = document.getElementById('banner-stack');
      if (!banners.length) return hide('section-banner');
      show('section-banner');
      stack.innerHTML = banners.map(function (b, i) {
        var title = I.lang === 'ar' ? (b.title_ar || b.title_en) : (b.title_en || b.title_ar);
        var sub = I.lang === 'ar' ? (b.subtitle_ar || b.subtitle_en) : (b.subtitle_en || b.subtitle_ar);
        var link = b.link_url || 'shop.html';
        return '<div class="banner-card">' +
          (b.image_url
            ? '<img src="' + UI.esc(b.image_url) + '" alt="' + UI.esc(title) + '">'
            : '<div class="ph ph-tone-' + ((i + 1) % 3) + '"><span>' + UI.esc(initialsOf(title)) + '</span><span class="ph-note">' + I.t('cat_placeholder_note') + '</span></div>') +
          '<div class="banner-content">' +
          (sub ? '<p class="overline">' + UI.esc(sub) + '</p>' : '') +
          '<h2 class="display-2">' + UI.esc(title) + '</h2>' +
          '<a class="btn btn-outline btn-sm mt-2" href="' + UI.esc(link) + '">' + I.t('banner_cta') + '</a>' +
          '</div></div>';
      }).join('');
    }).catch(function () { hide('section-banner'); });
  }

  function startCountdown(items) {
    var host = document.getElementById('flash-countdown');
    var ends = items.map(function (p) {
      return p.discountEnds ? new Date(p.discountEnds).getTime() : 0;
    }).filter(Boolean);
    if (!ends.length) { host.innerHTML = ''; return; }
    var target = Math.min.apply(null, ends);
    function tick() {
      var diff = target - Date.now();
      if (diff <= 0) { render(); return; }
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      host.innerHTML = '<span class="countdown">' + UI.icon('clock', 14) + I.t('ends_in') +
        ' <span class="cd-num num">' + d + I.t('cd_d') + ' ' + String(h).padStart(2, '0') + I.t('cd_h') + ' ' + String(m).padStart(2, '0') + I.t('cd_m') + '</span></span>';
    }
    tick();
    countdownTimer = setInterval(tick, 30000);
  }

  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  UI.boot({ active: 'home', rerender: render });
  render();
})();
