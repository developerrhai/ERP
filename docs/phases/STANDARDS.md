# STANDARDS — read before writing any code, every phase

## 1. Builder rules (the coding chat must obey)
1. Build ONLY the phase you were given. Do not start the next phase. Do not "improve" other phases.
2. If something in the phase file is unclear or contradicts STANDARDS, STOP and ask the owner.
   Never guess a business rule, a tax rate or a number.
3. Never git push, never deploy, never run deploy scripts, never commit unless the owner asks.
4. Never print, copy or commit secrets (.env values, passwords, tokens, keys).
5. Never change index.html. Never delete another phase's code, migration or test.
6. Finish with the Phase Report (§12). A phase is not done until every Acceptance check passes
   3 times in a row from a clean test database.

## 2. Stack (fixed)
Frontend: React 18 + TypeScript (strict) + Vite + React Router; server data with TanStack Query;
forms with React Hook Form + Zod; charts with Chart.js; CSS = tokens copied from index.html (no CSS framework).
Backend: Node 20 LTS + Express 4 + TypeScript (strict) + Prisma 5 + PostgreSQL 16; Zod validation;
pino logs; pg-boss jobs; pdfkit; exceljs; nodemailer.
Tests: Vitest (+ Supertest for API, Testing Library for web), Playwright for e2e.

## 3. Folder layout
apps/api/src/
  core/        auth, rbac, context, http, audit, db, numbering, approval, posting, storage, pdf, excel, jobs, notify
  engine/      generic metadata engine (registry-driven pages)
  modules/<area>/<entity>/  routes.ts controller.ts service.ts repository.ts schemas.ts dto.ts
apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<phaseNN>_<name>/migration.sql   (hand-written SQL)
apps/web/src/
  shell/ components/ lib/ pages/<area>/ styles/
packages/registry/   page registry extracted from index.html (frozen; changes only via a phase file)
packages/calc/       pure calculators (tax, payroll, depreciation, valuation) — no DB, 100% unit-tested
docs/phases/         ROADMAP, STANDARDS, PHASE-00…PHASE-20, PHASE-XX-REPORT

## 4. Layers (one job each)
routes      → path + middleware chain: authenticate → requirePasswordChanged → resolveContext →
              requirePermission(page, action) → validate(zod) → controller
controller  → HTTP only: read validated input, call ONE service method, shape the response. No rules.
service     → business rules, state machine, transactions, calls to other services
              (ApprovalService, PostingService, StockService, NumberingService, AuditService, NotifyService).
repository  → the ONLY code that touches Prisma/SQL. Always applies scope + soft-delete filters.
Cross-module calls go service → service. A module never reads another module's repository or tables.

## 5. Database conventions
- Tables: snake_case plural (sales_invoices). Lines: <header>_lines (sales_invoice_lines).
- PK: id uuid. FKs: <thing>_id, every FK has an index.
- Every business table: unit_id, fy_id (for documents), department, status, version int,
  created_at, created_by_id, updated_at, updated_by_id, deleted_at, deleted_by_id.
- Money numeric(18,2); quantity numeric(18,3); rate/price numeric(18,6); percent numeric(7,4).
  Never float. In TypeScript use Decimal (decimal.js), never number, for money and quantity.
- Dates: `date` for business dates (posting_date, due_date); timestamptz for events. Server TZ UTC,
  business day = Asia/Kolkata.
- Closed lists (statuses of one table) = CHECK constraint. Open lists (voucher types, document
  types) = lookup tables (D-11).
- Unique business numbers per (doc_type, number). Numbering only via NumberingService.
- Migrations: hand-written SQL, forward-only, one folder per change, named with the phase.
  Never `prisma migrate dev`, never `db push`. Then `npx prisma generate` and `npm run db:reset:test`.
- Posted rows (journals, stock ledger, posted documents) are never UPDATEd or DELETEd.
  Corrections = reversal rows. Audit table is append-only (trigger).

## 6. Universal document lifecycle (every transaction document uses it)
Draft ──submit──▶ Pending Approval ──approve (all levels)──▶ Approved ──post──▶ Posted
  ▲                 │ reject → Rejected (back to editable)          │
  └──── edit ───────┘ return → Draft                                ▼ cancel (needs `cancel`)
                                                               Cancelled (reversal posted)
- Edit/delete only in Draft or Rejected. Delete = soft delete with Undo (10 s) for Draft only.
- If the page's module control says approval_required = false, Submit goes straight to Approved.
- Some documents auto-post on approval (the phase file says which).
- Masters use: Active ⇄ Inactive (no approval unless the phase file says so).

## 7. API standards
- Base /api/v1. JSON only. Bearer access token. Context headers X-Unit-Id, X-FY-Id.
- List: GET …?q=&status=&sort=-date&page=1&size=20 → { data:[…], meta:{page,size,total} }.
- Get: { data:{…} } with ETag "<version>". Update needs If-Match. Create accepts Idempotency-Key.
- State changes are verbs: POST …/:id/submit | approve | reject | return | post | cancel.
- Errors: { error:{ code, message, status, requestId, fields? } }. Codes: VALIDATION 422,
  UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404 (also out-of-scope), CONFLICT/VERSION_CONFLICT 409,
  RECORD_LOCKED 409, PERIOD_CLOSED 409, INSUFFICIENT_STOCK 409, RATE_LIMITED 429.
- Every route has a permission check. A route without one fails the route-matrix test.

## 8. Permissions
Actions: view, add, edit, delete, submit, approve, post, cancel, export, print, import, controls.
Resolution: page row → family row → "*" row, per action; explicit deny wins. Module controls
(enabled, allow_add/edit/delete/export, approval_required) bind everybody incl. Super User.
Data scope (OWN/DEPARTMENT/UNIT/ALL) is applied in the repository SQL, never in the UI only.

## 9. Audit
Every write: action, actor, page, record id, before, after (changed fields only), ip, user agent,
request id. Also: login events, exports, prints, downloads, permission changes, approvals.

## 10. UI standards — our users are not computer experts
- Same look as index.html: tokens, sidebar, top bar, page head, chips, tabs, tables, drawer, modal.
- Every page: title + one-line purpose + ONE primary button (top right).
- Forms: required fields marked *, sensible defaults (today's date, my unit, my department),
  dropdowns/lookups instead of typing codes, inline errors under the field in plain English
  ("Enter a quantity greater than 0"), never error codes on screen.
- Disabled buttons show WHY on hover ("Only Draft records can be edited").
- Destructive actions: confirm dialog that names the record; >10 records: type the word DELETE.
- After every save: green toast + the record number. After delete: toast with Undo.
- Empty states say what to do next ("No items yet. Click + Add Item.").
- Numbers: Indian format (₹ 1,25,000.00), dates DD-MM-YYYY on screen, ISO in API.
- Every status shown as the coloured pill from index.html.
- Keyboard: Enter submits, Esc closes; focus trap in modal/drawer; labels on every input.
- Screens must work at 1440 px and on a phone (≤ 600 px), like index.html.

## 11. Tests (each phase)
- packages/calc: unit tests with worked examples from the official source for every formula.
- API: for every endpoint — 401 without token, 403 without permission, 404 out of scope,
  422 validation, happy path, state-machine illegal transitions, audit row written.
- Concurrency: double-submit / double-post tests for every posting endpoint.
- E2E: the "user stories" listed in the phase file, as a normal user would click them.
- Commands: npm run verify (lint + typecheck + unit + API) and npm run e2e. 3 clean runs.

## 12. Phase Report (the builder writes docs/phases/PHASE-XX-REPORT.md)
1. What was built (pages, tables, endpoints). 2. Migrations added (names) and DB changes.
3. Deviations from the phase file and why (should be none). 4. Test results of 3 clean runs.
5. Known issues. 6. Manual check list for the owner (5–15 clicks to try).

## 13. Release checklist (owner, per phase)
Backup prod DB → deploy backend (build, `prisma migrate deploy`, restart, /health OK) →
deploy frontend → smoke test the phase's manual check list → tag the release.


## 14. Release 2 rules (R2-1 … R2-9)
Compiled on 2026-11-12 from how PHASE-22 … PHASE-35, ROADMAP (R-29…R-41) and the Phase 20 targets use them.
Items marked **[CONFIRM]** are my reading, not a written decision; the owner edits them.

- **R2-1 Look.** Every screen follows RHAI_ERP_V40_Edit_Update_Fixed.html: tokens, sidebar, page head, tabs,
  tables, drawer, modal, pills. Page ids, tab names, field labels and button labels are kept letter for letter (R-29).
  Menu and Home tiles: 2 / 4 / 6 per row on phone / tablet / desktop (PHASE-23).
- **R2-2 ActionBar.** Every page uses the one button bar (R-32). No permission = button hidden. The record's state
  blocks it = button greyed with the reason on hover. Word and Move Forward are greyed "Arrives in Phase 27 / 25"
  until built. The server answers with `actionsFor` / the per-row `_a` bitmask.
- **R2-3 Speed.** List endpoints p95 < 300 ms at 100 virtual users with 100k rows per hot table; a posting endpoint
  p95 < 800 ms; errors < 0.5 % (Phase 20 targets). A list of 25 rows opens in about 1 s. Page load (UI) p95 ≤ 2,000 ms
  **[CONFIRM]**. Proven with k6 on the 10 hot lists (Phase 22) and on the full dataset (Phase 33/35).
- **R2-4 Zero-error gate.** A phase is done only when, three times in a row from a clean database: typecheck, lint,
  unit, integration, e2e, feeders, flows, the crawler (9 roles × plant combos, 0 errors), the unbounded-list check,
  the speed budget and axe all pass.
- **R2-5 Empty state.** A screen never shows a made-up number. With no data it says "No {things} yet. Press ＋ Add to
  create the first one." (or "No {things} match your search.").
- **R2-6 Plant scope.** Every list, dashboard and report shows the data of the plants chosen in the top bar (R-37),
  intersected with the user's data scope. The server checks every unit id against `user_units` on every request.
  Creating or posting a document needs exactly one plant.
- **R2-7 Feeders and flows.** Playwright feeders type data in through the real screens as real roles, and flows run
  each user journey (R-40). Fictitious "Demo Engineering Pvt Ltd" data only, on `*_e2e` / `_staging` databases only.
  Nothing is written straight into a database.
- **R2-8 [NOT DEFINED]** No phase file refers to R2-8. Owner: add the rule here if one was intended.
- **R2-9 Deploy sheet.** Every phase report ends with a DEPLOY SHEET for the owner to run by hand: backup, migrations
  (names; CONCURRENTLY scripts for busy tables), new dependencies, environment variables (names only, never values),
  build and restart, health check, smoke list, rollback. The builder never deploys.
