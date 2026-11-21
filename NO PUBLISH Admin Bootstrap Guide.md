# NO PUBLISH Admin Bootstrap Guide

There is **no public admin registration** anywhere in the app. An administrator is a Supabase Auth user that also has a row in the `admin_users` table. Both steps are manual and server-side by design.

## Create the first administrator

### Step 1 — Create the Auth user

Supabase Dashboard → **Authentication → Users → Add user**:

- Email: your admin email (e.g. `admin@blushbeauty.example`)
- Password: a strong password (store it in a password manager)
- Check **Auto Confirm User** (no email verification round-trip is needed for the prototype)

### Step 2 — Authorize the user

Copy the **User UID** shown in the users table, then in the SQL Editor:

```sql
insert into public.admin_users (id, email, display_name)
values ('<paste-the-user-uid-here>', 'admin@blushbeauty.example', 'Store Owner')
on conflict (id) do nothing;
```

A convenience variant that looks the user up by email (run after Step 1):

```sql
insert into public.admin_users (id, email)
select id, email from auth.users where email = 'admin@blushbeauty.example'
on conflict (id) do nothing;
```

### Step 3 — Sign in

Open `https://your-site/admin.html` (or `admin.html` locally) and sign in with that email and password. The dashboard verifies admin status through `am_i_admin()` (a server-side SECURITY DEFINER function) — an authenticated user **without** an `admin_users` row is signed out with the message "This account is not authorized as an administrator."

## Add another administrator

Repeat Steps 1–2 for the new email. Keep the list short — every admin can read customer data and modify the store.

## Remove an administrator

```sql
delete from public.admin_users where email = 'leaving-admin@example.com';
```

Their next request fails the `is_admin()` check everywhere, including the storage write policies. Optionally also delete the Auth user from the dashboard to revoke the session refresh token.

## Verify authorization works

As a non-admin test user (or anon):

```sql
-- must return false / raise Not authorized
select public.am_i_admin();
select public.admin_set_order_status(gen_random_uuid(), 'pending');
```

In the dashboard, the admin header shows the signed-in email; if you see `PREVIEW` instead, Supabase is not connected (check `config.js`).

## Password recovery

The prototype does not build a password-reset UI. If an admin forgets their password: Supabase Dashboard → Authentication → Users → ⋯ menu → **Send password recovery**, or **Reset password** directly. Add a reset form later if you want a self-service flow.
