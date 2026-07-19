# IMPORT_RULES.md — Normalization and Import Logic

## 1. Placeholder handling

Treated as blank unless the admin explicitly overrides on the Import Review
screen:
- empty cell
- `-`
- `0`
- `#REF!`
- whitespace-only string

## 2. Company name normalization (matching only, never overwrites the stored legal name)

- trim leading/trailing spaces
- collapse repeated internal spaces
- strip numbering prefixes (`1.`, `12.`)
- normalize punctuation (curly quotes → straight, en/em dash → hyphen, etc.)
- compare case-insensitively

The normalized form is used only to detect likely duplicates. The original
spelling from the workbook is always preserved in `*_raw` columns.

## 3. Registration numbers

- always stored and compared as **text**
- strip any accidental Excel decimal formatting (`2222222.0` → `2222222`)
- leading zeros preserved exactly
- never invented if missing — left null

## 4. Dates

- parser must handle Excel serial numbers, native datetime values, and
  formatted text dates
- stored as PostgreSQL `date` in `Asia/Kuala_Lumpur`
- impossible dates (e.g. day 32) rejected outright
- ambiguous dates (e.g. could be DD/MM or MM/DD) routed to Import Review,
  never guessed silently

## 5. Idempotency / stable import key

Re-uploading the same workbook must not create duplicate rows. The stable key
for a `client_deadlines` row is the combination of:

```
organisation_id + source_sheet + normalized_company_name + FYE + deadline_type + deadline_date
```

If a row with the same key already exists, the import either skips it or
updates non-destructively (never silently overwrites a manually-edited or
previously imported value) — imported/manual data always wins over a
re-import of the same source row.

## 6. Deadline priority rule

- `imported_excel` deadlines always take priority over `calculated_rule`
  deadlines
- a calculated (rule-based) deadline is generated **only** when no valid
  imported deadline of that type exists for that client
- reconciliation never overwrites an `imported_excel` or `manual` deadline
- `Recalculate from rules` is an explicit admin action that previews
  old-vs-new values before anything is written

## 7. Staff & client alias tables

`staff_aliases`: `organisation_id, alias, user_id (nullable), active`
`client_aliases`: `organisation_id, alias, client_id (nullable), active`

Unmapped aliases remain visible as raw imported text (e.g. `"CSY"`,
`"ANIS"`) and are never auto-assigned to a guessed user or client. Mapping is
a one-time admin action per alias — once `CSY` is mapped to a real user, every
future import of `CSY` resolves automatically.

## 8. Dry Run

Every import can be run in "Dry Run" mode: full parsing + validation +
duplicate detection, with a complete preview (valid / warning / rejected /
duplicate counts), but **zero rows written**. Only a second, explicit
"Confirm Import" step calls the insert RPCs.

## 9. Import batch tracking

Every import (dry run or real) is optionally logged to `import_batches`
(filename, imported_by, imported_at, status, valid/warning/rejected counts).
Real imports additionally write one `import_rows` record per source row, with
both the raw payload and the normalized payload, so any row can be traced
back to its exact origin (sheet + row number) later.
