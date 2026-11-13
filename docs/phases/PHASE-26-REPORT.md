# PHASE 26 — Report (built and API-tested; web not browser-tested)

Built locally on 2026-11-13. Nothing committed, pushed or deployed.

## What was built
**Database** — migration `20261214000000_phase26_project_spine` (idempotent): optional `project_id` (+ partial index) on the document headers
`sales_quotations, sales_orders, sales_dispatches, sales_invoices, sales_returns, purchase_requisitions, rfqs, purchase_orders, goods_receipts,
purchase_invoices, stock_vouchers, mfg_orders, qms_inspections, gate_passes, shipments, service_tickets` (`project_tasks` already had it);
`project_events`, `gate_templates` + `gate_template_steps` (BLDC and SPPM seeded from the V40 prototype, 15 steps each, each step depends on the one before),
`project_gates`, `project_specs`, `project_tests`, `project_documents`, `sales_enquiries`, `exception_rules` (10 rules seeded) + `process_exceptions`,
`order_journey_cache` (created, not used), notification types `project.gate_opened`, `process.exception`, `sales.enquiry_assigned`.

**API** (`modules/spine/`, mounted at the API root, paths as in the spec)
- Enquiries: list / create (numbered `ENQ/<PLANT>/<FY>/0001`), qualify, **to-quotation** (creates a Phase 10 draft quotation), **to-project** (creates a project, with the BLDC / SPPM template or CUSTOM), won, mark-lost (a reason is required).
- Gates: apply template (G01 OPEN, the rest LOCKED), list with readiness % and what is missing, start, due date, **submit**: checklist must be green ("Gate G03 needs: approved SPEC, 2 tests passed."),
  then **ApprovalService** (doc type `proj-stage-gates`); on approval the gates whose dependencies are all approved become OPEN and their department is notified; on rejection the gate stays IN_WORK with the comment. Nothing moves by itself (R-31).
- Specifications (target and tolerance, revisions supersede), tests (OK / NG worked out from the spec), documents (revision supersedes the old one, approve).
- History: project events plus the Phase 25 movement events of movements tagged with the project; filters; keyset cursor; **events of a plant the viewer did not choose show "Event in another plant."** with no details; export to Excel.
- **Dossier PDF**: cover, gates with approvers, specs, test results, documents, history, signature lines.
- **360° order view** `GET /orders/:id/360`: 13 stages, document numbers, who holds it now, per-line progress, **weighted progress** (order 5, material 25, production 35, quality 10, dispatch 15, billing 5, collection 5; example 47.5 %).
- **Process exceptions**: job `process.exceptions` every 30 minutes (and "Check now"): raises, never duplicates, auto-resolves when fixed, High severity notifies the owner department; list grouped by department; note / assign / resolve.
  Rules working: SO with no flow, PO late, GRN in QC hold, movement late, DC with no invoice, invoice overdue 30 days, gate late.

**Web** (`pages/spine/SpinePages.tsx`): Sales Enquiries (add, qualify, quotation, project, won, lost with reason), 360° Order Tracking (journey steps, progress bar, lines), Project History (+ Excel),
Process Exceptions (grouped by department, Check now), Project Stage Gates (gate cards with lock, state colour, readiness bar, due date, Start / Submit; tabs Specifications, Test records, Documents; dossier PDF; template buttons).
Menu entries: Sales ➜ Sales Enquiries; Executive ➜ 360 Order Tracking, Project History, Process Exceptions; Projects ➜ Stage Gates, Specifications, Test Records, Documents.

## Tests (`tests/phase26.test.ts`, 10 tests, all pass)
Pure: weights add to 100, 47.5 % example, gate message text, readiness, OK/NG at the tolerance edges, which gates open after an approval.
API: enquiry rules and numbering; enquiry → project → 15 gates (G01 open, rest locked), second template refused, locked gate refused, "needs approved URS", failing test blocks, submit → approved → next gate opens, history shows both events, dossier PDF is a real PDF, Excel export;
spec and document revisions; plant masking of history; 360 stages and progress; late gate raised, not duplicated, auto-resolved.
Bugs found and fixed by the tests: projects table needs `start_date`/`end_date` and its own check values; `project_manager_id` references employees, not users; a SQL parameter used as both uuid and text.

## Deviations / not done (carry-over)
1. `project_id` is **added** to the headers but is **not yet copied** automatically along the chain (SO → dispatch → invoice → PR/PO …), and there is no project selector or badge on the document forms, and no `PROJECT_CHANGE` approval for posted documents.
2. `project_events` is a plain table (not partitioned by year) and is filled by the gate / enquiry / exception code and read together with movement events; there is no general after-commit consumer of the audit log and approvals.
3. Exception rules **not implemented**: shortage with no PR, FQC passed with no DC, short receipt open (their data comes from later work). Daily digest per department is not built (High severity notifies at once).
4. 360: computed live (the cache table is unused); "time spent in each stage" and the Timeline / Approvals / Documents / Exceptions side tabs are not shown; no reservation / shortage stage.
5. `master-customers`, `master-products`, `master-materials` shortcut pages and `proj-demo-control` ("Project Flow Board") are not built.
6. Gate approval needs the Approval Matrix (Projects / `proj-stage-gates` rules) to be filled in by the Administrator; without a rule the submit says there is no approval rule. (The module control is seeded "approval required".)
7. A "won" enquiry does not create the sales order by itself; the enquiry's prospect cannot be turned into a customer from the screen (create the customer first, then pick it).
8. Feeders (5 enquiries, quotations, gates G01–G04 on screen) and flows (a)(b)(c), the 360 < 400 ms check and a browser test of the new web pages were not run.

## Deploy sheet (owner, by hand — not done by me)
1. Backup the production database. 2. `prisma migrate deploy` (migration `20261214000000_phase26_project_spine`, forward-only). No new dependencies, no new environment variables.
3. Build API and web, restart (new cron queue `process.exceptions`), `/health` OK. 4. Administration ➜ Approval Matrix: add a rule for Projects ➜ Project Stage Gates.
5. Smoke: Sales Enquiries ➜ Add (template BLDC) ➜ Create Project ➜ Project Stage Gates ➜ add a URS document, approve it, Submit G01 ➜ G02 opens; Process Exceptions ➜ Check now.
6. Rollback: all additive (new tables and a nullable `project_id`).
