/* ============================================================
   Blush Beauty — demo-catalog.js
   Local PLACEHOLDER catalog used ONLY when Supabase is not
   configured (config.js has no URL/key). It lets the prototype
   be previewed and QA-tested end-to-end without a backend.
   It is NOT used once SUPABASE_URL and SUPABASE_ANON_KEY are set.
   ============================================================ */
(function () {
  'use strict';

  var NOW = new Date();
  function daysAgo(n) {
    var d = new Date(NOW.getTime() - n * 86400000);
    return d.toISOString();
  }
  function daysAhead(n) {
    var d = new Date(NOW.getTime() + n * 86400000);
    return d.toISOString();
  }

  var CATEGORIES = [
    { id: 'cat-makeup', slug: 'makeup', parent_id: null, name_en: 'Makeup', name_ar: 'المكياج', image_url: '', display_order: 1, is_active: true, show_on_home: true },
    { id: 'cat-perfumes', slug: 'perfumes', parent_id: null, name_en: 'Perfumes', name_ar: 'العطور', image_url: '', display_order: 2, is_active: true, show_on_home: true },

    { id: 'sub-foundation', slug: 'foundation', parent_id: 'cat-makeup', name_en: 'Foundation', name_ar: 'كريم أساس', display_order: 1, is_active: true },
    { id: 'sub-concealer', slug: 'concealer', parent_id: 'cat-makeup', name_en: 'Concealer', name_ar: 'كونسيلر', display_order: 2, is_active: true },
    { id: 'sub-lipstick', slug: 'lipstick', parent_id: 'cat-makeup', name_en: 'Lipstick', name_ar: 'أحمر شفاه', display_order: 3, is_active: true },
    { id: 'sub-lip-gloss', slug: 'lip-gloss', parent_id: 'cat-makeup', name_en: 'Lip Gloss', name_ar: 'ملمع شفاه', display_order: 4, is_active: true },
    { id: 'sub-mascara', slug: 'mascara', parent_id: 'cat-makeup', name_en: 'Mascara', name_ar: 'مسكارا', display_order: 5, is_active: true },
    { id: 'sub-eyeshadow', slug: 'eyeshadow', parent_id: 'cat-makeup', name_en: 'Eyeshadow', name_ar: 'ظلال العيون', display_order: 6, is_active: true },
    { id: 'sub-blush', slug: 'blush', parent_id: 'cat-makeup', name_en: 'Blush', name_ar: 'بلاشر', display_order: 7, is_active: true },
    { id: 'sub-highlighter', slug: 'highlighter', parent_id: 'cat-makeup', name_en: 'Highlighter', name_ar: 'هايلايتر', display_order: 8, is_active: true },
    { id: 'sub-powder', slug: 'powder', parent_id: 'cat-makeup', name_en: 'Powder', name_ar: 'بودرة', display_order: 9, is_active: true },
    { id: 'sub-eyeliner', slug: 'eyeliner', parent_id: 'cat-makeup', name_en: 'Eyeliner', name_ar: 'آيلاينر', display_order: 10, is_active: true },
    { id: 'sub-brushes', slug: 'makeup-brushes', parent_id: 'cat-makeup', name_en: 'Makeup Brushes', name_ar: 'فرش المكياج', display_order: 11, is_active: true },
    { id: 'sub-skincare', slug: 'skincare', parent_id: 'cat-makeup', name_en: 'Skincare', name_ar: 'العناية بالبشرة', display_order: 12, is_active: true },
    { id: 'sub-accessories', slug: 'beauty-accessories', parent_id: 'cat-makeup', name_en: 'Beauty Accessories', name_ar: 'إكسسوارات الجمال', display_order: 13, is_active: true },
    { id: 'sub-other', slug: 'other', parent_id: 'cat-makeup', name_en: 'Other', name_ar: 'أخرى', display_order: 14, is_active: true }
  ];

  /* Images are empty strings on purpose: the UI renders a styled
     brand placeholder instead of stock photography. Owners upload
     real images via the admin dashboard (Supabase Storage). */
  var PRODUCTS = [
    {
      id: 'demo-p01', sku: 'BB-FD-001', category_id: 'cat-makeup', subcategory_id: 'sub-foundation',
      name_en: 'Velvet Matte Foundation \u2014 Nefertiti Beige', name_ar: 'فيلفت مات فاونديشن \u2014 نفرتيتي بيج',
      description_en: 'A weightless liquid foundation with a soft-matte velvet finish. Blurs pores, evens tone and holds for up to 12 hours without caking. Shade: Nefertiti Beige, for light-to-medium skin with warm undertones.',
      description_ar: 'فاونديشن سائل خفيف الوزن بلمسة مخملية غير لامعة. يخفي المسام، يوحد لون البشرة ويثبت حتى 12 ساعة دون تكتل. الدرجة: نفرتيتي بيج، للبشرة الفاتحة إلى المتوسطة بتحت دافئ.',
      price: 850, discount_price: 680, discount_active: true, discount_starts_at: null, discount_ends_at: daysAhead(21),
      stock: 24, low_stock_threshold: 5, is_active: true, is_featured: true, is_bestseller: false, is_flash_sale: true, sales_count: 34,
      images: [], created_at: daysAgo(26)
    },
    {
      id: 'demo-p02', sku: 'BB-CC-002', category_id: 'cat-makeup', subcategory_id: 'sub-concealer',
      name_en: 'Second Skin Concealer \u2014 Warm Sand', name_ar: 'كونسيلر سيكند سكين \u2014 وورم ساند',
      description_en: 'A buildable, crease-resistant concealer that brightens under-eyes and covers redness with a skin-like finish. Enriched with vitamin E. Shade: Warm Sand.',
      description_ar: 'كونسيلر قابل للترطيب بمستويات متعددة، مقاوم للتجاعيد، يفتح منطقة العين ويغطي الاحمرار بلمسة طبيعية. غني بفيتامين E. الدرجة: وورم ساند.',
      price: 420, discount_price: null, discount_active: false, discount_starts_at: null, discount_ends_at: null,
      stock: 31, low_stock_threshold: 5, is_active: true, is_featured: false, is_bestseller: true, is_flash_sale: false, sales_count: 41,
      images: [], created_at: daysAgo(24)
    },
    {
      id: 'demo-p03', sku: 'BB-LP-003', category_id: 'cat-makeup', subcategory_id: 'sub-lipstick',
      name_en: 'Rosewood Velvet Lipstick', name_ar: 'أحمر شفاه مخملي \u2014 روز وود',
      description_en: 'A creamy, full-coverage lipstick in a dusty rosewood shade. One swipe delivers rich pigment with a blurred velvet effect that stays comfortable on the lips for hours.',
      description_ar: 'أحمر شفاه كريمي بتغطية كاملة بلون روز وود هادئ. طبقة واحدة تكفي لتغطية غنية بلمسة مخملية ناعمة تدوم لساعات على الشفاه.',
      price: 380, discount_price: 290, discount_active: true, discount_starts_at: null, discount_ends_at: daysAhead(21),
      stock: 40, low_stock_threshold: 6, is_active: true, is_featured: false, is_bestseller: true, is_flash_sale: true, sales_count: 67,
      images: [], created_at: daysAgo(22)
    },
    {
      id: 'demo-p04', sku: 'BB-LG-004', category_id: 'cat-makeup', subcategory_id: 'sub-lip-gloss',
      name_en: 'Nile Glow Lip Gloss', name_ar: 'ملمع شفاه نايل جلو',
      description_en: 'A non-sticky, high-shine gloss with a sheer rose tint and a subtle plumping effect. Wear it alone or layered over any lipstick.',
      description_ar: 'ملمع غير لزج بدرجة لمعان عالية ولمسة وردية شفافة وأثر تكثير خفيف. يُستخدم وحده أو فوق أي أحمر شفاه.',
      price: 320, discount_price: null, discount_active: false, discount_starts_at: null, discount_ends_at: null,
      stock: 27, low_stock_threshold: 5, is_active: true, is_featured: false, is_bestseller: false, is_flash_sale: false, sales_count: 22,
      images: [], created_at: daysAgo(21)
    },
    {
      id: 'demo-p05', sku: 'BB-MS-005', category_id: 'cat-makeup', subcategory_id: 'sub-mascara',
      name_en: 'Volume Curve Mascara', name_ar: 'مسكارا فوليوم كيرف',
      description_en: 'A lifting mascara with an hourglass brush that catches every lash for dramatic curve and volume. Smudge-proof and easy to remove with warm water.',
      description_ar: 'مسكارا ترفع الرموش بفرشاة على شكل ساعة رملية تلتقط كل رمشة لمنح انحناء وحجم ملحوظين. مقاومة للبقع وسهلة الإزالة بالماء الدافئ.',
      price: 450, discount_price: 360, discount_active: true, discount_starts_at: null, discount_ends_at: daysAhead(10),
      stock: 3, low_stock_threshold: 5, is_active: true, is_featured: false, is_bestseller: true, is_flash_sale: false, sales_count: 58,
      images: [], created_at: daysAgo(20)
    },
    {
      id: 'demo-p06', sku: 'BB-ES-006', category_id: 'cat-makeup', subcategory_id: 'sub-eyeshadow',
      name_en: 'Twilight Eyeshadow Palette \u2014 12 Shades', name_ar: 'باليت ظلال تويلايت \u2014 12 درجة',
      description_en: 'Twelve buttery-soft shades from warm champagne to deep espresso. Matte, satin and foil finishes that blend effortlessly for everyday and evening looks.',
      description_ar: 'اثنتا عشرة درجة ناعمة كالزبدة من الشامبين الدافئ إلى الإسبريسو الغامق. تشطيبات مات وساتان ولامعة تدمج بسهولة لإطلالات النهار والسهرات.',
      price: 980, discount_price: null, discount_active: false, discount_starts_at: null, discount_ends_at: null,
      stock: 15, low_stock_threshold: 4, is_active: true, is_featured: true, is_bestseller: false, is_flash_sale: false, sales_count: 19,
      images: [], created_at: daysAgo(18)
    },
    {
      id: 'demo-p07', sku: 'BB-BL-007', category_id: 'cat-makeup', subcategory_id: 'sub-blush',
      name_en: 'Petal Soft Blush \u2014 Desert Rose', name_ar: 'بلاشر بيترال سوفت \u2014 ديزرت روز',
      description_en: 'A finely-milled powder blush in a soft desert-rose pink. Sheer-to-buildable payoff that melts into skin for a natural, healthy flush.',
      description_ar: 'بودرة بلاشر ناعمة بطبقات بميلان وردي هادئ. تغطية خفيفة قابلة للزيادة تندمج مع البشرة لإطلالة طبيعية صحية.',
      price: 390, discount_price: 310, discount_active: true, discount_starts_at: null, discount_ends_at: daysAhead(21),
      stock: 22, low_stock_threshold: 5, is_active: true, is_featured: true, is_bestseller: false, is_flash_sale: false, sales_count: 25,
      images: [], created_at: daysAgo(17)
    },
    {
      id: 'demo-p08', sku: 'BB-HL-008', category_id: 'cat-makeup', subcategory_id: 'sub-highlighter',
      name_en: 'Golden Hour Highlighter', name_ar: 'هايلايتر جولدن أور',
      description_en: 'A champagne-gold highlighter with pearl pigments that reflects light softly \u2014 glow without glitter. Suitable for cheekbones, brow bones and collarbones.',
      description_ar: 'هايلايتر بلون الشامبين الذهبي بحبيبات لؤلؤية تعكس الضوء بنعومة \u2014 إشراقة دون لمعان مبالغ. مناسب للوجنتين وحاجبي الصدر.',
      price: 430, discount_price: null, discount_active: false, discount_starts_at: null, discount_ends_at: null,
      stock: 18, low_stock_threshold: 4, is_active: true, is_featured: false, is_bestseller: true, is_flash_sale: false, sales_count: 37,
      images: [], created_at: daysAgo(16)
    },
    {
      id: 'demo-p09', sku: 'BB-PW-009', category_id: 'cat-makeup', subcategory_id: 'sub-powder',
      name_en: 'Translucent Setting Powder', name_ar: 'بودرة ثابتة شفافة',
      description_en: 'An invisible, silky loose powder that sets makeup, blurs shine and extends wear. Universally translucent \u2014 never ashy on deeper tones.',
      description_ar: 'بودرة سائلة حريرية شفافة تثبت المكياج، تخفي اللمعة وتطيل ثبات الإطلالة. شفافة تناسب كل درجات البشرة دون رمادية.',
      price: 520, discount_price: null, discount_active: false, discount_starts_at: null, discount_ends_at: null,
      stock: 26, low_stock_threshold: 5, is_active: true, is_featured: false, is_bestseller: false, is_flash_sale: false, sales_count: 16,
      images: [], created_at: daysAgo(15)
    },
    {
      id: 'demo-p10', sku: 'BB-EL-010', category_id: 'cat-makeup', subcategory_id: 'sub-eyeliner',
      name_en: 'Precision Liquid Eyeliner \u2014 Jet', name_ar: 'آيلاينر سائل دقيق \u2014 أسود',
      description_en: 'A felt-tip liner with a flexible brush point for hairline-fine or bold lines. Waterproof, fast-drying, and stays put for 16 hours.',
      description_ar: 'آيلاينر بأطرحة مرنة تسمح بخطوط دقيقة أو جسورة. مقاوم للماء، يجف سريعاً، ويثبت حتى 16 ساعة.',
      price: 280, discount_price: 225, discount_active: true, discount_starts_at: daysAgo(30), discount_ends_at: daysAgo(3),
      stock: 33, low_stock_threshold: 5, is_active: true, is_featured: false, is_bestseller: false, is_flash_sale: false, sales_count: 20,
      images: [], created_at: daysAgo(14)
    },
    {
      id: 'demo-p11', sku: 'BB-BR-011', category_id: 'cat-makeup', subcategory_id: 'sub-brushes',
      name_en: 'Essential Brush Set \u2014 12 Pieces', name_ar: 'طقم فرش أساسي \u2014 12 قطعة',
      description_en: 'Twelve vegan-fibre brushes covering face and eyes, with a champagne travel case. Soft, dense bristles that do not shed and blend without streaks.',
      description_ar: 'اثنتا عشرة فرشاة بألياف نباتية للوجه والعين مع حافظة سفر بلون الشامبين. ألياف ناعمة كثيفة لا تتساقط وتدمج دون خطوط.',
      price: 1200, discount_price: 940, discount_active: true, discount_starts_at: null, discount_ends_at: daysAhead(14),
      stock: 9, low_stock_threshold: 3, is_active: true, is_featured: false, is_bestseller: true, is_flash_sale: false, sales_count: 29,
      images: [], created_at: daysAgo(12)
    },
    {
      id: 'demo-p12', sku: 'BB-SK-012', category_id: 'cat-makeup', subcategory_id: 'sub-skincare',
      name_en: 'Vitamin C Glow Serum', name_ar: 'سيروم فيتامين سي للإشراق',
      description_en: 'A stable 10% vitamin C serum with ferulic acid to brighten, even tone and soften dark spots over time. Lightweight and layers well under makeup.',
      description_ar: 'سيروم ثابت بتركيز 10% فيتامين سي مع حمض الفيروليك لتفتيح البشرة وتوحيد اللون وتخفيف البقع الداكنة تدريجياً. خفيف ويناسب وضع المكياج فوقه.',
      price: 760, discount_price: null, discount_active: false, discount_starts_at: null, discount_ends_at: null,
      stock: 14, low_stock_threshold: 4, is_active: true, is_featured: false, is_bestseller: false, is_flash_sale: false, sales_count: 18,
      images: [], created_at: daysAgo(11)
    },
    {
      id: 'demo-p13', sku: 'BB-AC-013', category_id: 'cat-makeup', subcategory_id: 'sub-accessories',
      name_en: 'Mirrored Compact Mirror', name_ar: 'مرآة جيب مزدوجة',
      description_en: 'A slim double-sided compact with true-tone mirror and magnifying side, finished in soft blush with a champagne clasp.',
      description_ar: 'مرآة جيب نحيفة بوجهين: مرآة بالألوان الحقيقية وجهار تكبير، بلمسة بلون البلاش الوردي ومزلاج شامبين.',
      price: 240, discount_price: 190, discount_active: true, discount_starts_at: null, discount_ends_at: daysAhead(21),
      stock: 0, low_stock_threshold: 3, is_active: true, is_featured: false, is_bestseller: false, is_flash_sale: false, sales_count: 11,
      images: [], created_at: daysAgo(10)
    },
    {
      id: 'demo-p14', sku: 'BB-AC-014', category_id: 'cat-makeup', subcategory_id: 'sub-accessories',
      name_en: 'Soft Cotton Pads \u2014 200 Pieces', name_ar: 'قطن ناعم \u2014 200 قطعة',
      description_en: 'Double-layered cotton pads for toner, makeup removal and nail care. Soft on skin, lint-free, and packed in a resealable pouch.',
      description_ar: 'قطع قطن بطبقتين للتنير وإزالة المكياج والعناية بالأظافر. ناعمة على البشرة، بدون ألياف متطايرة، وبكيس قابل لإعادة الإغلاق.',
      price: 120, discount_price: null, discount_active: false, discount_starts_at: null, discount_ends_at: null,
      stock: 60, low_stock_threshold: 10, is_active: true, is_featured: false, is_bestseller: false, is_flash_sale: false, sales_count: 23,
      images: [], created_at: daysAgo(9)
    },
    {
      id: 'demo-p15', sku: 'BB-PF-101', category_id: 'cat-perfumes', subcategory_id: null,
      name_en: 'Amber Oud Eau de Parfum \u2014 50 ml', name_ar: 'أمبر عود أو دو بارفان \u2014 50 مل',
      description_en: 'A warm oriental signature: saffron and bergamot open into amber, oud and vanilla. Long-lasting with a soft, memorable sillage.',
      description_ar: 'توقيع شرقي دافئ: الزعفران والبرغموت يفتتحان العطر ثم يأتي العنبر والعود والفانيليا. ثبات طويل وفوحان ناعم لا يُنسى.',
      price: 1450, discount_price: 1150, discount_active: true, discount_starts_at: null, discount_ends_at: daysAhead(21),
      stock: 12, low_stock_threshold: 3, is_active: true, is_featured: true, is_bestseller: true, is_flash_sale: false, sales_count: 44,
      images: [], created_at: daysAgo(25)
    },
    {
      id: 'demo-p16', sku: 'BB-PF-102', category_id: 'cat-perfumes', subcategory_id: null,
      name_en: 'Rose Neroli Eau de Parfum \u2014 50 ml', name_ar: 'روز نيرولي أو دو بارفان \u2014 50 مل',
      description_en: 'A modern floral: Damascus rose and neroli wrapped in white musk and cedar. Fresh on first spray, tender on the drydown.',
      description_ar: 'زهري عصري: ورد دمشقي ونيرولي يلتفان حول المسك الأبيض والأرز. منعش عند الرش الأول، ناعم مع مرور الوقت.',
      price: 1320, discount_price: null, discount_active: false, discount_starts_at: null, discount_ends_at: null,
      stock: 16, low_stock_threshold: 4, is_active: true, is_featured: false, is_bestseller: false, is_flash_sale: false, sales_count: 21,
      images: [], created_at: daysAgo(23)
    },
    {
      id: 'demo-p17', sku: 'BB-PF-103', category_id: 'cat-perfumes', subcategory_id: null,
      name_en: 'White Musk Body Mist \u2014 250 ml', name_ar: 'بودي ميست وايت مسك \u2014 250 مل',
      description_en: 'A feather-light body mist of clean white musk and cotton flowers. Perfect for daytime layers over shower gel and lotion.',
      description_ar: 'بودي ميست خفيف كالريشة بمسك أبيض نقي وأزهار القطن. مثالي للاستخدام اليومي فوق الجل واللوشن.',
      price: 480, discount_price: 390, discount_active: true, discount_starts_at: null, discount_ends_at: daysAhead(10),
      stock: 30, low_stock_threshold: 6, is_active: true, is_featured: false, is_bestseller: true, is_flash_sale: false, sales_count: 48,
      images: [], created_at: daysAgo(19)
    },
    {
      id: 'demo-p18', sku: 'BB-PF-104', category_id: 'cat-perfumes', subcategory_id: null,
      name_en: 'Jasmine Night Perfume Oil \u2014 12 ml', name_ar: 'زيت عطر ياسمين الليل \u2014 12 مل',
      description_en: 'An alcohol-free perfume oil of Egyptian jasmine, warm amber and a hint of sandalwood. Roll on pulse points for an intimate, long-lasting scent.',
      description_ar: 'زيت عطر خالٍ من الكحول بالياسمين المصري والعنبر الدافئ ولمسة صندل. توضع على نقاط النبض لرائحة حميمة طويلة الثبات.',
      price: 560, discount_price: null, discount_active: false, discount_starts_at: null, discount_ends_at: null,
      stock: 20, low_stock_threshold: 4, is_active: true, is_featured: false, is_bestseller: false, is_flash_sale: false, sales_count: 15,
      images: [], created_at: daysAgo(8)
    }
  ];

  /* ---------- Demo product shades ----------
     Demonstrates the shade system without a backend: each shade is a
     variation of ONE product with independent stock and its own image
     gallery. Shade images are tiny inline SVG data URIs (CSP img-src
     already allows 'data:'), so every shade has a distinct
     self-contained gallery; real stores upload photography through
     the admin dashboard instead. */
  var SHADE_ROMAN = ['I', 'II', 'III', 'IV', 'V'];
  function shadeImg(hex, hex2, num, variant) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">' +
      '<rect width="600" height="800" fill="#F4EFE8"/>' +
      '<rect x="60" y="110" width="480" height="580" rx="18" fill="' + hex + '"/>' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + hex2 + '" stop-opacity=".5"/>' +
      '<stop offset="1" stop-color="#FFFFFF" stop-opacity=".16"/></linearGradient></defs>' +
      '<rect x="60" y="110" width="480" height="580" rx="18" fill="url(#g)"/>' +
      '<circle cx="300" cy="400" r="120" fill="#FBF9F6" opacity=".93"/>' +
      '<text x="300" y="388" font-family="Georgia, serif" font-size="66" font-weight="600" text-anchor="middle" fill="#2C2823">' + num + '</text>' +
      '<text x="300" y="442" font-family="Georgia, serif" font-size="26" letter-spacing="8" text-anchor="middle" fill="#675F56">' + variant + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function demoShade(id, productId, num, en, ar, stock, active, tones, price) {
    var suffix = num + ' \u00b7 ' + en.toUpperCase();
    return {
      id: id, product_id: productId, shade_number: num,
      shade_name_en: en, shade_name_ar: ar,
      stock_quantity: stock, low_stock_threshold: 4,
      price: (price === undefined ? null : price),
      is_active: active, display_order: num,
      created_at: daysAgo(20), updated_at: daysAgo(2),
      images: tones.map(function (t, i) {
        return {
          id: id + '-img-' + (i + 1), shade_id: id,
          url: shadeImg(t[0], t[1], String(num), SHADE_ROMAN[i] || String(i + 1)),
          alt: en + ' ' + suffix, position: i, created_at: daysAgo(20)
        };
      })
    };
  }

  var SHADES = [
    /* Rosewood Velvet Lipstick — 4 shades (12 / 8 / 0 / 15 units) */
    demoShade('demo-sh-p03-1', 'demo-p03', 1, 'Rosewood', 'روز وود', 12, true,
      [['#B07D85', '#8A5E67'], ['#C29098', '#9A6870'], ['#D9A6AD', '#B07D85']]),
    demoShade('demo-sh-p03-2', 'demo-p03', 2, 'Velvet Mahogany', 'ماهوجني مخملي', 8, true,
      [['#7A4E52', '#5C3A3E'], ['#8F5D60', '#6B4448']]),
    demoShade('demo-sh-p03-3', 'demo-p03', 3, 'Blush Pink', 'بلاش بينك', 0, true,
      [['#E8A0B0', '#D07F92'], ['#F0B4C1', '#DA8DA0'], ['#F7CBD5', '#E8A0B0']]),
    demoShade('demo-sh-p03-4', 'demo-p03', 4, 'Copper Rose', 'روز نحاسي', 15, true,
      [['#A9625B', '#7E4A44'], ['#C07A6C', '#965A50'], ['#D69381', '#A9625B'], ['#E2A895', '#C07A6C']]),

    /* Velvet Matte Foundation — 3 shades (10 / 8 / 0 units) */
    demoShade('demo-sh-p01-1', 'demo-p01', 1, 'Nefertiti Beige', 'نفرتيتي بيج', 10, true,
      [['#D9B08C', '#C39B76'], ['#E3C3A2', '#D0A983']]),
    demoShade('demo-sh-p01-2', 'demo-p01', 2, 'Warm Ivory', 'عاجي دافئ', 8, true,
      [['#EBD3B4', '#DCBF9C']]),
    demoShade('demo-sh-p01-3', 'demo-p01', 3, 'Golden Sand', 'رملي ذهبي', 0, false,
      [['#C99B62', '#B18551'], ['#D8AC78', '#C1935F']])
  ];

  /* Individual shade pricing demo: these shades carry their own
     selling prices in the database (null = inherit product price).
     Rosewood inherits; the others are individually priced. */
  (function () {
    var byId = { 'demo-sh-p03-2': 360, 'demo-sh-p03-3': 320, 'demo-sh-p03-4': 280 };
    SHADES.forEach(function (s) {
      if (byId[s.id] !== undefined) s.price = byId[s.id];
      else if (s.product_id === 'demo-p03') s.price = null;
    });
  })();

  function findShades(productId) {
    return SHADES
      .filter(function (s) { return s.product_id === productId; })
      .sort(function (a, b) {
        return (a.display_order - b.display_order) || (a.shade_number - b.shade_number);
      });
  }

  var SETTINGS = {
    id: 1,
    brand_name_en: 'Blush Beauty',
    brand_name_ar: 'بلاش بيوتي',
    logo_url: '',
    tagline_en: 'Makeup and fragrance, carefully edited for Egypt.',
    tagline_ar: 'مكياج وعطور منتقاة بعناية لسوق مصر.',
    contact_email: '',
    contact_phone: '',
    whatsapp_number: '',
    whatsapp_message_en: 'Hello Blush Beauty! I would like to ask about a product.',
    whatsapp_message_ar: 'مرحباً بلاش بيوتي! أود الاستفسار عن أحد المنتجات.',
    instagram_url: '',
    working_hours: '',
    show_subcategories: true,
    show_flash_sales: true,
    show_featured: true,
    show_bestsellers: true,
    shipping_fee: 65,
    show_shade_prices: true,
    payment_simulation: true,
    promo_ribbon_enabled: true,
    promo_ribbon_text_en: 'Glow, girl, glow! \u2728',
    promo_ribbon_text_ar: '',
    promo_ribbon_color: '#F72585'
  };

  var HOMEPAGE = {
    id: 1,
    flash_title_en: 'Flash Sales',
    flash_title_ar: 'العروض السريعة',
    featured_title_en: 'Featured',
    featured_title_ar: 'مختارات',
    bestsellers_title_en: 'Bestsellers',
    bestsellers_title_ar: 'الأكثر مبيعاً'
  };

  var BANNERS = [
    {
      id: 'banner-demo-1',
      title_en: 'The Velvet Edit',
      title_ar: 'تشكيلة الفيلفت',
      subtitle_en: 'Soft-matte formulas in warm, wearable tones.',
      subtitle_ar: 'تركيبات مخملية ناعمة بدرجات دافئة تناسب كل يوم.',
      image_url: '',
      link_url: 'shop.html?cat=makeup',
      is_active: true
    }
  ];

  /* ---------- Demo orders (seeded into localStorage once) ---------- */
  var ORDERS_SEED = [
    {
      order_number: 'BB-DEMO-1001', status: 'delivered', payment_method: 'cod', payment_status: 'unpaid',
      full_name: 'Mariam Hassan', phone: '01012340001', email: 'mariam@example.com',
      governorate: 'Giza', city: 'Sheikh Zayed', address: 'Beverly Hills, Building 12, Apt 5', delivery_instructions: '',
      created_days_ago: 12,
      items: [['demo-p03', 2], ['demo-p17', 1]]
    },
    {
      order_number: 'BB-DEMO-1002', status: 'shipped', payment_method: 'meeza', payment_status: 'paid',
      full_name: 'Omar Khaled', phone: '01112340002', email: '',
      governorate: 'Cairo', city: 'New Cairo', address: 'Tagnid MA Place, Tower B, Flat 21', delivery_instructions: 'Call on arrival',
      created_days_ago: 5,
      items: [['demo-p15', 1], ['demo-p07', 1]]
    },
    {
      order_number: 'BB-DEMO-1003', status: 'pending', payment_method: 'cod', payment_status: 'unpaid',
      full_name: 'Salma Adel', phone: '01212340003', email: 'salma@example.com',
      governorate: 'Alexandria', city: 'Smouha', address: 'Victor Emanuel St., Floor 3', delivery_instructions: '',
      created_days_ago: 1,
      items: [['demo-p01', 1], ['demo-p11', 1], ['demo-p02', 1]]
    },
    {
      order_number: 'BB-DEMO-1004', status: 'cancelled', payment_method: 'cod', payment_status: 'unpaid',
      full_name: 'Mariam Hassan', phone: '01012340001', email: 'mariam@example.com',
      governorate: 'Giza', city: 'Sheikh Zayed', address: 'Beverly Hills, Building 12, Apt 5', delivery_instructions: '',
      created_days_ago: 8,
      items: [['demo-p06', 1]]
    }
  ];

  function findProduct(id) {
    for (var i = 0; i < PRODUCTS.length; i++) {
      if (PRODUCTS[i].id === id) return PRODUCTS[i];
    }
    return null;
  }

  function unitPrice(p) {
    if (!p) return 0;
    var live = p.discount_active && p.discount_price !== null && p.discount_price < p.price &&
      (!p.discount_starts_at || new Date(p.discount_starts_at) <= NOW) &&
      (!p.discount_ends_at || new Date(p.discount_ends_at) >= NOW);
    return live ? p.discount_price : p.price;
  }

  function buildDemoOrders() {
    var orders = [];
    ORDERS_SEED.forEach(function (o) {
      var items = [];
      var subtotal = 0;
      o.items.forEach(function (it) {
        var p = findProduct(it[0]);
        if (!p) return;
        var unit = unitPrice(p);
        var line = Math.round(unit * it[1] * 100) / 100;
        subtotal += line;
        items.push({
          product_id: p.id,
          product_name_en: p.name_en,
          product_name_ar: p.name_ar,
          sku: p.sku,
          unit_price: unit,
          quantity: it[1],
          line_total: line
        });
      });
      var shipping = SETTINGS.shipping_fee;
      orders.push({
        id: 'demo-o-' + o.order_number,
        order_number: o.order_number,
        is_demo: true,
        status: o.status,
        payment_method: o.payment_method,
        payment_status: o.payment_status,
        full_name: o.full_name,
        phone: o.phone,
        email: o.email,
        governorate: o.governorate,
        city: o.city,
        address: o.address,
        delivery_instructions: o.delivery_instructions,
        subtotal: Math.round(subtotal * 100) / 100,
        shipping_fee: shipping,
        total: Math.round((subtotal + shipping) * 100) / 100,
        created_at: daysAgo(o.created_days_ago),
        items: items
      });
    });
    return orders;
  }

  function loadOrders() {
    try {
      var raw = localStorage.getItem('blush_demo_orders');
      if (raw) return JSON.parse(raw);
    } catch (e) { /* reseed below */ }
    var orders = buildDemoOrders();
    try { localStorage.setItem('blush_demo_orders', JSON.stringify(orders)); } catch (e) { /* ignore */ }
    return orders;
  }

  window.DEMO = {
    get mode() { return 'demo'; },
    categories: CATEGORIES,
    products: PRODUCTS,
    shades: SHADES,
    settings: SETTINGS,
    homepage: HOMEPAGE,
    banners: BANNERS,
    findProduct: findProduct,
    findShades: findShades,
    unitPrice: unitPrice,
    loadOrders: loadOrders,
    saveOrders: function (orders) {
      try { localStorage.setItem('blush_demo_orders', JSON.stringify(orders)); } catch (e) { /* ignore */ }
    }
  };
})();
