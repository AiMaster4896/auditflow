# AuditFlow

A static HTML/CSS/vanilla-JS audit & tax practice management app for
NBL & Associates PLT, backed entirely by Supabase (Auth, Postgres, Storage,
Realtime). No frontend framework, no build step, no separate API server.

## Status

- **Phase 1** (workbook audit) — done, see `docs/`
- **Phase 2** (static shell: sign-in, router, sidebar, dashboard) — done
- **Phase 3** (Supabase foundation: schema, RLS, functions) — done, live on
  project `AuditFlow` (Singapore region)
- **Phase 4** onward — not started yet

## Running locally

This is a static site — no build step. Any local static server works, e.g.:

```
npx serve .
```

Then open the printed URL. Before that, copy `config.example.js` to
`config.js` and fill in your Supabase project URL + anon key (already done
for this project's live values — see `config.js`, which is gitignored).

## One manual setup step remaining

See `supabase/README_SETUP.md` — creating the temporary admin account
(`admin@auditflow.local`) has to happen once through the Supabase dashboard,
since Supabase Auth doesn't allow setting a password via plain SQL.

## Deploying

Static output, so GitHub Pages or Netlify both work as-is. Hash routing
(`#/dashboard`, `#/clients`, etc.) means no server-side rewrite rules are
needed.

## Project layout

See `docs/IMPLEMENTATION_PLAN.md` for the full file structure and phase
breakdown.
