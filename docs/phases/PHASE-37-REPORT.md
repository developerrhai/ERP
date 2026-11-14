NOT COMPLETE — build and API tests done; four items need the owner or later phases (listed under "Open problems").

# PHASE 37 report — Save, stabilise, fix known backend/data bugs

Date: 2026-11-14. Local only. Nothing pushed or deployed. Databases touched: `rhai_erp_test` only.

## Before (V40 parity)
Phase 37 adds no screens, so parity is unchanged from Phase 36 (327 pages, 1,800 tabs, 4,311 fields). The Phase 38 plan builds the parity table.

## What was built
| Item | Result |
|---|---|
| 1 Save | Commits for 22–36 already existed (0a61c03, 1ac7eec, 5623ee2). `PHASE-33.md` heading fixed; `PROGRESS-R2.md` rewritten with the true state. |
| C1 | `loadLines` (procurement/core.ts) joins `items` and adds `item_code`, `item_name`; `uom` and `hsn_sac` fall back to the item's. Used by PO, SO, quotation, GRN, invoice, PR and the other typed documents. DC and MO already returned codes. |
| C2 | HSN / SAC form has GST Rate, Cess %, Rate Effective From; saved together as the dated `hsn_sac_rates` row. The form engine now honours `virtual` fields. One message: "No GST rate for HSN {code} — set it in HSN / SAC." |
| C3 | One shared `unitState()` (4 copies removed). Message "Plant {name} has no state set. Ask Admin to complete it." Unit create requires a 2-digit state code (API + form). |
| C4 | New `GET /hr/attendance/days?month=yyyy-mm` (plant-scoped by the chosen plants). `/hr/ess/me` answers 200 `{data:null, message:"Your login is not linked to an employee record. Ask HR."}`; ESS page shows it. |
| C5 | `project-service` and `project-budget-service` rewritten to the real columns (`code`, `project_manager_id`, `billing_method`, task `number` / `owner_id` / `estimated_hrs`, expense header + line table, budget `total_budget`). Project status DRAFT replaces the invalid PLANNING. Create accepts the web form's snake_case names. |
| C6 | Dashboard guard test for my / plant / owner / departments / modules: no 5xx. The two 500s of the audit no longer reproduce. Balance Sheet key warning was fixed in Phase 36. 403s left in api-calls.csv are real permission answers. |
| C7 | One status-word map (`ui/format.ts`) with PENDING_L1/L2/L3, NOT_REQUIRED, NONE, RETURNED, WAITING_APPROVAL … |
| C8 | New `DateField` (dd-mm-yyyy text, ISO out); 29 files with `<input type="date">` and the shared `Field type="date"` now use it. |
| C9 | Pending approval states (incl. PENDING_L1/L2, WAITING_APPROVAL) grey Submit Approval with "Already sent for approval." |
| C10 | After a save the dialog closes and the saved record opens (`GenericModulePage.afterSave`). |
| Tools | `tools/dev/stop-stale.mjs` (lists / stops only this repo's node on 4100 / 5173 / 5180). |
| Docs | `docs/clicntmassage.md` rewritten (the old file also held real-looking demo passwords; they are gone from the file — they remain in git history, change them if they were ever used live). Steps appended to `docs/client-test-guide.md`. |

## Tests
* API typecheck: 0 errors (was 53 in test files; a sub-agent aligned the tests with current types, no test weakened).
* New tests: `phase37-hsn-rate`, `phase37-hr-ess`, `phase37-projects`, `phase37-dashboards` — all green.
* Existing tests adjusted for the changed behaviour: `screens-forms` (HSN needs a rate), `phase3-masters` (unit needs a state code), web `LetterheadAndAudit`, `HrEmployeesPage`, `FilterBar`, `OrgMasters`, `TypedMasters` (dd-mm-yyyy typing, state code, stale designation payload / duplicate FY text).
* Tier 1: API + web typecheck green. Tier 2 (partial): full API suite 1,369 tests: 1,320 pass, 45 skipped, 4 fail only in the full run (phase21 broadcast, phase23-25 movement, phase29 canteen numbering, users) and pass when run alone → order-dependent flakes, not caused by this phase.
* Migrations replayed on an empty `rhai_erp_test` 3 times: 0 errors.
* Web suite: 71 → 64 failing (all in the old generic page / shell tests).

## Open problems
1. **Web suite not green: 64 stale tests** (GenericModulePage 36 + kit 6, Phase4 10, App 5, ContextSelectors 6, Settings 1). They test the old page body that Phase 38 deletes; rewritten there (DECISION in journal).
2. **`prisma migrate diff` is not 0**: `schema.prisma` models only part of the database (~460 tables, ~1,660 FKs exist only in raw-SQL migrations). Needs an owner decision (OWNER-ACTIONS #2).
3. **`prisma generate` blocked** by the owner's own running `npm run dev` (engine DLL locked); Phase 23 raw-SQL workarounds therefore kept (OWNER-ACTIONS #1).
4. **Lint baseline is red** (≈2,100 pre-existing errors, mostly `no-unsafe-*` in older services and tests). New code follows neighbouring style; a lint clean-up is not part of any phase and should be scheduled.
5. Project expense approval cannot post its GL journal (account 2104 requires a party); the failure is only logged. Belongs to Phase 45.
6. `ui:audit`, crawler and feeders were not run (they need the API/web servers; the owner's dev servers occupy the ports). Run them in Phase 38's Tier 2.

## DB changes
No DB changes (no migration). Only the unit-create API rule and form-engine behaviour changed.

## DEPLOY SHEET
* Migrations: none. New env names: none. Jobs: none.
* 5-minute smoke test: sign in as Administrator → add an HSN with a GST rate → add a plant without a state code (must be refused) → open any form with a date (dd-mm-yyyy) → HR attendance for a month opens.
* Rollback: revert the local commit; no data change to undo.
