// ============================================================
// Blush Beauty — Supabase Edge Function: create-order
//
// The secure entry point for order creation. The service-role
// key stays here, on the server, injected automatically by
// Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars).
// All business validation happens in the create_order database
// function (stock locks, server-side totals, rate limiting) —
// this function is a thin, auditable proxy with CORS handling.
//
// Deploy (requires the supabase/functions/... structure — the
// only folder exception to the flat project layout, because
// the Supabase CLI mandates it):
//   supabase functions deploy create-order --project-ref <ref>
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const VALID_PAYMENTS = new Set(['cod', 'visa', 'mastercard', 'meeza']);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch (_e) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const items = Array.isArray(body?.items) ? body.items : null;
  const customer = body?.customer && typeof body.customer === 'object' ? body.customer : null;
  const method = body?.payment_method;
  const clientRequestId = body?.client_request_id ?? null;

  if (!items || items.length === 0 || items.length > 50) {
    return json({ error: 'Order items are required (max 50)' }, 400);
  }
  for (const it of items) {
    if (!it?.product_id || !Number.isInteger(Number(it?.quantity)) || Number(it.quantity) < 1) {
      return json({ error: 'Each item needs a product_id and quantity >= 1' }, 400);
    }
  }
  if (!customer || !VALID_PAYMENTS.has(method)) {
    return json({ error: 'Customer details and a valid payment method are required' }, 400);
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data, error } = await supabase.rpc('create_order', {
      p_items: items.map((it) => ({
        product_id: String(it.product_id),
        quantity: Number(it.quantity),
      })),
      p_customer: customer,
      p_payment_method: method,
      p_client_request_id: clientRequestId,
    });

    if (error) {
      return json({ error: error.message }, 400);
    }
    return json({ order: data }, 200);
  } catch (_err) {
    return json({ error: 'Order could not be created' }, 500);
  }
});
