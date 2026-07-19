# DATABASE_PLAN.md — Proposed Supabase Schema

> **Update:** the `audit_work_plans` and `jmb_tax_tracking` tables (originally
> tied to the "Date Control" and "JMB Tax Allocation" sheets) were dropped —
> Adrian confirmed those sheets were included in the original spec by
> mistake and aren't wanted. Excel import is scoped to client data only,
> and now lives on the Client List page rather than Firm Settings.

All business tables: UUID primary key, `created_at`, `updated_at` (trigger-maintained),
`organisation_id` (direct or via strict parent FK), RLS enabled, indexed on
FK columns and any field used for filtering.

## Core / identity

| Table | Purpose |
|---|---|
| `organisations` | One row per firm (NBL / Actaxtaxservices). |
| `organisation_settings` | Logo, primary colour, firm-level preferences. |
| `profiles` | One row per Supabase Auth user — display name, `must_change_password`, status. |
| `organisation_members` | Links a `profiles` row to an `organisations` row with a `role` (`firm_admin` / `staff`). This is the single source of truth for "what can this user see" — never trusted from the browser. |

## Clients

| Table | Purpose |
|---|---|
| `clients` | `legal_name`, `registration_number` (text), `financial_year_end`, `audit_fee`, `industry`, `branch`, `company_address`, `directors` (text array), `invoice_to_date`, `collection_to_date`, `workflow_status` (`WIP`/`Completed`/`Quotation`), status. |
| `client_contacts` | PIC name/email/phone, one-to-many per client. |
| `client_service_assignments` | Who's assigned (`assigned_user_id` nullable, `assigned_name_raw`, `assignment_role`, `service_type`, `mapping_status`). |
| `staff_aliases` | Spreadsheet initials/names → real `profiles.id`. |
| `client_aliases` | Spreadsheet company-name variants → real `clients.id`. |

## Deadlines

| Table | Purpose |
|---|---|
| `deadline_rules` | The fallback calculation rules (FYE+6mo, FYE-30d, etc.) — kept as data, not hard-coded, so Adrian can adjust them later. |
| `client_deadlines` | One row per deadline instance: type, date, `source` (`imported_excel`/`calculated_rule`/`manual`), status, completed date, manual-override flag, import batch ID, source sheet/row. |
| `deadline_assignees` | Who owns a given deadline (separate from the general service assignment, so a deadline can be reassigned without touching the client record). |

## Work orders

| Table | Purpose |
|---|---|
| `work_orders` | Staff-initiated create/update/deactivate/invoice/generic requests awaiting admin approval. |
| `approval_actions` | Audit trail of approve/reject + remarks, guaranteed to apply exactly once. |

## Resources, AI Bot, activity

| Table | Purpose |
|---|---|
| `resources` | Metadata for files in private Supabase Storage. |
| `ai_tools` | Admin-managed directory of n8n links (seeded with the Financial Statement Review form). |
| `activity_logs` | Who did what, when — audit trail across the app. |
| `notifications` | In-app notifications (deadline due soon, work order approved, etc.). |

## Virtual Workspace

| Table | Purpose |
|---|---|
| `workspace_user_settings` | Avatar choice (base style, skin tone, hairstyle, hair colour, shirt colour, glasses) per the customization sheet you supplied. |
| `chat_rooms`, `chat_room_members` | Public room + 1:1 private rooms. |
| `chat_messages` | Message content, sender, room, timestamp. |
| `chat_read_receipts` | Per-user last-read tracking. |

## Import machinery

| Table | Purpose |
|---|---|
| `import_batches` | One row per workbook upload attempt. |
| `import_rows` | One row per source spreadsheet row, raw + normalized payload, validation status, and a pointer to whatever it became (`imported_entity_type` / `imported_entity_id`). |

## Row-Level Security approach

- Every policy filters on `organisation_id IN current_organisation_ids()` —
  a `SECURITY DEFINER` SQL function that reads the caller's memberships from
  `organisation_members`, never from a client-supplied value.
- `is_firm_admin(org_uuid)` gates admin-only writes (User Management, Firm
  Settings, import confirmation, work order approval).
- Staff can `INSERT` into `work_orders` for their own organisation but cannot
  directly write to `clients` — client changes always go through
  `work_orders` + `approve_work_order()` for staff, or directly for admins.
- Storage bucket policies mirror the same organisation check.

## Secure RPC / SQL functions

`current_organisation_ids()`, `is_firm_admin(org_uuid)`,
`generate_client_deadlines(client_uuid)`, `approve_work_order(...)`,
`reject_work_order(...)`, `mark_deadline_completed(...)`,
`import_completed_rows(...)`.

All of these run as `SECURITY DEFINER` with a locked-down `search_path`,
resolve the organisation from the authenticated JWT (never trust a
browser-supplied org ID), and have `EXECUTE` restricted to `authenticated`.

## What actually gets written to disk in Phase 3

- `supabase/schema.sql` — full DDL for every table above, indexes, triggers.
- `supabase/policies.sql` (or inlined in schema.sql) — RLS policies.
- `supabase/functions.sql` — the RPCs listed above.
- `supabase/seed.sql` — `deadline_rules` seed data + the `ai_tools` seed
  (Financial Statement Review link) only. No fake clients, no credentials.
- `supabase/functions/invite-user/` — the Edge Function for staff invites.
