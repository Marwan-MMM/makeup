/* ============================================================
   Blush Beauty — config.js
   Public site configuration.

   SUPABASE_URL / SUPABASE_ANON_KEY are PUBLIC values (the anon
   key is safe to expose — Row Level Security protects the data).
   The secret service-role key must NEVER be placed here.

   Without these values the site runs in clearly-labelled DEMO
   mode with local placeholder data. See:
   "NO PUBLISH Supabase Setup Guide.md" and
   "NO PUBLISH Environment Variables Guide.md"
   ============================================================ */

window.BLUSH_CONFIG = {
  // e.g. 'https://xxxxxxxxxxxx.supabase.co'
  SUPABASE_URL: 'https://aegzuedfznmxdrotmygi.supabase.co',

  // e.g. 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' (anon / public key)
  SUPABASE_ANON_KEY: 'sb_publishable_rPWoBwmGglrbcFeaWCnEVw_skgBxlp6',

  // Name of the Edge Function used for order creation.
  // If the function is not deployed, the site falls back to the
  // create_order database function (also protected server-side).
  ORDER_FUNCTION: 'create-order',

  // Storage buckets (created by the database schema)
  BUCKET_PRODUCTS: 'products',
  BUCKET_BRAND: 'brand'
};
