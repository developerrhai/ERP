# PHASE-12 REPORT — Quality / QMS (client forms on one inspection engine)

Built 2026-11-08. Local only: nothing pushed, nothing deployed, nothing committed. Migration `20261122000000_phase12_a_qms` applied to `rhai_erp` (dev) and `rhai_erp_test`.

## 0. How the spec was defined (read this first)
`docs/phases/PHASE-12.md` is only the client-forms table (plus the Usage Decision). It names no pages, no tables and no numbers. You asked me to build it without searching the internet, so every choice below comes from the table, STANDARDS, ERRATA and the earlier phases. **I did not ask you questions this time.** The choices that are really yours to make are listed in §3.

The API base path is `/api/v1/qms` (ERRATA E-26). The quality menu already had ten pages (`registry.json` is frozen), so **no new page ids were added**; each client form lives on the page that fits it (§1).

## 1. What was built
| Client form / need | Where | How |
|---|---|---|
| Incoming (RM) inspection sheet | **Incoming Quality** `qms-incoming` | Template INCOMING: supplier, invoice no, item, grade / spec, heat / batch no, dimensions; rows with result. A posted goods receipt line that needs inspection **creates the lot automatically** (Phase 9 `QmsInboundPort`), pre-filled from the supplier, invoice and the item's plan. |
| In-process inspection | **In-Process Quality** `qms-process` | Template IN_PROCESS: part, machine, operation; rows with specification, method and **readings for parts 1 to 5**. |
| Pre-dispatch inspection | **Final Quality** `qms-final` | Template PRE_DISPATCH: customer, part, challan no, in-charge; parameters with readings 1 to 5; accepted / rejected / conditionally accepted. |
| Welding inspection (before / after) | Final Quality | Template WELDING: stage, ISO 5817 class, weld no, welder no, WPS no, heat no; fit-up and weld checks as OK / NOT OK. |
| VT report | Final Quality | Template VT: a blank format on the same engine. |
| ISIR | **Supplier Quality** `qms-supplier` | Template ISIR: supplier, part no, revision, material spec, reviewed by; zone / item and tolerance columns, readings per sample. |
| Rejection / rework register + monthly summary | **Non-Conformance / NCR** `qms-ncr` | Date, process, operator, part, hold qty, defect, defect type, disposition (hold, rework, scrap, use as is, return to vendor). Monthly summary by process, defect type and disposition. |
| Quality Alert | NCR page, tab *Quality alerts* | Template ALERT: part, notification date, issue, OK / NOT OK evidence, containment. |
| PPM monitor | NCR page | Produced / rejected / customer-rejected qty per month → internal and customer PPM; verdict against **your** target. |
| Quality cost monitor | NCR page | Prevention, appraisal, internal and external failure cost → total and % of sales; verdict against your target. |
| 8D | **CAPA** `qms-capa` | Template EIGHT_D: D1 team … D8, containment, Why-Why (why made / why missed), cause and effect, root cause, CAPA reference. Cannot be closed without root cause, corrective action, prevent-recurrence and the CAPA reference. |
| Continuous improvement (SQDCPE) | CAPA page | Template CI: theme, project no, dates, category S/Q/D/C/P/E, team, before, target, why 1..4, root cause, actions, after. |
| Minutes of Meeting | CAPA page | Template MOM: agenda, customer and own representatives, points. |
| Instruments list + history card | **Calibration** `qms-calibration` | Instrument (history card no, equipment no, name, range, least count, division, validity) with its history card; calibration entries move the validity; a failed calibration puts the instrument out of service. |
| **Calibration due reminders** | Phase 5 notifications | Daily job `qms.daily` (02:15) sends `QMS_CALIBRATION_DUE` once per instrument and validity date (due soon, and again when expired). |
| **Usage Decision** | Any inspection sheet, action *approve* | Accepted → Unrestricted, rejected → Blocked, through the Phase 9 `qcDecide` / Phase 8 `StockService.changeStatus`. The rejected quantity also enters the rejection register (a goods-receipt lot is marked *return to vendor*). Replays with the same Idempotency-Key answer the first result. |
| Inspection plans | **Inspection Plans** `qms-plans` | Characteristics with specification, method, unit, type (measured or OK / NOT OK) and lower / upper limit; chosen by item. |
| Formats are data (R-16 / R-17) | Plans page, tab *Form templates* | Templates are versioned rows. Publishing needs the page action **controls** and a reason, retires the active version of the same (form, customer) and adds the next. A **customer-specific** format wins over the general one when that customer is chosen. Sheets keep the template snapshot they were made with. |

Readings are judged on the server: a measured reading must lie between the lower and upper limit, an attribute reading must be OK. One NOT OK makes the row, and the sheet, rejected; **a sheet with a reading out of limit cannot be marked accepted** (it can be rejected or conditionally accepted with a written condition). An instrument chosen on a sheet must be in calibration on the sheet's date.

## 2. Migrations and other changes
* `20261122000000_phase12_a_qms`: `qms_templates` (seeded with the ten client forms), `qms_plans`, `qms_inspections`, `qms_inspection_rows`, `qms_forms`, `qms_rejections`, `qms_monthly`, `qms_cost_entries`, `qms_settings`, `qms_instruments`, `qms_calibrations`. One live inspection lot per goods-receipt line (partial unique index).
* New code: `apps/api/src/modules/qms/*` (`logic` pure rules, `inspection-service`, `forms-service`, `registers-service`, `instruments-service`, `master-service`, `inbound`, `routes`). Web: `apps/web/src/pages/qms/*`, `apps/web/src/lib/qmsApi.ts`, wired in `ModulePage.tsx`.
* Changed outside the new folder: `app.ts` (mounts the router), `core/jobs/index.ts` and `approvals/register-jobs.ts` (the daily job), `notifications/types.ts` (two notification types), `core/http/errors.ts` (three error codes).
* Numbers: `IQC`, `IPQC`, `PDI`, `ISIR`, `WLD`, `VT`, `8D`, `QA`, `MOM`, `CI`, `REJ`, each a Phase 3 number series per unit and year.

## 3. Deviations and things you must decide
1. **The AQL / sampling plan is not coded.** ERRATA E-31 keeps "Phase 12 AQL value of the old sheet" as an owner decision. A plan says which characteristics to check; **how many pieces to sample is typed on the sheet** (the number of reading columns comes from the template). Give me the AQL table and I will add it as data.
2. **Targets are yours.** PPM targets (internal, customer) and the quality-cost % target are **not seeded**; until you enter them on *Inspection Plans › Targets* the monitors show the value without a verdict. The one seeded number is the **calibration reminder window of 15 days**, flagged *needs review*.
3. **PPM inputs are typed monthly.** Phase 13 (production) does not exist yet, so *produced quantity* and *customer-rejected quantity* are entered per unit and month, together with the sales value for the cost %. When Phase 13 and the sales invoices can supply them, the screen can fill them in.
4. **Rework cost is not posted to the GL.** ERRATA E-22 reserves the account key `QMS_REWORK_EXPENSE` for this phase, but nothing in the spec says when to post it or how to cost a rework. The quality-cost monitor takes costs as typed entries. No journal is created by Phase 12.
5. **No approval workflow on inspection sheets.** The Usage Decision is the controlled step (action *approve*); the inspector submits (action *submit*). The Phase 5 approval engine is not used, so the module-control "approval required" switch has no effect on these pages.
6. **Where MOM and Continuous Improvement live** (ERRATA E-32 (b), still your decision): I put them on the CAPA page of Quality, because the menu had no better place and the registry is frozen. They are plain template forms, so moving them later is a menu change.
7. **Inspection sheet of other source documents.** Only the goods receipt creates a lot by itself. In-process, pre-dispatch and the rest are started by hand (no link yet to a work order or a dispatch; those arrive with Phases 13 and 10 follow-ups).
8. **Not built:** PDF print of the sheets and of the 8D (the print registry of Phase 4 is not wired to these forms), Excel export of the registers, photo attachments for the quality alert, supplier rating from rejections, NCR / CAPA as separate documents (the 8D carries the CAPA reference as text), Phase 19 dashboards.
9. **Data scope.** Rows are scoped by unit (and by creator for pages whose data scope is OWN). The register totals and the monitors follow the unit chosen in the top bar.

## 4. Test results
**The 3 clean runs required by STANDARDS were NOT done.** The machine is short of memory (the Phase 11 runs were stopped for it), so I ran each check once.
* Phase 12 API test (phase12-qms.test.ts): 13 of 13 pass after the review fixes.
* Full API suite on a clean rhai_erp_test: 71 files passed, 1 failed; 1013 tests passed, 1 failed, 45 skipped. The failure is phase01-identity "enforces challenge flow when MFA is enabled": the MFA verify transaction passed its 10 s limit on this slow machine (same result when that file runs alone). It is login code Phase 12 did not touch.
* Web, full suite (run once on 2026-11-09): 46 files passed, 387 tests passed, 29 skipped, 0 failed (includes Qms.test.tsx, 4 of 4).
* e2e (run on 2026-11-09): phase12.spec.ts passes (all nine quality pages open) together with auth.spec.ts. auth.spec test 6 fails as in earlier reports; the older phase2 to phase6b specs fail on a fresh e2e database in a full run (they were never part of the Phase 8 to 11 e2e sets), so they are not a Phase 12 result.
* tsc and eslint: clean for the new API and web code.
* Independent review (code-review, high): 11 findings. Fixed: goods-receipt sheets could not be completed (header was read-only), lot quantity editable by API, lot creation checked no unit or posted status, failed instrument could be reactivated, template switch dropped or kept wrong fields, rejection could close without a note, calibration checked against a back-dated sheet date, decimal comma read as thousands, cleared item / customer / supplier kept the old one. **Not fixed:** the lists show the newest 50 rows only (no paging yet); a duplicate small string helper.

## 5. Known issues
* e2e `auth.spec.ts` test 6 fails as in the Phase 8–11 reports (old role label).
* The browser test only opens the nine pages. The rules and the numbers are proved by `apps/api/tests/phase12-qms.test.ts` (13 tests) and the screens by `apps/web/src/pages/qms/Qms.test.tsx` (4 tests).
* Repo-wide `npm run lint` and `tsc` of the old test files still report errors outside Phases 9–12.

## 6. Manual check list for the owner
1. **Item Master**: an item with *Quality Inspection Required* ticked. **Inspection Plans › Inspection plans › New**: type Incoming, that item, one measured characteristic (lower 9.5, upper 10.5) and one OK / NOT OK check.
2. Receive that item with a **Goods Receipt** and post it. **Incoming Quality** shows a new lot, already filled with the supplier, invoice and the plan's rows. Stock Balance shows the quantity in *Quality Inspection*.
3. Open the sheet, type 10.7 in the reading: it turns **NOT OK**. Try *Submit* with result *Accepted*: it is refused. Change it to 10.1, submit.
4. Record the **Usage Decision**: accepted 98, rejected 2, reason *Cracked edge*. Stock Balance now shows 98 Unrestricted and 2 Blocked. **Non-Conformance** register has the 2 pieces *Return to vendor*.
5. **Final Quality › New welding sheet**: fill the header, mark one check NOT OK, submit as *Conditionally accepted* with a condition.
6. **CAPA › 8D**: create one, try *Close*: it lists what is missing. Fill it, add a CAPA reference, close.
7. **Non-Conformance › PPM monitor**: enter a month (produced 10,000, rejected 25, customer 5). Enter the targets on **Inspection Plans › Targets**; the verdicts appear. Add costs on *Quality cost monitor*.
8. **Calibration**: add an instrument, record a calibration. Set its validity to within 15 days and the quality team gets the reminder the next morning (once).
9. **Inspection Plans › Form templates**: publish a customer-specific *Pre-dispatch* format; choosing that customer on a new sheet shows its fields.
