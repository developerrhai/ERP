# PHASE 12


*Calibration:**
- **Daily job qms.calibration-sweep (00:05 IST):** past due or never calibrated → Blocked (OVERDUE);
  due within 15 days → Due Soon + notify.
- **Checks on every result save:**
  - blocked or past due on the measurement date → 409 QMS_INSTRUMENT_BLOCKED;
  - least count coarser than required → 422 QMS_INSTRUMENT_RESOLUTION.
- **Saving a calibration record:**
  - next_due = date + frequency;
  - external calibration needs certificate + NABL number + traceability;
  - each point passes when |as_found − nominal| ≤ tolerance.
- **Out of tolerance** (Fail, or Pass After Adjustment with an NG as-found point):
  - a Fail blocks the instrument (OOT);
  - an impact review opens over [last good calibration, this record], listing posted inspections
    measured with that instrument;
  - unblocking needs a Pass record **and** the review closed by the quality head.

**PPM / capability / COPQ:**
- PPM = supplier rejected qty in the month / received qty × 10⁶ (integer).
  - Example: 12 / 8,000 → 1,500 PPM → B.
  - Grade cuts (setting): A ≤ 1,000; B ≤ 5,000; C ≤ 10,000; D above.
- Monthly job qms.supplier-period on the 1st at 02:00.
- QmsSupplierMetricsPort.getQuality(supplierId, period) is read by Phase 9.
- Cp = (USL − LSL) / 6σ_within (σ_within = R̄/d₂); Cpk = min(USL − μ, μ − LSL) / 3σ.
  - Example: 9.90 / 10.10, μ 10.02, σ 0.02 → Cp 1.667, Cpk 1.333.
  - Flag below 1.33 (ongoing) or below 1.67 (PPAP initial).
- COPQ = internal + external failure costs; % of sales uses Finance monthly sales.

**QmsProcessPort (for Phase 13):**
~~~
requestInspection({kind:'IN_PROCESS'|'FINAL'|'FIRST_OFF', workOrderId, woOperationId, itemId, batchId, qty, idempotencyKey}) -> {inspectionId}
getGate(woOperationId) -> {state:'NOT_REQUIRED'|'PENDING'|'PASSED'|'FAILED'|'ON_HOLD', inspectionIds}
getFinalRelease(batchId) -> {released:boolean, certificateNo?}
onInspectionPosted(callback)   // emitted after commit via pg-boss 'qms.inspection-posted'
~~~

## 6. API (/api/v1/qms; {data,meta}; ETag; Idempotency-Key on stock / GL / status POSTs)
- **Plans:** /plans (+ /characteristics, /approve, /revise)
- **Sampling:**
  - /sampling/schemes
  - /sampling/lookup?lot=&scheme=&supplier=&item=
  - /sampling/states/:id/confirm-reduced
  - POST /sampling/aql-rows/import
- **Inspections:**
  - /inspections?kind=&status=&unit=
  - PUT /inspections/:id/results (bulk; returns evaluated results + recommendation)
  - POST /inspections/:id/complete | post | cancel
  - GET /holds; GET /final-release/:batchId
- **NCR:** /ncrs (+ /containment, /dispositions, /dispositions/:lid/complete, /costs, /close); /alerts
- **CAPA:** /capas (+ /steps/:d/complete, /root-causes, /actions, /effectiveness, /request-closure)
- **5-Why:** /five-whys (+ /close)
- **Calibration:**
  - /instruments (+ /import, /:id/block | unblock)
  - /calibrations
  - /impact-reviews/:id/items | close
  - /calibration/compliance
- **Supplier & PPAP:** /suppliers/periods, /suppliers/:id/scorecard, /audits, /ppap, /capability
- **Reports:** /reports/{ppm,pareto,fpy,copq,ncr-ageing,capa-ageing}
- **Prints:** /print/:formCode/:id (client-style layout on the letterhead)

## 7. UI
**Tablet InspectionGrid:**
- Characteristics fixed on the left; samples 1…n as columns.
- 48 px inputs with a numeric keypad. A cell turns green or red when you leave it, and shows the spec
  range in grey.
- Swipe to the next sample. Big OK / NG toggles. Camera photo per row.
- Only usable instruments can be picked; blocked ones are greyed out with their due date.
- Sticky footer: "Defective x / Ac y → recommendation".

**Incoming flow:**
1. GRN posted → lot appears in Queue.
2. Open it; sample size and severity are shown.
3. Enter results → Complete.
4. The decision panel is pre-filled; quantities must add up.
5. Post → toast "Posted. 2 rejected kept in QC Hold. NCR NCR/TAL/26-27/0004 created".

**Other screens:**
- NCR: disposition grid with a coverage bar (covered / hold).
- CAPA: stepper with padlocks and the reason each step is locked.
- Calibration: tiles (Overdue / Due in 15 days / OK) and a red banner for open impact reviews.
- Prints: IQC, IPQ, ISIR, VT, WELD_BA, rework register, 8D, why-why, Q-alert, instrument list,
  calibration record, MOM, release certificate.

## 8. Messages
| Code | Message |
|---|---|
| QMS_QTY_RECONCILE | "Accepted 90 + rejected 8 + rework 0 + hold 0 = 98, but lot is 100." |
| QMS_RESULTS_INCOMPLETE | "3 required readings are missing (sample 4: Bore Ø)." |
| QMS_INSTRUMENT_BLOCKED | "Instrument VC-014 is blocked (overdue since 30-10-2026). Use another or calibrate it." |
| QMS_INSTRUMENT_RESOLUTION | "This instrument's least count is too coarse for this characteristic." |
| QMS_DISPOSITION_QTY | "Dispositions total 12.000 but only 10.000 is on hold." |
| QMS_ASIS_FORBIDDEN | "Critical NCR cannot be used as-is without customer authorisation." |
| QMS_RTV_NEEDS_GRN | "Return to vendor needs a GRN-linked NCR. Create the debit note in Procurement." |
| QMS_8D_GATE | "Complete D4 before D5." |
| QMS_EFFECTIVENESS_EARLY | "Effectiveness can be recorded from 01-02-2027." |
| QMS_POSTED_LOCKED | "Posted documents cannot be edited. Create a re-inspection." |
| QMS_CERT_REQUIRED | "External calibration needs certificate, NABL number and traceability." |
| QMS_AQL_TABLE_MISSING | "No AQL 2.5 normal row for letter K. Import the table first." |

## 9. Audit & notifications
- **Audit:** every create / post / decision / disposition / approval callback / block / unblock /
  sampling switch / CAPA step. System jobs are recorded as actor "system".
- **Notifications:**
  - lot rejected → Purchase and Stores;
  - NCR created / SLA breached → owner and quality head;
  - disposition approval → approver;
  - CAPA overdue, effectiveness due;
  - instrument due / blocked / out of tolerance → owner and quality head;
  - supplier tightened / discontinued / SCAR → Purchase;
  - PPAP awaiting the customer.

## 10. Tests
- **Unit:**
  - code letters, arrows, 100 % rule;
  - switching sequences (2 of 5 → tightened; 5 accepted → normal; 5 rejected on tightened →
    discontinued; score 15 × 2 = 30);
  - rounding at limits, one-sided limits, a piece counted once, recommendLot;
  - Cp / Cpk / Ppk, PPM, COPQ.
- **Integration:**
  - GRN → inspection (idempotent);
  - qcDecide called exactly once per line, with no second voucher;
  - rejected qty stays in hold;
  - scrap journal balances;
  - a disposition does nothing until approved, and the approver ≠ owner;
  - blocked instrument → 409;
  - impact review lists the right inspections;
  - CAPA gates; early effectiveness refused;
  - ETag 412; idempotent replay;
  - a SAW user cannot read TAL.
- **Simulation:** 200 random lots — qty reconciles, stock value conserved, coverage ≤ hold, one NCR
  per rejection, no reading saved with a blocked instrument.
- **Playwright** at 1024×768: incoming accept and reject; NCR scrap with approval; 8D to closure;
  overdue calibration; prints.
- 3 clean runs.

## 11. Acceptance
- [ ] Frozen tabs and fields are unchanged.
- [ ] A GRN creates a queued inspection with the correct letter / n / Ac / Re.
- [ ] Accepted stock is released only through qcDecide.
- [ ] Cells turn OK / NG from the limits; the NCR is created automatically; dispositions need approval
      and must cover the held qty.
- [ ] Scrap posts SCRAP_LOSS; return to vendor creates the Phase 9 debit note.
- [ ] 8D gates and the 90-day check are enforced.
- [ ] An overdue instrument can't be used; an out-of-tolerance result opens an impact review.
- [ ] Monthly PPM can be read by Procurement.
- [ ] Client-style prints come out on the letterhead.
- [ ] Only reference tables are seeded.

## 12. Out of scope
SPC run rules, MSA/Gage R&R, skip-lot, double sampling, variables sampling, welder/WPS register,
supplier portal, offline mode, PFMEA authoring, customer PPAP portal. Work-order triggers come from
Phase 13 through QmsProcessPort.

## 13. Owner check
1. GRN 1000 of a QC item. Does the queue show "Sample 80, Ac 5, Re 6" (AQL 2.5)?
2. Enter 10.06 against 10.00 ± 0.05. Is it red?
3. Reject 2 and post. Is stock 998 released and 2 on hold, with an NCR open?
4. Scrap 2. Is there an approval request, and after approval a SCRAP_LOSS journal?
5. Make an instrument overdue. Does choosing it give the "blocked" message?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md (R-01..R-24), ERRATA.md, PHASE-12.md, Phase 4–9
code as built; docs/archive/plans/06*.md for field/print detail only (NEVER open doc from clint/).
7 migrations <ts>_phase12_*; seed only code letters, defect master, CLIENT-LEGACY scheme, QC_IN/QC_OUT,
QMS_REWORK_EXPENSE. packages/calc/quality first, with §5 examples as tests. Wire Phase 9
QmsInboundPort.onGrnPosted and call qcDecide / debit note — never a second stock posting for GRN qty.
Use StockService.hold/releaseHold/post, PostingService (SCRAP_LOSS, INVENTORY_*), ApprovalService
(QMS_NCR_DISPOSITION, QMS_CONCESSION, QMS_CAPA_CLOSE), NotificationService, DocumentService, PdfService.
pg-boss jobs qms.calibration-sweep, qms.supplier-period, qms.inspection-posted. Expose QmsProcessPort and
QmsSupplierMetricsPort. UI in index.html look with tablet InspectionGrid. ETag, Idempotency-Key, audit;
posted rows immutable. 3 clean runs. Migrations local dev/test only (R-16). Never push; commit only if
asked. Write PHASE-12-REPORT.md.
