/* Blush Beauty — 404.js (page-not-found copy, localized) */
(function () {
  'use strict';
  var UI = window.UI, I = window.I18N;
  document.getElementById('nf-glyph').innerHTML = UI.icon('search', 22);
  function render() {
    document.querySelector('.empty-state p').textContent =
      I.lang === 'ar'
        ? 'الصفحة التي تبحثين عنها غير موجودة أو تم نقلها.'
        : 'The page you are looking for does not exist or has moved.';
    document.querySelector('.empty-state .btn').textContent =
      I.lang === 'ar' ? 'العودة إلى الرئيسية' : 'Back to Home';
    document.title = I.lang === 'ar' ? 'الصفحة غير موجودة \u2014 بلاش بيوتي' : 'Page Not Found \u2014 Blush Beauty';
  }
  document.addEventListener('lang:change', render);
  render();
})();
