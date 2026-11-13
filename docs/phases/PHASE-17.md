# PHASE 17


# PHASE 17 — Projects & Service
(ERRATA E-20: project_id / amc_contract_id on journal_lines AND gl_entries. E-25: SLA calendar holidays from Phase 15.)

## 1. Goal
**Customer projects** (installation, commissioning, custom builds):
- schedules with Gantt and critical path;
- approved timesheets;
- budgets by cost head;
- earned value (EVM);
- profitability read from the GL by project_id.

**After-sales service:**
- SLA-timed tickets;
- technician dispatch;
- mobile visit reports;
- spares through StockService;
- AMC contracts that bill and recognise revenue;
- warranty by serial, with back-to-back claims to suppliers.

Profitability always comes from the GL, never from typed fields.

## 2. Pages
- **Projects:** proj-projects, proj-tasks, proj-subtasks, proj-milestones, proj-team, proj-timesheets,
  proj-expenses, proj-budget, proj-kanban, proj-gantt, proj-profitability.
- **Service:** service-tickets, service-requests, service-technicians, service-visits, service-spares,
  service-history, service-amc, service-warranty, service-claims.
- Computed fields are read-only: Actual Cost, Committed, Margin %, Utilization %, First Time Fix %,
  Billed, Claims Count, Warranty Cost.

## 3. Rules (ERPNext Projects / Warranty Claim / Maintenance Visit / SLA; Odoo Field Service / Helpdesk; SAP PS / CS; PMI EVM; ITIL; GST SAC 9987 as data; Ind AS 115 / AS 9 straight-line AMC revenue)
1. A project belongs to one unit; cost and profit centre default from unit/department and can be overridden.
2. **Lifecycles:**
   | Document | States |
   |---|---|
   | Project | Draft → Planned → Active → On Hold → Completed → Closed (Closed blocks new costs) |
   | Task | Open → In Progress → Review → Done / Cancelled |
   | Timesheet | Draft → Submitted → Approved / Rejected → Posted |
   | Ticket | New → Assigned → In Progress → Awaiting Customer / Awaiting Parts (SLA paused) → Resolved → Closed / Cancelled; reopen within 7 days |
   | AMC | Draft → Pending Approval → Active → Expired / Renewed / Terminated |
   | Warranty claim | Draft → Submitted → Inspected → Approved / Rejected → Supplier Claimed → Settled |
3. **Approvals:** project budget (each version), weekly timesheets, project expenses, AMC contracts,
   warranty claims.
4. **Costs reach the GL only through PostingService:**
   - timesheet cost = hours × the employee/grade cost rate (Phase 15), frozen at approval;
   - spares via StockService at moving average;
   - project purchases carry project_id (Phase 9).
5. **Corrections** = reversal + new entry.
6. **Schedules** use the working calendar (Mon–Sat configurable + Phase 15 holidays). Dependencies
   FS / SS / FF / SF with lag in working days.
7. **Billing:**
   - an accepted billing milestone creates a Phase 10 draft invoice;
   - AMC billing schedules create invoices on their due dates;
   - chargeable visits are invoiced from their billable lines.

## 4. Database (<ts>_phase17_projects_service; money (18,2), qty/rate (18,4); numbering PRJ, TSK, STK, MIL, TS, PEX, TKT, SRQ, VIS, SPI, AMC, WAR, WCL)
**Projects:**
- projects(code, name, customer, project_manager (employee), project_type customer/internal/capex,
  billing_method fixed_milestone/time_material/non_billable, contract_value, start, end,
  baseline_set_at, cost_centre, profit_centre, status, health (computed green/amber/red))
- project_tasks(project, parent_task (max depth 2), number, name, owner, priority P1–P4, planned
  start/end, duration_days, baseline start/end, estimated_hrs, weight, progress_pct, kanban_column,
  kanban_rank, is_milestone, evidence_doc, status)
- task_dependencies(predecessor, successor, type FS/SS/FF/SF, lag_days; pred ≠ succ; cycles rejected)
- project_milestones(target/actual date, acceptance_criteria, owner, linked_task, is_billing,
  billing_pct or amount, sales_invoice_id, status planned/achieved/accepted/invoiced)
- project_team(employee, role PM/engineer/technician/QA/viewer, allocation_pct, from/to, billable, bill_rate)
- timesheets(employee, week_start Monday, total_hrs, approver, approval, status, journal) unique per
  employee + week; timesheet_lines(work_date, project, task, hours, billable_hours, description,
  cost_rate (frozen), cost_amount)
- project_expenses + lines(date, category = budget head, payee, amount, tax, billable, receipt, journal)
- project_budgets(version, status draft/pending/approved/superseded, approval) — one approved version
  at a time — + lines(cost_head labour/material/subcontract/travel/expense/overhead, account, amount)
- project_evm_snapshots(as_of, bac, pv, ev, ac, cpi, spi, eac, etc) — weekly
- **ALTER journal_lines AND gl_entries ADD project_id, amc_contract_id** (+ indexes)

**Service:**
- sla_policies(calendar, priority, response_mins, resolution_mins, pause_statuses, applies_to)
- service_tickets(number, customer, contact, site_address, serial_number_id, item, subject,
  category breakdown/installation/PM/complaint, channel, impact 1–3, urgency 1–3, priority (computed),
  sla_policy, response_due_at, resolution_due_at, first_response_at, resolved_at, sla_paused_mins,
  sla_state, entitlement warranty/amc/chargeable, amc_contract, warranty, assigned_tech, rating, status)
- ticket_events(at, actor, kind comment/status/assign, from/to status, body) — timeline and pause intervals
- service_requests(request_type installation/relocation/overhaul/upgrade, estimate, approval, ticket_id)
- technicians(employee unique, territory_ids, max_open_jobs, van_warehouse_id, home lat/lng, active)
  + technician_skills(skill_code, level 1–5)
- territories(code, name, pincode ranges / districts, parent)
- service_visits(ticket or amc_schedule, customer, site, technician, scheduled start/end, check-in/out
  time + lat/lng, travel_km, checklist template/result/pct, findings, action_taken, photos,
  signatory_name, signature_doc, signed_at, billable, report_pdf_doc, status)
- spare_issues + lines(issued/used/returned qty — used + returned ≤ issued — unit_cost, value,
  chargeable, stock_txn_ids)
- service_history = a VIEW (tickets, visits, spares, claims by serial / customer)
- amc_contracts(customer, coverage comprehensive/non-comprehensive, start, end, visit_frequency,
  contract_value, billing_frequency, service_item (SAC + GST from Phase 6), sla_policy, renewal_stage,
  renewed_from, approval, status)
  - amc_contract_assets(serial) — one active AMC per serial (daterange exclusion)
  - amc_visit_schedule(serial, due_date, visit, status) unique
  - amc_billing_schedule(period, amount, due, sales_invoice, status)
  - amc_revenue_schedule(period yyyy-mm, amount, journal) unique
- warranty_terms(item or category, months, start_basis invoice/delivery/installation,
  coverage parts/labour/both, exclusions)
- warranty_registrations(serial unique, customer, invoice ref, term, start, end (copied to serial),
  installation_date, status active/expired/void, void_reason)
- warranty_claims(warranty, ticket, customer, serial, claim/failure date, problem, eligibility_result,
  inspection_result, decision repair/replace/reject, replacement_serial, claim_cost, supplier,
  supplier GRN ref, supplier claim/settled amounts, approval, status)

## 5. Algorithms (packages/calc)
**CPM:**
- Topological sort (Kahn's algorithm); a cycle → PRJ_DEP_CYCLE.
- Forward pass: FS: ES_s ≥ EF_p + lag; SS: ES_s ≥ ES_p + lag; FF: EF_s ≥ EF_p + lag; SF: EF_s ≥ ES_p + lag.
  The backward pass mirrors it. Float = LS − ES; float 0 = critical.
- Example: A 3 d; B 2 d FS A; C 3 d SS A + 1; D 2 d FS B and FS C.
  - Forward: A 0–3, B 3–5, C 1–4, D 5–7.
  - C has float 1. Critical path **A–B–D**, 7 days.
- Baseline variance = planned end − baseline end.

**EVM:**
- PV = planned value (linear across working days); EV = Σ budget × progress; AC = GL cost by project_id.
- Example: BAC 10,00,000; PV 4,00,000; EV 3,00,000; AC 3,60,000
  → CV −60,000; SV −1,00,000; CPI 0.8333; SPI 0.75; EAC 12,00,000; ETC 8,40,000; VAC −2,00,000;
    TCPI 1.0938.
- Health: red if CPI or SPI < 0.85; amber if < 0.95.
- Committed = open project PO lines − received.

**Profitability:** one SQL over gl_entries where project_id = X, grouped by account class.
Margin % = contribution / revenue ("—" when revenue is 0). AMC uses amc_contract_id the same way.

**SLA timer** (business minutes Mon–Fri 09:00–18:00 IST + holidays; pauses from ticket_events):
- due = add business minutes(created, target + paused). Warning at 75 % elapsed.
- Priority = clamp(impact + urgency − 1, 1, 4).
- Example: P2, response 2 h / resolution 8 h, created Friday 16:30.
  - Response due Monday 09:30.
  - Resolution due Monday 15:30 + 2 h paused (Awaiting Customer) → **Monday 17:30**.
  - Resolved at 17:10 → met.

**Auto-assignment:**
- Candidates: matching skill and level, territory covers the pincode, not on leave.
- Score = 0.5 × (level / 5) + 0.3 × (1 − open jobs / max) + 0.2 × proximity (same territory 1, parent 0.5).
  Ties → fewer open jobs, then lower employee code.
- Example: T1 0.80, T2 0.75, T3 0.70 → **T1**. No candidate → "Unassigned" queue + notify the manager.

**AMC visits** (daily job amc.generate-visits, 02:00):
- Due dates from the start date every 1 / 3 / 6 months up to the end date, within a 60-day horizon.
- A holiday moves the visit to the next working day. ON CONFLICT DO NOTHING.
- A draft visit is created 7 days ahead.
- Example: 1-Apr-2026 to 31-Mar-2027, quarterly → 1-Apr, 1-Jul, 1-Oct, 1-Jan.

**Other jobs:** amc.renewal-reminders (60 / 30 / 7 days), amc.billing-due, amc.recognise-revenue
(monthly on the 1st, unique per contract + period), sla.tick (every 5 min), warranty.expiry-alerts,
project.evm-snapshot (weekly).

**AMC revenue:**
- Daily straight-line: each month = days × value / total days, rounded to 2 decimals; the last month
  takes the remainder.
- Examples: ₹1,20,000 over 365 days → April 9,863.01 … exact total; a 15-Apr start → April 5,260.27.

**Warranty check:**
1. The serial exists with a sales reference (else NOT_SOLD).
2. An active registration exists.
3. start ≤ failure date ≤ end.
4. No exclusion flagged.
5. Same customer, or a recorded transfer.
- Result: IN_WARRANTY / AMC_COVERED / OUT_OF_WARRANTY / CONDITIONAL, with reasons.
- End = start basis + months − 1 day (e.g. 10-Jan-2026 + 18 months → 09-Jul-2027).
- Back-to-back: the failed component's GRN batch/serial gives the supplier and their warranty; if still
  valid, a supplier claim is raised.

**GL journals** (account codes from posting rules):
| Event | Journal |
|---|---|
| Timesheet approved, 6 h × ₹450 | Dr Project Labour Cost 2,700 [project] / Cr Labour Cost Absorbed 2,700 |
| Project expense, travel 4,000 + GST 720 | Dr Travel 4,000 [project], Dr Input CGST 360, Dr Input SGST 360 / Cr EMPLOYEE_PAYABLE 4,720 |
| Material to project | Dr Project Material 18,000 / Cr Inventory 18,000 |
| Warranty spares, 2 × 1,250 | Dr Warranty Cost 2,500 / Cr Inventory 2,500 (AMC → AMC Service Cost [amc]; chargeable → Cost of Service) |
| AMC quarterly bill | Dr Customer 35,400 / Cr AMC Deferred Revenue 30,000 [amc], Cr Output CGST 2,700, Cr Output SGST 2,700 |
| Monthly recognition | Dr AMC Deferred Revenue 9,863.01 / Cr AMC Service Revenue 9,863.01 [amc] |
| Supplier accepts a claim | Dr Supplier Claim Receivable 2,500 / Cr Warranty Cost Recovery 2,500 |

## 6. API (/api/v1)
- **Projects:**
  - projects CRUD (+ plan | activate | hold | complete | close | set-baseline)
  - GET /projects/:id/gantt | critical-path | evm | profitability | health
- **Tasks:** tasks CRUD; PATCH /tasks/:id/move; /tasks/:id/dependencies; /tasks/:id/progress
- **Milestones:** milestones CRUD (+ achieve | accept | invoice)
- **Team:** project-team CRUD; GET /project-team/availability
- **Timesheets / expenses / budgets:**
  - timesheets (+ submit | approve | reject | reverse; GET /timesheets/approval-queue)
  - project-expenses (+ submit | approve | reject | reverse)
  - project-budgets (+ submit | approve | revise); GET /projects/:id/budget-vs-actual
- **Tickets:** tickets (+ assign | auto-assign | respond | pause | resume | resolve | close | reopen | comment;
  GET /tickets/:id/entitlement)
- **Requests:** service-requests (+ estimate | approve | convert-to-ticket)
- **Technicians:** technicians (+ /skills; GET /technicians/board?date)
- **Visits:** visits (+ start-travel | check-in | check-out | checklist | photos | sign | complete; GET /visits/:id/report.pdf)
- **Spares:** spare-issues (+ issue | consume | return)
- **History:** service-history?serial=&customer=
- **AMC:** amc-contracts (+ submit | approve | activate | terminate | renew | generate-visits;
  GET schedule | billing | revenue | profitability | contract.pdf)
- **Warranty:** warranties; GET /warranties/check?serial=&date=
- **Claims:** warranty-claims (+ submit | inspect | approve | reject | claim-supplier | settle)
- **Import / export:** via the Phase 4 wizard.

## 7. UI
- **Kanban:** WIP limits per column (amber header when over); cards show owner, due date (red when
  overdue) and hours.
- **Gantt:** SVG bars by day/week/month, dependency arrows, critical bars in red, baseline ghost bars,
  today line. Dragging reschedules successors after confirming.
- **Timesheet:** week grid; > 24 h a day is blocked; bulk approve in the approver inbox.
- **Profitability:** every amount drills down to journal lines.
- **Service desk:** SLA chips (green / amber / red + countdown); entitlement banner; timeline.
- **Technician board:** lanes per technician; drag a ticket to assign.
- **Mobile /m/visits:**
  1. Today's list → Start Travel → Check-in (GPS; warning if > 500 m from the site).
  2. Checklist → parts from van stock → photos → findings.
  3. Customer signature on a canvas → Check-out → PDF report emailed.
  - Offline drafts are kept in IndexedDB and synced with an Idempotency-Key.
- **AMC:** coverage, visit calendar, renewal board, billing, profitability.
- **Warranty:** a serial lookup shows the eligibility card with reasons.

## 8. Messages
| Code | Message |
|---|---|
| PRJ_DATES | "End date cannot be before start date." |
| PRJ_DEP_CYCLE | "This dependency creates a loop: A → B → A." |
| PRJ_CLOSED | "Project PRJ-… is closed; reopen it to book cost." |
| PRJ_BUDGET_NONE | "Approve a budget before activating." |
| PRJ_OVER_BUDGET | "Travel budget left ₹x; this expense is ₹y." (warning; blocks in hard-stop mode) |
| TS_DAY_HRS | "Hours on 03-11 exceed 24." |
| TS_NOT_MEMBER | "You are not on project PRJ-… for that date." |
| TS_NO_RATE | "No cost rate for employee E-…; ask HR." |
| TKT_NO_ASSET | "Select the equipment serial." |
| SLA_NO_POLICY | "No SLA policy for P2; set one in settings." |
| VIS_GEO_FAR | Warning; a reason is required |
| VIS_SIGN_REQ | "Customer signature required." |
| SPI_QTY | "Used + returned (5) exceeds issued (4)." |
| AMC_OVERLAP | "Serial S-… already covered by AMC-… till dd-mm-yyyy." |
| WCL_INELIGIBLE | "Out of warranty since dd-mm-yyyy." |
| POSTED_LOCK | "Posted documents cannot be edited; reverse instead." |

## 9. Audit & notifications
- **Audit:** every change and posting; GPS and signature captures.
- **Notifications:**
  - task assigned / overdue;
  - timesheet decisions;
  - budget approval due; expense over budget;
  - ticket created (customer email); ticket assigned (technician);
  - SLA warning at 75 % and breach;
  - visit reminder the day before;
  - AMC renewal at 60 / 30 / 7 days; AMC bill raised;
  - warranty expiring in 30 days;
  - claim decided; supplier claim older than 30 days.

## 10. Tests
- **Unit:** CPM example + all 4 dependency types with lags; cycle; EVM to 4 decimals; SLA example incl.
  holiday, overnight pause and after-hours creation; priority matrix; AMC revenue (365 days, mid-month,
  leap year 2028); warranty end dates (month end, 29 Feb); dispatch scoring.
- **Integration:** timesheet → journal with project_id; spare issue/return; AMC bill + 12
  recognitions → deferred balance 0; visit generation run twice → no duplicates; overlapping AMC
  rejected; 412; idempotent replay.
- **E2E:** Kanban drag; Gantt dependency; mobile visit → signature → PDF; ticket to resolution within
  SLA; warranty claim to supplier settlement.
- 3 clean runs.

## 11. Acceptance
- [ ] A 10-task project shows the correct critical path.
- [ ] Costs show in budget-vs-actual and profitability, equal to the GL filtered by project.
- [ ] EVM matches a hand calculation; SLA breach fires on time.
- [ ] Auto-assignment picks the expected technician.
- [ ] A mobile visit produces a PDF with photos and signature.
- [ ] AMC visits, bills and revenue work, and deferred revenue reaches 0.
- [ ] The warranty check is correct at end date ± 1 day.
- [ ] No invented values anywhere.

## 12. Out of scope
Resource levelling, multi-currency, percentage-of-completion revenue, warranty provisioning, customer
portal, maps / route optimisation, IoT, MS Project import.

## 13. Owner check
1. Can't activate a project without an approved budget?
2. Tasks A–D: A, B and D shown red?
3. 6 h timesheet approved → ₹2,700 labour cost?
4. P2 ticket Friday 16:30 with a 2 h pause → "due Monday 17:30"?
5. Phone visit → PDF with signature?
6. ₹1,20,000 quarterly AMC → 4 visits and 4 bills of ₹30,000 + GST?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md (R-01..R-24), ERRATA.md (E-20, E-25), PHASE-17.md,
Phase 3–16 code as built. Migration <ts>_phase17_projects_service: all §4 tables + project_id and
amc_contract_id on journal_lines AND gl_entries. packages/calc: CPM, EVM, SLA business minutes, priority
matrix, dispatch scoring, AMC revenue — §5 examples as tests. Use NumberingService, lifecycle,
DocumentService, PdfService, import, board/calendar kits, ApprovalService, NotificationService,
customers/items/tax, PostingService (accounts from posting rules), StockService/serial_numbers,
project_id on purchases, sales invoices, employees/rates. pg-boss jobs §5, idempotent. 20 pages in
index.html look + Kanban drag-drop + Gantt + mobile visit view. No demo data; computed fields derived.
Tests §10, 3 clean runs. Migrations local dev/test only (R-16). Never push; commit only if asked.
Write PHASE-17-REPORT.md.
