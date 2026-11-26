# Supabase SQL Execution Guide — Run 14

> **TL;DR: Run 14 requires NO new SQL execution.** Every fix in this run was code-side
> (Edge Function request headers, error handling, CSS and admin-form layout). The only
> manual steps needed are **deploying two Edge Functions** (deployment is not SQL —
> the SQL Editor cannot deploy functions) and, if you have not already, the Run 13
> migration you told us you already executed.

---

## 1. Scripts you have ALREADY executed (do NOT run again)

| File | Status |
|---|---|
| `NO PUBLISH Migration - Wheel Enhancements and Order Spin.sql` (Run 13) | ✅ **Already executed by you** — confirmed working; do not re-run. |
| `NO PUBLISH Migration - Wheel of Fortune.sql` (Run 12, M2) | ✅ Executed in a previous run. |
| `NO PUBLISH Migration - Homepage Popup Settings.sql` (Run 12, M1) | ✅ Executed in a previous run. |
| `NO PUBLISH Migration - Product Cost and Inventory Valuation.sql` (Run 12, M3) | ✅ Executed in a previous run. |
| `NO PUBLISH Database Schema.sql`, shade-pricing and create_order-fix migrations (Runs 1–12 chain) | ✅ Executed in previous runs. |

## 2. NEW SQL scripts requiring execution in this run

**None.** Run 14 contains no new or modified SQL. If a future defect in the Run 13
migration is ever identified, it will ship as a separate, clearly named corrective
migration — none was needed here (see §4 for proof the Run 13 objects are intact).

## 3. The manual step that actually fixes the spin failure (NOT SQL)

Running SQL in the Supabase SQL Editor creates database objects. It does **not**
deploy Edge Functions — those are deployed separately. Deploy both updated functions
from the project root:

```bash
npx supabase functions deploy wheel-spin
npx supabase functions deploy create-order
```

(The Supabase Dashboard → Edge Functions works equally well. `wheel-spin` must be the
function name — the storefront calls exactly `/functions/v1/wheel-spin`.)

Then verify deployment **independently of the website**:

```bash
curl -s -X GET "$SUPABASE_URL/functions/v1/wheel-spin"
# expect: {"ok":true,"service":"wheel-spin"}
```

Or simply open **`wheel-diagnostics.html`** (shipped in this archive) in your browser
and press *Run diagnostics* — it checks, stage by stage: site configuration → project
reachability → function deployed (GET health) → CORS preflight → function executes
with authentication → storefront state RPC (RLS/grants). A complete real spin should
then succeed on the site; if anything still fails, the modal now names the exact
failing layer (network / deployment / authentication / backend).

## 4. Verification queries (run in SQL Editor — read-only, safe)

Confirm the Run 13 objects you already created are present and intact:

```sql
-- a) the order-spin settings singleton exists and shows current values
select * from public.wheel_settings;

-- b) participations carry the source column
select column_name, column_default from information_schema.columns
 where table_schema='public' and table_name='wheel_participations'
   and column_name='source';

-- c) the four source-aware uniqueness indexes exist
select indexname from pg_indexes where tablename='wheel_participations'
 order by indexname;
-- expect wheel_participations_{user,token}_unique_{free,entitlement}
--        + wheel_participations_nonce_unique

-- d) the grant trigger is attached to orders
select tgname from pg_trigger where tgrelid = 'public.orders'::regclass
  and tgname = 'trg_wheel_order_entitlement';

-- e) the canonical 5-argument spin function exists
select proname, pg_get_function_arguments(oid) from pg_proc
 where proname = 'wheel_spin' and pronamespace = 'public'::regnamespace;
-- expect exactly ONE row: (campaign_id uuid, nonce text, user_id uuid,
--  participant_token text, p_consume_entitlement boolean DEFAULT false)

-- f) any entitlements granted so far (audit)
select count(*) from public.wheel_order_entitlements;
```

If **all six** return as expected, the database side of the wheel is complete —
again: no SQL needs to run for Run 14.

## 5. Dependencies & order

1. Deployments (§3) — independent of each other, no required order.
2. Verification queries (§4) — any time; read-only.
3. If (and only if) query (b), (c) or (e) shows the Run 13 objects MISSING on your
   project, run `NO PUBLISH Migration - Wheel Enhancements and Order Spin.sql` once —
   it is idempotent and additive. Otherwise leave it untouched.

## 6. Security notes

- Nothing in Run 14 weakens RLS, grants, or the service-role boundary; the anon key
  sent as `Authorization: Bearer …` on spin requests is the same public key the
  storefront already uses for every REST call, and prize selection stays 100%
  server-side (`wheel_spin()` security-definer, service-role only).
- `wheel-diagnostics.html` is a read-only tool: its spin-shaped request uses a
  non-existent campaign id, so the function stops at its identity guard and never
  reaches the prize roll; no participation, coupon or entitlement can be created by it.
