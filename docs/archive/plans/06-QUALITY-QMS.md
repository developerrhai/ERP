# 06 — Quality / QMS (10 pages) — INDEX AND MASTER PLAN

**Read first:** `00-BUILDER-RULES.md`, `01-SHARED-FOUNDATION.md`, then `03-SCM-PROCUREMENT.md` (GRN / QC hold / suppliers — QMS plugs into it). This plan was built from the client's real quality documents (`doc from clint/`, confidential, never commit, never quote real names / part numbers / measurements). Everything below uses invented example values (`PART-001`, `Supplier A`).

| File | Content (section numbers of the plan) |
|---|---|
| `06-QUALITY-QMS.md` (this file) | index; §0 header, §1 scope + mapping, §3 market, §14 decisions and open questions, §15 sources; summaries of §2, §4–§13 |
| `06a-QMS-UI-PROCESSES.md` | §2 the frozen UI page by page (all 10 pages, fields, tabs, actions, document templates) and §4 end-to-end processes (mermaid) |
| `06b-QMS-DATABASE.md` | §5 database design: conventions, ERD, 40 tables with DDL and Prisma, numbering, seeds, migration order, reconciliation with Plan 03 |
| `06c-QMS-RULES-API-REPORTS.md` | §6 business rules `BR-QMS-01…30`, §7 API design, §8 reports and KPIs |
| `06d-QMS-EXTRAS-TESTS-TICKETS.md` | §9 extra functions, §10 edge cases (50), §11 test plan, §12 tickets `T-QMS-01…36`, §13 reviewer checklist |
| `06e-QMS-APPENDIX-CLIENT-FORMS.md` | Appendix A: client form extraction (sanitised) with column-to-field mapping |

---

## 0. Header

**Purpose.** Give Sawant Group a quality-management module that reproduces the client documents (incoming inspection, in-process report, ISIR, visual weld report, before / after weld report, rejection and rework register with COPQ, 8D + 5-Why + quality alert, instrument list with calibration, minutes of meeting, continuous improvement) inside the ERP, with the rules the paper sheets cannot enforce: AQL sampling, usage decision with stock release, automatic NCR, quantity coverage of dispositions, rework re-inspection, 8D gates with effectiveness check, calibration blocking and out-of-tolerance impact review, supplier scoring.

**Users.** Quality (inspectors, quality engineers, quality head — `approve`), Production (reads holds, performs rework), Purchase (reads supplier quality, receives SCAR / debit notes), Warehouse (QC hold stock), Management (KPIs). Owner department: **Quality**.

**The ten pages (registry, frozen):** `qms-plans`, `qms-incoming`, `qms-process`, `qms-final`, `qms-supplier`, `qms-inspections`, `qms-ncr`, `qms-capa`, `qms-5why`, `qms-calibration` — all become `typed` pages (listed in `TYPED_PAGES`).

**Dependencies.** Existing: units / FY / context, RBAC, audit, number series, idempotency, items, warehouses, stock posting (`postMovement`, `reverseVoucher`), settings. Plan 03: `parties`, `goods_receipts` (+ lines, batches), `scm_settings.qc_hold_warehouse_id`, the QC decision (`qcDecide`) and `returnToVendor` (debit note). Plan 02 (not present when this was written): nothing required (see R-5 in `06b` §5.2). Later plans consume QMS: Manufacturing (`mfg-rework`, `mfg-scrap`, production-order holds), Sales (dispatch release), Finance (queue events).

**Foundation items used.** `number_series` numbering `<PFX>/<UNIT>/<FY>/<0001>`; soft delete and undo; `If-Match` + `version`; audit (`recordAudit`); `requirePageAction`; typed-page engine (`TypedSchema`, `TypedHandler`); `Idempotency-Key`; `accounting_event_queue`; status words of foundation §6; error format.

**FOUNDATION-CHANGE items (all small, listed once):** (1) **no `company_id`** on QMS tables (follow the Phase 3–5 code) — `06b` A-DB-1; (2) QMS migrations are **hand-written** and never use `prisma migrate dev`; Prisma models keep scalar ids for core tables — `06b` A-DB-2 (overrides `00-BUILDER-RULES.md` §6 "New migration" for QMS only); (3) `LedgerVoucherType` gains `'QC_OUT' | 'QC_IN'` (T-QMS-18); (4) Plan 03 `post` of a GRN with QC lines calls `QmsInboundPort.onGrnPosted` (one call, A-SCM-2); (5) shared records code gains optional typed filters, `actionBodySchema.payload`, new `lookup` kinds (T-QMS-13); (6) optional `tabPanels` map in `TypedSchema` (same as Plan 03; T-QMS-30 adds it if absent); (7) `Quality Score` of Plan 03's `scm-evaluation` may later read QMS (Q-11); (8) setting keys `qms.*` in `settings`; env `QMS_UPLOAD_DIR`.

**Client context (sanitised).** A Pune-area contract manufacturer of welded fabrications and machined parts (heavy steel plate, gantry-type structures, frames, brackets, decks) with two plants kept in the client's own naming ("Unit 3", "Unit 5"). They run paper / Excel forms: incoming inspection with heat numbers and MTCs, in-process checks of 12 parts per sheet, ISIR with 5 samples, visual weld inspection against ISO 5817, before / after welding reports, a rejection / rework register with PPM and cost-of-quality sheets, 8D reports with why-why and quality alerts for customer complaints, an instruments list of ~57 gauges (annual external calibration), minutes of meetings and a continuous-improvement slide. Plant, unit and company names are **configuration** (the `units` table), never code; the owner's own plants (Talwade, Sawardari, Varale) work the same way.

**Decisions taken (referenced by id elsewhere):**
* **D-1** all ten pages are typed pages with their own tables; no new page ids, only `[ADD]` fields, tabs and buttons.
* **D-2** the four inspection pages are filtered views of one `inspections` table (one inspection = one item + one lot / heat / batch); `qms-inspections` shows every kind.
* **D-3** weld flaw limits that are formulas (ISO 5817 style) are **data on the plan, judged by the inspector**, not evaluated by code.
* **D-4** only incoming inspections move stock in this plan; in-process / final decisions are read by Manufacturing / Sales through documented queries.
* **D-5** QMS follows the existing tables' conventions (no `company_id`), and hand-written migrations.
* **D-6** welder / WPS register is backlog (COULD).
* **D-7** MOM lives as an `[ADD]` tab of `qms-capa` ("Review Meetings (MOM)").
* **D-8** Continuous improvement ideas live as an `[ADD]` tab of `qms-capa` ("Improvement Ideas").
* **D-9** internal PPM = rejected ÷ **produced** (or received) × 10⁶; customer PPM = customer-rejected ÷ **dispatched** × 10⁶ (the client sheets mix both; Q-8).
* **D-10** no separate REJECT warehouse: the QC hold warehouse of Plan 03 is the reject area (rejected pieces stay in it until returned, scrapped or released).

---

## 1. Scope, mapping and status

### 1.1 The ten Quality pages
| # | Page id | Title | Kind today → after this plan | Document | Frozen fields | `[ADD]` tabs |
|---|---|---|---|---|---|---|
| 1 | `qms-plans` | Inspection Plans | generic → **typed** | `IPL` | 11 | Print Forms |
| 2 | `qms-incoming` | Incoming Quality | generic → typed | `IQC` | 13 | — |
| 3 | `qms-process` | In-Process Quality | generic → typed | `IPQ` | 12 | — |
| 4 | `qms-final` | Final Quality | generic → typed | `FQC` | 12 | — |
| 5 | `qms-supplier` | Supplier Quality | generic → typed | `SQS` | 12 | — |
| 6 | `qms-inspections` | Quality Inspections | generic → typed | `ISR/VTR/WBA/LAY` (+ all kinds) | 12 | — |
| 7 | `qms-ncr` | Non-Conformance / NCR | generic → typed | `NCR` | 12 | Quality Alerts, Cost of Poor Quality, Defect Master, Monthly Quality Data |
| 8 | `qms-capa` | CAPA | generic → typed | `CAPA` / `SCAR` | 11 | Review Meetings (MOM), Improvement Ideas |
| 9 | `qms-5why` | 5 Why Analysis | generic → typed | `5WY` | 11 | — |
| 10 | `qms-calibration` | Calibration | generic → typed | Instrument ID | 12 | — |
Status of the existing code: these pages are served by the generic engine as plain registers today (no QMS tables). All real behaviour is new (36 tickets).

### 1.2 Mapping of the owner's page names (these names are **not** in the registry; never create them)
| Owner's note | Real page | What goes there |
|---|---|---|
| `qc-inward` — inward inspection | `qms-incoming` | incoming inspection from GRN, incl. heat no., material grade, dimensions, MTC status, AQL decision |
| `qms-rejections` / `qms-rework` — rejection & rework register | `qms-ncr` (register + containment + disposition + COPQ) with hand-off to `mfg-scrap` and `mfg-rework` (Manufacturing, planned later) | the client register columns are `[ADD]` fields of the NCR; the shared tables `rework_requests`, `rework_log`, `scrap_requests` and their status contract are defined now (`06b` §5.8) and become the data of the two Manufacturing pages |
| `cal-instruments` — calibration master | `qms-calibration` | instrument register, schedule, records, out-of-tolerance, certificates, compliance |
| 8D | `qms-capa` (+ `qms-5why` for the why-why analysis; `qms-ncr` tab "Quality Alerts" for the quality alert) | D1–D8 sections as tabs |
| In-process | `qms-process` | |
| ISIR / PPAP-style first article | **`qms-inspections`** with type *First Article (ISIR)* (decision below) | |
| VT report (visual / weld testing) | `qms-inspections` with type *Visual Weld (VT)*; before / after welding report = type *Weld Before/After* | |
| Supplier quality | `qms-supplier` | |
| Inspection plans / templates | `qms-plans` | |
| MOM format | `qms-capa › [ADD] Review Meetings (MOM)` (D-7) | no new page, not a DMS document (the action points need tracking) |
| Continuous improvement ideas | `qms-capa › [ADD] Improvement Ideas` (D-8) | |

**Decision — ISIR on `qms-inspections`, not `qms-final`.** The ISIR is a dimensional first-article report of one part at one drawing revision with 5 samples and a reviewer sign-off; it is not tied to a production lot's release. `qms-inspections` is the register of all inspection kinds with the "Parameter Results", "Sample Details" and "Attachments & Certificates" tabs that an ISIR needs. `qms-final` stays the **finished-lot release** (checklist, test results, release certificate); its "Customer Requirement" tab shows the latest approved ISIR, so the PPAP-style link is visible where dispatch is decided.

### 1.3 Which client form maps to which page / tab / print template
| # | Client file | Page / tab | Print template (`formCode`) |
|---|---|---|---|
| 1 | RM inward inspection sheet (3 sheets + AQL reference) | `qms-incoming` (all tabs); AQL reference → `qms-plans › Sampling Rules` | `IQC_REPORT`, `IQC_SHEET` |
| 2 | In-process inspection report | `qms-process › SPC Readings` / register | `IPQ_REPORT` |
| 3 | ISIR | `qms-inspections › Parameter Results` (type ISIR) | `ISIR` |
| 4 | VT report blank | `qms-inspections › Parameter Results` (type VT) | `VT_REPORT` |
| 5 | Rejection / rework register (+ summary, PPM, quality cost, COPQ sheets) | `qms-ncr` register, `NCR Trend`, `[ADD]` Cost of Poor Quality, Monthly Quality Data | `REWORK_REG` |
| 6 | 8D report (+ why-why + quality alert) | `qms-capa` all tabs; `qms-5why › Why Chain`; `qms-ncr › [ADD] Quality Alerts` | `EIGHT_D`, `WHY_WHY`, `Q_ALERT` |
| 7 | Instruments list (two plants) | `qms-calibration › Instrument Register` (+ import) | `INSTRUMENT_LIST` (+ `CAL_RECORD`) |
| 8 | Before / after welding report | `qms-inspections › Parameter Results` (type Weld Before/After) | `WELD_BA` |
| 9 | MOM format | `qms-capa › [ADD] Review Meetings (MOM)` | `MOM` |
| 10 | Continuous improvement ideas | `qms-capa › [ADD] Improvement Ideas` | `CI_PROJECT` |
All 10 client files are mapped (details in Appendix A). Additional ERP-originated print: `RELEASE_CERT` (final release certificate), `CAL_RECORD`.

### 1.4 Hand-off points
* **Procurement (Plan 03):** GRN lines needing inspection → QMS (`QmsInboundPort.onGrnPosted`); QC decision stock moves → Plan 03 `qcDecide` called by QMS (`GrnQcPort.decideLine`); rejected → `returnToVendor` debit note; supplier PPM / OTIF ↔ `scm-evaluation` (Q-11).
* **Inventory (QC hold):** the QC hold warehouse is the quarantine and the reject area; QMS posts only through `postMovement` / `reverseVoucher` (voucher types `QC_OUT` / `QC_IN`).
* **Manufacturing (later):** reads / writes `rework_requests`, `rework_log`, `scrap_requests` only through `ReworkService` / `ScrapService`; reads holds with `GET /qms/holds`; replaces the free-text `production_order_ref`.
* **Sales (later):** dispatch allowed only if `GET /qms/final-release` says released.
* **Finance:** events `SCRAP_POSTED`, `RETURN_TO_SUPPLIER_POSTED` (queue).

---

## 2. The frozen UI, page by page — SUMMARY (full text in `06a-QMS-UI-PROCESSES.md` §2)
For every page `06a` gives: the six profile tabs (registry names) each with one line "what it shows / does and from which data"; the complete frozen field list with key, type and required flag from `field-types.json`; the `[ADD]` fields (client-driven: heat no., material grade, thickness / width / length, MTC status, AQL result, defect category, rework tracking, COPQ …) after the frozen ones; statuses; row actions; header buttons; filters; totals; empty states; the `[ADD]` tabs; §2.11 lists the 15 print templates with exact header blocks and table columns; §2.12 lists the new web components (`InspectionGrid` etc.).

## 3. How the market does it

| Concept | Odoo Quality | ERPNext | SAP QM | Dynamics 365 SCM | Others / standards | Decision here |
|---|---|---|---|---|---|---|
| What triggers an inspection | **Control points** on product / operation, with frequency (every operation, % of units, random %, once per period) | Quality Inspection created manually / from receipt with a template | **Inspection lot** created automatically from goods receipt, production order, delivery | **Quality associations**: event (receipt, report as finished, sales), before / after, blocking | AIAG control plan: sample size + frequency per characteristic | Adopt: plan characteristic carries `sample_rule` and frequency; inspection created automatically from GRN (D365 / SAP style). Skip: random % control points (COULD) |
| Sampling | Pass-fail / measure, tolerance, partial % of transfer | none (manual) | Sampling procedures, AQL | **Item sampling** (percentage, fixed, per batch / serial) with AQL and test groups; flexible sampling | ISO 2859-1 / IS 2500 tables | Adopt: table-driven AQL plans (data) + per-characteristic rule |
| Check types | Instructions, picture, pass-fail, measure, worksheet | Reading / value / numeric with min-max | Quantitative and qualitative characteristics | Test groups with tests | — | Adopt: `MEASURED`, `ATTRIBUTE`, `CHECKLIST`; photo = attachment |
| Decision | Check pass / fail → alert | Accepted / Rejected status | **Usage decision** codes close the lot and trigger stock posting and quality score | Quality order validation; quarantine order on failure | — | Adopt usage decision (`inspection_decisions`, append-only) with stock release |
| Stock blocking | Not by default | none | QI stock → unrestricted / blocked | Open quality order blocks quantity | — | Adopt via QC hold warehouse (Plan 03) |
| Non-conformance | **Quality alert** with team, stage, corrective / preventive action fields | **Non Conformance** (subject, procedure, details, corrective / preventive, Open / Resolved / Cancelled) | **Quality notification** with defect, cause, tasks | **Nonconformance** (approval status New → Approved), can create a quality order | 8D / CAPA (IATF 10.2) | Adopt a richer NCR with dispositions and costs; CAPA / 8D is a separate page |
| Corrective action | Alert actions (corrective, preventive) | Quality Action under a Quality Review | Tasks in the notification | corrections in the nonconformance | 8D D0–D8; effectiveness check | Adopt 8D gates + 90-day effectiveness |
| Calibration | module add-ons | Asset maintenance / third-party | **Calibration inspection** (inspection type 14), PM calibration orders, usage decision unlocks | not core | ISO/IEC 17025, ISO 10012, NABL, impact review of out-of-tolerance | Adopt due-date blocking + impact review (QMS-specific) |
| Supplier quality | vendor ratings via add-on | supplier scorecard | vendor evaluation by QM scores | vendor evaluation | scorecards: PPM, delivery, SCAR | Adopt monthly scorecard with PPM, OTIF, audit, auto SCAR |
| Reports | Quality checks / alerts analysis | quality goal review | QM information system | — | PPM, FPY, Pareto, COPQ, Cpk | Adopt (section 8) |
Pitfalls seen: AQL table copies in vendor PDFs are unreliable (we seed only what the client uses and require the licensed table for others); supplier score weights differ by customer (configurable, defaults documented); one PPAP level does not fit every OEM (customer decides).

## 4. End-to-end processes — SUMMARY (full flows with mermaid diagrams in `06a` §4)
4.1 Incoming inspection from GRN (accept / reject / deviation → QC hold release → NCR → SCAR / debit note) · 4.2 in-process inspection with hold and release · 4.3 ISIR, final inspection and release certificate · 4.4 rejection and rework (reject → containment → disposition → rework → re-inspection → COPQ) · 4.5 NCR → CAPA / 8D → effectiveness; 5-Why · 4.6 calibration lifecycle (due → in-house / outside → certificate → out-of-tolerance review → blocked instruments) · 4.7 supplier rating and SCAR · 4.8 hand-offs.

## 5. Database design — SUMMARY (full DDL, Prisma, seeds in `06b-QMS-DATABASE.md`)
40 new tables in 8 hand-written migrations (`20270301000000_qms_m1_masters` … `…700_qms_m8_supplier_misc`): masters (`qms_defect_categories`, `qms_defects`, `qms_sampling_plans`, `qms_sampling_plan_rows`, `qms_form_headers`), calibration (`instruments`, `calibration_records`, `calibration_points`, `calibration_impact_reviews`, `calibration_impact_items`), plans (`inspection_plans`, `inspection_plan_characteristics`), inspections (`inspections`, `inspection_results`, `inspection_decisions`, `inspection_stock_moves`), NCR family (`ncrs`, `ncr_dispositions`, `ncr_containment_actions`, `ncr_cost_lines`, `rework_requests`, `rework_log`, `scrap_requests`), CAPA family (`capas`, `capa_team_members`, `capa_containment`, `capa_root_causes`, `capa_actions`, `five_why_cases`, `quality_alerts`), supplier and misc (`supplier_quality_periods`, `supplier_audits`, `supplier_audit_findings`, `quality_meetings`, `quality_meeting_points`, `improvement_projects`, `improvement_actions`, `quality_monthly_inputs`, `capability_studies`, `qms_attachments`). Numbering table, seed (defect categories from the client register, VT flaw list, CLIENT-AQL table, form headers, 23 settings keys, default plans) and the reconciliation block R-1…R-8 with Plan 03 are in `06b`.

## 6. Business rules and formulas — SUMMARY (full text with worked examples and error codes in `06c` §6)
BR-QMS-01 AQL lookup · 02 lot decision · 03 quantity reconciliation · 04 result evaluation · 05 rates, PPM, FPY · 06 QC-hold stock postings · 07 auto-NCR · 08 NCR severity, SLA, ageing, repeat · 09 dispositions and coverage · 10 rework and re-inspection · 11 scrap · 12 COPQ · 13 CAPA / 8D gates · 14 effectiveness and closure · 15 5-Why · 16 calibration due logic · 17 blocking of instruments · 18 out-of-tolerance impact review · 19 Cp / Cpk / Pp / Ppk · 20 in-process hold and escalation · 21 final inspection and certificate · 22 ISIR · 23 plan revision control · 24 supplier score and SCAR trigger · 25 statuses, permissions, four-eyes · 26 VT and weld reports · 27 numbering · 28 attachments · 29 concurrency and idempotency · 30 error codes. Each is assigned to tickets in `06d` §12.1.

## 7. API design — SUMMARY (full endpoint tables in `06c` §7)
Standard typed-page routes for the 10 pages plus the `/qms/*` router: plans and sampling, inspections and results, decisions and stock moves, NCR (containment, dispositions, costs), rework / scrap requests, CAPA / 8D, 5-Why, alerts, calibration (schedule, compliance, records, impact reviews, import), supplier periods and audits, meetings and improvements, monthly inputs, defect master, attachments, reports, print data, client-layout Excel exports, lookups.

## 8. Reports and KPIs — SUMMARY (definitions in `06c` §8)
KPI cards (First-pass yield, Open NCR (critical), CAPA overdue, Calibration due); FPY and rolled throughput yield; PPM by supplier / item / defect / customer / month; Pareto; rejection trend; COPQ and cost of quality; NCR ageing; CAPA ageing and 8D cycle time; calibration compliance; supplier ranking; rework register; inspection analytics; heat-number trace.

## 9. Extra functions beyond the prototype `[ADD]` — SUMMARY (`06d` §9)
40 items: 22 MUST (built), 8 SHOULD, 10 COULD. Highlights: auto-NCR, usage decision with stock release, instrument blocking, out-of-tolerance impact review, four-eyes approvals, 8D gates, supplier auto-SCAR, capability study, client-layout exports, magic-byte-checked attachments; backlog: SPC control charts, MSA Gage R&R, supplier portal, barcode scan, skip-lot switching, welder / WPS register.

## 10. Edge cases and careless-user scenarios — SUMMARY (`06d` §10)
50 cases E01–E50 with exact safe behaviour and a test file each (lot above the table, double-click decisions, own-approval, stock already issued, overdue instrument, impact review, over-disposition, rework without re-inspection, early effectiveness, upload of a disguised executable, parallel numbering, all-units writes …).

## 11. Test plan — SUMMARY (`06d` §11)
Unit tests of every formula with the worked numbers; API tests per area; a seeded simulation of 200 inspections checking six invariants (quantity reconciliation, stock value conservation, coverage, one auto-NCR per rejection, no blocked-instrument results, idempotent replay); Playwright scenarios (accept / reject lot, in-process hold, 8D, calibration, print forms, frozen-UI screenshots).

## 12. Build tickets — INDEX (full tickets in `06d` §12)
| Ticket | Title | Depends on |
|---|---|---|
| T-QMS-01 | Module skeleton, ports, errors, constants, settings, env | Plans 02/03 migrations |
| T-QMS-02 | Migration M1 masters + Prisma | 01 |
| T-QMS-03 | Migration M2 instruments, calibration records | 02 |
| T-QMS-04 | Migration M3 inspection plans | 03 |
| T-QMS-05 | Migration M4 inspections, results, decisions, stock moves | 04 |
| T-QMS-06 | Migration M5 NCR family | 05 |
| T-QMS-07 | Migration M6 CAPA, 5-Why, alerts | 06 |
| T-QMS-08 | Migration M7 calibration impact | 07 |
| T-QMS-09 | Migration M8 supplier, misc, capability, attachments | 08 |
| T-QMS-10 | Seed (defects, sampling plans, plans, headers, settings) | 09 |
| T-QMS-11 | Pure calculation library | 01 |
| T-QMS-12 | Numbering, state machine, guards, attachments, notify | 09, 11 |
| T-QMS-13 | Typed definitions for the 10 pages, engine extensions, lookups | 12 |
| T-QMS-14 | Plans, characteristics, sampling tables, form headers | 13 |
| T-QMS-15 | Instruments, schedule, compliance, sweep, import | 13 |
| T-QMS-16 | Calibration records, out-of-tolerance, impact review | 15 |
| T-QMS-17 | Inspection core: create, results, complete | 14, 16 |
| T-QMS-18 | Stock and GRN adapters, QC moves, reversal | 17 |
| T-QMS-19 | Incoming inspection: from GRN, decision, reopen | 18 |
| T-QMS-20 | In-process hold / release, escalation, capability | 17 |
| T-QMS-21 | Final, ISIR, VT, weld before/after, certificate | 17 |
| T-QMS-22 | NCR service (auto-NCR, containment, dispositions, costs, close) | 19, 20, 21 |
| T-QMS-23 | Rework and scrap requests | 22 |
| T-QMS-24 | CAPA / 8D / SCAR | 22 |
| T-QMS-25 | 5-Why and quality alerts | 24 |
| T-QMS-26 | Supplier quality and audits | 19, 24 |
| T-QMS-27 | Meetings, improvements, monthly inputs, defect master | 22 |
| T-QMS-28 | Reports and KPIs | 26, 27 |
| T-QMS-29 | Client-layout Excel exports and print data | 28 |
| T-QMS-30 | Web: tab framework, wiring, lookups, action dialogs | 13 |
| T-QMS-31 | Web: inspection grid and decision panels | 30, 19–21 |
| T-QMS-32 | Web: NCR, CAPA, 5-Why, alert, MOM, improvement panels | 30, 22–25, 27 |
| T-QMS-33 | Web: calibration, supplier, plan panels | 30, 14–16, 26 |
| T-QMS-34 | Web: print forms | 29, 30 |
| T-QMS-35 | Simulation, invariants, RBAC tests | 28 |
| T-QMS-36 | E2E and screenshot freeze | 34, 35 |
Total: **36 tickets**, 40 tables, 8 migrations.

## 13. Reviewer checklist — SUMMARY (`06d` §13)
Freeze and schema, database, rules, safety, hand-offs, and the list of likely builder mistakes (renaming a frozen label, `MAX(code)+1`, month arithmetic on due dates, UTC date, counting NG results instead of defective pieces, trusting a client-sent result, creating a REJECT warehouse, running `prisma migrate dev`).

---

## 14. Open questions and decisions taken (defaults apply until the owner answers)

| Id | Question / what we still need from the client | Default used meanwhile |
|---|---|---|
| Q-1 | Approval of each print layout (15 forms) and the **real controlled form numbers** (Doc No., Rev No., Rev Date) | placeholders `QF-…`, rev 0, 2026-04-01; editable in `qms-plans › Print Forms` |
| Q-2 | The AQL of the client's sampling table: the sheet is labelled "AQL Level 1" but its Ac/Re pattern resembles AQL 2.5 (unverified, from the numbers). Which AQL and which table do they contractually use? | table seeded as `CLIENT-AQL` exactly as the sheet; `aql` field = 1.00 as labelled |
| Q-3 | Who signs each form (inspector, quality head, plant head)? Who may approve deviations, scrap, CAPA closure? | roles: inspector `edit`; quality head `approve`; four-eyes on |
| Q-4 | The ISO 5817 limits per quality level (B / C / D) as data for the weld plans; the client sheets print one level's limits | plan rows as printed on the client sheet (level B on the VT report, level C named on the weld report); Quality loads other levels from the purchased standard |
| Q-5 | Customer-specific requirements (PPAP level, required Cpk, ISIR frequency) per customer | Cpk 1.67 capable / 1.33 acceptable (common AIAG values; the customer's value wins); ISIR per drawing revision |
| Q-6 | Position of `[ADD]` tabs (after `Audit Trail` vs after the 6th profile tab) | after `Audit Trail` |
| Q-7 | Plant naming: create `units` for the client's plants; instruments are per unit; is a calibration lab in-house (NABL scope)? | two units configured by the owner; all calibration External |
| Q-8 | PPM bases: internal PPM on produced or received? customer PPM on dispatched or produced? | D-9 |
| Q-9 | Real shop-floor hour rates for rework and sorting; real SLA days per severity | 350.00 / 300.00 per hour and 2 / 7 / 15 days (placeholders) |
| Q-10 | Retention period of quality records and the legal-hold rule (IATF: ≥ product life + 1 year typical) | records are never deleted (soft delete only); no purge job |
| Q-11 | Should Plan 03's supplier `Quality Score` read the QMS monthly score? Different zero points (QMS 10,000 PPM, SCM 50,000 PPM) | both exist separately; QMS page labelled "Quality Score" (QMS) |
| Q-12 | Is a supplier portal for SCAR responses wanted soon? | backlog COULD |
| Q-13 | Which instruments need **internal** calibration points (master gauge blocks etc.)? | external certificate only; point table optional |
| Q-14 | Formal rule for "conditionally accepted" in-process parts (client wording "Cond. Accepted") | mapped to `Accept Under Deviation` with approver |

## 15. Sources

All pages below were opened or returned by search in this session (dates 2026-11). Claims taken from search snippets only, or from vendor pages, are marked "(unverified)". No client data was used in any query.
**ERP / QMS products**
* Odoo documentation, quality control points — https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/quality/quality_management/quality_control_points.html (fields of a control point, check types, frequency, alert hand-off).
* Odoo Quality app listing (third-party vendor page; "alerts, actions, reports", unverified) — https://apps.odoo.com/apps/modules/16.0/to_quality ; Odoo 18 user guides re-hosted by a third party (unverified) — https://www.cleverence.com/articles/odoo-documentation/quality-control-points-odoo-18-0-documen-0543
* ERPNext Non Conformance — https://docs.frappe.io/erpnext/non-conformance.md ; Quality Review — https://docs.frappe.io/erpnext/quality_review.md ; Quality Management manual — https://docs.frappe.io/erpnext/user/manual/en/quality-management
* SAP QM usage decision / notifications / calibration inspection (training sites; secondary, unverified against SAP help) — https://www.tutorialspoint.com/sap_qm/sap_qm_usage_decision.htm , https://www.guru99.com/hr/introduction-sap-qm.html , https://download.consolut.com/direct/SAP_PrintDoku/en/QMIMIL/QMIMIL.PDF , https://oxmaint.com/sap-integration/sap-qm-maintenance-integration
* Dynamics 365 Supply Chain quality associations — https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/quality-associations ; test groups — https://learn.microsoft.com/el-gr/dynamics365/supply-chain/inventory/quality-test-groups ; quality overview — https://learn.microsoft.com/en-us/training/modules/configure-work-quality-control-dyn365-supply-chain-mgmt/4-processes
**Standards and methods (overview level)**
* ISO 2859-1 / IS 2500 (Part 1): https://iteh.es/catalog/standards/iso/15ffc59c-9f33-46dc-8518-f4163282a638/iso-2859-1-1999 , https://services.bis.gov.in/tmp/SR2500_1.pdf , https://infralens.in/code/IS-2500-Part-1-2017 (unverified edition), https://qualityinspection.org/aql-2-5-samples , https://qualityinspection.org/inspection-level/ — **the Ac/Re values of the standard were not available as clean text, so none are seeded beyond the client's own table; the code letters / sample sizes of general level II (A=2 … Q=1250) are from the standard's structure and match the client's sample sizes.**
* 8D: https://www.fabrico.io/blog/8d-problem-solving/ , https://www.learnleansigma.com/?p=11209 (D0 added as preparation; escape-point root cause; containment kept until D6).
* PPAP / ISIR / PSW: https://kaizen.com/insights/production-part-approval-process/ , https://kissflow.com/solutions/manufacturing/ppap-explained/ , https://en.wikipedia.org/wiki/Production_part_approval_process , https://elsmar.com/elsmarqualityforum/threads/is-ppap-the-same-process-as-a-isir-initial-sample-inspection-report.836/ (ISIR content is customer-defined; one source's level definitions differ — customer decides).
* Cp / Cpk, Pp / Ppk: https://sas.uwaterloo.ca/~shsteine/papers/cap.pdf (AIAG quote: Ppk ≥ 1.67, Cpk ≥ 1.33 for significant characteristics), https://ifactoryapp.com/article/process-capability-cpk-automotive (vendor; thresholds vary by OEM). The d2 constants (1.128, 1.693, 2.059, 2.326, 2.534, 2.704, 2.847, 2.970, 3.078) and the MR̄/1.128 estimator are standard SPC tables (from general knowledge, unverified in this session).
* Cost of poor quality: https://www.learnleansigma.com/guides/cost-of-poor-quality-copq/ , https://www.accountingtools.com/articles/what-are-quality-costs.html (four categories; benchmarks differ, unverified).
* Calibration: https://casrai.org/guides/out-of-tolerance-calibration (17025 clause 7.10 impact assessment, look-back), https://casrai.org/guides/calibration-certificate (clauses 6.5, 7.8.4; uncertainty), https://fluke.com/en-us/learn/blog/calibration-software/calibration-control-best-practices (interval management; ISO 10012 claims unverified).
* Weld inspection: https://www.evs.ee/en/iso-5817-2014 (levels B, C, D), https://www.evs.ee/en/evs-en-iso-17637-2016 (visual testing), https://materialwelding.com/welder-certificate-validity-as-per-asme-section-ix-aws-d1-1-and-iso-9606/ and https://european-accreditation.org/?p=43283 (ISO 9606-1 six-monthly confirmation; interpretation differs between assessors). ISO 15614-1 (WPS qualification) was not found; welder / WPS register is therefore backlog.
* MSA: https://www.spcforexcel.com/knowledge/measurement-systems-analysis/acceptance-criteria-for-MSA (%GRR < 10 % / 10–30 % / > 30 %, ndc ≥ 5; critique of the cut-offs).
* Supplier scorecards and SCAR: https://www.hendrickson-intl.com/suppliers/quality-and-delivery , https://www.drivparts.com/suppliers/ivalua/supplier-scorecard.html , https://atsautomation.com/?p=429 (weights differ by buyer; no industry-standard formula).
* Control plan / FMEA: https://www.symestic.com/en-us/what-is/control-plan-in-automotive (columns, reaction plan; exact AIAG column order unverified).
**Project files read:** `PLAN.md`, `docs/plan/04-modules.md` §4.8, `docs/REGISTRY.csv`, `apps/api/tests/fixtures/field-types.json`, `reference/index.html` (`PROFILES`, `v9SpecialType`, `v9Quality`), `reference/screens/v92/fam-08-Quality-qms-ncr.png`, `docs/plans/00`, `01`, `03*` , existing code under `apps/api/src/{engine,modules/inventory,modules/records,core}`, `apps/api/prisma/schema.prisma`, `apps/web/src/pages/generic/**`, and the ten client documents (Appendix A).

**Unverified claims, collected:** IS 2500 current edition; Ac/Re values of ISO 2859-1 for any AQL (not seeded); the "Ac/Re pattern ≈ AQL 2.5" observation about the client table; d2 constants quoted from memory; ISO 10012 specifics; the 10:1 gauge-resolution rule of thumb; COPQ % benchmarks; the cut-off symbol in two VT requirement cells ("≤" assumed).
