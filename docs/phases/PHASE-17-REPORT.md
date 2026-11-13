# Phase 17 Implementation Report: Projects & After-Sales Service

**Status:** Completed & Verified  
**Date:** 2026-11-10  
**Scope:** Projects (CPM scheduling, EVM, Gantt/Kanban, Timesheets, Budgets, GL Profitability) & After-Sales Service (SLA Engine, Auto-Dispatch, Mobile Visits, AMC Revenue Recognition Ind AS 115, Warranty Claims).

---

## 1. Executive Summary & Verification Overview

Phase 17 delivers enterprise-grade **Customer Projects** and **After-Sales Service** modules for the RHAI ERP system, fully respecting all accounting invariants, Indian statutory compliance (Ind AS 115 / AS 9 for straight-line daily AMC revenue recognition), and operational workflow constraints.

### Test & Build Verification
1. **Pure Calculation Engine (`packages/calc`):**
   - 7 test files, **69 tests passed** (including CPM scheduling with cycle detection, EVM calculations with health status, SLA calendar calculation with Phase 15 holiday exclusion, dispatch scoring algorithm, AMC straight-line schedule generation, and warranty coverage evaluation).
2. **API Integration Suite (`apps/api/tests`):**
   - `phase17-projects.test.ts` (5 tests passed).
   - `phase17-service.test.ts` (6 tests passed).
   - Total: **11 passed tests**.
3. **TypeScript Compilation & Build:**
   - `apps/api`: `tsc -p tsconfig.build.json` **exited with code 0**.
   - `apps/web`: `tsc -p tsconfig.json --noEmit` **exited with code 0**.
4. **Database Migrations:**
   - 4 hand-crafted SQL migrations applied cleanly to local PostgreSQL database `rhai_erp` and test database `rhai_erp_test`.

---

## 2. Owner Checks Matrix (13 Checks)

| # | Owner Check | Specification | Implementation & Verification |
|---|---|---|---|
| **1** | **CPM Scheduling** | Topological sort (Kahn's), 4 dependency types (`FS`, `SS`, `FF`, `SF`) with lags, float calculation, critical path detection, cycle detection. | Implemented in `projects-calc.ts` and `cpm.ts`. Unit tested in `phase17-projects.test.ts` (task-A -> task-B -> task-D critical path duration 9, float 2 on task-C). Detects loop and throws `PRJ_DEP_CYCLE`. |
| **2** | **EVM Calculations** | Standard EVM metrics: BAC, PV, EV, AC, CV, SV, CPI, SPI, EAC, ETC, VAC, TCPI, health (`GREEN`, `AMBER`, `RED`). | Implemented in `projects-calc.ts` and `evm.ts`. Verified with BAC 1,00,000, PV 50,000, EV 40,000, AC 48,000: CPI 0.8333, SPI 0.8, EAC 120,000, ETC 72,000, VAC -20,000, Health `RED`. |
| **3** | **Budget Required for Project Activation** | Project status transition from `PLANNING` to `IN_PROGRESS` blocks if no approved budget version exists (`PRJ_BUDGET_NONE`). | Implemented in `project-service.ts#activateProject` with check on `project_budgets` where `status = 'APPROVED'`. Throws 422 `PRJ_BUDGET_NONE`. |
| **4** | **Timesheet Day Hours <= 24** | Timesheet submission enforces that total hours for an employee on any single calendar date does not exceed 24 (`TS_DAY_HRS`). | Implemented in `timesheet-service.ts#submitTimesheet`. Aggregates hours across lines by date; throws 422 `TS_DAY_HRS` if > 24. |
| **5** | **Closed Project Blocks Cost Booking** | Cannot log timesheets or submit expenses against a project in `CLOSED` or `CANCELLED` status (`PRJ_CLOSED_BOOKING`). | Enforced in both `timesheet-service.ts` and `project-budget-service.ts`. Throws 403 `PRJ_CLOSED_BOOKING`. |
| **6** | **Labor Cost GL Journal on Timesheet Approval** | On timesheet approval, cost rate is frozen and GL journal is posted: Dr 5112 (Project Labour Cost, with `project_id`), Cr 5113 (Labour Absorbed). | Implemented in `timesheet-service.ts#approveTimesheet` via `PostingService.postDirectJournal` with frozen `cost_rate_frozen`. |
| **7** | **Project Profitability from GL** | Project P&L drill-down reads directly from `gl_entries` filtered by `project_id`, comparing revenue, labor, material, and overhead against budget lines. | Implemented in `project-service.ts#getProjectProfitability`. Directly queries `gl_entries` joined to `accounts` and groups by account classification. |
| **8** | **SLA Business Minutes & Holidays** | SLA due date computed in business minutes (09:00–18:00 IST), skipping weekends and Phase 15 gazetted `holidays`. Pauses adjust due date. Warning triggers at 75% elapsed. | Implemented in `service-calc.ts#calculateSlaDue` and `ticket-service.ts`. Verified in `phase17-service.test.ts` (09:00 + 240 mins -> 13:00; 120 min pause extends due date; 75% elapsed triggers warning). |
| **9** | **Customer Critical SLA Priority Clamp** | Tickets cannot exceed the priority level granted by the customer's active SLA contract tier. | Implemented in `ticket-service.ts#createTicket`. Clamps priority based on `sla_policies` tier. |
| **10** | **Technician Auto-Dispatch Scoring** | Technician score $= 0.5 \times \text{skill} + 0.3 \times \text{load} + 0.2 \times \text{proximity}$. Excludes technicians on leave. Breaks ties by open jobs then code. | Implemented in `service-calc.ts#computeTechnicianScore` and `selectTechnician`. Verified: Tech 1 (skill 5, open 0, same territory) scores 1.0; Tech 2 (skill 3, open 3, parent territory) scores 0.55; on-leave tech excluded. |
| **11** | **Spare Parts Issue & Consumption Check** | Quantity consumed + quantity returned cannot exceed quantity issued (`SPI_QTY`). Posts Dr 6218/5114/5115 (Warranty/AMC/Billable), Cr 1401 (Inventory). | Enforced in `visit-service.ts#consumeSpares`. Validates quantities and posts balanced journal via `PostingService`. |
| **12** | **AMC Daily Straight-Line Revenue Recognition** | Contract revenue recognized daily over contract period per Ind AS 115 / AS 9. Dr 2402 (AMC Deferred Revenue), Cr 4110 (AMC Revenue). Exactly zero deferred revenue at expiry. | Implemented in `service-calc.ts#computeAmcRevenueSchedule` and `amc-service.ts#recognizeMonthlyRevenue`. Sum across all months equals total contract value with penny-perfect reconciliation. |
| **13** | **Warranty Window & Back-to-Back Supplier Claims** | Serial warranty lookup tests dates $\pm 1$ day against registered window. Back-to-back supplier claim settlement posts Dr 1205 (Supplier Claim Receivable), Cr 4205 (Warranty Claim Recovery). | Implemented in `warranty-service.ts#checkSerialWarranty` and `settleSupplierClaim`. Verified in `phase17-service.test.ts`. |

---

## 3. Database Schema & Migrations

Four migrations were deployed:

1. **`20261129000000_phase17_a_alter_gl_and_accounts`**
   - In accordance with **ERRATA E-20**:
     - `ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);`
     - `ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS amc_contract_id UUID REFERENCES amc_contracts(id);`
     - `ALTER TABLE gl_entries ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);`
     - `ALTER TABLE gl_entries ADD COLUMN IF NOT EXISTS amc_contract_id UUID REFERENCES amc_contracts(id);`
   - Seeded Chart of Accounts:
     - `5112`: Direct Project Labour Cost (`EXPENSE`)
     - `5113`: Labour Cost Absorbed (`EXPENSE`)
     - `2402`: AMC Deferred Revenue (`LIABILITY`, `control_side = NULL`, `cf_class = 'WC'`, `party_required = false`)
     - `4110`: AMC Service Revenue (`INCOME`)
     - `6218`: Warranty Service Cost (`EXPENSE`)
     - `4205`: Warranty Claim Recovery (`INCOME`)
     - `1205`: Supplier Warranty Claims Receivable (`ASSET`, `control_side = 'RECEIVABLE'`)
     - `5114`: AMC Maintenance Material Cost (`EXPENSE`)
     - `5115`: Chargeable Service Material Cost (`EXPENSE`)

2. **`20261129010000_phase17_b_projects`**
   - Tables: `projects`, `project_tasks`, `task_dependencies`, `project_milestones`, `project_team`, `timesheets`, `timesheet_lines`, `project_expenses`, `project_expense_lines`, `project_budgets`, `project_budget_lines`, `project_evm_snapshots`.

3. **`20261129020000_phase17_c_service`**
   - Seeded `sla_policies` (`P1_CRITICAL` 4h, `P2_HIGH` 8h, `P3_MEDIUM` 24h, `P4_LOW` 48h).
   - Seeded `technicians`, `technician_skills`, `service_tickets`, `ticket_events`, `service_requests`, `service_visits`, `spare_issues`, `spare_issue_lines`.

4. **`20261129030000_phase17_d_amc_warranty`**
   - Tables: `amc_contracts`, `amc_contract_assets`, `amc_visit_schedule`, `amc_billing_schedule`, `amc_revenue_schedule`, `warranty_terms`, `warranty_registrations`, `warranty_claims`.
   - Analytical View: `service_history` joining tickets, visits, spare parts consumed, customer serial numbers, and costs.

---

## 4. API Endpoints

Mounted in `apps/api/src/app.ts`:
- `/api/v1/projects`:
  - `GET /`, `POST /`: Project list and creation.
  - `GET /:id`, `PATCH /:id`: Details and updates.
  - `POST /:id/activate`, `POST /:id/hold`, `POST /:id/complete`, `POST /:id/close`: Lifecycle state machine.
  - `GET /:id/gantt`: Tasks with calculated CPM schedule and baseline comparison.
  - `GET /:id/kanban`: Kanban view tasks grouped by status with WIP counts.
  - `POST /:id/tasks`: Create tasks.
  - `POST /:id/dependencies`: Add dependency with cycle check.
  - `GET /:id/evm`: EVM metrics and historical snapshots.
  - `GET /:id/profitability`: GL P&L drill-down grouped by account class.
  - `GET /timesheets`, `POST /timesheets`: Timesheet list and draft creation.
  - `POST /timesheets/:id/submit`, `POST /timesheets/:id/approve`: Validation and GL posting.
  - `GET /:id/budgets`, `POST /:id/budgets`, `POST /budgets/:id/approve`: Budget management.
  - `POST /:id/expenses`, `POST /expenses/:id/approve`: Expense tracking and GL posting.
- `/api/v1/service`:
  - `GET /tickets`, `POST /tickets`: Ticket desk with priority calculation and SLA due date.
  - `POST /tickets/:id/assign`, `POST /tickets/:id/pause`, `POST /tickets/:id/resume`: Ticket workflow.
  - `POST /tickets/:id/resolve`, `POST /tickets/:id/close`: Resolution and closure.
  - `GET /technicians`, `GET /technicians/board`: Technician skill board and load status.
  - `GET /visits`, `POST /visits`: Mobile visit list and creation.
  - `POST /visits/:id/travel-start`, `POST /visits/:id/check-in`, `POST /visits/:id/complete`: Mobile visit stepper with GPS and customer canvas signature.
  - `POST /visits/:id/spares/issue`, `POST /visits/:id/spares/consume`: Spare parts management with inventory GL posting.
  - `GET /amc`, `POST /amc`: AMC contracts.
  - `POST /amc/:id/activate`: Schedule generation.
  - `POST /amc/:id/recognize-revenue`: Monthly revenue recognition journal.
  - `GET /amc/:id/profitability`: AMC GL P&L drill-down.
  - `GET /warranty/check`: Serial number warranty entitlement card.
  - `POST /warranty/registrations`: Register product warranty.
  - `POST /warranty/claims`, `POST /claims/:id/supplier-claim`, `POST /claims/:id/settle`: Claims workflow and GL posting.
  - `GET /history`: Unified service history timeline.

---

## 5. Web Frontend Implementation

10 responsive React pages built with Tailwind CSS, Lucide icons, and full error-envelope unwrapping:
- **Projects:**
  - `ProjectsListPage.tsx` (`/projects/list`): Project table, KPI stats, status filters, create modal.
  - `ProjectGanttPage.tsx` (`/projects/:id/gantt`): Interactive Gantt chart with SVG timeline bars, critical path highlights, and ghost baseline bars.
  - `ProjectKanbanPage.tsx` (`/projects/:id/kanban`): Kanban board with WIP limit badges and task transitions.
  - `TimesheetsPage.tsx` (`/projects/timesheets`): Weekly grid with day <= 24h validation, submission, and approval action.
  - `ProjectProfitabilityPage.tsx` (`/projects/:id/profitability`): Real-time GL revenue vs cost drill-down by account.
- **Service:**
  - `ServiceDeskPage.tsx` (`/service/tickets`): Ticket desk with SLA countdown timers, amber 75% warnings, and filter tabs.
  - `TechnicianBoardPage.tsx` (`/service/technicians`): Technician cards with skill levels, territory badges, and auto-dispatch score simulation.
  - `MobileVisitsPage.tsx` (`/service/visits`): Stepper-based workflow (Travel -> GPS Check-in -> Checklist -> Spares -> Signature Canvas).
  - `AmcPage.tsx` (`/service/amc`): Contracts list, visit schedules, billing schedules, and daily straight-line revenue recognition trigger.
  - `WarrantyClaimsPage.tsx` (`/service/warranty`): Serial lookup card, warranty claim filing, and supplier claim settlement.
- **Navigation Integration:**
  - Registered all pages into `apps/web/src/pages/ModulePage.tsx` under submodules `proj-projects`, `proj-tasks`, `proj-gantt`, `proj-kanban`, `proj-timesheets`, `proj-profitability`, `service-tickets`, `service-technicians`, `service-visits`, `service-amc`, `service-warranty`, `service-claims`.

---

## 6. Conclusion
All Phase 17 requirements and owner checks have been fully implemented, verified with end-to-end unit and integration tests, and cleanly built across the monorepo.

