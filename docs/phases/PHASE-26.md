# PHASE 26 — Project spine, product development stage gates, 360° Order Tracking, Sales Enquiries, Process Exceptions

## 1. Goal
- One project number ties every document together.
- Project History shows every event across departments.
- New products (BLDC motor, SPPM machine style) go through stage gates with specs, tests, documents
  and a dossier PDF.
- 360° Order Tracking shows one order's full journey and progress on one screen.
- A Process Exceptions list shows every delay automatically.

## 2. Pages
| Page | What it is |
|---|---|
| sales-enquiries | new |
| ops-order-360 | 360° Order Tracking |
| project-global-history | Project History |
| proj-stage-gates | |
| proj-specifications | |
| proj-test-records | |
| proj-documents | |
| proj-demo-control | renamed "Project Flow Board" — a read-only board of projects by gate |
| process-exceptions | |
| master-customers, master-products, master-materials | V40 shortcuts to the Phase 6 masters with V40 tabs |

Plus a project selector and a badge on every document form.

## 3. Rules
- **project_id** is optional on all document headers. Once set on an SO (or PR/PO for internal
  projects), it is copied to every document created from it. Changing it on a posted document needs
  approval (Phase 5 doc type PROJECT_CHANGE).
- **Gate templates** (from V40 V20_BLDC_STAGES / V20_SPPM_STAGES, seeded as editable data):
  - **BLDC:** G01 Enquiry & URS (Sales, URS); G02 Feasibility & Project Approval (Projects, CHARTER);
    G03 Electromagnetic & Mechanical Design Freeze (Projects, SPEC/DRR); G04 BOM & Sourcing Release
    (Purchase, BOM); … through closure (all rows copied from V40 in order).
  - **SPPM:** G01 Customer URS & Enquiry; G02 Feasibility & Project Charter; G03 Concept Layout & Cycle
    Study; G04 Mechanical Design Freeze; … through closure.
  - **CUSTOM:** Admin builds their own.
- **Gate document types (V40):** URS, CHARTER, SPEC, DRR, BOM, PO, IQC, JC, TR, FAT, DC, SAT, INV, CLOSE.
- **A gate can be submitted only when:** its deliverable document is Approved, all its tests passed,
  and its predecessor gates are Approved. Submit → ApprovalService (Projects Head + the owner
  department head).
- **On approval:** the next eligible gates become OPEN and their owner department is notified.
  No work is moved (R-31).
- **Plants:** a project has a home plant; documents in other plants may link to it. Project History
  respects the viewer's plants (events from unallowed plants show "Event in another plant" with no
  details).

## 4. Database (<ts>_phase26_project_spine)
- ALTER every document header without it: ADD project_id uuid FK + index. The builder lists the tables
  in the report (sales quotations/orders/dispatches/invoices/returns, PR/RFQ/PO/GRN/purchase invoices,
  stock vouchers, production orders, job cards, inspections, NCR, gate passes, shipments, service
  tickets, tasks).
- project_events(id, project_id, unit_id, at, department_id, actor_id, kind DOC_CREATED/MOVED/
  RECEIVED/ACCEPTED/RETURNED/SUBMITTED/APPROVED/REJECTED/POSTED/CANCELLED/GATE_OPENED/GATE_APPROVED/
  NOTE/ATTACHMENT/EXCEPTION, doc_type, doc_id, doc_no, text, source_event_id unique)
  — partitioned by year; filled by an after-commit consumer of audit + movements + approvals
  (idempotent)
- gate_templates + gate_template_steps(seq, code, name, owner_department_id, deliverable_doc_type,
  exit_criteria, linked_page, depends_on text[])
- project_gates(project, step, state LOCKED/OPEN/IN_WORK/SUBMITTED/APPROVED/REJECTED, deliverable_doc_id,
  approval_request_id, opened_at, approved_at, due_date, late)
- project_specs(project, spec_no, parameter, target, tol_minus, tol_plus, unit, revision, status)
- project_tests(project, gate, test_name, method, spec_id, sample, value, result OK/NG, report_doc_id,
  tested_by, tested_at)
- project_documents(project, doc_type, title, revision, document_id, status Draft/Approved/Superseded)
- sales_enquiries(enq_no ENQ/<PLANT>/<FY>/0001, unit_id, date, customer_id | prospect fields,
  contact, product, application, qty, required_date, urs_document_id, source, assigned_to,
  status New/Qualified/Quoted/Won/Lost, lost_reason, quotation_id, project_template)
- exception_rules(code, name, check_key, threshold_hours, owner_department_id, severity, active)
  + process_exceptions(rule, unit_id, doc_type, doc_id, project_id, raised_at, resolved_at, note,
  assigned_to)
- order_journey_cache(so_id PK, json, refreshed_at) — refreshed on events

## 5. Logic and examples
**A. 360° Order view**, per SO line. Stages:
Enquiry → Quotation → SO → Project → BOM & material flow → Reservation/Shortage → PR → PO → GRN → IQC →
MO / job cards → FQC → FG → DC → Invoice → Collection.

Each stage shows status, qty done/ordered, the document numbers (clickable), the department holding it,
and the time spent there.

**Progress weights:**
| Stage group | Weight |
|---|---|
| order confirmed | 5 |
| material ready | 25 |
| production | 35 (pro-rata by good qty) |
| quality | 10 |
| dispatch | 15 |
| billing | 5 |
| collection | 5 |

**Example:** order confirmed (5) + material ready (25) + production 50 % done (17.5) → **47.5 %**.

**B. Exception rules** (job every 30 min, auto-resolve):
| Rule | Owner |
|---|---|
| SO approved > 48 h with no project / MO / material flow | Sales |
| Shortage on a flow > 24 h with no PR | Purchase |
| PO past its delivery date | Purchase |
| GRN in QC hold > 72 h | Quality |
| Movement late (Phase 25) | holding department |
| FQC passed, no DC within 48 h | Warehouse |
| DC without invoice > 24 h | Finance |
| Invoice overdue > 30 days | Finance |
| Gate past its due date | Projects |
| Short receipt open > 48 h | Warehouse |

**C. Gate flow:**
- a project is created with a template → gates created, G01 OPEN, the rest LOCKED;
- Submit → readiness checklist (each item green/red) → approval;
- Approved → the gates whose dependencies are all approved become OPEN, plus a notification;
- Rejected → stays IN_WORK with the comments.

**D. Dossier PDF:** cover (project, customer, product, dates); project data; gate table (dates,
approvers); specs with revision; test results with OK/NG; document list with revisions;
history summary; signatures block.

**E. Enquiry → Quotation:** "Create Quotation" makes a Phase 10 draft with the customer/prospect,
product lines and the enquiry reference; the enquiry becomes Quoted. Win/Loss follows the quotation.
A "New product" enquiry can create a project with the BLDC/SPPM/CUSTOM template.

**F. Project History:** a timeline filtered by department, kind, plant and date; export to Excel.
**Example line:** "12-11-2026 14:05 · Production · R. Patil · ACCEPTED · MO/TAL/2627/0044".

## 6. API
- CRUD /sales/enquiries (+ /:id/to-quotation | to-project | mark-lost)
- GET /orders/:soId/360
- GET /projects/:id/history?kind=&dept=&unit=&cursor= (+ /export.xlsx)
- CRUD /projects/:id/gates (+ /:gateId/submit)
- CRUD /projects/:id/specs | tests | documents
- GET /projects/:id/dossier.pdf
- GET /exceptions?dept=&unit=&severity= (+ /:id/note | assign | resolve)
- GET /projects/options?q=

## 7. Screens
- **360° page:**
  - top card: customer, SO, customer PO, value, project, plant;
  - a horizontal journey rail with coloured stage dots (done green, active blue, late red, not
    started grey);
  - a lines table with progress bars;
  - right tabs: Timeline · Approvals · Documents · Exceptions.
- **Gate rail:** cards in a row with a lock icon, state colour, owner department, due date and a
  readiness % ring.
- **Project badge** on forms: "Project PRJ/TAL/2627/0004 ✕".
- **Exceptions:** grouped by owner department; each with Assign, Note, Open document.

## 8. Messages
| Case | Message |
|---|---|
| gate not ready | "Gate G03 needs: approved SPEC, 2 tests passed." |
| project change | "Changing the project of a posted document needs approval — request sent." |
| enquiry lost | "Give a lost reason." |
| other-plant event | "Event in another plant." |

## 9. Audit & notifications
Gate opened/approved → owner department; exception raised → owner department (one digest per
department per day + immediate for High severity); enquiry assigned → salesperson.

## 10. Tests
- project_id propagation along the chain;
- 360 stages and weights;
- every exception rule raise/resolve;
- gate dependencies and approval;
- dossier PDF snapshot;
- history idempotency and plant masking;
- 360 < 400 ms.
- **Feeders:**
  - 5 enquiries (2 new products using BLDC and SPPM templates) through the screens;
  - quotations; projects with gates G01–G04 approved by the right roles;
  - specs and tests entered on screen.
- **Flows:** (a) enquiry → won → SO → 360 shows progress after each Phase 25 step; (b) a gate rejected
  then approved; (c) a delay creates an exception and resolving the cause clears it.

## 11. Acceptance
- [ ] 360° shows the live journey.
- [ ] BLDC/SPPM gates work with approvals.
- [ ] Project History is complete and plant-safe.
- [ ] Exceptions list real delays.
- [ ] Zero-error gate. Client documents updated.

## 12. Out of scope
Gantt of gates (can reuse the Phase 17 Gantt later), customer portal.

## 13. Owner check
1. SO → 360°: are all stages and numbers there?
2. Approve G02: does G03 open?
3. Exceptions: does an overdue PO show?

## 14. Build prompt
~~~
Read …, PHASE-26.md, V40 V20_*, v20*/v23*/v35*/v38* (reference). Build §4–§7; list every table you
add project_id to. Gate approvals via ApprovalService, no automatic movement. Feeders/flows §10.
Zero-error gate ×3. Local commit. Report + Deploy sheet + client documents.
~~~

## 15. Client documents
**NEW:** Sales Enquiries; 360° Order Tracking with progress %; Project History timeline; product
development stage gates (BLDC/SPPM) with specs, tests and dossier PDF; Process Exceptions list.

**Test book:**
- **Sales:** Enquiry → Create Quotation → win → SO → 360°. ✔️ The stages light up as work moves.
- **Projects:** Gate G02 → Submit. ✔️ The checklist shows what's missing; after approval, G03 opens.
- **Director:** Process Exceptions. ✔️ The late PO is listed under Purchase.

