# 06d — Quality / QMS: extra functions, edge cases, test plan, build tickets, reviewer checklist (sections 9–13 of the plan)

> Part of `06-QUALITY-QMS.md` (index). Rule ids `BR-QMS-nn` are in `06c`; tables in `06b`; pages in `06a`.

## 9. Extra functions beyond the prototype `[ADD]`

Priority: **MUST** = built in this plan (a ticket is named); **SHOULD** = designed here and built in the ticket named; **COULD** = designed only (backlog, not built). Sources are in section 15.

| # | Function | Prio | Why | Source | Ticket |
|---|---|---|---|---|---|
| 1 | Automatic NCR when a lot is rejected / pieces fail (idempotent) | MUST | the client re-types rejects into a register today | SAP QM notification, ERPNext NC | T-QMS-22 |
| 2 | Usage decision with stock release from QC hold | MUST | "reject must not be usable" | SAP QM usage decision, D365 quality order blocking | T-QMS-18/19 |
| 3 | AQL sampling table as data + sample / Ac / Re lookup | MUST | the client's formula table | client sheet, IS 2500 | T-QMS-11/14 |
| 4 | Plan revision control with frozen snapshot per inspection | MUST | IATF record traceability | IATF 16949, control plan | T-QMS-14/17 |
| 5 | Calibration due logic + automatic blocking of overdue instruments | MUST | measuring with an overdue gauge invalidates results | ISO/IEC 17025, ISO 10012 | T-QMS-15 |
| 6 | Out-of-tolerance impact review (look-back list of affected inspections) | MUST | ISO/IEC 17025 7.10 practice | CASRAI guide | T-QMS-16 |
| 7 | Instrument picked per reading, refused when blocked | MUST | traceability of every reading | MSA / 17025 | T-QMS-17 |
| 8 | Four-eyes approvals (plan, deviation, scrap, CAPA close, ISIR) | MUST | audit evidence | IATF 16949 | T-QMS-12 |
| 9 | 8D gates D1–D8 and 90-day effectiveness check | MUST | client's 8D format; IATF 10.2 | 8D guides | T-QMS-24 |
| 10 | 5-Why with "why made" and "why missed" chains | MUST | client's Why-Why sheet | client | T-QMS-25 |
| 11 | Disposition lines with quantity coverage, rework / scrap hand-off | MUST | client register: hold = rework + reject | client | T-QMS-22/23 |
| 12 | COPQ lines (internal / external) + monthly inputs + prevention / appraisal | MUST | client COPQ sheets | Feigenbaum / ASQ | T-QMS-22/28 |
| 13 | Supplier monthly scorecard (PPM, score, OTIF, audit, grade) + auto SCAR | MUST | client supplier PPM rating | supplier scorecards | T-QMS-26 |
| 14 | Cp / Cpk / Pp / Ppk study on in-process readings | MUST | frozen tab "Process Capability" | AIAG SPC | T-QMS-20 |
| 15 | Defect Pareto and rejection trend | MUST | client summary charts | quality tools | T-QMS-28 |
| 16 | Photo / certificate attachments (magic-byte checked) | MUST | 8D photographs, calibration certificates | client | T-QMS-12 |
| 17 | Client-layout Excel exports and 15 print forms | MUST | the client's forms must be reproducible | client | T-QMS-29/34 |
| 18 | In-process hold / release and defect escalation streak | MUST | frozen tabs "Hold Release", "Defect Escalation" | Odoo control points + alerts | T-QMS-20 |
| 19 | Release certificate number on final accept; dispatch release query | MUST | frozen tab "Release Certificate" | client | T-QMS-21 |
| 20 | ISIR with ballooned characteristics, 5 samples, reviewer approval | MUST | client ISIR | PPAP / ISIR | T-QMS-21 |
| 21 | Instrument import from the client's instrument sheets | MUST | 57 instruments exist in sheets | client | T-QMS-15 |
| 22 | Quality Alert one-pager with OK / NOT-OK photos | MUST | client Q-Alert | client | T-QMS-25 |
| 23 | Minutes of meeting and improvement-idea register | SHOULD | client forms 9 and 10 | client | T-QMS-27 |
| 24 | Control-plan reference and reaction plan per characteristic | SHOULD | AIAG control plan columns | AIAG control plan | T-QMS-14 (columns) |
| 25 | PPAP 18-element checklist on ISIR | SHOULD | customer submissions | AIAG PPAP | T-QMS-21 (`header_data.ppap`, 18 booleans, shown as a checklist; no new table) |
| 26 | Gauge-resolution warning (least count > 10 % of tolerance band) | SHOULD | MSA good practice (10:1 rule — unverified as a universal rule) | MSA | T-QMS-17 |
| 27 | Batch / heat trace report ("where was heat X used / inspected / rejected") | SHOULD | recall readiness for steel plate | traceability | T-QMS-28 (`GET /qms/reports/trace?heatNo=`) |
| 28 | Mobile-friendly inspection entry (responsive grid, large OK/NG buttons) | SHOULD | shop-floor tablets | Odoo quality app | T-QMS-31 |
| 29 | Customer complaint intake as NCR source with customer reference | SHOULD | client 8D starts from a customer complaint | IATF 10.2.3 | T-QMS-22 |
| 30 | Notification stub for due / overdue items | SHOULD | reminders | — | T-QMS-12 (`notifyUser`) |
| 31 | SPC control charts with run rules (Western Electric / Nelson) | COULD | go beyond Cpk | AIAG SPC | backlog |
| 32 | MSA Gage R&R studies (ANOVA, %GRR, ndc ≥ 5) | COULD | IATF requires MSA | AIAG MSA (10 % / 30 % bands) | backlog |
| 33 | Supplier portal for SCAR response | COULD | removes double entry | — | backlog |
| 34 | Barcode / QR scan of lot or instrument | COULD | speed, error reduction | — | backlog |
| 35 | Skip-lot and reduced / tightened inspection switching (ISO 2859-1 switching rules) | COULD | cost of inspection | ISO 2859-1 | backlog |
| 36 | Welder / WPS / PQR register with ISO 9606-1 six-monthly validity check | COULD | weld traceability | ISO 9606-1, ISO 15614-1 | backlog |
| 37 | PFMEA ↔ control-plan ↔ inspection-plan links | COULD | closes the loop of 8D D7 | AIAG-VDA FMEA | backlog |
| 38 | Lessons-learned library from closed 8D | COULD | horizontal deployment | 8D guides | backlog |
| 39 | Inspector competency matrix | COULD | IATF 7.2 | IATF 16949 | backlog |
| 40 | E-mail / WhatsApp escalation of overdue NCR / CAPA | COULD | needs the Communication module | — | backlog |

## 10. Edge cases and careless-user scenarios

Each row has a proving test (file in `apps/api/tests/`, test name starts with the case number, e.g. `E07 …`). "Safe behaviour" is exact.

| # | Scenario | Expected safe behaviour | Test file |
|---|---|---|---|
| E01 | Lot size 1201 on the client plan | 422 `QMS_LOT_OUT_OF_RANGE`; nothing created | `qms-sampling.test.ts` |
| E02 | Lot qty 20.5 kg | lotSize 21 → sample 5, Ac 0 / Re 1 | `qms-calc.test.ts` |
| E03 | Two overlapping rows saved in a sampling table | 422 (`QMS_SAMPLING_OVERLAP` DB error mapped), table unchanged | `qms-sampling.test.ts` |
| E04 | Same GRN posted twice → `onGrnPosted` twice | one inspection per line (unique index), second call returns the existing rows | `qms-incoming.test.ts` |
| E05 | Double click on `decide` (same Idempotency-Key) | one decision row, one set of stock moves, replay returns the same body | `qms-incoming.test.ts` |
| E06 | `decide` twice with different keys on a Completed inspection | 409 `RECORD_LOCKED`; no second move | `qms-incoming.test.ts` |
| E07 | Accept chosen while recommendation is REJECT | 422 `QMS_DECISION_CONFLICT` | `qms-incoming.test.ts` |
| E08 | Inspector approves his own deviation | 403 `QMS_FOUR_EYES` | `qms-incoming.test.ts` |
| E09 | Accepted + rejected + hold ≠ lot | 422 `QMS_QTY_MISMATCH` with field error | `qms-incoming.test.ts` |
| E10 | Stock already issued out of QC hold before the decision | 409 `INSUFFICIENT_STOCK`, whole decision rolled back, inspection unchanged | `qms-stock.test.ts` |
| E11 | Reopen a decision after a Rework disposition started | 409 `QMS_REVERSAL_BLOCKED` | `qms-stock.test.ts` |
| E12 | Reopen a clean decision | moves reversed with `reverseVoucher`, balances restored exactly, auto-NCR cancelled | `qms-stock.test.ts` |
| E13 | Result saved with an overdue instrument | 409 `QMS_INSTRUMENT_BLOCKED` naming the instrument and due date | `qms-calibration.test.ts` |
| E14 | Instrument due today | still usable (due date inclusive); tomorrow blocked | `qms-calibration.test.ts` |
| E15 | Calibration record dated in the future / before the last one | 422 `QMS_DATE_FUTURE` / `QMS_CAL_ORDER` | `qms-calibration.test.ts` |
| E16 | Calibration Fail on an instrument used in 3 inspections | instrument Blocked / OUT_OF_TOLERANCE, review Open with 3 items; unblock refused with `QMS_IMPACT_REVIEW_OPEN` until closed | `qms-calibration.test.ts` |
| E17 | Pass After Adjustment with an as-found NG point | impact review still created | `qms-calibration.test.ts` |
| E18 | Instrument with Validity "-" imported | created Blocked / MANUAL, state Not Calibrated | `qms-import.test.ts` |
| E19 | Importing the same instrument sheet twice | second run creates 0, skips all (duplicate codes) | `qms-import.test.ts` |
| E20 | Disposition quantities exceed hold qty | 422 `QMS_DISPOSITION_QTY` | `qms-ncr.test.ts` |
| E21 | Use As Is on a Critical NCR | 422 `QMS_ASIS_FORBIDDEN` | `qms-ncr.test.ts` |
| E22 | Return To Supplier on an NCR without supplier | 422 `QMS_SUPPLIER_REQUIRED` | `qms-ncr.test.ts` |
| E23 | Close an NCR with an uncovered quantity or without root cause / corrective action | 409 / 422 with the missing item named | `qms-ncr.test.ts` |
| E24 | Close a Critical NCR without a CAPA | 409 `QMS_CAPA_REQUIRED` | `qms-ncr.test.ts` |
| E25 | Rework logs exceed the request quantity | 422 `QMS_REWORK_QTY` | `qms-rework.test.ts` |
| E26 | Close a rework request without re-inspection | 409 `QMS_REINSPECTION_REQUIRED` | `qms-rework.test.ts` |
| E27 | Approve own scrap request | 403 `QMS_FOUR_EYES` | `qms-rework.test.ts` |
| E28 | Scrap with no warehouse and unit cost 0 | 422 `QMS_SCRAP_COST_REQUIRED` | `qms-rework.test.ts` |
| E29 | CAPA `start` with one team member / two leaders | 422 `QMS_D1_TEAM` | `qms-capa.test.ts` |
| E30 | CAPA `complete` without an ESCAPE root cause | 422 `QMS_D4_INCOMPLETE` | `qms-capa.test.ts` |
| E31 | Record effectiveness 10 days after completion | 409 `QMS_EFFECTIVENESS_TOO_EARLY` (approver with reason: allowed) | `qms-capa.test.ts` |
| E32 | CAPA owner closes his own CAPA | 403 `QMS_FOUR_EYES` | `qms-capa.test.ts` |
| E33 | Not Effective result | status In Process, round 2, new due date on next complete | `qms-capa.test.ts` |
| E34 | 5-Why with Why 3 filled and Why 2 empty | 422 `QMS_WHY_GAP` | `qms-5why.test.ts` |
| E35 | Root cause identical to the problem text | 422 `QMS_ROOT_EQUALS_PROBLEM` | `qms-5why.test.ts` |
| E36 | Edit an Approved plan | 409 `QMS_PLAN_LOCKED`; `new_revision` works and approving it makes the old revision Inactive | `qms-plans.test.ts` |
| E37 | Approve a plan with a MEASURED row without limits | 422 field error naming the row | `qms-plans.test.ts` |
| E38 | Plan approver = plan creator | 403 `QMS_FOUR_EYES` | `qms-plans.test.ts` |
| E39 | No approved plan for the item | 422 `QMS_NO_PLAN` with the "Waiting for inspection" entry kept | `qms-incoming.test.ts` |
| E40 | Capability with 24 readings / all identical | verdict `Insufficient Data`, indices null | `qms-capability.test.ts` |
| E41 | Upload an `.exe` renamed `.pdf` / 11 MB file / SVG | 422 `QMS_FILE_TYPE` / 413 / 422 | `qms-attachments.test.ts` |
| E42 | Download an attachment of another unit | 404 | `qms-attachments.test.ts` |
| E43 | Two users edit the same NCR | second `PATCH` with the old `If-Match` → 409 `VERSION_CONFLICT` | `qms-ncr.test.ts` |
| E44 | Writing with "All units" selected | 422 `CONTEXT_INVALID` | `qms-context.test.ts` |
| E45 | Supplier month computed twice | one row (unique key), values identical; Approved row not recomputed | `qms-supplier.test.ts` |
| E46 | Approve a supplier month twice (SCAR trigger) | one SCAR only | `qms-supplier.test.ts` |
| E47 | Division by zero (no lots in the month, produced 0) | zeros stored / null in reports, never NaN | `qms-reports.test.ts` |
| E48 | Same NCR number requested by 20 parallel creates | 20 distinct gap-free numbers, one fetched token reused (lesson 3) | `qms-numbering.test.ts` |
| E49 | Soft-deleted Draft NCR's number | never reused | `qms-numbering.test.ts` |
| E50 | User with only `view` calls `PUT …/results` | 403; no change | `qms-rbac.test.ts` |

## 11. Test plan

**Unit tests (pure, no DB)** — `apps/api/tests/qms-calc.test.ts`: `sampleFor` (examples of BR-QMS-01: 20→5/0/1; 40→8/1/2; 100→20/1/2; 300→50/3/4; 1200→80/5/6; 1201 error; 1→1/0/1; 20.5→5/0/1), `recommendLot` (BR-QMS-02 examples), `evaluateMeasured` (10.0500 OK / 10.0501 NG / 9.9500 OK / 9.9499 NG), `splitDefaults`, rates (5000 / 12 → 0.24 %, 99.76 %, PPM 2400.00, grade B; zero denominators → 0), `ncrDueDate` (Major 7 days), `ageBucket`, `calibrationState` (the five dates of BR-QMS-16), `nextDueDate` (2026-01-15 + 365 = 2027-01-15; 2023-12-31 + 365 = 2024-12-30), `capability` (vector A → Cp 0.78, Cpk 0.62; vector B → Cp 0.75, Cpk 0.57, Pp 1.31, Ppk 0.99), `supplierScore` (ppm 2400 → 76.00; overall 81.60 grade B; without audit 82.00), `copq` (the BR-QMS-12 example → 60,000.00 / 105,000.00 / 5.25 %), `reworkCost` (6 h × 350.00 + 120.00 = 2220.00), `scrapCost` (500.00 − 120.00 = 380.00), `effectivenessDue` (2026-09-12 → 2026-12-11), `roundHalfUp` (2.345 → 2.35, −2.345 → −2.35, 1.005 → 1.01 via Decimal path).
**API tests (supertest, DB `rhai_erp_test`)** — one file per area named in section 10 plus: `qms-schema.test.ts` (each of the 10 pages: `GET /pages/:id/schema` frozen labels / types / required equal `field-types.json`, `[ADD]` after, `kind: 'typed'`, generic engine answers 404 `NOT_GENERIC`), `qms-rbac.test.ts` (matrix of view / add / edit / approve / delete / export per action key), `qms-reports.test.ts` (every report with a fixed data set, numbers in section 8), `qms-exports.test.ts` (column titles and order of the client layouts), `qms-print.test.ts` (print JSON contains the header block and every table column of 06a §2.11). Helpers: `apps/api/tests/qms-helpers.ts` (creates unit context, item `PART-001`, supplier `Supplier A` through the Plan 03 helper, QC hold + receiving warehouses, plan with 3 characteristics, instrument valid until next year, users with roles; **cleanup deletes only rows the test created**, lesson 1; always `ORDER BY`, lesson 2).
**Simulation / invariant test** — `qms-simulation.test.ts`: 200 random inspections (seeded RNG, fixed seed 20270301) with random lot sizes 1–1200, random defectives, random decisions, random dispositions; after each step assert: (I1) for every Completed inspection `accepted + rejected + hold + rework = lot`; (I2) `stock_balances.value` of QC hold + receiving equals the value received (conservation, ±0.00); (I3) Σ non-cancelled disposition qty ≤ NCR hold qty; (I4) every rejected quantity > 0 has exactly one live auto-NCR; (I5) no instrument that is Blocked appears in a result saved after its block; (I6) re-running the whole decision list with the same Idempotency-Keys changes nothing.
**E2E (Playwright, `tests/e2e/qms.spec.ts`, one at a time):**
1. *Incoming accept / reject:* GRN 100 Nos of `PART-001` at rate 50.00 with plan (Ac 1 at sample 20); enter results with 1 defective → recommendation ACCEPT, accepted 99 / rejected 1 → ledger: QC hold 1 piece / 50.00 remains, receiving +99 / 4,950.00; NCR with hold qty 1 appears; disposition Scrap 1 → scrap request approved by a second user → QC hold 0 / 0.00; cost line 50.00.
2. *Reject lot:* 2 defectives → REJECT, NCR Major due +7 days, Return To Supplier → debit note, SCAR suggestion.
3. *In-process hold:* NG on a Critical characteristic → On Hold; release attempt without coverage → 409; rework 5 pieces 6 h × 350.00 + 120.00 = 2,220.00; re-inspection OK → release.
4. *8D:* NCR → CAPA → complete all gates → effectiveness before the due date refused → record after (test clock set) → close by another user.
5. *Calibration:* instrument due in 30 days shows amber; set the clock after the due date → blocked; calibration Fail → impact review with the earlier inspections; close it → instrument Active after a Pass record.
6. *Prints:* open `Print` of NCR register, 8D, ISIR, VT; screenshot comparison with the layout list.
7. *Frozen UI:* screenshots of the 10 pages' register tab against `reference/screens/v92/` (`fam-08-Quality-qms-ncr.png` etc.).

## 12. Build tickets — strict dependency order

Conventions for every ticket: first line of every new file is a 1–3 line comment saying why it exists; layers `routes → controller → service → repository → Prisma` (00-BUILDER-RULES §4); use `Decimal`; every write audited, in one transaction, `If-Match`; new error codes only those of BR-QMS-30; `qmsError(status, code, message, fields?)` from T-QMS-01. Folder `apps/api/src/modules/qms/` is written `qms/`. Size = one builder session (≤ 12 files, ≤ ~900 lines). After each ticket: `cd apps/api && npm run verify` green plus the ticket's tests. Rule coverage table at the end of this section.

### T-QMS-01 — Module skeleton, ports, errors, constants, settings reader, env
**Goal.** Empty-but-compiling `qms/` module, port interfaces with default adapters, the precondition check. **Depends on.** Plans 02/03 migrations applied (`parties`, `goods_receipts`, `scm_settings`).
**Files.** `qms/errors.ts`, `qms/constants.ts`, `qms/ports.ts`, `qms/adapters/default-ports.ts`, `qms/settings.ts`, `qms/index.ts`, `apps/api/src/config/env.ts` (add `QMS_UPLOAD_DIR`), `apps/api/tests/qms-skeleton.test.ts`.
**Steps.** 1. `errors.ts`: `export function qmsError(status: number, code: string, message: string, fields?: FieldErrors): AppError` using the existing `AppError` constructor (`new AppError(status, code, message, fields)`); export `QMS_ERRORS` map code→status from BR-QMS-30. 2. `constants.ts`: the option lists of 06c §7.3 (`INSPECTION_TYPES`, `KIND_OF_TYPE`, `PAGE_OF_KIND`, `NCR_SOURCES`, `NCR_DISPOSITIONS`, `SEVERITIES`, `DECISIONS`, `RESULTS`, `TEST_RESULTS`, `HOLD_STATUSES`, `CAL_FREQUENCIES` with `FREQUENCY_DAYS`, `CAL_RESULTS`, `EFFECTIVENESS_RESULTS`, number-key table of 06b §5.3). 3. `ports.ts`: the interfaces of 06b §5.2.1 verbatim (+ `GrnQcPort`, `QmsInboundPort`, `QmsReleasePort`). 4. `adapters/default-ports.ts`: default adapters that call the Plan 03 / Plan 02 services (`GrnPort`, `GrnQcPort` → services behind `qcDecide` and `returnToVendor`; `PartyPort` → `PartyService`; `OtifPort` → returns `null`; `QcStockPort` → `postMovement` / `reverseVoucher`; `AccountingEventPort` → insert into `accounting_event_queue`; `FileStoragePort` → local disk under `QMS_UPLOAD_DIR`). A function `getPorts()` returns them; tests replace them with `setPortsForTest()`. 5. `settings.ts`: `getQmsSetting<T>(key, schema)` reads `settings` (Zod-parsed with the defaults of 06b §5.14) and caches for 30 s; `todayIst()`. 6. Precondition test: assert that tables `parties`, `goods_receipts`, `goods_receipt_lines`, `scm_settings` exist (via `to_regclass`) and that `scm_settings.qc_hold_warehouse_id` exists; if not, the test prints `QUESTION` and fails. 7. Env: `QMS_UPLOAD_DIR` default `./uploads/qms`; add `uploads/` to `.gitignore` only if not present (this is the one allowed non-listed edit).
**Acceptance.** `npm run verify` green; `qmsError(422,'QMS_NO_PLAN','x')` serialises as `{error:{code:'QMS_NO_PLAN',…,status:422}}`.
**Tests.** `qms-skeleton.test.ts`: error shape; settings default (`qms.ncr_sla_days` Major = 7); `todayIst()` at 2026-12-20T20:00:00Z returns `2026-12-21` (IST is +05:30); preconditions.
**Do NOT.** Create tables or routes; hard-code unit names; read `.env`.
**Size.** 8 files, ~400 lines.

### T-QMS-02 — Migration M1 masters (+ Prisma)
**Goal.** Tables 1–5 of 06b §5.13. **Depends on.** T-QMS-01.
**Files.** `apps/api/prisma/migrations/20270301000000_qms_m1_masters/migration.sql`, `apps/api/prisma/schema.prisma` (append models `QmsDefectCategory`, `QmsDefect`, `QmsSamplingPlan`, `QmsSamplingPlanRow`, `QmsFormHeader`), `apps/api/tests/qms-m1.test.ts`.
**Steps.** Hand-write the SQL exactly from 06b §5.4 (DDL, CHECKs, partial unique index, overlap trigger function + trigger, `@AUDIT` block pasted where marked). Append the Prisma models; `npx prisma validate`; `npx prisma generate`; `npm run db:reset:test`.
**Acceptance.** Migration applies on a fresh test DB; two default sampling plans cannot coexist; overlapping rows rejected by the trigger.
**Tests.** insert plan + rows (2-8, 9-15) ok; row (8-12) rejected (SQLSTATE 23505); `re <> ac+1` rejected; second `is_default` plan rejected.
**Do NOT.** Use `prisma migrate dev`; add a `company_id`; edit older migrations. **Size.** 3 files, ~250 lines.

### T-QMS-03 — Migration M2 instruments and calibration records (+ Prisma)
**Depends on.** T-QMS-02. **Files.** `…/20270301000100_qms_m2_instruments/migration.sql`, `schema.prisma` (`Instrument`, `CalibrationRecord`, `CalibrationPoint`), `tests/qms-m2.test.ts`.
**Steps.** SQL from 06b §5.5 (`calibration_records.impact_review_id` plain column for now). **Acceptance.** `instruments_blocked_chk` enforces `(status='Blocked') = (block_reason IS NOT NULL)`; `calibration_records_done_chk`. **Tests.** blocked without reason rejected; Completed record without certificate rejected; two instruments with the same code rejected. **Do NOT.** add the impact FK yet. **Size.** 3 files, ~350 lines.

### T-QMS-04 — Migration M3 inspection plans (+ Prisma)
**Depends on.** T-QMS-03. **Files.** `…/20270301000200_qms_m3_plans/migration.sql`, `schema.prisma` (`InspectionPlan`, `InspectionPlanCharacteristic`; add `inspectionPlans InspectionPlan[]` to `QmsSamplingPlan`), `tests/qms-m3.test.ts`.
**Steps.** SQL 06b §5.6 (note: no `UNIQUE(code)`, instead `(code, revision)`; one-Approved partial index; characteristic CHECKs). **Tests.** two Approved revisions of one code rejected; MEASURED without limits rejected; FIXED rule without `sample_fixed` rejected. **Size.** 3 files, ~300 lines.

### T-QMS-05 — Migration M4 inspections, results, decisions, stock moves (+ Prisma)
**Depends on.** T-QMS-04 (needs `instruments`, `inspection_plans`, `parties`, `warehouses`). **Files.** `…/20270301000300_qms_m4_inspections/migration.sql`, `schema.prisma` (4 models), `tests/qms-m4.test.ts`.
**Steps.** SQL 06b §5.7 incl. decision guard trigger (copy the pattern of the stock-ledger trigger in `20261105000000_phase5_inventory`), partial unique indexes (`inspections_one_per_grn_line_idx` uses `(grn_line_id, COALESCE(batch_no,''))`). **Tests.** decision UPDATE of `decision` rejected, DELETE rejected, TRUNCATE rejected, update of `is_current` allowed; second current decision rejected; Completed inspection with quantities not adding to lot rejected. **Do NOT.** add FKs for `ncr_id` / `rework_request_id` (T-QMS-06). **Size.** 3 files, ~700 lines.

### T-QMS-06 — Migration M5 NCR family (+ Prisma)
**Depends on.** T-QMS-05. **Files.** `…/20270301000400_qms_m5_ncr/migration.sql`, `schema.prisma` (7 models), `tests/qms-m5.test.ts`. **Steps.** SQL 06b §5.8 including the three `ALTER TABLE` FKs (`inspections_ncr_id_fkey`, `inspections_rework_request_id_fkey`, `ncr_dispositions_*_fkey`). **Tests.** NCR `Closed` without closing date rejected; disposition Use As Is Open without concession allowed only when Cancelled/…(see CHECK); cost line class mismatch rejected; one live NCR per (inspection, decision seq). **Size.** 3 files, ~700 lines.

### T-QMS-07 — Migration M6 CAPA, 5-Why, quality alerts (+ Prisma)
**Depends on.** T-QMS-06. **Files.** `…/20270301000500_qms_m6_capa/migration.sql`, `schema.prisma` (7 models), `tests/qms-m6.test.ts`. **Steps.** SQL 06b §5.9 + the three FKs back to ncrs/capas. **Tests.** SCAR without supplier rejected; two Leaders rejected; Closed CAPA with effectiveness Pending rejected; 5-Why Completed without root cause rejected. **Size.** 3 files, ~600 lines.

### T-QMS-08 — Migration M7 calibration impact (+ Prisma)
**Depends on.** T-QMS-07 (ncrs) and T-QMS-05. **Files.** `…/20270301000600_qms_m7_impact/migration.sql`, `schema.prisma` (2 models + `impactReviewId` already a scalar), `tests/qms-m7.test.ts`. **Tests.** one review per record; Closed review needs conclusion + reviewer. **Size.** 3 files, ~200 lines.

### T-QMS-09 — Migration M8 supplier quality, audits, meetings, improvement, monthly inputs, capability, attachments (+ Prisma)
**Depends on.** T-QMS-08. **Files.** `…/20270301000700_qms_m8_supplier_misc/migration.sql`, `schema.prisma` (12 models), `tests/qms-m8.test.ts`. **Steps.** SQL 06b §5.11–5.12; run `SHOW server_version_num` inside the migration test and choose `UNIQUE NULLS NOT DISTINCT` (≥ 150000) or the two partial unique indexes. **Tests.** unique (unit, supplier, period); period not first-of-month rejected; attachment size 10,485,761 rejected; monthly input duplicate rejected for NULL customer. **Size.** 3 files, ~700 lines.

### T-QMS-10 — Seed
**Depends on.** T-QMS-09. **Files.** `apps/api/src/core/seed/qms-defaults.ts`, `apps/api/src/core/seed/run-seed.ts` (register call), `apps/api/tests/qms-seed.test.ts`. **Steps.** Insert-if-missing (key = code) in one transaction: categories, defects (incl. `VT-01…VT-34` from `06e` A.6), sampling plans `CLIENT-AQL` (default) and `IS2500-GII` (Inactive), settings keys of 06b §5.14, 15 form headers, the six seed plans with characteristics (A.1, A.6 incl. the 7 + 34 + 12 rows; `IPL/SEED/00/000n` codes, `doc_date` 2026-04-01, unit = the first unit, `fy_id` = the FY containing that date or the current FY), demo instruments only when `NODE_ENV !== 'production'`. Running the seed twice creates nothing new. **Acceptance.** counts: 9 categories, 55 defects (21 + 34), 2 sampling plans (9 + 15 rows), 15 headers, 6 plans (7 + 34 + 12 characteristics), settings 23 keys. **Tests.** `qms-seed.test.ts` asserts those counts and idempotency. **Do NOT.** Seed real client data; run in production the demo instruments. **Size.** 3 files, ~700 lines.

### T-QMS-11 — Pure calculation library
**Goal.** All formulas of section 6 as pure functions. **Depends on.** T-QMS-01. **Files.** `qms/calc.ts`, `qms/calc-capability.ts`, `apps/api/tests/qms-calc.test.ts`.
**Steps (signatures).** `roundHalfUp(x: number|Decimal, dp: number)`; `sampleFor(lotQty: Decimal, rows: SamplingRow[], opts?: {fixed?: number; override?: number}): {lotSize, sample, ac, re}`; `sampleCountFor(char, lotSize, planSample): number`; `evaluateMeasured(v: Decimal, lsl: Decimal|null, usl: Decimal|null): 'OK'|'NG'`; `limitsFromTolerance(nominal, tolText)`; `summariseResults(rows): {defectiveCount, verificationFail, criticalFail, pend}`; `recommendLot(a): {aqlResult, recommendation, reasons}`; `splitDefaults(decision, lot, defective, uomIsCount)`; `rates({received, rejected, accepted})`; `ppmGrade(ppm, cuts)`; `ncrDueDate(docDate, severity, sla)`; `ageBucket(days)`; `needsCapa(...)`; `nextDueDate(last, days)`; `calibrationState(today, nextDue, alertDays, last)`; `pointResult(asFound, nominal, tol)`; `capability(readings, m, lsl, usl, minSamples)` with the `D2` table; `supplierScore(...)`; `copq(...)`; `reworkCost(hours, rate, material)`; `scrapCost(value, salvage)`; `effectivenessDue(completed, days)`; `todayIst` re-exported. Dates are `YYYY-MM-DD` strings; date maths uses `Date.UTC` (no local time).
**Acceptance.** every worked example of section 6 reproduces exactly. **Tests.** the list in section 11 (unit tests). **Do NOT.** import Prisma or Express; use floating point for money or quantity. **Size.** 3 files, ~800 lines.

### T-QMS-12 — Plumbing: numbering, state machine, audit, attachments, notify
**Depends on.** T-QMS-09, T-QMS-11. **Files.** `qms/numbering.ts`, `qms/status.ts`, `qms/audit.ts`, `qms/notify.ts`, `qms/attachments/{routes,controller,service,repository}.ts`, `qms/guards.ts`, `apps/api/tests/qms-numbering.test.ts`, `apps/api/tests/qms-attachments.test.ts`.
**Steps.** 1. `numbering.ts`: `nextQmsNumber(tx, key, prefix, unit, fy)` — copy the SQL of `records/repository.ts` lines ~190–205 (`INSERT … ON CONFLICT DO NOTHING`, `SELECT … FOR UPDATE`, `UPDATE next_value`) with `page_id = key`. 2. `status.ts`: `assertTransition(table: Record<string,string[]>, from, to, code)`; and `transitions` constants per document of BR-QMS-25. 3. `guards.ts`: `fourEyes(actorId, otherId, rule)` (honours `qms.four_eyes`), `assertUnitWritable(caller)`, `requireKindAction(action)` middleware implementing the kind→page permission rule of 06c §7.2. 4. `audit.ts`: wrappers over `recordAudit` with target types `QmsInspection`, `QmsNcr`, `QmsCapa`, … 5. `notify.ts`: `notifyUser(userId, text)` stub (logger + audit `qms.notify`). 6. Attachments per BR-QMS-28 (magic-byte table, `express.raw` on the upload route only, SHA-256 dedupe, storage through `FileStoragePort`, download with `nosniff`, soft delete, 20-per-entity cap, permission by `entityType → pageId` map). Register `/qms/attachments` routes in `qms/routes.ts` (created here; later tickets add routers).
**Acceptance.** 20 parallel `nextQmsNumber` calls give 20 distinct consecutive numbers; upload of a PNG works, an `.exe` renamed `.png` is refused. **Tests.** E41, E42, E48, E49. **Do NOT.** `MAX(code)+1`; trust the `Content-Type` header alone; put user text in file paths. **Size.** 11 files, ~850 lines.

### T-QMS-13 — Typed definitions for the 10 pages, engine extensions, registration, lookups
**Depends on.** T-QMS-12. **Files.** `qms/definitions.ts`, `qms/typed-pages.ts`, `apps/api/src/engine/kinds.ts` (add the 10 ids to `TYPED_PAGES`), `apps/api/src/engine/field-types.ts` (extend `lookup` union), `apps/api/src/engine/overrides/pages.ts` (`qms-ncr` Severity), `apps/api/src/modules/records/schemas.ts` (typedFilters + `actionBodySchema.payload`), `apps/api/src/modules/records/typed-dispatch` (wherever `typedHandlerFor` is combined: add `qmsHandlerFor`), `qms/lookups/*`, `apps/api/tests/qms-schema.test.ts`.
**Steps.** 1. Write `define(...)` for each page from `06a` §2.1–2.10: frozen fields in registry order (labels exactly), `[ADD]` after, options from constants, `required` flags from the fixture (Item on `qms-incoming` stays `false`), `statuses`, `actions` (keys of 06c §7.1 with confirm texts, `allowedFrom`, `requires`), `filters`, `totals`, `views`, explicit `listColumns` (the frozen keys). 2. `typed-pages.ts`: `QMS_HANDLERS` map pageId → handler objects (each created by later tickets; for now every handler is a stub throwing `QMS_NOT_SUPPORTED` 422 with the text "Built in ticket T-QMS-nn"); the dispatcher returns it. 3. Add the extended filters and `payload`; `TypedHandler.action` gets `body.payload`. 4. Lookups `GET /lookups/{suppliers,customers,users,instruments,defects,ncrs,capas,inspections,plans,fivewhys}` (limit 1–50, `q`), permission `view` on the owning page (suppliers/customers via `PartyPort.search`). 5. Make the generic engine answer `NOT_GENERIC` for the ten ids (automatic through `TYPED_PAGES`).
**Acceptance.** `qms-schema.test.ts`: for each of the 10 pages `GET /pages/<id>/schema` equals `field-types.json` for the frozen part (labels, order, type, required) and `[ADD]` fields come after; `kind==='typed'`; `GET /pages/qms-ncr/records` returns 422 `QMS_NOT_SUPPORTED` (stub) not 500. **Tests.** as above plus E44. **Do NOT.** Change any frozen label, type or order; edit `registry.json`. **Size.** 12 files, ~900 lines.

### T-QMS-14 — Plans, characteristics, sampling tables, form headers (`qms-plans`)
**Depends on.** T-QMS-13. **Files.** `qms/plans/{repository,service,routes,controller,schemas}.ts`, `qms/sampling/{repository,service}.ts`, `qms/form-headers.ts`, `apps/api/tests/qms-plans.test.ts`, `apps/api/tests/qms-sampling.test.ts`.
**Steps.** 1. Handler for `qms-plans` (list with latest-revision filter, get, create Draft with number `IPL`, patch Draft only, delete Draft). 2. `PUT /qms/plans/:id/characteristics` replace-all (Draft; validation per BR-QMS-04 limit derivation; renumber `line_no`; update `characteristic_count`). 3. Actions `approve` (BR-QMS-23, four-eyes), `new_revision` (clone), `deactivate`. 4. `selectPlan(tx, {kind, itemId, supplierId, date})` exported for T-QMS-17. 5. Sampling plan CRUD + `GET /qms/sampling-lookup` using `sampleFor`; `activate / deactivate / set_default`. 6. Form headers `GET/PUT`. 7. Audit each write.
**Acceptance / Tests.** E01, E03, E36, E37, E38 and plan selection ranking test (5 candidates → item+supplier wins). **Do NOT.** edit an Approved plan in place; allow two defaults. **Size.** 11 files, ~850 lines.

### T-QMS-15 — Instruments, schedule, compliance, sweep, import (`qms-calibration` part 1)
**Depends on.** T-QMS-13, T-QMS-12. **Files.** `qms/calibration/{instrument-repository,instrument-service,routes,controller,schemas,import}.ts`, `qms/scheduler.ts`, `apps/api/src/server.ts` (call `startQmsScheduler()` after listen), `apps/api/tests/qms-calibration.test.ts` (part), `apps/api/tests/qms-import.test.ts`.
**Steps.** 1. Handler for `qms-calibration` (CRUD per 06a §2.10; code typed or auto `INS`; `frequency_label ↔ frequency_days` consistency; `next_due_date` recomputed whenever last date or frequency changes; derived fields `calibrationState`, `daysToDue` in the DTO via `calibrationState`). 2. Actions `block`, `unblock`, `retire` (BR-QMS-17/25). 3. `enforceCalibrationBlocks(tx, unitId?)`; called from the list handler, `POST /qms/calibration/sweep` and the scheduler (`setInterval` 15 min, `pg_try_advisory_lock(727001)`, `unref()` so tests exit, **disabled when `NODE_ENV==='test'`**). 4. `GET /qms/calibration/schedule`, `/compliance`. 5. Import per `06e` A.8 (`dryRun`, per-row messages, derived dates, `-` validity).
**Acceptance / Tests.** E14, E18, E19, nextDue examples; sweep blocks an overdue instrument and writes one audit row. **Do NOT.** start the scheduler in tests; compute dates with local time. **Size.** 9 files, ~850 lines.

### T-QMS-16 — Calibration records, out-of-tolerance, impact review
**Depends on.** T-QMS-15, T-QMS-05 (needs inspection tables). **Files.** `qms/calibration/{record-service,impact-service,record-routes}.ts`, `apps/api/tests/qms-calibration.test.ts` (part 2).
**Steps.** BR-QMS-16 (date checks), BR-QMS-17 (unblocking), BR-QMS-18 (point evaluation, result conflict, impact window query, review + items, close, raise-ncr). `complete` runs in one transaction: lock instrument → insert/update record → update instrument → create review when needed. Notifications to `notify_user_id`.
**Acceptance / Tests.** E15, E16, E17 and the point-evaluation example (nominal 25.000, tol 0.005: 25.004 OK, 25.007 NG). **Do NOT.** delete a Completed record; unblock an OOT instrument before the review closes. **Size.** 5 files, ~700 lines.

### T-QMS-17 — Inspection core: create, results, complete
**Depends on.** T-QMS-14, T-QMS-16. **Files.** `qms/inspections/{repository,service,results-service,routes,controller,schemas,header-schemas}.ts`, `apps/api/tests/qms-inspection-core.test.ts`.
**Steps.** 1. Handlers for `qms-incoming`, `qms-process`, `qms-final`, `qms-inspections` built from one `makeInspectionHandler(kinds, pageId)` (list filtered by kinds). 2. `create`: item from payload (or GRN), `selectPlan` (or `planId`), `sampleFor`, copy plan characteristics × `sampleCountFor` samples into `inspection_results` (`PEND`), per-kind Zod `header_data` validation (06b §5.7.5), number by kind (06b §5.3). 3. `PUT /qms/inspections/:id/results` (≤ 500 rows; server computes MEASURED results; `enforceCalibrationBlocks` first; instrument checks BR-QMS-17; gauge-resolution warning; `measured_at` default now; update denormalised `parameter_name / specification_text / actual_value`). 4. `start`, `complete` (BR-QMS-04 completeness; compute `result`, `aql_result`, recommendation, `defective_count`, `checklist_score`; status Completed or On Hold per kind rules left to T-QMS-19/20/21: this ticket implements the generic part and a hook `kindHooks[kind].onComplete`), `cancel`, `reopen` (state only; stock part in T-QMS-19). 5. Audit.
**Acceptance / Tests.** E13, E50, result evaluation examples, plan snapshot unaffected by a later plan revision, `QMS_RESULTS_INCOMPLETE`. **Do NOT.** accept a client-sent result for a MEASURED row. **Size.** 9 files, ~900 lines.

### T-QMS-18 — Stock and GRN adapters, QC move, reversal, hold warehouse
**Depends on.** T-QMS-17. **Files.** `qms/adapters/stock-adapter.ts`, `qms/adapters/grn-adapter.ts`, `qms/stock/qc-moves.ts`, `apps/api/src/modules/inventory/stock/posting.ts` (add `'QC_OUT' | 'QC_IN'` to `LedgerVoucherType`; nothing else), `apps/api/tests/qms-stock.test.ts`.
**Steps.** 1. `QcStockPort` default adapter per 06b §5.2.1 (`move` = out + in at the same value; `issueOut`; `reverse` = `reverseVoucher`; `onHand`; `avgRate`; `qcHoldWarehouse(tx, unitId)` reads `scm_settings` (unit row, else company row) → `QMS_NO_QC_WAREHOUSE`). 2. `GrnQcPort` default adapter calling the Plan 03 service functions behind `qcDecide` and `returnToVendor` inside the caller's transaction. 3. `qc-moves.ts`: `commitDecisionMoves(tx, inspection, decision)` implementing BR-QMS-06 (GRN-linked vs manual), creating `inspection_stock_moves` with deterministic idempotency keys; `reverseDecisionMoves`. 4. FOUNDATION-CHANGE note in the report: ledger voucher types.
**Acceptance / Tests.** manual move: 100 at 50.00 → 90 + 10 split example (QC hold 10 / 500.00, target 90 / 4,500.00); E10, E12; GRN-linked decision calls the port exactly once per line (test double); total value conserved to 0.00. **Do NOT.** post stock directly from services other than through the port; change any other posting rule. **Size.** 5 files, ~600 lines.

### T-QMS-19 — Incoming inspection: from GRN, decision, reopen
**Depends on.** T-QMS-18. **Files.** `qms/incoming/{service,inbound-port,routes,controller}.ts`, `qms/inspections/decision-service.ts`, `apps/api/tests/qms-incoming.test.ts`.
**Steps.** 1. `QmsInboundPort.onGrnPosted(tx, grnId)`: for each `qc_required` line (per batch when batches exist) create the inspection idempotently (BR-QMS-23/01); no plan → skip + keep line listed as waiting. `POST /qms/inspections/from-grn`. 2. `decide` action (BR-QMS-02/03/06/07 hook, 25 four-eyes): recommendation vs choice, quantity split, deviation approval, decision row (`seq` next), stock via T-QMS-18, GRN-line aggregation (call `GrnQcPort.decideLine` once when the last inspection of the line completes), auto-NCR hook (T-QMS-22 supplies `ncrService.createFromInspection`; here a port `NcrCreatePort` default = no-op until T-QMS-22, replaced there), idempotency key, status Completed / On Hold. 3. `reopen` with reversal (BR-QMS-06). 4. Supplier PPM / rating fields of the DTO (BR-QMS-05).
**Acceptance / Tests.** E04–E09, E11, E39 and the 06c BR-QMS-03 example. **Do NOT.** decide on an inspection with PEND rows; call `decideLine` twice for one line. **Size.** 6 files, ~800 lines.

### T-QMS-20 — In-process: hold / release, escalation, capability studies
**Depends on.** T-QMS-17. **Files.** `qms/process/{service,escalation,capability-service,routes,controller}.ts`, `apps/api/tests/qms-process.test.ts`, `apps/api/tests/qms-capability.test.ts`.
**Steps.** BR-QMS-20 (`onComplete` hook for IN_PROCESS, `release_hold`, streak escalation with `header_data.escalationKey`), `GET /qms/holds`, capability: readings query, `capability()` call, `POST /qms/capability-studies/compute|save`, `GET`. **Tests.** hold flow, E40, streak of 3 creates exactly one NCR, vector A / B numbers through the API. **Size.** 7 files, ~700 lines.

### T-QMS-21 — Final inspection, ISIR, VT, weld before/after, release certificate
**Depends on.** T-QMS-17. **Files.** `qms/final/{service,certificate,release-port}.ts`, `qms/isir/service.ts`, `qms/weld/service.ts`, `apps/api/tests/qms-final.test.ts`.
**Steps.** BR-QMS-21 (score, test result, certificate once, void on reopen, `GET /qms/final-release`), BR-QMS-22 (ISIR status, `approve_isir`, ppap checklist booleans in `header_data.ppap` validated as 18 booleans), BR-QMS-26 (VT / weld header defaults, instrument check of `gaugeSrNo`, quantity invariants). **Tests.** score 88.89 example; certificate number issued once under double click; ISIR rejected on one NG sample; reviewer = inspector refused; weld quantity invariant. **Size.** 6 files, ~750 lines.

### T-QMS-22 — NCR service (auto-NCR, containment, dispositions, costs, close)
**Depends on.** T-QMS-19, T-QMS-20, T-QMS-21. **Files.** `qms/ncr/{repository,service,disposition-service,cost-service,routes,controller,schemas}.ts`, `apps/api/tests/qms-ncr.test.ts`.
**Steps.** Handler for `qms-ncr` (create manual with `Item` required; severity default; due date; repeat detection; list totals), `createFromInspection` (BR-QMS-07; replaces the T-QMS-19 no-op port), containment PUT, dispositions (BR-QMS-09 incl. Use As Is, Sort, Return via `GrnQcPort.returnToVendor` or `issueOut`; Rework / Scrap request creation delegated to T-QMS-23 services through ports), cost lines CRUD (manual) and recomputation of `cost_internal/external`, summary quantities, auto status moves, `close` / `reopen` / `cancel` (BR-QMS-08/25), `raise_capa` / `raise_5why` links (calls into T-QMS-24/25 later through ports; this ticket stores the ids only). **Tests.** E20–E24, E43, the 23-piece coverage example (BR-QMS-09), due-date example. **Size.** 8 files, ~900 lines.

### T-QMS-23 — Rework and scrap requests
**Depends on.** T-QMS-22. **Files.** `qms/rework/{service,routes,controller}.ts`, `qms/scrap/{service,routes,controller}.ts`, `apps/api/tests/qms-rework.test.ts`.
**Steps.** BR-QMS-10 (log, qty rules, `reinspect` creating a Draft inspection of the source kind, completion callback that sets qty_ok/qty_ng and releases stock), BR-QMS-11 (approve, complete with `issueOut`, `SCRAP_POSTED`), cost lines (rework log row → `REWORK` cost, unique by `source_id`), exported `ReworkService`, `ScrapService` (contract for Manufacturing, A-MFG-1). **Tests.** E25–E28, the 2,220.00 and 380.00 examples, double completion leaves one cost line. **Size.** 7 files, ~750 lines.

### T-QMS-24 — CAPA / 8D / SCAR
**Depends on.** T-QMS-22. **Files.** `qms/capa/{repository,service,gates,routes,controller,schemas}.ts`, `apps/api/tests/qms-capa.test.ts`.
**Steps.** Handler for `qms-capa`; `from-ncr`; team / containment / root-cause PUTs; action items CRUD; `start`, `complete` (gates BR-QMS-13 returned as a list in `GET /qms/capas/:id`), `record_effectiveness`, `close` (BR-QMS-14, four-eyes), `cancel`; `GET /qms/capas/:id/report`; overdue calculation. **Tests.** E29–E33; the 2026-09-12 → 2026-12-11 due date. **Size.** 7 files, ~850 lines.

### T-QMS-25 — 5-Why and quality alerts
**Depends on.** T-QMS-24. **Files.** `qms/fivewhy/{service,routes,controller}.ts`, `qms/alerts/{service,routes,controller}.ts`, `apps/api/tests/qms-5why.test.ts`. **Steps.** BR-QMS-15 (gap rule, completion, closure, `push_to_capa`, linking), alerts CRUD with attachments, actions `close` / `cancel`. **Tests.** E34, E35, push_to_capa creates one OCCURRENCE row. **Size.** 7 files, ~600 lines.

### T-QMS-26 — Supplier quality and audits
**Depends on.** T-QMS-19, T-QMS-24. **Files.** `qms/supplier/{service,scoring,routes,controller}.ts`, `qms/supplier/audits.ts`, `apps/api/tests/qms-supplier.test.ts`. **Steps.** Handler `qms-supplier`; `compute` per BR-QMS-24 (idempotent), `approve` (+ auto SCAR once), `reopen`, `raise_scar`; `GET /qms/supplier-scorecard`; audits CRUD + findings. **Tests.** E45, E46, the 81.60 / 82.00 examples. **Size.** 6 files, ~700 lines.

### T-QMS-27 — Meetings, improvement projects, monthly inputs, defect master
**Depends on.** T-QMS-22. **Files.** `qms/misc/{meetings,improvements,monthly-inputs,defects}.ts`, `qms/misc/routes.ts`, `apps/api/tests/qms-misc.test.ts`. **Steps.** CRUD per 06b §5.11–5.12 and 06a [ADD] tabs; permission = `qms-capa` (meetings, improvements) / `qms-ncr` (monthly inputs, defects; `approve` to change defects); SQDCPE validation; meeting `approve` freezes. **Tests.** SQDCPE tag outside the list refused; defect used by an NCR cannot be deleted (`IN_USE` 409), can be set Inactive. **Size.** 6 files, ~600 lines.

### T-QMS-28 — Reports and KPIs
**Depends on.** T-QMS-26, T-QMS-27. **Files.** `qms/reports/{repository,service,routes,controller}.ts`, `apps/api/tests/qms-reports.test.ts`. **Steps.** Section 8 reports 1–12 + trace report `GET /qms/reports/trace?heatNo=`; dashboard KPIs wired into the typed schema `dashboardKpis` for the 10 pages (the four cards of section 8). SQL aggregates only, parameterised, `ORDER BY` always. **Tests.** fixed data set: Pareto cumulative 80 % flag, PPM / COPQ numbers of BR-QMS-05 / 12, ageing buckets at 7 / 8 / 15 / 16 / 30 / 31 days, E47. **Size.** 5 files, ~900 lines.

### T-QMS-29 — Client-layout Excel exports and print-data endpoints
**Depends on.** T-QMS-28. **Files.** `qms/exports/{rejection-register,incoming,instruments,scorecard}.ts`, `qms/print/{service,routes}.ts`, `apps/api/tests/qms-exports.test.ts`, `apps/api/tests/qms-print.test.ts`. **Steps.** `exceljs` workbooks per 06c §7.4 (header block from `qms_form_headers`; exact titles); `GET /qms/print/:formCode/:id` per 06a §2.11 table (one builder function per formCode returning `{header, data, signatures}`); 50,000-row cap. **Tests.** column titles / order equal to the lists; header block fields present. **Size.** 8 files, ~800 lines.

### T-QMS-30 — Web: tab framework, page wiring, lookups, action dialogs
**Depends on.** T-QMS-13 (schemas) and the API tickets as they land. **Files.** `apps/web/src/pages/qms/{QmsTabs,ActionDialog,qmsApi,useQmsLookup}.tsx|ts`, `apps/web/src/pages/generic/GenericModulePage.tsx` (render `schema.tabPanels` when present), `apps/web/src/pages/generic/ModuleTabs.tsx` (register `[ADD]` tabs after Audit Trail), `apps/web/src/styles/qms.css`, `apps/web/src/pages/qms/QmsTabs.test.tsx`.
**Steps.** 1. If `tabPanels` is not yet in `TypedSchema` (Plan 03 not built) add the optional map and the rendering lookup exactly as: `tabPanels?: Record<string, {component: string; endpoint?: string}>`. 2. `ActionDialog`: generic modal that collects the `payload` fields declared by the action (`payloadFields` in the schema action: `{key,label,type,required}`) and posts with `Idempotency-Key` (`newIdempotencyKey()`). 3. Lookup combobox support for the new lookup kinds (extend `LookupCombobox`). 4. Tab registry: `QMS_PANELS['qms-ncr']['Containment'] = NcrContainmentPanel` etc. — components come in T-QMS-31..33; here only the registry and placeholders. 5. `[ADD]` tabs appended after the 16.
**Acceptance.** all 10 pages render the register tab and 16 frozen tabs; an unknown panel shows the existing `PhaseNotice`. **Tests.** `QmsTabs.test.tsx`: tab order = registry tabs + universal + `[ADD]`; screenshots unaffected. **Do NOT.** change the frozen tab names or CSS of existing classes. **Size.** 8 files, ~700 lines.

### T-QMS-31 — Web: inspection grid, decision panel (incoming / process / final / inspections)
**Depends on.** T-QMS-30, T-QMS-19–21. **Files.** `apps/web/src/pages/qms/{InspectionGrid,DecisionPanel,RunChart,SupplierTrend,AttachmentsPanel}.tsx`, `apps/web/src/pages/qms/panels/{IncomingPanels,ProcessPanels,FinalPanels,InspectionPanels}.tsx`, `apps/web/src/pages/qms/InspectionGrid.test.tsx`.
**Steps.** Per 06a §2.12 and the tab lines of §2.2–2.6: grid with live OK/NG colouring (MEASURED: compare with limits using string-decimal compare, same rule as BR-QMS-04), instrument picker disabled for blocked ones, defect picker, changed-rows-only save, responsive (touch targets ≥ 44 px), `localStorage` draft in try/catch. Panels call the endpoints of 06c §7.2. **Tests.** typing 10.0501 against limits 9.95–10.05 shows NG; blocked instrument option disabled; decision panel disables `Accept` when recommendation is REJECT. **Size.** 11 files, ~900 lines.

### T-QMS-32 — Web: NCR, CAPA / 8D, 5-Why, alerts, MOM, improvement panels
**Depends on.** T-QMS-30, T-QMS-22–25, 27. **Files.** `apps/web/src/pages/qms/{DispositionEditor,EightDEditor,WhyChain,ParetoChart}.tsx`, `apps/web/src/pages/qms/panels/{NcrPanels,CapaPanels,FiveWhyPanels,MiscPanels}.tsx`, tests. **Steps.** Tabs of 06a §2.7–2.9 and the `[ADD]` tabs; coverage bar `coveredQty / holdQty`; D-gate checklist from `GET /qms/capas/:id` `gates`; two-column Why chain. **Tests.** coverage bar 23 → 20 + 3 shows 100 %; CAPA complete button disabled while gates missing. **Size.** 10 files, ~900 lines.

### T-QMS-33 — Web: calibration, supplier, plans panels
**Depends on.** T-QMS-30, T-QMS-15, 16, 26, 14. **Files.** `apps/web/src/pages/qms/{CalibrationRecordForm}.tsx`, `panels/{CalibrationPanels,SupplierPanels,PlanPanels}.tsx`, tests. **Steps.** Tabs of 06a §2.1, 2.5, 2.10 (schedule grouped by week with colours from the existing status classes, import dialog with dry-run table, impact review editor, supplier score explanation table, plan characteristics grid, sampling tables editor with the sample finder). **Tests.** dry-run import shows counts; due-soon amber / overdue red; characteristics grid refuses a MEASURED row without limits. **Size.** 8 files, ~900 lines.

### T-QMS-34 — Web: print forms
**Depends on.** T-QMS-29, T-QMS-30. **Files.** `apps/web/src/pages/qms/print/{PrintForm,IqcReport,IqcSheet,IpqReport,Isir,VtReport,WeldBa,ReworkRegister,EightD,QAlert,WhyWhy,Mom,CiProject,InstrumentList,CalRecord,ReleaseCert}.tsx`, `apps/web/src/styles/qms.css` (print rules `@media print`), `…/print/print.test.tsx`. **Steps.** One component per `formCode` laying out exactly the header block, table columns and signature labels of 06a §2.11 (A4, repeat table header per page, 12 / 15 rows per page where stated); wire the `Print` button of each page to the form of the selected row / filtered list. **Tests.** each component renders every column title of its form from a fixture JSON (a test iterates the §2.11 list). **Do NOT.** reproduce the client's misspellings; add fonts. **Size.** 18 files, ~900 lines (small components).

### T-QMS-35 — Simulation / invariants and RBAC matrix tests
**Depends on.** T-QMS-28. **Files.** `apps/api/tests/qms-simulation.test.ts`, `apps/api/tests/qms-rbac.test.ts`, `apps/api/tests/qms-context.test.ts`. **Steps.** Section 11 simulation (I1–I6) and the RBAC matrix (every action key × role view/add/edit/approve/delete). **Acceptance.** green in < 120 s. **Size.** 3 files, ~700 lines.

### T-QMS-36 — E2E and screenshot freeze
**Depends on.** T-QMS-34, T-QMS-35. **Files.** `tests/e2e/qms.spec.ts`, `tests/e2e/qms-helpers.ts`. **Steps.** The 7 scenarios of section 11; screenshot comparison of the register tab of the ten pages with `reference/screens/v92/`. **Acceptance.** `npm run e2e` (single process) green. **Size.** 2 files, ~600 lines.

### 12.1 Business-rule coverage by ticket
| Rule | Ticket(s) | Rule | Ticket(s) |
|---|---|---|---|
| BR-QMS-01 | T-QMS-11, 14, 17, 19 | BR-QMS-16 | T-QMS-11, 15, 16 |
| BR-QMS-02 | T-QMS-11, 19 | BR-QMS-17 | T-QMS-15, 16, 17 |
| BR-QMS-03 | T-QMS-11, 19 | BR-QMS-18 | T-QMS-16 |
| BR-QMS-04 | T-QMS-11, 14, 17 | BR-QMS-19 | T-QMS-11, 20 |
| BR-QMS-05 | T-QMS-11, 19, 28 | BR-QMS-20 | T-QMS-20 |
| BR-QMS-06 | T-QMS-18, 19 | BR-QMS-21 | T-QMS-21 |
| BR-QMS-07 | T-QMS-20, 21, 22 | BR-QMS-22 | T-QMS-21 |
| BR-QMS-08 | T-QMS-11, 22 | BR-QMS-23 | T-QMS-14, 17 |
| BR-QMS-09 | T-QMS-22, 23 | BR-QMS-24 | T-QMS-11, 26 |
| BR-QMS-10 | T-QMS-23 | BR-QMS-25 | T-QMS-12 and every service ticket |
| BR-QMS-11 | T-QMS-23 | BR-QMS-26 | T-QMS-21 |
| BR-QMS-12 | T-QMS-11, 22, 23, 28 | BR-QMS-27 | T-QMS-12 |
| BR-QMS-13 | T-QMS-24 | BR-QMS-28 | T-QMS-12 |
| BR-QMS-14 | T-QMS-24 | BR-QMS-29 | T-QMS-12, 19 |
| BR-QMS-15 | T-QMS-25 | BR-QMS-30 | T-QMS-01 |

## 13. Reviewer checklist

**Freeze and schema.** (1) The ten pages are in `TYPED_PAGES`; the generic engine answers `NOT_GENERIC`. (2) Every frozen label / key / type / required flag equals `field-types.json` (note: `Item` on `qms-incoming` stays `false`); `[ADD]` fields after, none between. (3) Tab names equal the registry; `[ADD]` tabs after `Audit Trail`. (4) No CSS framework; new classes prefixed `qm-` / `qp-`.
**Database.** (5) Every table of 06b exists with its CHECKs, indexes and FKs (spot-check: `inspections_one_per_grn_line_idx`, `ncrs_one_per_decision_idx`, `inspection_decisions` trigger, `capa_team_one_leader_idx`, `instruments_blocked_chk`). (6) QMS migrations are hand-written, applied in the order of 06b §5.13, no edit of older migrations. (7) Prisma scalars for core refs, relations only inside QMS (A-DB-2). (8) Seed is idempotent and has no client data.
**Rules.** (9) Each BR in 12.1 is implemented in the named ticket with the worked-example numbers as tests. (10) Every ratio guards a zero denominator. (11) Money / quantity use `Decimal`; rounding half-up at the stated places only. (12) *Today* is the IST date (test at 2026-12-20T20:00Z).
**Safety.** (13) Every state change re-reads the status `FOR UPDATE`; idempotent with `Idempotency-Key`; `If-Match` on every patch. (14) Four-eyes enforced for the six listed cases. (15) Stock moves only through the ports; one transaction with the decision; reversal through `reverseVoucher`. (16) Auto-NCR cannot be created twice. (17) Attachments checked by magic bytes, no user text in paths, download authorised per owning page. (18) Writes need a concrete unit; lists respect unit + FY + data scope. (19) Errors use `qmsError` codes of BR-QMS-30 only.
**Hand-offs.** (20) `ReworkService` / `ScrapService` / `GET /qms/final-release` / `GET /qms/holds` exist and are documented. (21) Plan 03 gets exactly one new call (`onGrnPosted`) and no other change.
**Likely builder mistakes.** Editing a frozen label to "fix" a client typo; using `MAX(code)+1`; computing the due date with months instead of days; using the server UTC date; rounding with `toFixed` on money; counting NG **results** instead of defective **pieces** for AQL; letting the client send `result` for MEASURED rows; forgetting `ORDER BY` in reports; deleting whole tables in test cleanup; starting the scheduler in tests; creating a REJECT warehouse (the QC hold warehouse is the reject area); posting stock from the NCR service directly; treating `NF` as a failure; recomputing an Approved supplier month; running `prisma migrate dev`.
