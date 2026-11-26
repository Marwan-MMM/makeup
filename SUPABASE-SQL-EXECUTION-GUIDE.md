# Supabase SQL Execution Guide — Run 15

> **TL;DR: Run 15 requires exactly ONE new SQL execution — the Shop-by-Category
> caption migration (`NO PUBLISH Migration - Homepage Category Caption.sql`).**
> It adds two admin-editable columns (`homepage_settings.home_categories_sub_en/_ar`)
> and seeds the new default caption. Everything else in Run 15 is code-side
> (shop labels, wheel segments, navbar, admin form). The Run 14.1 wheel hotfix
> and the Edge Function deployments are already done — see §1 history.

---

## 0. Run 15 — NEW SQL requiring your manual execution

**File:** `NO PUBLISH Migration - Homepage Category Caption.sql`

**What it changes:**
- `ALTER TABLE homepage_settings ADD COLUMN IF NOT EXISTS home_categories_sub_en text`
  and `..._ar text` — the editable caption ABOVE the homepage "Shop by Category"
  heading (English + Arabic).
- Seeds the singleton row (id = 1) with the new copy: **"Realms of beauty" /
  "عوالم الجمال"**. The COALESCE seed rule NEVER overwrites an existing custom
  value (verified in PGlite).

**Why a migration:** the caption must be editable from the admin dashboard and
persist in Supabase. `homepage_settings` is the existing single-row content table
(the Flash/Featured/Bestsellers titles already live there) — the caption follows
the identical pattern, rendered by `home.js` with dictionary fallback when a
value is empty.

**RLS:** no policy changes. The table's existing policies cover the new columns
automatically (public SELECT — the storefront loads the caption anonymously;
admin UPDATE — `is_admin()` policy verified intact: `scripts/test_run15_migrations.mjs`,
17/17 in real PostgreSQL).

**Idempotent:** safe to run any number of times. SQL Editor → *New query* →
paste the whole file → *Run*.

**Verification query (read-only, run after the migration):**
```sql
select id, home_categories_sub_en, home_categories_sub_ar from homepage_settings;
-- expect: 1 | Realms of beauty | عوالم الجمال
```

**After executing:** upload the Run 15 site files to your hosting — the changed
frontend files are `index.html`, `home.js`, `translations.js`, `admin.js`,
`main.js`, `styles.css`, `demo-catalog.js` — then edit the caption under
Admin → Settings → "Shop-by-Category caption (English/Arabic)" and the homepage
updates without any code change.

## 1. Scripts you have ALREADY executed (do NOT run again)

| File | Status |
|---|---|
| `NO PUBLISH Hotfix - Wheel Randomness no pgcrypto.sql` (Run 14.1) | ✅ Executed during the Run 14.1 session — fixed `function gen_random_bytes(integer) does not exist` by rebuilding `wheel_spin()` randomness on PostgreSQL core built-ins (`gen_random_uuid()` + `md5()`). |
| `NO PUBLISH Migration - Wheel Enhancements and Order Spin.sql` (Run 13) | ✅ **Already executed by you.** The copy in this package was corrected in-place (Run 14.1) so fresh installs need no pgcrypto — do not re-run. |
| `NO PUBLISH Migration - Wheel of Fortune.sql` (Run 12, M2) | ✅ Executed in a previous run (copy likewise corrected). |
| `NO PUBLISH Migration - Homepage Popup Settings.sql` (Run 12, M1) | ✅ Executed in a previous run. |
| `NO PUBLISH Migration - Product Cost and Inventory Valuation.sql` (Run 12, M3) | ✅ Executed in a previous run. |
| `NO PUBLISH Database Schema.sql`, shade-pricing and create_order-fix migrations (Runs 1–12 chain) | ✅ Executed in previous runs. |

## 2. Execution order for a FRESH database

If you ever rebuild the project from scratch, run in this order (all additive,
idempotent):

1. `NO PUBLISH Database Schema.sql`
2. `NO PUBLISH Migration - Shade Pricing and Flash Sale.sql`
3. `NO PUBLISH Migration - Fix create_order Function.sql`
4. `NO PUBLISH Migration - Homepage Popup Settings.sql` (M1)
5. `NO PUBLISH Migration - Product Cost and Inventory Valuation.sql` (M3)
6. `NO PUBLISH Migration - Wheel of Fortune.sql` (M2)
7. `NO PUBLISH Migration - Wheel Enhancements and Order Spin.sql` (M13)
8. `NO PUBLISH Migration - Homepage Category Caption.sql` (M15 — Run 15)

pgcrypto is NEVER needed: every wheel migration in this package is pgcrypto-free
(Run 14.1 correction).

## 3. Edge Functions (NOT SQL)

Running SQL in the SQL Editor creates database objects; it does not deploy Edge
Functions. `wheel-spin` and `create-order` are already deployed by you. One
function remains — see `NO PUBLISH - Edge Function Audit (Run 15).md` for the
full audit:

```bash
npx supabase functions deploy storage-cleanup
```

(Required for the admin Storage-audit card; the site degrades gracefully without
it, and no SQL is pending for it.)

## 4. Verification queries (run in SQL Editor — read-only, safe)

```sql
-- a) Run 15: caption columns exist and are seeded
select id, home_categories_sub_en, home_categories_sub_ar from homepage_settings;
-- expect: 1 | Realms of beauty | عوالم الجمال

-- b) Run 14.1: the live wheel_spin has NO gen_random_bytes call
--    (comments may mention it historically; the executable body must not)
select pg_get_functiondef('public.wheel_spin(uuid,text,uuid,text,boolean)'::regprocedure)
  as def \gset
```
A simpler visual check for (b): open the function definition in the editor and
confirm the roll line uses `substr(md5(gen_random_uuid()::text || gen_random_uuid()::text), 1, 16)`.

Run 13 object checks (unchanged from Run 14, all already verified on your project):

```sql
-- c) the order-spin settings singleton exists
select * from public.wheel_settings;

-- d) the four source-aware uniqueness indexes exist
select indexname from pg_indexes where tablename='wheel_participations' order by indexname;

-- e) the grant trigger is attached to orders
select tgname from pg_trigger where tgrelid = 'public.orders'::regclass
  and tgname = 'trg_wheel_order_entitlement';

-- f) the canonical 5-argument spin function exists
select proname, pg_get_function_arguments(oid) from pg_proc
 where proname = 'wheel_spin' and pronamespace = 'public'::regnamespace;
```

## 5. Dependencies & order

1. The caption migration (§0) depends only on `homepage_settings` existing
   (created with the original schema, extended by M1). Nothing else is touched.
2. Fresh installs: §2 order.
3. Edge Function deployment (§3): independent of SQL, no required order.

## 6. Security notes

- No new grants or policies in Run 15: the new caption columns inherit
  `homepage_settings`' existing RLS (public read, admin-only write — both
  re-verified under RLS in PGlite).
- Nothing in Run 15 weakens RLS, grants, or the service-role boundary; prize
  selection stays 100% server-side (`wheel_spin()` security-definer, service-role
  only), and no service-role value appears in any migration or frontend file.
- `wheel-diagnostics.html` remains a read-only tool: its spin-shaped request uses
  a non-existent campaign id and can never create a participation, coupon or
  entitlement.
