# PHASE 11

# PHASE 11 — Indian Taxation (GST returns, e-invoice, e-way bill, TDS/TCS)
(ERRATA E-23: itc_reversals is ALTERed here, not created. E-24: inter-GSTIN transfers start working here.)

## 1. Goal
Turn the posted documents from Phases 8–10 into statutory outputs for each GSTIN and the company PAN:
- GSTR-1 and GSTR-1A JSON
- GSTR-3B worksheet
- 2B / IMS reconciliation
- e-invoice and e-way bill upload JSON
- quarterly TDS/TCS data

**Nothing is sent live (R-12).** The user uploads the file on the portal and types back the IRN / Ack /
QR, the e-way bill number and validity, and the ARN.

This matters because GSTR-3B liability is now hard-locked to GSTR-1/1A, ITC exists only if it appears
in 2B/IMS, and ITC must be reversed when a supplier is unpaid after 180 days.

## 2. Pages (tabs as in index.html PROFILES)
- tax-gst, tax-gstr1, tax-gstr3b, tax-tds, tax-tcs, tax-hsn, tax-einvoice, tax-eway, tax-salesreg, tax-purchasereg.
- tax-gst and tax-hsn are views/editors over the Phase 6 masters (no duplicate tables).

## 3. Rules (each value is a statutory_params row, needs_review, with source_url)
1. **GSTR-1 tables:**
   - 4A/4B/6B/6C (B2B incl. SEZ and deemed export)
   - 5 B2CL (inter-state B2C invoice above ₹1,00,000 from 1-Aug-2024)
   - 6A exports
   - 7 B2CS (aggregated)
   - 8 nil/exempt
   - 9A/9B/9C amendments and credit/debit notes
   - 11 advances (manual rows only)
   - 12 HSN
   - 13 documents issued
2. **Table 12, phase III:** split into B2B and B2C tabs; HSN picked from the master. Table 13 is
   mandatory from the May 2025 period.
3. **GSTR-1A:** a same-period correction filed after GSTR-1 and before 3B. v1 builds a delta JSON.
4. **GSTR-3B:** the ERP computes it independently and compares it with the portal draft. Liability can't
   be edited on the portal, so mistakes are fixed through 1A or the next GSTR-1. ITC comes from 2B/IMS.
5. **IMS:** each inward document is Accepted / Rejected / Pending. The ERP recommends the action; the
   user takes it on the portal. RCM documents are not in IMS.
6. **E-invoice (INV-01 schema, version from params, seed "1.1"):**
   - for B2B / SEZ / export / B2B credit and debit notes, above AATO ₹5 cr;
   - AATO ≥ ₹10 cr → the IRP rejects documents older than 30 days;
   - cancel only within 24 h, whole document only, not while an e-way bill is active; after that, issue
     a credit note.
7. **E-way bill (Rule 138):**
   - Needed above ₹50,000 (Maharashtra intra-state override row ₹1,00,000, verify); also always for
     inter-state job work and listed goods.
   - Validity = ceil(km / 200) days for normal cargo (20 km/day for ODC); expires at midnight.
   - Part B can be skipped under 50 km to the transporter.
   - Extension window: from 8 h before to 8 h after expiry.
   - Cancel within 24 h; the recipient can reject within 72 h.
   - No e-way bill on a document older than 180 days; total life capped at 360 days.
   - Multi-vehicle and consolidated bills are in the data model.
8. **Inter-unit transfers:**
   - Units with **different** GSTINs are distinct persons, so a transfer is a supply (Schedule I):
     tax invoice + IRN + e-way bill, shown in GSTR-1 B2B and in the receiver's 2B.
   - Value under Rule 28: invoice value accepted when the receiver can take full ITC; otherwise open
     market value → like-kind value → cost + 10 %.
   - Same GSTIN → delivery challan (Rule 55).
   - This lifts the E-24 block.
9. **ITC:**
   - s.16(4) time limit.
   - 180-day reversal + interest (3B 4(B)(2)), reclaimed after payment (4(A)(5) and 4(D)(1)).
   - Rule 37A: reverse when the supplier hasn't filed by 30 Sep.
   - Rule 42/43 is out of scope.
10. **Rates (GST 2.0, 22-Sep-2025):** live in Phase 6 hsn_sac_rates. This phase only checks that the
    document rate equals the rate valid at the time of supply.
11. **TDS/TCS under the Income-tax Act 2025 (from 1-Apr-2026):**
    - non-salary TDS → s.393 table payment codes; TCS → s.394;
    - forms: 140 (was 26Q), 138 (was 24Q, Phase 16), 144 (was 27Q), 143 (was 27EQ);
    - FY 2025-26 Q4 stays on the old forms;
    - every form, section, code, rate and due date is a data row; act IT1961 / IT2025;
    - for Sawant, TCS mainly applies to **scrap sales**.

**v1 delivers:** everything above, per GSTIN, for monthly filers, plus Form 140 and 143 data.
**Later:** live GSP/IRP calls (a mock adapter ships now), QRMP, GSTR-9/9C, Rule 42/43, ISD, Forms 138/144.

## 4. Database (<ts>_phase11_*)
- **statutory_params**(code, act/scope, value_json, effective_from/to, source_url, needs_review,
  reviewed_by/at). Seed: gst.b2cl_limit, gst.due_day.*, gst.2b_tolerance_per_head (1.00),
  gst.itc_payment_days (180), einv.*, eway.*, tds.due.*, tds.form.*, gst.schema.gstr1.
- **gst_return_periods**(gst_registration_id, return_type GSTR1/GSTR1A/GSTR3B/GSTR2B_IMPORT,
  period 'MMYYYY', fiscal_period_id, due_date, status OPEN → PREPARED → VALIDATED → JSON_GENERATED →
  FILED → LOCKED, arn, filed_on, filed_by, json_sha256, file_ref)
  - unique (gstin, type, period); nothing is recomputed after FILED
- **gstr1_snapshots**(period, section B2B/B2CL/B2CS/EXP/SEZWP/SEZWOP/DE/CDNR/CDNUR/NIL/HSN_B2B/
  HSN_B2C/DOCS/AT/ATADJ/B2BA/CDNRA/B2CSA, key_json, values, source_doc_ids) — frozen when the JSON is built
- **gstr1_issues**(period, code, severity, doc_id, message)
- **gstr3b_summaries**(period, table_code 3.1a…5.1, pos_state, amounts, source BOOKS/PORTAL)
- **gstr3b_payments**(period, head, credit used per head, cash, interest, late fee, CPIN, CIN, date) → GL
- **gst_2b_imports**(gstin, period, file_sha256, generated_on, row_count, raw_json)
- **gst_2b_lines**(section, supplier_gstin, doc_type, doc_no, doc_no_norm, doc_date, pos, amounts,
  itc_avl, reason, ims_action, supplier_filing_date)
- **gst_recon_matches**(2b_line, purchase_invoice, status MATCHED/MATCHED_TOLERANCE/VALUE_MISMATCH/
  ONLY_IN_2B/ONLY_IN_BOOKS/PERIOD_MISMATCH, diff per head, recommended_ims_action, decided_by, reason)
- **ALTER itc_reversals** (from Phase 9): add kinds R37A, S17_5, MANUAL, plus period, interest, reclaimed_period
- **einvoice_records**(sales_doc_id unique while live, gstin, doc_type INV/CRN/DBN, json_sha256,
  schema_version, status PENDING → JSON_GENERATED → IRN_ENTERED → CANCELLED/ERROR, irn char(64), ack_no,
  ack_dt, signed_qr, qr_png, must_report_by, cancel_deadline, cancel_reason_code, remark, error)
- **eway_bills**(source doc, gstin, from/to GSTIN, supply_type, sub_type, doc no/date, value, hsn_lines,
  transporter, mode, distance_km, odc, ewb_no char(12), generated_at, valid_until, status, cancel_deadline,
  max_valid_until, consolidated_ewb_no)
- **eway_partb_history**, **eway_extensions**
- **customer_tcs_ledger**, **tds_tcs_challans**(act, kind, section/payment code, month, BSR, serial,
  date, CIN, amounts, journal), **tds_tcs_allocations**, **tds_tcs_returns**(tan, form_code, act,
  quarter, status, token, filed_on, export_sha256)
- **tax_due_calendar** — rebuilt from params by a job
- **inter_unit_tax_invoices**(stock_transfer_id unique, from/to registration, sales_doc_id (IUT
  invoice via Phase 10), valuation_basis, value)

## 5. Algorithms (packages/calc/tax/*)
**Gstr1Builder:**
- Reads posted documents in the period, plus amendments of already-filed periods.
- Classification:
  - recipient has a GSTIN → B2B (SEZ / deemed export variants);
  - unregistered, inter-state, above b2cl_limit on the document date → B2CL;
  - export → EXP;
  - all other B2C → B2CS, aggregated by (POS, rate, intra/inter);
  - notes: registered → CDNR; unregistered → CDNUR only if inter-state and the original was
    B2CL/export, otherwise netted into B2CS.
- HSN grouped by (hsn, uqc, rate) separately for B2B and B2C. DOCS from NumberingService series
  (from/to/total/cancelled).
- The JSON is validated against the vendored official schema.

**Gstr3bService:**
- 3.1(a) from the frozen GSTR-1. 3.1(d) = inward RCM.
- 4A from 2B/IMS: matched, eligible and not rejected.
- 4B(1) = s.17(5) etc.; 4B(2) = Rule 37/37A reversals; 4D(1) = reclaims.
- Set-off order (s.49A/B, Rule 88A): cess against cess; IGST first against IGST, then CGST, then SGST;
  CGST and SGST credit never cross; the remainder in cash.
- A difference against the portal above ₹1 per head is a warning, with its cause shown.

**ReconService:**
- Normalise numbers: uppercase, strip spaces / '/' / '-', and leading zeros of the numeric tail.
- Key = (supplier GSTIN, FY, doc type, normalised number).
- Within tolerance → MATCHED / MATCHED_TOLERANCE; same key outside it → VALUE_MISMATCH; other period →
  PERIOD_MISMATCH.
- Fuzzy suggestions (same GSTIN, ±3 days, ±₹1) are never auto-matched.
- Recommendation: Accept if matched; Reject if not in books or blocked; Pending if goods not received
  or values mismatch.

**ItcAgeingJob (daily):** unpaid at doc date + 180 → reversal = ITC × unpaid / invoice value, plus
interest at the s.50 rate row, posted via PostingService; reclaim when paid.

**EinvoiceBuilder (INV-01):**
- Sections: TranDtls (SupTyp B2B / SEZWP / SEZWOP / EXPWP / EXPWOP / DEXP), DocDtls (No ≤ 16,
  date dd/mm/yyyy), Seller, Buyer (Pos), ItemList (HsnCd, Qty, Unit = UQC, AssAmt, GstRt, tax amounts),
  ValDtls, optional e-way / export / reference details.
- Totals = Σ lines ± 1.
- Blocks past the 30-day limit.
- enterIrn checks: IRN is 64 hex characters, ack number and date are present, and the signed QR JWT
  decodes to the same IRN / document number / value.

**EwayApplicability.decide:**
- Required if value (taxable + tax, exempt lines excluded) exceeds the threshold for the scope and date,
  or for inter-state job work, or for an HSN on the always-required list.
- Returns {required, reason, partBRequired}.
- Validity as in §3; extensions only inside the ±8 h window and capped at 360 days.

**TdsReturnPrep:**
- Deductee rows from the supplier / customer ledgers; challan rows.
- Checks: PAN format or PANNOTAVBL, higher rate when there is no PAN, lower-deduction certificate,
  every row allocated, challan ≥ allocated.
- Exports the RPU layout; the user runs FVU, files, and enters the token.

**Rounding:** line tax r2 half-up. Returns sum the stored line values and never recompute. 3B cash is
paid in whole rupees.

**InterUnitTaxService:**
- A dispatch between distinct GSTINs creates a Phase 10 IUT tax invoice, which enters the e-invoice and
  e-way queues.
- The receiving unit gets an ITC entry, PENDING until it appears in 2B.

**GspAdapter interface:** generateIrn, cancelIrn, generateEwb, updatePartB, extendEwb, cancelEwb,
fetch2B, saveGstr1. Only MockGspAdapter ships, and only for tests.

## 6. API (/api/v1/tax; {data,meta}; ETag/If-Match; Idempotency-Key)
- **Params:** GET /params?code=&on= · POST /params · POST /params/:id/review
- **Returns:**
  - GET /returns?gstin=&type=&period=
  - POST /returns/:id/prepare · GET /returns/:id/issues
  - POST /returns/:id/generate-json (409 RETURN_HAS_ERRORS) · GET /returns/:id/file
  - POST /returns/:id/mark-filed · POST /returns/:id/gstr1a-delta
- **3B:** GET /gstr3b/:periodId · PUT /gstr3b/:periodId/portal-values · POST /gstr3b/:periodId/payment (approval)
- **2B:** POST /2b/import · POST /2b/:importId/match · GET /recon · POST /recon/:id/decide
- **ITC:** GET /itc/reversals · POST /itc/reversals/:id/reclaim
- **E-invoice:** GET /einvoice · POST /einvoice/generate-json · POST /einvoice/:id/irn · POST /einvoice/:id/cancel
- **E-way:** GET /eway · POST /eway/decide · POST /eway/generate-json · POST /eway/:id/number | part-b | extend | cancel
- **TDS:** GET /tds/register · POST /tds/challans · POST /tds/challans/:id/allocate · POST /tds/returns/prepare ·
  GET /tds/returns/:id/export · POST /tds/returns/:id/mark-filed
- **Registers:** GET /registers/sales | purchase (CSV / XLSX) · GET /calendar

## 7. UI (index.html look; GSTIN selector TAL/SAW/VAR; "All units" is read-only)
- **Clerk:**
  - e-invoice / e-way queues: Generate JSON → download → upload on portal → paste IRN/QR or e-way number;
  - Part B and extensions;
  - 2B upload.
- **Accountant:**
  - GSTR-1: Prepare → fix issues → Generate JSON → upload → enter ARN;
  - 3B workspace: books vs portal side by side, differences highlighted, set-off preview;
  - reconciliation decisions ("Accept recommended" only for matched rows);
  - TDS challan allocation and export;
  - a red badge on any page that uses an unreviewed param.
- **Monthly rhythm per GSTIN:**
  1. Days 1–10: clear the e-invoice and e-way queues.
  2. By the 11th: file GSTR-1.
  3. Days 12–14: import IMS/2B and reconcile; take IMS actions on the portal; import the final 2B.
  4. Compute 3B, pay, file, enter ARN.
  5. Lock the period.

## 8. Messages
| Code | Message |
|---|---|
| GSTIN_INVALID | "GSTIN {g} fails the check digit." |
| HSN_DIGITS_SHORT | "HSN must have at least {n} digits for {gstin}." |
| HSN_NOT_IN_MASTER | "HSN {h} is not in the HSN master." |
| RATE_NOT_EFFECTIVE | "Rate {r}% was not valid for HSN {h} on {date}." |
| POS_MISSING | "Place of supply is missing on {doc}." |
| DOC_NO_TOO_LONG | "Document number is longer than 16 characters." |
| DUPLICATE_DOC_NO | "Document number {no} is used twice in {fy}." |
| UQC_INVALID | "Unit {u} has no valid GST UQC." |
| IRN_MISSING | "E-invoice applies but IRN is missing on {doc}." |
| IRN_30DAY_EXPIRED | "Older than 30 days; the IRP will reject it." |
| CANCEL_WINDOW_CLOSED | "Cancel only within 24 h of acknowledgement; issue a credit note instead." |
| EWB_ACTIVE_ON_IRN | "Cancel the e-way bill before cancelling the IRN." |
| EWB_DOC_TOO_OLD | "Document is older than 180 days; e-way bill not allowed." |
| EWB_EXT_OUT_OF_WINDOW | "Extension is allowed only from 8 h before to 8 h after expiry." |
| EWB_MAX_360 | "E-way bill cannot be extended beyond 360 days." |
| EWB_PARTB_REQUIRED | "Enter vehicle details (Part B) for this distance." |
| RETURN_HAS_ERRORS | "Fix {n} errors before generating the file." |
| PERIOD_FILED_LOCKED | "Period filed with ARN {arn}; correct via GSTR-1A or next period amendment." |
| PARAM_NEEDS_REVIEW (warning) | File name gets the suffix _UNREVIEWED. |
| TDS_CHALLAN_SHORT | "Challan total is less than the TDS allocated to it." |
| PAN_INVALID | "PAN {p} is not valid." |
| QR_MISMATCH | "The signed QR does not match this invoice." |

## 9. Audit & notifications
- **Audit:** every state change, file built (sha256), IRN / EWB / ARN entered, recon decision, override,
  and param change.
- **Due-date reminders** (from tax_due_calendar only):
  - GSTR-1 / 3B: 5 days before, 1 day before, and on the day;
  - TDS deposit on the 7th; quarterly return 7 days before;
  - e-way bill expiring within 8 h;
  - IRN cancel window closing in 2 h;
  - e-invoice day 25 of 30;
  - ITC-180 due; Rule 37A; s.16(4) last date;
  - a param expiring with no successor.
- **Approvals:** marking a return filed, 3B payment, ITC overrides, param rows.

## 10. Tests
- **Calc:**
  - Rule 88A set-off examples from the CBIC circular;
  - e-way validity: 199 km → 1 day, 201 km → 2 days, ODC 25 km → 2 days;
  - 180-day reversal;
  - B2CL boundary: exactly ₹1,00,000 → B2CS.
- **JSON:** validated against the vendored official schemas; QR decode with the IRP sandbox sample.
- **Integration:**
  - a full month per GSTIN on scrubbed real data;
  - snapshots immutable after FILED;
  - TAL→SAW transfer → IUT invoice → B2B at the sender and a 2B line at the receiver.
- 3 clean runs.

## 11. Acceptance
- [ ] GSTR-1 JSON for a real month passes the offline tool with 0 errors, and totals = the sales register.
- [ ] 3B from books = portal draft within ₹1 per head, or the differences are explained.
- [ ] At least 95 % of real 2B rows auto-match, and every other row has a recommended action.
- [ ] 10 e-invoice and 10 e-way JSONs are accepted by the bulk tools.
- [ ] Form 140 passes FVU.
- [ ] No literal statutory numbers in code.

## 12. Out of scope
Live portal calls, QRMP/IFF, GSTR-9/9C/4/5/6/7/8, ISD, Rule 42/43, refunds, Forms 138 (Phase 16) and
144, 26AS/AIS reconciliation, B2C dynamic QR, litigation tracker.

## 13. Owner check
1. GST Setup shows the right GSTINs and flags.
2. GSTR-1 taxable total = the Sales Register total.
3. After the 2B upload, "Only in 2B" lists the bills that were never booked.
4. A TAL→SAW transfer (different GSTINs) creates an IUT invoice in the e-invoice queue.
5. Cancelling an IRN after 24 h is refused with the credit-note message.

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md (R-01..R-24), ERRATA.md, PHASE-11.md and the
Phase 3/6/7/8/9/10 code as built. NO live calls to GSTN/IRP/EWB/TRACES — files only; GspAdapter + Mock.
1 migrations <ts>_phase11_* per §4 (ALTER itc_reversals, do not recreate);
2 seed statutory_params only from official sources, needs_review=true + source_url; no literal statutory
  numbers in services;
3 packages/calc/tax: classifyGstr1, aggregateB2cs, hsnSummary, docsIssued, gstr3b, rule88aUtilise,
  normaliseDocNo, reconcile, itcAgeing, ewayApplicability, ewayValidity, extensionWindow, einvoiceJson,
  decodeSignedQr, tdsReturnRows — pure, Decimal;
4 services Gstr1Builder, Gstr1aDelta, Gstr3bService, ReconService, ItcAgeingJob, EinvoiceService,
  EwayService, TdsTcsService, InterUnitTaxService (lifts the E-24 block), DueCalendarJob;
5 API §6; UI 10 pages; vendor official JSON schemas and validate generated files;
6 messages §8, notifications §9, tests §10, 3 clean runs.
Migrations to local dev/test only (R-16). Never push; commit only if asked. Write PHASE-11-REPORT.md.
~~~

---

# PHASE 12 — Quality / QMS
(ERRATA E-26: base path /api/v1/qms. R-20: AQL default.)

## 1. Goal
Move Sawant's paper and Excel quality forms into the ERP: RM inward inspection, in-process inspection,
ISIR, VT weld report, before/after welding, rejection & rework register, 8D with why-why and quality
alert, instruments list, MOM, improvement ideas.

Add the rules paper cannot enforce:
- AQL sampling with switching (ISO 2859-1);
- automatic pass/fail from spec limits;
- usage decisions that move stock through Procurement/Inventory, never posting twice;
- automatic NCRs, with approved dispositions that must cover the held quantity and post cost of poor
  quality to the GL;
- 8D gates and an effectiveness check;
- overdue instruments blocked, with an impact review on out-of-tolerance;
- supplier PPM feeding Phase 9 evaluation.

Standards: ISO 9001 8.6 / 8.7 / 10.2 / 7.1.5 and IATF 16949 basics. This phase overrides the old
06*.md plans wherever contracts differ.

## 2. Pages (frozen tabs as in index.html)
| Page | Tabs | Is |
|---|---|---|
| qms-plans | Master, Characteristics, Sampling Rules, Spec Limits, Revision Control, Plan Coverage | Control / inspection plan |
| qms-incoming | Queue, Supplier Lot, Sampling & Tests, Acceptance Decision, NCR Link, Supplier Quality Trend | INCOMING inspections, one per GRN line |
| qms-process | In Process Inspection, Operation Checkpoints, SPC Readings, Hold Release, Defect Escalation, Process Capability | IN_PROCESS |
| qms-final | Final Queue, Final Checklist, Test Results, Release Certificate, Customer Requirement, Final Yield | FINAL + release certificate |
| qms-supplier | Dashboard, PPM & Rejection, Incoming Trends, SCAR Actions, Audit Findings, Score | Monthly supplier quality |
| qms-inspections | Register, Parameter Results, Sample Details, Accept Reject, Attachments & Certificates, Analytics | All kinds, incl. ISIR / VT / Weld before-after |
| qms-ncr | Register, Containment, Root Cause, Disposition, Responsibility & Due Date, NCR Trend (+ Quality Alerts, Cost of Poor Quality, Defect Master) | NCR |
| qms-capa | Register, Problem Statement, Root Cause, Corrective, Preventive, Effectiveness (+ Review Meetings / MOM, Improvement Ideas, PPAP) | 8D D0–D8 |
| qms-5why | Cases, Problem Definition, Why Chain, Evidence, Action Linkage, Closure Review | Occurrence + escape legs |
| qms-calibration | Register, Schedule, Results, Out of Tolerance, Certificates, Compliance | Instruments |

## 3. Rules
- **Inspection lot + one final usage decision** (the SAP pattern). A posted decision is final; mistakes
  are fixed by a re-inspection.
- **Nonconforming product** stays in QC hold.
  - Use-as-is / accept-under-deviation needs an approver.
  - If the spec is the customer's, the customer's authorisation reference and an expiry (date or qty)
    are also required.
- **Rework** always ends in a re-inspection. Repair is a separate disposition and needs a concession.
- **8D:** D4 has an occurrence root cause and an escape root cause. Effectiveness is checked after
  90 days.
- **Calibration:** traceable; external calibration needs certificate number, NABL number and a
  traceability statement. An out-of-tolerance result triggers an impact review.
- **AQL (R-20):** ISO 2859-1, General Level II, AQL 2.5 by default, single sampling, normal / tightened /
  reduced switching. Skip-lot is out.
- **Welds:** ISO 5817 quality levels B/C/D, ISO 6520-1 flaw codes, VT per ISO 17637. Formula limits are
  stored as text and judged by the inspector.
- **PPAP levels 1–5** (default 3); ISIR = dimensional results.
- **Client sheet errors this removes:**
  - one bad piece rejected the whole lot → the ERP counts defectives against Ac;
  - legacy n=8/n=13 with Ac 1 → the ISO table instead. The legacy table is kept only as plan CLIENT-LEGACY.

## 4. Database (7 migrations <ts>_phase12_*; posted/closed rows immutable by trigger)
- **masters:**
  - qms_defects(code, name, category, iso6520_code, severity_default)
  - qms_aql_code_letters(inspection_level, lot_min, lot_max, code_letter)
  - qms_aql_plan_rows(severity NORMAL/TIGHTENED/REDUCED, code_letter, aql, sample_size, ac, re,
    ac_one_step_tighter) — table arrows already resolved
  - qms_sampling_schemes(code, standard ISO2859-1/LEGACY/FIXED/HUNDRED_PCT, level, aql, legacy_rows)
  - qms_sampling_states(scheme, supplier, item, severity, switching_score, recent_results,
    consecutive_accepts, tightened_rejects, discontinued_at)
  - Inserts: QC_IN, QC_OUT (stock_voucher_types); QMS_REWORK_EXPENSE (account key, mapped by default to
    the SCRAP_LOSS account)
- **calibration:**
  - instruments(code, name, type, unit, location, range, least_count, accuracy, analog/digital,
    frequency_days, source INTERNAL/EXTERNAL, agency_supplier_id, commissioning_date,
    last_calibration_date, next_due_date, status Active/Due Soon/Blocked/Out for Calibration/Inactive,
    block_reason OVERDUE/OOT/DAMAGED/MANUAL, notify_user_id)
  - calibration_records(instrument, date, type, lab_name, nabl_cert_no, certificate_no,
    certificate_doc_id, traceability_text, ambient_temp, result Pass/Pass After Adjustment/Fail,
    next_due_date, cost, status)
  - calibration_points(record, nominal, tolerance, as_found, as_left, point_result)
  - calibration_impact_reviews + calibration_impact_items(inspection, readings_count,
    action Pending/No Impact/Re-inspect/NCR Raised/Recall, ncr_id, remark)
- **plans:**
  - inspection_plans(code, name, kind INCOMING/IN_PROCESS/FINAL/ISIR/VT/WELD_BA/FIRST_OFF/REINSPECT,
    item or item_group, customer_id, revision, effective_from, sampling_scheme_id, weld_quality_level,
    status Draft/Approved/Superseded) — one Approved revision per (item, kind)
  - inspection_plan_characteristics(seq, process_step, name,
    char_type MEASURED/ATTRIBUTE/CHECKLIST/WELD_FLAW/VALUE, char_class Critical/Major/Minor + SC symbol,
    nominal, lsl, usl (nullable), uom, decimals, spec_text, tolerance_text, method, instrument_type,
    least_count_required, sample_rule PLAN/FIXED/ALL/PER_N/FIRST_LAST, frequency_text, reaction_plan,
    is_required, defect_id)
- **inspections:**
  - inspections(code IQC/IPQ/FQC/ISR/VTR/WBA/RIN, kind, plan_id + revision, item, batch, heat_no,
    supplier, customer, grn_id, grn_line_id, work_order_id, wo_operation_id, parent_inspection_id,
    lot_qty, sample_qty, severity_used, ac, re, defective_count, inspected/accepted/rejected/rework/hold qty,
    mtc_status, header_data jsonb, recommendation,
    decision Accept/Accept Under Deviation/Reject/Partial/Hold, decided_by/at,
    status Draft/In Progress/Results Complete/Posted/Cancelled, ncr_id, idempotency_key)
  - inspection_results(inspection, characteristic, sample_no, measured_value, attr_value OK/NG/NA/NF,
    text_value, result (auto), instrument_id, measured_at, defect_id, photo_doc_id, remark)
    — unique (inspection, characteristic, sample_no)
  - inspection_stock_actions(inspection, action QC_DECIDE/HOLD/RELEASE_HOLD/QC_OUT/QC_IN, qty,
    port_ref, idempotency_key unique)
- **ncr:**
  - ncrs(code, unit, source Incoming/In-Process/Final/Customer/Calibration/Audit/Internal, inspection,
    item, batch, supplier, customer, problem, severity, hold_qty, process, operator,
    containment_done_at, owner, due_date (SLA 1/3/7 days by severity), status, qty summaries, capa_id)
  - ncr_containment_actions(location Stores/WIP/FG/Customer/In-transit, qty_found, qty_ok, qty_ng, done_by/at)
  - ncr_dispositions(type USE_AS_IS/REWORK/REPAIR/SCRAP/RETURN_TO_VENDOR/SORT, qty, concession_ref,
    customer_auth_ref, concession_expiry_date, concession_qty_limit, approval_request_id,
    status Proposed/Pending Approval/Approved/Rejected/Done/Cancelled, rework_inspection_id,
    debit_note_id, journal_id)
  - ncr_cost_lines(cost_class INTERNAL/EXTERNAL/APPRAISAL, cost_type, amount, journal_id (null = memo), date)
  - quality_alerts(ncr, title, what_changed, how_to_detect, photos, issued_to, valid_until)
- **capa:**
  - capas(code, type CAPA/8D/SCAR, ncr, supplier, customer, problem_statement (is/is-not), owner,
    target_date, current_d 0–8, effectiveness_due, effectiveness_result, approval_request_id,
    status Open/In Process/Effectiveness Pending/Pending Closure/Closed/Cancelled)
  - capa_steps (one per D), capa_team_members
  - capa_root_causes(leg OCCURRENCE/ESCAPE/SYSTEMIC, cause, verified, evidence_doc_id, five_why_id)
  - capa_actions(kind CORRECTIVE/PREVENTIVE/CONTAINMENT, action, owner, due, done_at, verified_by)
  - five_why_cases + five_why_steps (n 1–7, why, answer, evidence, verified)
  - quality_meetings + quality_meeting_points (MOM)
  - improvement_ideas(title, before, after, saving, status)
- **supplier_ppap:**
  - supplier_quality_periods(supplier, period YYYY-MM, lots received/rejected, qty received/rejected,
    ppm, ncr_count, scar_open, audit_score, quality_score, rating A–D) — computed only
  - supplier_audits + supplier_audit_findings
  - ppap_submissions(item, customer, drawing_rev, level 1–5, reason, isir_inspection_id,
    capability_study_id, psw_doc_id, status)
  - ppap_elements(1–18, required by level, doc_id, status)
  - capability_studies(characteristic, inspection_ids, n, mean, sigma_within, sigma_overall, cp, cpk, pp, ppk)

## 5. Algorithms (packages/calc/quality)
**aqlLookup(lotQty, scheme, severity):**
- Code letter from the level, then the (severity, letter, AQL) row gives n / Ac / Re.
- n ≥ lot → 100 % inspection with Ac 0. Missing row → 422 QMS_AQL_TABLE_MISSING.
- Level II code letters (seeded):
  | Lot size | Letter / n (normal) |
  |---|---|
  | 2–8 | A / 2 |
  | 9–15 | B / 3 |
  | 16–25 | C / 5 |
  | 26–50 | D / 8 |
  | 51–90 | E / 13 |
  | 91–150 | F / 20 |
  | 151–280 | G / 32 |
  | 281–500 | H / 50 |
  | 501–1200 | J / 80 |
  | 1201–3200 | K / 125 |
  | 3201–10000 | L / 200 |
  | 10001–35000 | M / 315 |
  | 35001–150000 | N / 500 |
  | 150001–500000 | P / 800 |
  | 500001+ | Q / 1250 |
- The Ac/Re rows are imported from the company's licensed IS 2500-1 / ISO 2859-1 copy through the
  Phase 4 import wizard; rows whose n doesn't match the letter are refused.
- Examples:
  - lot 1000 → J, n 80: AQL 1.0 → Ac 2 / Re 3; AQL 2.5 → Ac 5 / Re 6;
  - lot 300 → H, n 50, AQL 2.5 → Ac 3 / Re 4;
  - lot 40 → D, AQL 2.5 arrow → n 5, Ac 0 / Re 1;
  - lot 6 → n 5, Ac 0.

**switchState** — per (scheme, supplier, item), on original INCOMING lots only:
| From → to | Rule |
|---|---|
| Normal → Tightened | 2 lots not accepted within 5 consecutive lots |
| Tightened → Normal | 5 consecutive lots accepted |
| Tightened → Discontinued | 5 lots not accepted while on tightened. Lots still arrive with severity TIGHTENED and the banner "Supplier discontinued — SCAR required"; an auto-SCAR is raised; Purchase is notified; only the quality head can return the item to tightened. |
| Normal → Reduced | Switching score ≥ 30 **and** the quality head approves (until then only "proposed") |
| Reduced → Normal | Any lot not accepted, or a manual reset with a reason |

Switching score: when Ac ≥ 2, +3 if the lot would also pass at one step tighter, otherwise reset to 0;
when Ac ≤ 1, +2 per accepted lot, otherwise reset. Example: 15 accepted Ac-1 lots → 30 → reduced proposed.

**evaluateResult:**
- MEASURED: round to the characteristic's decimals (half-up); OK if LSL ≤ v ≤ USL (inclusive; missing
  limits are skipped). Example: spec 10.00 ± 0.05 → 10.05 OK, 10.051 → 10.05 OK, 10.06 NG.
- ATTRIBUTE / CHECKLIST: the inspector's OK/NG.
- WELD_FLAW: OK / NG / NA / NF; any not-permitted flaw = NG.
- VALUE: recorded only.
- A defective piece = a sample with ≥ 1 NG on MEASURED / ATTRIBUTE / WELD_FLAW, counted once.

**recommendLot:**
1. REJECT if defectives > Ac, any CHECKLIST NG, or any Critical NG.
2. Otherwise HOLD if an MTC is required and not received.
3. Otherwise ACCEPT.
The inspector may be stricter. Being looser needs an NCR with an approved concession.

**Stock (D-16):**
- **GRN posted:** onGrnPosted creates one INCOMING inspection per qc_required line (idempotent per GRN
  line); the batch stays Pending QC.
- **Posting the inspection:** one call to Phase 9 qcDecide(grnLineId, accepted, rejected+rework+hold,
  reason) when the line's last live inspection posts. QMS writes no stock voucher of its own for GRN qty.
- **Non-GRN inspections:**
  - Reject / Hold → StockService.hold; release → releaseHold;
  - lots without a GRN → StockService.post QC_IN / QC_OUT between QC-hold and the target warehouse.
- **Dispositions:**
  | Disposition | Effect |
  |---|---|
  | Use As Is / Accept Under Deviation | releaseHold (or qcDecide) |
  | Return to vendor | Phase 9 debit note; QMS stores debit_note_id |
  | Sort | Child re-inspection: OK qty released, NG qty stays uncovered |
  | Rework / Repair | Child re-inspection required before closing. Material issued: Dr QMS_REWORK_EXPENSE / Cr INVENTORY_RM. Labour is a memo cost only. |
  | Scrap | QC_OUT at the batch valuation, then Dr SCRAP_LOSS / Cr INVENTORY_RM / WIP / FG by item type. Example: 4 × ₹1,250 = 5,000 → Dr SCRAP_LOSS 5,000.00 / Cr INVENTORY_FG 5,000.00. |
- **Recall:** NCR (source Internal) + hold on the remaining qty + batch recall flag.

**NCR:**
- **Created automatically** when an inspection posts with rejected + rework + hold > 0 or any Critical
  NG — in the same transaction, one per inspection.
  - Pre-filled with the defect Pareto, supplier and batch.
  - Severity Critical if any Critical NG, otherwise Major.
- **Also created** from calibration impact items, customer complaints (manual), or repeats: 3 NCRs on
  the same defect + item + machine within 30 days → `repeat` flag and a proposed CAPA.
- **Coverage:** Σ live disposition qty ≤ hold qty. The NCR closes only when covered = hold, all lines
  are Done, and containment is recorded.
- **Approvals:**
  - every disposition → QMS_NCR_DISPOSITION;
  - USE_AS_IS and REPAIR also → QMS_CONCESSION, with an approver who is not the NCR owner. Not allowed
    on a Critical NCR without a customer authorisation reference;
  - stock and GL effects run only in onApproved.
- **8D required** when the source is Customer, the NCR is Critical, or it is a repeat. The NCR can then
  close only once its CAPA is at least Effectiveness Pending.

**8D gates:**
- D(n) needs D(n−1); D3 may run in parallel after D2.
- D4: at least one OCCURRENCE and one ESCAPE root cause, each verified with evidence; a linked 5-Why must be Closed.
- D5 / D6: every action has an owner and due date; D6 needs all actions done.
- D7: at least one PREVENTIVE action (plan / PFMEA / work instruction), with the new plan revision if
  the plan changed.
- Effectiveness due = D6 + 90 days (qms.effectiveness_days); it can't be recorded earlier.
  - Passes if there is no NCR with the same defect + item since D6.
  - Not Effective → reopens at D4.
- D8 closure → approval QMS_CAPA_CLOSE.
- SCAR: raised automatically when a supplier's monthly rating is D, or the supplier is discontinued.


