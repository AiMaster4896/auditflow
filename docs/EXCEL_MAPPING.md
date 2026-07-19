# EXCEL_MAPPING.md — AuditFlow Phase 1 Workbook Audit

> **Update since this was written:** Adrian confirmed `JMB Tax Allocation`
> and `Date Control` were included in the original spec by mistake — they've
> been dropped entirely (no tables, no import support). This document is
> kept as-is below as the historical record of the original file audit;
> only the `Completed` sheet mapping is still active.

## 1. What was actually inspected

File: `Client database - Control Sheet.xlsx`

**Finding — discrepancy from spec:** the master prompt describes three sheets
(`Completed`, `JMB Tax Allocation`, `Date Control`). The uploaded workbook
contains **only one sheet: `Completed`**. There is no `JMB Tax Allocation` or
`Date Control` sheet in this file.

This means one of two things, and I need Adrian to confirm which:
- this is a **trimmed sample/test copy** used to validate the mapping logic
  before the real file is uploaded, or
- the real workbook genuinely no longer has those tabs (in which case the
  `jmb_tax_tracking` and `audit_work_plans` import paths in Phase 4/7 have
  nothing to import yet, and the schema/UI for them should still be built but
  will start empty).

Everything below is scoped to the `Completed` sheet only.

## 2. Sheet: `Completed`

- Header row: **row 2**, columns **B through Q**
- Data rows: start at **row 4**
- Column **A**: a plain sequence number (1, 2, 3…) — not imported, ignored
- Rows 6–31: **completely blank** — ignored
- Row 32: blank across B–Q except a stray value `"KJPM"` sitting in column
  **R** (outside the mapped column range) — this is orphaned/misplaced data,
  not part of any client row. It will be flagged in the Import Review screen
  and skipped, not guessed at.

### Column-by-column mapping

| Excel column | Header | Sample value | Maps to |
|---|---|---|---|
| B | Company Name | `ABC Sdn Bhd` | `clients.legal_name` |
| C | Company Registration Number | `2222222` | `clients.registration_number` (text) |
| D | FYE | `2025-06-30` | `clients.financial_year_end` |
| E | Audit Fee | `1000` | `clients.audit_fee` (decimal) |
| F | PIC name | *(blank in all rows)* | `client_contacts.name` |
| G | PIC email | *(blank in all rows)* | `client_contacts.email` |
| H | PIC contact number | *(blank in all rows)* | `client_contacts.phone` |
| I | Staff in charged | `CSY`, `ANIS`, `AIN` | `client_service_assignments` (audit staff), via `staff_aliases` |
| J | Partner in charged | `NBL`, `TYF` | `client_service_assignments` (audit partner), via `staff_aliases` |
| K | Audit deadline | date | `client_deadlines` (type = Audit Deadline) |
| L | Form C deadline | date | `client_deadlines` (type = Form C Deadline) |
| M | Form E deadline | date | `client_deadlines` (type = Form E Deadline) |
| N | CP204 deadline | date | `client_deadlines` (type = CP204 Deadline) |
| O | CP204A 6th deadline | date | `client_deadlines` (type = CP204A 6th Deadline) |
| P | CP204A 9th deadline | date | `client_deadlines` (type = CP204A 9th Deadline) |
| Q | CP204A 11th deadline | date | `client_deadlines` (type = CP204A 11th Deadline) |

### Data actually present (5 rows)

| Company | Reg No | FYE | Fee | Staff | Partner |
|---|---|---|---|---|---|
| ABC Sdn Bhd | 2222222 | 2025-06-30 | 1,000 | CSY | NBL |
| DEF Sdn Bhd | 1111111 | 2025-12-31 | 2,000 | ANIS | TYF |
| GDK Sdn Bhd | 444444 | 2026-04-30 | 4,000 | AIN | NBL |
| ZZZ Sdn Bhd | 7777777 | 2026-06-30 | 2,500 | ANIS | NBL |
| JJJ Sdn Bhd | 999999 | 2026-06-30 | 3,000 | AIN | TYF |

**These look like placeholder/test names** (ABC, DEF, GDK, ZZZ, JJJ), not real
client names — worth confirming with Adrian before treating anything here as
production data to seed.

## 3. Data-quality findings

1. **No PIC contact data at all.** Columns F/G/H are blank for every row. The
   import must not fail on this — `client_contacts` rows simply won't be
   created for these 5 clients until someone fills them in.
2. **No broken `#REF!` rows, no `0`/`-` placeholders, no Excel-serial-date
   artifacts** were found in this file — all dates parsed cleanly as real
   dates and registration numbers are already stored as clean text (no
   leading zeros observed, no `.0` decimal artifacts). This is a much cleaner
   file than the spec anticipates, which supports the "trimmed sample" theory
   above.
3. **One orphaned cell** (`KJPM` in R32) outside the data range — treated as
   noise, shown in Import Review, not auto-imported.
4. **Staff aliases needed:** `CSY`, `ANIS`, `AIN` (audit staff) and `NBL`,
   `TYF` (partners) — 5 distinct short codes, none of which are email
   addresses or full names, so none can auto-match a real `profiles` row.
   All five will show as **unresolved** in Import Review until Adrian maps
   them once.
5. **No duplicate company names** in this sample — duplicate-detection logic
   still needs to be built (per spec) for when the real file is used, but
   there's nothing to test it against in this file.
6. **No `JMB Tax Allocation` or `Date Control` sheets** — see section 1.

## 4. Records that will be skipped automatically

- Row 3 (fully blank) and rows 6–31 (fully blank): skipped, not counted as
  errors.
- Row 32: skipped, flagged in Import Review because of the stray `KJPM` value.

## 5. Fields requiring admin review before import commits

- All 5 `Staff in charged` / `Partner in charged` values (alias mapping).
- Nothing else needs review in this particular file — no ambiguous dates,
  no ambiguous company names, no rejected rows.
