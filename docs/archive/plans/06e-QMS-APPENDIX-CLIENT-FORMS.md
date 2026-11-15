# 06e — Quality / QMS: Appendix A — Client form extraction (sanitised)

> Part of `06-QUALITY-QMS.md` (index). Source: the ten files in `doc from clint/` (confidential, git-ignored, read locally only). This appendix gives **structure only**: sheet names, header-block fields, table columns, formulas, drop-down lists, signature blocks, and the mapping of each column to a database column or to an `[ADD]` field. **No client names, part numbers, drawing numbers, instrument serial numbers, operator names or real measurements appear here.** Where an example value is needed it is invented (`PART-001`, `Supplier A`). The client's own spelling mistakes are listed once (A.0) and not repeated.

## A.0 Overview and file → page map (10 of 10)

| # | Client file (descriptive) | Sheets | Maps to page / tab | Table(s) | Print `formCode` |
|---|---|---|---|---|---|
| 1 | RM inward inspection sheet | `Sheet1.` (register), `Sheet2` (per-GRN sheet), `Incoming Inspection` (45-column data sheet with formulas), `Sampling & AQL Reference` | `qms-incoming` (+ `qms-plans › Sampling Rules`) | `inspections`, `inspection_results`, `qms_sampling_plans/rows` | `IQC_REPORT`, `IQC_SHEET` |
| 2 | In-process inspection report | `Sheet1` | `qms-process` | `inspections`, `inspection_results` | `IPQ_REPORT` |
| 3 | ISIR (initial sample inspection report) | `Blank Format` | `qms-inspections` (type First Article (ISIR)); read by `qms-final › Customer Requirement` | `inspections`, `inspection_results` | `ISIR` |
| 4 | VT (visual / weld testing) report blank | `VT Report` | `qms-inspections` (type Visual Weld (VT)) | same | `VT_REPORT` |
| 5 | Rejection / rework register | `Rework-reject Register`, `Summary Sheet`, `PPM Monitor`, `Quality Cost Monitor`, `COPQ Summary` | `qms-ncr` (register, NCR Trend, `[ADD]` Cost of Poor Quality / Monthly Quality Data) + hand-off to `mfg-rework`, `mfg-scrap` | `ncrs`, `ncr_*`, `rework_*`, `scrap_requests`, `quality_monthly_inputs` | `REWORK_REG` |
| 6 | 8D report for a customer complaint | `8D report`, `Why- Why`, `Q-Alert` | `qms-capa` (8D), `qms-5why`, `qms-ncr › [ADD] Quality Alerts` | `capas` + children, `five_why_cases`, `quality_alerts` | `EIGHT_D`, `WHY_WHY`, `Q_ALERT` |
| 7 | Instruments list for the client's two plants | `Unit-3`, `Unit-5` | `qms-calibration` | `instruments` (one row per instrument, `unit_id` per plant) | `INSTRUMENT_LIST` |
| 8 | Before / after welding report | `Before After` | `qms-inspections` (type Weld Before/After) | `inspections` (`WELD_BEFORE_AFTER`) | `WELD_BA` |
| 9 | MOM (minutes of meeting) format | `MOM` | `qms-capa › [ADD] Review Meetings (MOM)` (decision D-7) | `quality_meetings`, `quality_meeting_points` | `MOM` |
| 10 | Continuous improvement ideas (slide) | 1 slide | `qms-capa › [ADD] Improvement Ideas` (decision D-8) | `improvement_projects`, `improvement_actions` | `CI_PROJECT` |

**Client spelling and data-quality defects the ERP removes (do not copy):** misspelt column headings (thickness, description, alignment …); the same value typed in several ways (`CLOSE` / `Closed`; `Fabrication` / `FABRICATION`; defect type misspelt or two types joined with "&"); free-text process / defect / operator names (→ pick-lists and master data); a summary percentage computed as a **sum of monthly percentages**; a PPM divided by dispatches instead of produced / received quantity; a broken `#REF!` total; closing dates earlier than the register date (month typed wrongly); a "Final Decision" that rejects a whole lot for one reject piece regardless of the AQL; blank "Validity" dates; instrument "Validity" instead of last-calibration date. Each is covered by a rule in `06c` (BR-QMS-05, -02, -16) or by validation (`closing_date ≥ doc_date`).

## A.1 RM inward inspection sheet → `qms-incoming`

**Sheet `Sheet1.` — "Incoming Inspection Report" register.** Header block (rows 1–3): company name; title "INCOMING INSPECTION REPORT"; `Doc. No.` (form number), `Rev No.`, `Rev Date`. Table columns (15, 15 numbered blank rows): `Sr No, Date, Supplier Name, Invoice No, Item Description, Material Grade/Spec, Heat/Batch No, Thickness, Width, Length, Total Qty, Accp/Qty, Rej/Qty, MTC Status, Remark`.
Sample content shape: item description `Plate`; grade like `E250BR` / `E350C` (steel plate grades — **material grades are generic and kept**); `MTC Status` = `Received`; remark `Ok`; width / length in mm; thickness in mm with 2 decimals.
| Column | → |
|---|---|
| Sr No | row number (print only) |
| Date | `inspections.doc_date` |
| Supplier Name | `supplier_id` → `parties.name` |
| Invoice No | `invoice_no` ([ADD] `invoiceNo`) |
| Item Description | item name (calc) |
| Material Grade/Spec | `material_grade` ([ADD] `materialGrade`) |
| Heat/Batch No | `heat_no` ([ADD] `heatNo`) |
| Thickness / Width / Length | `thickness`, `width`, `length` ([ADD]) |
| Total Qty | `lot_qty` (frozen `Lot Qty`) |
| Accp/Qty | `accepted_qty` (frozen `Accepted Qty`) |
| Rej/Qty | `rejected_qty` (frozen `Rejected Qty`) |
| MTC Status | `mtc_status` ([ADD] `mtcStatus`) |
| Remark | `remarks` ([ADD]) |

**Sheet `Sheet2` — per-supplier incoming sheet.** Header block: company; title "INCOMING INSPECTION REPORT"; `Doc. No.`, `Rev No.`, `Rev Date`; row: `Supplier Name :`, `PO No :`; row: `Date :`, `GRN No :`, `Inspector`. Table columns (14, rows 1…): `Sr No, Item Description, Part No, Material Grade/Spec, Category, Qty Recd, UOM, Drawing No, Heat/Batch No, MTC Available, Critical Dimension, Actual Result, Status, Remarks`. Instruction cells show the allowed values: Category `RM/BO/Fabricated/Machined`; MTC Available `Yes/No`; Status `OK/NG`. **Acceptance Criteria** block (7 lines): (1) Material Grade matches PO/Drawing/MTC; (2) Dimensions within drawing tolerance; (3) Quantity verified against PO & Challan; (4) No rust, cracks, dents, deformation or transit damage; (5) MTC/Test Certificate available where applicable; (6) Heat/Batch No traceable where applicable; (7) BO (bought-out) items match approved make / model / specification. Last line: `Final Status: Accept / Reject / Hold`. → the 7 criteria are the `CHECKLIST` characteristics of the seeded plan `IPL/SEED/00/0001`; `Category` → `header_data.materialType`; `Critical Dimension` / `Actual Result` → a `MEASURED` or `ATTRIBUTE` result row; `Final Status` → `decision` (Accept / Reject / Hold).

**Sheet `Incoming Inspection` — data sheet (45 columns, row 1 headings, row 2–3 examples).** Columns and mapping:
| # | Client column | → |
|---|---|---|
| 1 | Inspection Date | `doc_date` |
| 2 | Supplier Name | `supplier_id` |
| 3 | PO No | `po_no` ([ADD]) |
| 4 | GRN No | `grn_no` (frozen `GRN Ref`) |
| 5 | Invoice/DC No | `invoice_no` ([ADD]) |
| 6 | Inspector Name | `inspector_id` (frozen `Inspector`) |
| 7 | Material Type | `header_data.materialType`; drop-down `OK,NG,Yes,No,NA` is mis-applied by the client (the list belongs to the verification columns) — ERP uses `RM,BO,Fabricated,Machined` |
| 8 | AQL Level | `aql` (value `1` in the example = AQL 1.0, see Q-2) |
| 9 | Lot Size | `lot_qty` (frozen `Lot Qty`) |
| 10 | Sample Size | `sample_qty` — formula in A.1.1 |
| 11 | Item Description | item name |
| 12 | Part No | item code |
| 13 | Drawing No | `drawing_no` |
| 14 | Material Grade/Specification | `material_grade` |
| 15 | Heat/Batch No | `heat_no` / `batch_no` |
| 16 | MTC Available | `mtc_status` (drop-down OK/NG/Yes/No/NA → ERP enum Received / Pending / Not Applicable) |
| 17 | Qty Received | `lot_qty` |
| 18 | Qty Inspected | `inspected_qty` |
| 19 | Accepted Qty | `accepted_qty` |
| 20 | Rejected Qty | `rejected_qty` |
| 21 | Inspection Parameter | result row `name` |
| 22 | Specification Requirement | result row `spec_text` |
| 23 | Actual Result | result row `measured_value` / `observed_text` |
| 24 | Measuring Instrument | result row `instrument_id` |
| 25 | Status | result row `result` (OK/NG) |
| 26 | Surface Condition | `header_data.surfaceCondition` |
| 27 | Material Verification | `header_data.materialVerification` |
| 28 | Dimension Verification | `header_data.dimensionVerification` |
| 29 | Quantity Verification | `header_data.quantityVerification` |
| 30 | Traceability Verification | `header_data.traceabilityVerification` |
| 31 | Functional Check | `header_data.functionalCheck` |
| 32 | NCR No | `ncr_id` (frozen `NCR Ref`) |
| 33 | Defect Description | `header_data.defectDescription` |
| 34 | Disposition | NCR `disposition` (read) |
| 35 | Final Decision | formula A.1.1 → replaced by BR-QMS-02 |
| 36 | Acceptance % | formula → `acceptancePct` (BR-QMS-05) |
| 37 | Rejection % | formula → `rejectionPct` |
| 38 | Inspection Result | formula `OK` if accepted + rejected = inspected, else `CHECK` → ERP validation BR-QMS-03 |
| 39 | Ac No | `ac` |
| 40 | Re No | `re` |
| 41 | AQL Result | `aql_result` |
| 42 | Supplier PPM | `supplierPpm` |
| 43 | Supplier Rating | `supplierRating` (A–D) |
| 44 | Overall Status | formula A.1.1 → recommendation |
| 45 | Remarks | formula (REJECTED / HOLD / ACCEPTED) → derived status; free-text `remarks` is a separate ERP field |
Drop-down lists (data validation): columns 7, 16, 25 and 27–31 use the list `OK,NG,Yes,No,NA`.

### A.1.1 Formulas of the data sheet (logic only)
* Sample size by lot size `L`: `L ≤ 8 → 2; ≤ 15 → 3; ≤ 25 → 5; ≤ 50 → 8; ≤ 90 → 13; ≤ 150 → 20; ≤ 280 → 32; ≤ 500 → 50; ≤ 1200 → 80; else "REFER AQL"`.
* Ac by `L`: `≤ 25 → 0; ≤ 150 → 1; ≤ 280 → 2; ≤ 500 → 3; ≤ 1200 → 5; else "REF"`. Re by `L`: `≤ 25 → 1; ≤ 150 → 2; ≤ 280 → 3; ≤ 500 → 4; ≤ 1200 → 6; else "REF"`.
* Final Decision: `IF(rejected = 0, ACCEPT, REJECT)`. Acceptance % `= accepted / received × 100`; Rejection % `= rejected / received × 100`. Inspection Result `IF(accepted + rejected = inspected, OK, CHECK)`. AQL Result `IF(rejected ≤ Ac, ACCEPT, REJECT)`. Supplier PPM `= rejected / received × 1,000,000`. Supplier Rating: `PPM ≤ 1000 → A; ≤ 5000 → B; ≤ 10000 → C; else D`.
* Overall Status: `REJECT` if any of the five verification columns is `NG`, else `ACCEPT`. Remarks: `REJECTED` if AQL Result = REJECT or Overall Status = REJECT; `HOLD` if an NCR No is present; else `ACCEPTED`.
* **Observations (used in the design):** (a) the "Ac/Re" use the lot range of the reference sheet (A.1.2); (b) AQL Result compares **rejected quantity** (not number of defective pieces in the sample) with Ac — QMS counts defective pieces in the sample (BR-QMS-02); (c) Final Decision ignores AQL (see BR-QMS-02 note); (d) the PPM rating thresholds are adopted as `qms.ppm_grade_cuts`.

### A.1.2 Sheet `Sampling & AQL Reference`
Columns `Lot Size, Sample Size, Ac, Re`; rows: `2-8 → 2, 0, 1`; `9-15 → 3, 0, 1`; `16-25 → 5, 0, 1`; `26-50 → 8, 1, 2`; `51-90 → 13, 1, 2`; `91-150 → 20, 1, 2`; `151-280 → 32, 2, 3`; `281-500 → 50, 3, 4`; `501-1200 → 80, 5, 6`. → seeded as plan `CLIENT-AQL` (06b §5.14). The sample sizes equal the ISO 2859-1 / IS 2500 (Part 1) sample sizes of code letters A–J for general inspection level II; the Ac/Re pattern resembles AQL 2.5 although the data sheet is labelled "AQL Level 1" — open question Q-2.

## A.2 In-process inspection report → `qms-process`
**Sheet `Sheet1`.** Header block: company name (merged), title "Inprocess Inspection Report"; `Doc no:`, `Doc date:`; row `Part No:`, `Part Name:`, `Customer :`, `Shift:`; row `M/c No:`, `Opn Name:`, `Operator name:`, `Date:`. Table: `Sr. No.` (15 numbered rows), `Specification`, `Checking Method`, `Parts` with sub-columns **1 … 12**, `Remarks`. Footer: `Remark: Accepted / Rejected / Cond. Accepted.` and signature labels `INSPECTED BY:`, `APPROVED BY:`.
| Client field | → |
|---|---|
| Part No / Part Name | item code / name |
| Customer | `customer_id` ([ADD] `customer`) |
| Shift | `shift` ([ADD]) |
| M/c No | `machine_no` ([ADD]) |
| Opn Name | frozen `Operation` (`operation_name`) |
| Operator name | `operator_name` ([ADD]) |
| Date | `doc_date` |
| Specification | plan characteristic `spec_text` (+ `nominal/lsl/usl`) |
| Checking Method | plan characteristic `method` |
| Parts 1…12 | `inspection_results.sample_no` 1…12 (`partsPerRow`) |
| Remarks | result `remark` |
| Accepted / Rejected / Cond. Accepted | inspection `result` OK / NG and `decision` (Cond. Accepted = `Accept Under Deviation`) |
| Inspected by / Approved by | `inspector_id`, `header_data.approvedByName` |

## A.3 ISIR → `qms-inspections` (First Article (ISIR))
**Sheet `Blank Format`.** Header block: title "INITIAL SAMPLE INSPECTION REPORT"; `Format No`; `ISIR NO`; `JOB NO`; `SUPPLIER NAME AND CODE`; `PAGE n of N`; `PART NUMBER`; `Rev`; `DESCRIPTION`; `REVISION STATUS`; `MATERIAL SPECIFICATION`. Table: `ZONE / ITEM`, `DESCRIPTION`, `DIMENSION SPECIFICATION`, `TOLERANCE`, `MEASURING METHOD`, `MEASURED DIMENSION` with five sub-columns `Sr.No.1 … Sr.No.5`, `OK`, `NOT OK`, `Remark`; blank rows 9–19 (≈ 12 per page, multi-page up to 10 pages). Footer: `REVIEWED BY` (name), `SIGNATURE`, `DATE`, `DIMENSIONAL STATUS : ACCEPTED / REJECTED ?`.
| Client field | → |
|---|---|
| ISIR NO / JOB NO | `header_data.isirNo`, `jobNo` |
| Supplier name and code | `header_data.supplierCodeText` (the supplier here is the client itself) |
| Page n of N | print only (`pageNo`, `pageCount`) |
| Part number / Rev / Description | item, `drawing_rev` / `header_data.partRev`, `partDescription` |
| Revision status | `header_data.revisionStatus` |
| Material specification | `header_data.materialSpecification` |
| Zone / Item | `zone_item` |
| Description | `name` |
| Dimension specification | `spec_text` (+ `nominal`) |
| Tolerance | `tolerance_text` (+ `lsl/usl`) |
| Measuring method | `method` |
| Measured dimension 1…5 | `measured_value` of `sample_no` 1…5 |
| OK / NOT OK | `result` OK / NG |
| Remark | `remark` |
| Reviewed by + date | `header_data.reviewedByName`, `reviewedOn` |
| Dimensional status | `header_data.dimensionalStatus` (computed, BR-QMS-22) |
No formulas, no drop-downs in the blank form.

## A.4 VT report → `qms-inspections` (Visual Weld (VT))
**Sheet `VT Report`.** Header block: company; title "Visual Inspection Report"; `Format No`; `Manufacturer`; `Address`; `Project`; `Stage` (example "After Welding & 100%"); `Component`; `Material Grade`; `Scope` (example "100 % Welding, HAZ"); `Part No`; `Procedure` (a procedure number); `Sr.No`; `Welding Gauge Details` (type of gauges) and `Gauge Sr no`; `Applicable Code Edition & Added` with three numbered lines (example "DIN EN ISO 5817 CLASS B"); `Process` (example "DIN EN ISO 4063 135"); `Technique`; test standard (example "VT (ISO 17637:2016)"); `Surface Condition` (Cleaned); `Temperature`; `Surface Preparation` (Fit-Up & After Welding); `Method` (Visual Examination Direct); `Lighting Equipment` (Battery Torch / Day Light); `Light Intensity`; `Post Examination Cleaning` (NA); `Examination Date`.
Table columns: `Sr.No`, `Type Of Flaw (ISO 6520-1)`, `Interpretation` (sub-columns `Requirement For weld joints`, `Observation`, `Remark`), `Result`. Legend: `NA - Not Applicable`, `NF - Not Found`, `NP - Not Permitted`. Footer: `Examined By` (Name, Date), `Reviewed and Accepted` (Name, Date).
→ header fields → `header_data` keys of 06b §5.7.5 (VT); table rows → plan characteristics (A.6) and result rows; `Result` → `OK / NG / NA / NF`; legend NP is a **requirement wording**, not a result.

## A.5 Before / after welding report → `qms-inspections` (Weld Before/After)
**Sheet `Before After`.** Header: company; title "Welding Inspection Report (Before/After-VT)"; `Format No`; `Acceptance Criteria` (example "DIN EN ISO 5817 CLASS C"); `Date`; `Part No & Description`; `Drawing Rev`; `Qty`; `Serial no.`; `Weld No.`; `Welder no.`; `WPS no.`; `Parent Metal Heat no.`. Body, three groups with OK / NG per row: **Fit-Up** — `Welding joint preparation`, `Ensure gap between two parts it should be less than 1 mm`, `Weld surface free from oil, dust`; **Before Welding** — `Wire Spool TC/Lot no.` (a recorded value), `Cleaning`, `Tacking`; **After Welding (VT-100%)** — `Weld Size & Profile`, `Spatter`, `Undercut`, `Surface Porosity`, `Surface Crack`, `End Crater`. Footer lines: `Accepted as per <criteria>`, `Reworked & Accepted Quantity`, `Rejected Quantity`, `Inspector Name & Sign`.
→ keys: `acceptanceCriteria`, `weldNo`, `welderNo`, `wpsNo`, `parentMetalHeatNo`, `wireSpoolLotNo` in `header_data`; `Qty` = `lot_qty`; rows → 12 plan characteristics (3 fit-up + 2 before + 1 wire-spool value + 6 after, see seed note A.6); quantities → `accepted_qty`, `rejected_qty`, `rework_qty` and `header_data.reworkedAcceptedQty`.
`[ADD]` COULD: welder qualification register (ISO 9606-1 validity every 6 months) so `welderNo` is validated — not built in this plan (decision D-6).

## A.6 The 34-row visual-weld checklist (seed of plan `IPL/SEED/00/0002`)
Rows in the client's order; wording corrected; "NP" = "Not permitted". Rows 1–7 are `CHECKLIST` characteristics (document / condition checks, requirement `--`), rows 8–34 are `ATTRIBUTE`. Severity class: `Critical` for rows 8, 9, 24, 29, 30; `Major` for the rest. `defect` code = `VT-<two-digit row>`.
| # | Type of flaw / check | Requirement for weld joints (as printed) |
|---|---|---|
| 1 | Availability of latest revision drawing and specification | -- |
| 2 | Availability of welding procedure specification | -- |
| 3 | Welders qualification and validity | -- |
| 4 | Use of correct material and consumable availability | -- |
| 5 | Welding joint preparation | -- |
| 6 | Gap between two parts less than 1 mm | -- |
| 7 | Weld surface free from oil, dust | -- |
| 8 | Crack | NP |
| 9 | Crater crack | NP |
| 10 | Surface pore | NP |
| 11 | Intermittent undercut | h ≤ 0,05 t, but max. 0,5 mm |
| 12 | Continuous undercut | NP |
| 13 | Shrink cavity | NP |
| 14 | Excessive convexity | h ≤ 1 mm + 0,1 b, but max. 3 mm |
| 15 | Incorrect weld toe | α ≥ 150° |
| 16 | Excessive unequal leg length | h ≤ 1,5 mm + 0,15 a |
| 17 | Root porosity | NP |
| 18 | Elongated cavity (worm hole) | h ≤ 0,2 s, but max. 2 mm; l ≤ s, but max. 25 mm (the client cell shows the symbol before "s" cut off; "≤" assumed — unverified) |
| 19 | Poor restart | NP |
| 20 | Insufficient throat thickness | NP |
| 21 | Stray arc | NP |
| 22 | Spatter | NP |
| 23 | Overlap | NP |
| 24 | Weld / base-metal fusion (LOF) | NP |
| 25 | Multiple imperfections | NP; maximum total height of imperfections Σh ≤ 0,2 t (the second alternative in the client cell is cut off — unverified) |
| 26 | Straightness | As per fabrication drawing |
| 27 | Excessive throat thickness | h ≤ 1 mm + 0,15 a, but max. 3 mm |
| 28 | Root concavity | NP |
| 29 | Burn through | NP |
| 30 | Incomplete root penetration | NP |
| 31 | Grinding mark | NP |
| 32 | Chipping mark | NP |
| 33 | Underfill | NP |
| 34 | End crater pipe | NP |
(The limits printed are those of the client's sheet for its quality level; they are **data of the plan**, edited by Quality, not code. The ISO 5817 class (B / C / D) is chosen per report in the header; the limits per class must be loaded from the purchased standard, see Q-4.)

**Seed rows of plan `IPL/SEED/00/0003` (weld before/after)** in order: 1 Welding joint preparation; 2 Gap between two parts less than 1 mm; 3 Weld surface free from oil, dust; 4 Wire spool TC/Lot no. (`ATTRIBUTE`, value in `observed_text`); 5 Cleaning; 6 Tacking; 7 Weld size & profile; 8 Spatter; 9 Undercut; 10 Surface porosity; 11 Surface crack; 12 End crater. (12 rows; the client groups them as Fit-Up 1–3, Before Welding 4–6, After Welding 7–12.)

## A.7 Rejection / rework register → `qms-ncr`
**Sheet `Rework-reject Register`.** Header: company; `Format No.`, `Rev. No.`, `Rev. Date.`; title "Rejection/Rework Register". Columns (16): `Sr no, Date, Process Name, Operator /Fitter Name, Part Name, Part No, HOLD QTY, Defect, Defect Type, Root Cause, Corrective Action Taken, Responsibility, REWORK QTY, REJECT QTY, Closing Date, Status`; ~40 data rows; footer `Prepared By:-`, `Reviewed By:-`.
Observed vocabularies (shape only): **Process Name**: `FABRICATION`, `FABRICATION WELDING`, `CUTTING`, `MACHINING`. **Defect Type**: `DIMENSIONAL`, `MISSING`, `PAINTING`, `FUNCTIONAL & VISUAL`, `VISUAL`. **Status**: `OPEN`, `CLOSE`. Typical rows: `HOLD QTY = REWORK QTY + REJECT QTY` (e.g. 5 = 5 + 0; 4 = 0 + 4). Defect examples: flatness not OK, hole alignment not OK, chamfer preparation not OK, weld missing, drilling / tapping missing, UT fail on a weld joint, blasting not done. Root-cause examples: process bypassed / skipped; plate bent during welding; wrong reference taken; drawing revision not checked; damaged in handling; new fitter assigned.
| Client column | → |
|---|---|
| Sr no | print only |
| Date | `ncrs.doc_date` (frozen `Date`) |
| Process Name | `process_name` ([ADD] `processName`; pick-list from `qms_defects.process_hint` values: Cutting, Fabrication, Welding, Machining, Painting, Assembly) |
| Operator / Fitter Name | `operator_name` ([ADD]) |
| Part Name / Part No | item name / code (frozen `Item`) |
| HOLD QTY | `hold_qty` ([ADD]) |
| Defect | `defect_id` ([ADD] `defect`) |
| Defect Type | `defect_category_id` ([ADD] `defectCategory`) |
| Root Cause | `root_cause` ([ADD] `rootCauseText`) |
| Corrective Action Taken | `corrective_action` ([ADD]) |
| Responsibility | `responsibility` ([ADD]) |
| REWORK QTY | `rework_qty` (calc from Rework lines) |
| REJECT QTY | `reject_qty` (calc from Scrap + Return lines) |
| Closing Date | `closing_date` ([ADD]) |
| Status | frozen `Status` (`OPEN` → Open / In Process / Completed; `CLOSE` → Closed; Excel export maps back to `OPEN` / `CLOSE`) |

**Sheet `Summary Sheet`** (formulas, logic only): block *"Internal Rejection Log Summary Sheet — FY"* with month columns; rows `Customer Complaint Count`, `Total Dispatched Part Qty`, `Total Issue Reported`, `Percentage Of Rejection = issue / dispatched`, `Closed`, `Open`, `Under Monitoring`, `Dimensional Issues` (and similar per-category rows), `Total` columns as sums (one total of percentages is wrong — A.0). Block *"Part Number Wise Defect QTY"*: `Part Description, Part Number, Qty, share = qty / total` and a total with a broken reference. Block *"Internal PPM — year"*: `Months, Rejects, Total Dispatches, PPM = rejects / dispatches × 1,000,000, NCN % = rejects / dispatches, PPM Target` (target `20000`), `YTD Overall Avg` (average of monthly PPM — wrong: BR-QMS-05). Block *"Defect Category — year"*: `Dimensional, Visual, Missing, Functional, Leakage` with quantity and share. → report 5 / 3 / 4; categories seeded (06b §5.14); target `20000` = `quality_monthly_inputs.ppm_target`.
**Sheet `PPM Monitor`:** columns `Month, Customer, Project, Produced Qty, Rejected Qty, Customer Rej Qty, Internal PPM = IF(produced = 0, 0, rejected / produced × 1e6), Customer PPM = IF(produced = 0, 0, customer rejected / produced × 1e6), Target PPM (20000), Status`; summary row sums and recomputes PPM from the sums. → `quality_monthly_inputs` + report 3 (customer PPM base: client uses produced qty here, the other sheet dispatches; ERP uses **dispatched** for customer PPM and **produced** for internal PPM — decision D-9, Q-8).
**Sheet `Quality Cost Monitor`:** `Month, Sales Value, Prevention Cost, Appraisal Cost, Internal Failure Cost, External Failure Cost, Total Quality Cost = sum of the four, Quality Cost % = IF(sales = 0, 0, total / sales)`. **Sheet `COPQ Summary`:** `Scrap Cost, Rework Cost, Customer Returns, Warranty/Field Failures, Sorting Cost, Penalty Cost, Total COPQ = sum`. → BR-QMS-12 and `ncr_cost_lines.cost_type` values `SCRAP, REWORK, CUSTOMER_RETURN, WARRANTY, SORTING, PENALTY`.

## A.8 Instruments list → `qms-calibration`
**Sheets `Unit-3`, `Unit-5`** (one per client plant; both start with a banner cell from the software the client used; ignored on import). Columns (20): `Sr No, Division, History Card No, Equipment Name, Equipment No (Unit-5: "PO No"), Equipment Range / Specification, Least Count, Part Name, Validity, Source of Calibration, Calibration Frequency, Manufacturer Name, Analog/Digital, Purpose of Equipment, Model No., Equipment Location, Commissioning Date, Equipment Status, Notify To, Calibration Agency`.
Observed vocabularies: **Equipment Name** (shape): pressure gauge (TPG), thread plug gauges, filler gauge, radius gauge, welding fillet gauge, welding gauge, pipe welding gauge, digital angle protractor, digital micrometer, digital vernier caliper, digital height gauge, digital indicator, coating thickness gauge, taper gauge, measuring tape, right angle, torque wrench, spirit level, cross-hatch cutter, surface roughness comparison, surface table, flatness scale. **Source of Calibration**: `External` (all). **Calibration Frequency**: `365 days` (all). **Analog/Digital**: `Analog`, `Digital`, `-`. **Purpose**: `Inspection`. **Location**: `Quality Control Lab`. **Equipment Status**: `Active`. **Validity**: a single date per sheet in Unit-3 (all rows equal), `-` in Unit-5. **Calibration Agency**: one external agency (all). **Least Count**: `-` for fixed gauges, values like `0.02mm`, `0.01mm`, `0.001mm`, `0.1°`, `1mm`.
| Client column | → |
|---|---|
| Division | `unit_id` (the plant: Unit-3 / Unit-5 become two **units** of the client's company configuration, not hard-coded) |
| History Card No | `history_card_no` ([ADD]); also used as the Instrument ID when "Equipment No" is empty |
| Equipment Name | frozen `Instrument Name` (+ `instrument_type` derived by the importer: first word group) |
| Equipment No / PO No | `equipment_no` ([ADD]) — Unit-5's "PO No" column holds a purchase reference, imported into `equipment_no` with a note |
| Equipment Range / Specification | frozen `Range` |
| Least Count | `least_count` ([ADD]) |
| Part Name | `part_name` ([ADD]) |
| Validity | `next_due_date` (derived `last_calibration_date = validity − frequency`, A.8 / BR-QMS-16); `-` → Not Calibrated, Blocked / MANUAL |
| Source of Calibration | `source_of_calibration` ([ADD]) |
| Calibration Frequency | frozen `Calibration Frequency` (`365 days` → label + `frequency_days 365`) |
| Manufacturer Name | `manufacturer` ([ADD]) |
| Analog/Digital | `display_type` ([ADD]) |
| Purpose of Equipment | `purpose` ([ADD]) |
| Model No. | `model_no` ([ADD]) |
| Equipment Location | `location` ([ADD]) |
| Commissioning Date | `commissioning_date` ([ADD]) |
| Equipment Status | frozen `Status` (`Active` → Active) |
| Notify To | `notify_user_id` (matched by name to a user; unmatched → import warning, field left empty) |
| Calibration Agency | frozen `Agency` |
**Importer** (`POST /qms/instruments/import`): row key = `History Card No` (else `Equipment No`); a duplicate code in the file or in the DB is skipped with a message; `dryRun=true` returns counts without writing; one transaction per sheet; idempotent (second run creates 0). Unit chosen per sheet by the user (select box), never guessed.
**Frequency logic in the client sheet:** a fixed text `365 days`; due date is entered manually as "Validity". The ERP computes it (BR-QMS-16).

## A.9 8D report → `qms-capa`, `qms-5why`, `qms-ncr` (Quality Alert)
**Sheet `8D report`.** Header: title "8D Problem Solving"; `CAPA Ref. No.` (customer reference); `Part No.`; `Part Description`; `Supplier` (the client) ; `Date`. Sections:
* **D1 Establish a team** — table `Name` / `Department` (rows 1–5 in the example: plant head, quality head, production head, two quality engineers) → `capa_team_members`.
* **D2 Define the problem** — rows `Who`, `What`, `Where`, `When`, `Why`, `How`, `Photographs` → `d2_who … d2_how`, attachments.
* **D3 Implement containment** — matrix, columns `Customer Line, Customer Stock, In-transit Parts, Our Stock, Our Line, Manufacturing Process`, rows `Segregation, Rework, Replacement` (quantities) → `capa_containment` (scope × action_type × qty).
* **D4 Identify root cause** — "Problem definition" then three numbered causes `1st`, `2nd`, `3rd` (in the example: why the defect occurred (process / work instruction), why it was not detected (control plan / final inspection), why the system allowed it (PFMEA review)) → `capa_root_causes` kinds `OCCURRENCE`, `ESCAPE`, `SYSTEMIC`.
* **D5 Choose and verify permanent corrective actions (PCAs)** — columns `PCAs`, `Responsibility`, `Target Date` (3 rows) → `capa_actions` phase `D5`.
* **D6 Implement PCAs** — same columns → phase `D6` (implementation record of each D5 action: same action row gets `done_date`; ERP shows D5 / D6 as two views of the same rows).
* **D7 Prevent recurrence** — `Actions`, `Responsibility`, `Target Date` (examples: PFMEA revision, control plan revision, training matrix update) → phase `D7`.
* **D8 Recognition** — free text → `d8_recognition`.
* Footer: `Prepared By`, `Authorized By`.
**Sheet `Why- Why`.** Title "Cause & Effect Diagram — of Root cause analysis report"; note "Please follow at least one of the below tools"; **B) Why Why Analysis (for valid cause after 4M analysis)**; part description / part no.; the problem statement; two blocks side by side: **Why Made?** (header "Why did the problem occur?") with five rows `Why?` and a `Root Cause` row, and **Why Missed?** (header "Why was this problem not caught by the normal system?") with five rows and a `Root Cause` row; each row is a question ("Why …?") followed by "Because …". → `five_why_cases.why_1…5, root_cause` (made) and `missed_why_1…5, missed_root_cause` ([ADD]).
**Sheet `Q-Alert`.** Header: company; `Format No`, `Rev`, `Rev Date`; title "QUALITY ALERT"; `PART NUMBER`, `PART DESCRIPTION`, `Notification Date`; `ISSUE :` text; two photo areas `Not OK` / `OK`; `Containment Action :` line. → `quality_alerts`.

## A.10 MOM format → `qms-capa › Review Meetings (MOM)`
**Sheet `MOM`.** Header: company; title "MINUTES OF MEETING"; `Format No`; `Rev & Date`; `Agenda Of Meeting`; `Date Of Meeting`; `Customer Representatives`; `Representatives (<own company>)`. Table: `Sr.No.` (15 rows), `Point Discussed`, `Responsible Team`, `Remark`. → `quality_meetings` (agenda, date = `doc_date`, `customer_reps`, `our_reps`) and `quality_meeting_points` (`point_discussed`, `responsible_team`, `remark`; ERP adds `due_date`, `action_status`, links to NCR / CAPA). **Decision D-7 (where it lives):** no new page; an `[ADD]` tab on `qms-capa` because its action points feed CAPA and customer quality reviews are the usual source of 8D requests; documents in DMS are not used (the register needs action tracking).

## A.11 Continuous improvement ideas (one slide) → `qms-capa › Improvement Ideas`
Slide text structure (title "Continuous Improvement Team"; `Format No`): `Name` of team; `Project Theme / Overview`; `Project Details`: `Project No`, `Start Date`, `Close Date`; **SQDCPE** tick set — Safety, Quality, Delivery, Cost, People, Environment; `Team Names`; `Area / Function`; `Champion`; `Team Members`; boxes `Current Situation (Before)`, `Objective / Target`, `Benefits / Improvement`, `Analysis & Action` with `Analysis: Why 1, Why 2, Why 3, Why 4, Root Cause` and `Action Plan`, `New Situation (After)`, `New Situation vs Objective / Target`. Two images (before / after photographs). → `improvement_projects` (+ `improvement_actions` for the action plan, photographs as attachments). **Decision D-8:** `[ADD]` tab on `qms-capa` (preventive / improvement actions), no new page.

## A.12 Cross-file checks (builder test data)
* The same part appears in the register, the 8D and the quality alert → `PART-001` in all test fixtures; the item must exist in `items` before an NCR can be raised (`Item` required).
* The instrument codes in a VT report header (`gaugeSrNo`) and in the instruments list are the same string namespace (`INS-DEMO-004`).
* The 8D "Customer Stock = 1, Replacement at Customer Line = 2" example becomes the fixture for `capa_containment` (scope `Customer Stock` × `Segregation` qty 1; scope `Customer Line` × `Replacement` qty 2).
