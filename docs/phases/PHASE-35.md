# PHASE 35 — Full V40 Regression, Multi-Plant Load/DR Drill & Final Production Cut-Over

## 1. Goal
Final V40 release gate certifying the complete 3-plant (`TAL`, `SAW`, `VAR`) Sawant Group Enterprise ERP before client-wide V40 production cut-over:
1. full 250+ page **Playwright Crawler & Feeder Regression** across all 9 roles and multi-plant combinations (`0` errors, `0` generic fallbacks, `0` console/page/5xx failures);
2. **k6 Multi-Plant Concurrency, Soak & N+1 Load Certification** matching R2-3 speed budgets;
3. **Backup/Restore & Multi-Process Failover Drill** (verify PostgreSQL `pg_dump` restore, `pm2` cluster SSE/cache-bus resilience, and `pg-boss` job recovery);
4. final **Security & ASVS L2 / DPDP Audit Sign-Off** + complete V40 client handover pack.

## 2. Pages
No new feature pages; final verification across **every** page in `registry.json` v2 (`246+` core + Phases 23–34 V40 pages) and `admin-page-health` / `admin-registry`.

## 3. Rules
- STANDARDS §11–§13: zero relaxed assertions, zero skipped tests, zero unindexed FKs (`verify-fk-indexes.ts` = 0), zero unbounded queries (`check-unbounded.ts` = 0), zero secrets (`secrets:scan` = 0).
- Every statutory rate & opening balance batch signed off by the client CA / HR Head / Plant Heads (`needs_review = false` on live statutory rows).
- Cut-over runs ONLY against a verified pre-cut-over backup.

## 4. Database
- No schema changes; runs full migration replay verification (`clean DB → all migrations 00..34 → FK index check → seed → integrity check`).

## 5. Work, logic and examples
- **Full Feeder + Flow E2E (`tests/feed/`):** executes end-to-end business journeys across all 3 units simultaneously:
  - `Lead/Enquiry → Quote → SO → MRP → PR → PO → GRN → Incoming QA → Material Issue → Work Order → IPQC → Move Forward → Final QA → FG → Dispatch → Tax Invoice/IRN → Customer Receipt → GL Trial Balance & P&L`;
  - `Employee Onboard → Attendance → Leave → Payroll Run → Payslip PDF → GL Journal`;
  - `Contract Labour Muster → Wage Sheet → GL Journal`;
  - `Offline Kiosk Capture → Online Sync`.
- **k6 Load & Soak Suite (`tests/perf/`):** 50–100 virtual users across hot list endpoints, SSE streams, and concurrent posting endpoints (`p95` within budget, 0 `5xx`, 0 double-posting).
- **DR Drill:** backup `rhai_erp_test` → drop/recreate → restore → verify row counts, sequences, and GL Trial Balance equality (`Debit == Credit`).

## 6. API
- Verify `GET /api/v1/health/ready`, `GET /api/v1/admin/page-health`, and `GET /api/v1/meta/registry` report 100% healthy, 0 errors, and 0 planned/unbuilt pages.

## 7. Screens
- `admin-page-health` shows 100% green across all 9 roles × plant combinations.
- `admin-registry` shows 100% `built` status across all V40 menu families.

## 8. Messages
- Verify all user-facing error, empty-state, and ActionBar blocked-reason messages across en/hi/mr locales.

## 9. Audit & notifications
- Verify audit log append-only trigger, PII access logging, and multi-process SSE + Web Push + Email delivery during failover drill.

## 10. Tests
- `npm run secrets:scan` (0 findings)
- `npx tsx tools/verify-fk-indexes.ts` (0 unindexed FKs)
- `npx tsx tools/check-unbounded.ts` (0 unbounded queries)
- `npm run verify` (lint, typecheck, unit, API — 3 consecutive clean runs)
- `npm run e2e` + `tests/e2e/crawl.spec.ts` + `tests/feed/` (3 consecutive clean runs, 0 console/HTTP errors)
- `tests/perf/k6-suite.js` (meets p95 latency & 0 errors)

## 11. Acceptance
- [ ] `admin-registry`: 100% V40 pages marked `built` (0 `planned`, 0 `generic`).
- [ ] `admin-page-health`: 0 errors across all 9 roles and all plant combinations (3× clean).
- [ ] k6 load, concurrency double-post, and PostgreSQL backup/restore DR drill passed.
- [ ] ASVS L2 checklist & DPDP compliance register verified.
- [ ] Final `STATUS.md`, `RUNBOOK.md`, `docs/clicntmassage.md`, and `docs/client-test-guide.md` signed off.

## 12. Out of scope
New feature development (any post-V40 requests go to Phase 36+ backlog).

## 13. Owner check
1. Administration → Registry Viewer. ✔️ Every single V40 page shows `Built`.
2. Administration → Page Health. ✔️ `0` errors across all roles and units.
3. Finance → Trial Balance & Stock Valuation. ✔️ Group & unit totals match to the paise.

## 14. Build prompt
~~~
Read CLAUDE.md, STANDARDS, ROADMAP, ERRATA, and PHASE-35.md. Run the full V40 verification suite
(FK check, unbounded check, secrets scan, 3× unit/API/E2E/crawler/feeder runs, k6 load/soak,
backup/restore DR drill). Do NOT modify business logic unless fixing a verified regression. Update
STATUS.md, RUNBOOK.md, docs/clicntmassage.md, and docs/client-test-guide.md. Write
PHASE-35-REPORT.md.
~~~

## 15. Client documents
**clicntmassage.md — NEW in this update:**
- Full V40 Enterprise ERP certified ready across Talwade, Sawardari, and Varale: 100% of screens live, zero-error multi-role verification, load tested, and backup/disaster-recovery verified for production cut-over.

**client-test-guide.md — add:**
- **Owner / Super User:** Administration → Page Health & Registry Viewer → Trial Balance → Order 360°. ✔️ All screens green, all balances exact, ready for go-live.

