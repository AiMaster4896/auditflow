# IMPLEMENTATION_PLAN.md

## 1. File structure to be created

```
/
├── index.html
├── README.md
├── config.example.js          # placeholders only — never real keys
├── .gitignore                 # must ignore config.js (the real one)
├── assets/
│   ├── css/styles.css
│   └── js/
│       ├── app.js
│       ├── router.js          # hash routing: #/dashboard etc.
│       ├── auth.js
│       ├── supabase-client.js
│       ├── permissions.js
│       ├── dashboard.js
│       ├── clients.js
│       ├── work-orders.js
│       ├── resources.js
│       ├── ai-bot.js
│       ├── users.js
│       ├── settings.js
│       ├── excel-utils.js
│       ├── workspace.js
│       ├── avatars.js
│       └── chat.js
├── supabase/
│   ├── schema.sql
│   ├── seed.sql
│   ├── README_SETUP.md
│   └── functions/invite-user/
├── docs/                       # this folder
└── reference/
    └── Client database - Control Sheet.xlsx
```

## 2. Phased build order (unchanged from the spec)

1. **Workbook audit & planning** — this document set. ⏳ *you are here*
2. Static shell (sign-in, router, sidebar, dashboard placeholder pages)
3. Supabase foundation + login (schema, RLS, Auth, forced password change)
4. Excel import tool — lives on the Client List page (upload, blank template
   download, plus manual add/edit/delete). No JMB Tax Allocation / Date
   Control support — dropped, see note in `DATABASE_PLAN.md`.
5. Clients & Work Orders
6. Deadlines & Dashboard
7. Resources, Users, Firm Settings
8. AI Bot directory
9. Virtual Workspace, avatars, chat
10. Integration, security review, deployment docs

Each phase ends with something testable before moving to the next — nothing
in Phase 5 onward gets built against a schema that hasn't been reviewed.

## 3. Supabase connectivity — what's actually needed to build phases 3+

This chat environment's sandbox has **no outbound network access**, so I
cannot directly run SQL against a live Supabase database, call the Supabase
Management API, or deploy Edge Functions from here on my own. To go from
"schema on paper" to "schema running in your project," one of these needs to
happen:

**Option A — connect the official Supabase MCP connector to this chat.**
Anthropic has an official Supabase integration that lets me create the
project, run migrations, manage RLS, and deploy Edge Functions directly,
with you approving each step. This is the smoothest path and keeps you from
copy-pasting SQL by hand. I'll suggest connecting it below.

**Option B — you run `supabase/schema.sql` yourself.** I generate the full
SQL file, you paste it into the Supabase SQL Editor (or run it via the
Supabase CLI) yourself. Slower to iterate, but no new connector needed and no
credentials ever touch this chat.

**Option C — build in Claude Code / Cowork instead of this chat.** Those
environments do have outbound network access, so if you'd rather hand the
whole multi-phase build to an agentic coding session (with you supplying the
Supabase project URL, anon key, and — only inside that sandboxed session,
never committed to the repo — a service-role key or personal access token
for migrations), that also works well for a project this size.

Whichever option you pick, the **frontend itself only ever holds the project
URL and the anon/publishable key** (safe to expose, protected entirely by
RLS). The service-role key, DB password, and any Supabase personal access
token are never written into `index.html`, any `.js` file, `README.md`, or
anything that goes to GitHub — they're used once, out-of-band, to stand up
the schema and the `invite-user` Edge Function.

## 4. Initial admin account

- Created via Supabase Dashboard (Auth → Users → Invite/Create) or a
  one-time bootstrap script — never hard-coded into any committed file.
- `admin@auditflow.local` / a one-time chosen temporary password, `must_change_password = true`.
- On first sign-in, the app checks that flag and forces a password change
  before any other page is reachable.
- `supabase/README_SETUP.md` documents the exact manual steps so you (or
  whoever sets up a fresh environment later) isn't dependent on me being in
  the loop.

## 5. Staff invitations

- Admin fills in name/email/designation/role in User Management.
- That calls the `invite-user` Edge Function (the only place the
  service-role key lives, server-side inside Supabase — never in the
  browser).
- Staff receives a Supabase Auth invite, sets their own password, signs in
  through the same login page as admins, and the app hides admin-only pages
  based on their `organisation_members.role`.

## 6. Open questions before Phase 2 starts

1. Is the uploaded workbook a test/sample file, or does it reflect the real
   production data (see `EXCEL_MAPPING.md` §1)?
2. Do you already have a Supabase project, or should one be created from
   scratch as part of this build?
3. Which of Option A/B/C above do you want for actually running the schema
   and Edge Functions?
