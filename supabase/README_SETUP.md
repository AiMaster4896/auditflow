# Supabase Setup — AuditFlow

Project: **AuditFlow** (ref `qfxwgyeuqkqziemxrfyf`, Singapore region)
Schema, RLS, and RPC functions are already applied (see `docs/DATABASE_PLAN.md`
for what's in there). This document covers the one manual step that's left:
creating the initial admin account.

## Why this step is manual

Supabase Auth users can't be safely created with a chosen password via plain
SQL — passwords need to go through Supabase's own Auth service. So the
temporary admin account has to be created once, by hand, through the
dashboard. Nothing about this account is hard-coded anywhere in the repo.

## Step 1 — Create the auth user

1. Open your Supabase project → **Authentication → Users**.
2. Click **Add user** → **Create new user**.
3. Fill in:
   - Email: `admin@auditflow.local`
   - Password: choose your own strong temporary password (the app forces a
     real password change on first login regardless, so this one only needs
     to be used once)
   - Check **Auto Confirm User** (so it's active immediately, no email
     verification loop for a `.local` address).
4. Save. Copy the generated **User UID** — you'll need it in Step 2, or just
   tell me once it's created and I'll look it up by email.

## Step 2 — Link the account into AuditFlow's tables

Once the auth user exists, this SQL (already prepared, just needs the user
to exist first) creates the matching `profiles` and `organisation_members`
rows, with `must_change_password = true`:

```sql
insert into public.profiles (id, display_name, email, must_change_password)
select id, 'Admin User', email, true
from auth.users
where email = 'admin@auditflow.local'
on conflict (id) do nothing;

insert into public.organisation_members (organisation_id, user_id, role, status)
select '00000000-0000-0000-0000-000000000001', id, 'firm_admin', 'active'
from auth.users
where email = 'admin@auditflow.local'
on conflict (organisation_id, user_id) do nothing;
```

Tell me once Step 1 is done and I'll run this for you.

## Step 3 — Before real/public use

- Sign in once with the temporary credentials — the app will force a
  password change immediately (see `must_change_password`).
- Create a second admin account with your real email, then deactivate or
  delete `admin@auditflow.local`.
- Review Supabase Auth → Settings for rate limiting / brute-force
  protection appropriate for production (the dashboard defaults are a
  reasonable starting point).

## Staff accounts

Staff are never created this way. Once User Management (Phase 8) ships,
admins invite staff from inside the app, which calls the `invite-user`
Edge Function — staff set their own password via the invite email and never
share credentials.
