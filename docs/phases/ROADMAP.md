## 0. Source of truth (in this order)
1. docs/phases/STANDARDS.md        — rules for ALL code
2. docs/phases/PHASE-XX.md         — the phase being built
3. docs/phases/ROADMAP.md          — this file (decisions in §3 win over old docs)
4. index.html (repo root)          — the look and the screens the client approved. Read-only.
Everything in docs/plan/, docs/plans/, PLAN.md is ARCHIVE (reference only). If it disagrees
with a phase file, the phase file wins.

## 1. The product in one paragraph
A web ERP for Sawant Group (Ready Hand): one company, 3 units (Unit 1 Talwade, Unit 2
Sawardari, Unit 3 Varale), 11 departments, 22 menu families, 248 pages. It must look and flow
like index.html (login, dark sidebar, top bar with Unit/FY, department dashboards, module pages
with tabs, register tables, drawers, modals, letterhead PDFs, payslip). Unlike index.html,
every button does real, saved, permission-checked, audited work on the server.

## 2. Phases (build strictly in this order; a phase starts only when the previous is ACCEPTED)
| #  | Phase | Main pages / outcome | Depends on | Status of existing code |
|----|-------|----------------------|------------|-------------------------|
| 0  | Foundation reset & standards | docs, gitignore, scripts, baseline report. No features | — | new |
| 1  | Identity hardening | login, sessions, password policy, lockout, admin reset, my sessions | 0 | ~90% built → verify + close gaps |
| 2  | Roles & access v2 | editable roles (9), multi-department users, permission matrix, data scopes incl. UNIT | 1 | rework (roles are a fixed enum today) |
| 3  | Organisation masters | company, units, departments, designations, FY + periods, numbering series, letterhead, settings, currency, UOM | 2 | ~60% built |
| 4  | Generic engine v2 + documents + print | generic CRUD fixes, attachments service, PDF service (₹ + Hindi font), Excel import/export, record lock rules | 3 | rework of Phase 4 code |
| 5  | Approval engine + notifications | approval matrix, requests, SoD, limits, delegation, SLA escalation, bell + Notification Center, My Approvals | 4 | NOT built |
| 6  | Shared business masters | customers, suppliers, items (move here), HSN/SAC, GST rates, price lists base, payment terms, banks | 5 | items built; rest new |
| 6B | Format & Settings engine (client requirement) | versioned formats, customer-wise layouts, rule sets / formulas from data or Excel, Department-Head-only Settings panel, dynamic cascade; no hard-coded formulas | 6 | NOT built |
| 7  | Finance core | chart of accounts, journals, GL, cash/bank book, cost/profit centres, period close, trial balance, P&L, BS, posting-rules engine | 6 | NOT built |
| 8  | Inventory & WMS v2 | vouchers WITH LINES, batch/serial, bins, transfers, adjustments, reconciliation, valuation → GL, reorder, ageing | 7 | rework of Phase "5" inventory |
| 9  | Procurement / SCM | PR → RFQ → quotes → comparison → PO → GRN → purchase invoice (3-way match), supplier evaluation, contracts | 8 | NOT built |
| 10 | CRM & Sales | leads → opportunities → pipeline kanban → quotation → SO → reservation → delivery → dispatch → invoice → collection, credit limits, returns | 8 | NOT built |
| 11 | Indian Taxation | GST setup, GSTR-1 / 3B data, HSN summary, e-invoice JSON, e-way bill JSON, TDS/TCS registers | 9, 10 | NOT built. **Carry-over from Phase 7: see PHASE-11.md section A** (GST returns, e-invoice, e-way bill, GSTR-2B/ITC matching, TDS/TCS return files); Phase 7 already built the sales/purchase/TDS registers and challans |
| 12 | Quality / QMS | inspection plans, incoming (GRN), in-process, final, NCR, CAPA, 5-Why, calibration, client forms | 9 | NOT built |
| 13 | Manufacturing | BOM, routing, work centres, production plan/orders, MRP, work orders, WIP, FG receipt, scrap, rework, costing, shop floor | 8, 12 | NOT built |
| 14 | Maintenance & Assets | machines, PM, breakdown, maintenance WOs, spares, downtime, MTBF/MTTR, asset register, capitalisation, depreciation, disposal, QR | 7, 8 | NOT built |
| 15 | HRMS | employees, recruitment, onboarding, attendance, shifts, leave, expenses, training, performance, exit, ESS, documents | 5 | NOT built |
| 16 | Payroll | salary structures, payroll run, PF/ESIC/PT/LWF/TDS, OT, bonus, loans, payslip PDF, bank file, register, journal to GL | 7, 15 | NOT built |
| 17 | Projects & Service | projects, tasks, milestones, timesheets, budget, Gantt/Kanban, profitability; tickets, AMC, warranty, visits, claims | 10, 15 | NOT built |
| 18 | Logistics, Fleet, Gate, DMS | transporters, routes, shipments, POD, vehicles, drivers, fuel, gate passes, containers; DMS folders/versions/permissions | 10, 4 | NOT built |
| 19 | Dashboards, BI, AI & Communication | 11 department dashboards with real KPIs, Command Center, Report Builder, schedules, AI Copilot (Claude API, role-aware), automation rules, email/WhatsApp/SMS adapters, webhooks | all | NOT built |
| 20 | Hardening & go-live | performance, security review, backups, monitoring, data import of opening balances, UAT, user guide, Hindi UI, accessibility | all | NOT built |

Every phase is deployable on its own. A failing phase never breaks an accepted one
(each phase has its own migrations, modules, tests and feature flag).

## 3. Architect rulings (binding; they settle every conflict found in the review)
| ID | Ruling |
|----|--------|
| R-01 | ONE company. No company_id anywhere (keeps D-01). The `companies` table holds the legal entity only. |
| R-02 | "Branch" in index.html = **Unit** in the code. Units: TAL (Talwade), SAW (Sawardari), VAR (Varale). |
| R-03 | Roles become an editable `roles` table (Phase 2). Seed 9 roles: Super User 99, Administrator 95, Director 90, CFO 80, General Manager 70, Department Head 60, Department Manager 50, Supervisor 30, Employee 10. Existing enum maps: SUPER_ADMIN→SUPER_USER, ADMIN→ADMINISTRATOR, MANAGER→DEPT_MANAGER, LEAD→SUPERVISOR, MEMBER→EMPLOYEE. |
| R-04 | A user has ONE home department and MAY be granted extra departments (`user_departments`). Units stay in `user_units`. |
| R-05 | Data scopes: OWN, DEPARTMENT, UNIT, ALL. |
| R-06 | The approval engine (Phase 5) is generic and built BEFORE any business module. Every business document submits through it. Nobody can set "Approved" by hand. |
| R-07 | Finance core (Phase 7) is built BEFORE Inventory v2, Purchase and Sales, so every stock and money movement posts a journal from day one. Success rule: stock value = GL inventory balance, trial balance always balances. |
| R-08 | Every transaction document = header table + line table. No single-item vouchers. The current single-item stock_vouchers are migrated in Phase 8. |
| R-09 | Posted documents are never edited or deleted. They are cancelled by a reversal (stock and GL). |
| R-10 | Infrastructure v1: PostgreSQL 16 only (no Redis). Jobs: pg-boss (Postgres). Files: local disk behind a StorageService interface (S3 later). PDF: server-side pdfkit + Noto Sans / Noto Sans Devanagari. Excel: exceljs. Email: SMTP. API runs as ONE process (pm2 fork mode, instances 1) until Phase 20 moves rate-limits/caches to Postgres. |
| R-11 | Statutory numbers (GST, TDS, PF, ESIC, PT, LWF, gratuity, depreciation rates) are DATA rows with effective dates, never constants. The phase file gives the verified starting values and the source. |
| R-12 | v1 makes no live calls to government portals (GSTN, IRP, e-way bill, EPFO, ESIC, TRACES). It produces the upload JSON/files; numbers like IRN are entered back. Adapters are interfaces for later. |
| R-13 | No demo data in production. A separate dev seeder may load prototype-style demo rows (DEV only, refuses to run when NODE_ENV=production). |
| R-14 | The client's files in `doc from clint/` are confidential: git-ignored, never pasted into web tools. Phases use only their structure. |
| R-15 | Dashboards and KPIs show only numbers computed from real data. No hash-generated, random or hard-coded numbers (index.html did this; we do not). When there is no data, show "No data yet" with what to do. |
| R-16 | **No hard-coded formulas or layouts** (client directive). Margins, process costs, tolerances, norms and document formats are data (Phase 6B): versioned, audited, editable only by the owner Department Head (and Administrator). Phases 7–13 read them; they never put them in code. |
| R-17 | The client's quality / production forms (incoming, in-process, pre-dispatch, ISIR, welding, VT, 8D, quality alert, rejection register, MOM, continuous improvement) are **templates on one inspection engine** (Phase 12) using Phase 6B formats, not separate modules. |
| R-18 | Customer-supplied material and rework against a customer challan (job work) is a real client need; placement is decided by the owner (ERRATA E-32). |


R-29 RHAI_ERP_V40_Edit_Update_Fixed.html is the reference for pages, tabs, fields, buttons and look.
     Page ids stay exactly as in V40. Demo-only V40 parts (passwords in the browser, localStorage data,
     demo account list, auto-forward) are not copied; the same screen runs on server rules.
R-30 LOGIN DOES NOT CHANGE. It keeps the current screen and flow: Email / User ID, Password, Show,
     Forgot password, MFA step, first-login password change.
     No Sign-Up, no Request Access, no department dropdown on login. Users are created only by Admin.
R-31 A movement is not an approval. Every movement is clicked by a person; the Workflow Matrix only
     suggests the next department; nothing moves on its own.
R-32 Every page uses the universal ActionBar. The server says which actions are allowed:
     - no permission → the button is hidden;
     - the record's state blocks it → the button is greyed, with the reason on hover.
R-33 Contract-labour statutory values are dated rows with needs_review (OSH Code 2020 replaced the
     CLRA Act from 21-Nov-2025).
R-34 Owner = Super User. "View as" is read-only and audited. The Owner can't approve their own request
     or skip approval levels.
R-35 Build order: 22 → 32. Every phase must be deployable on its own: forward-only migrations, and
     feature flags for anything half-built.
R-36 The 12 departments of V40 are data rows, not code: Administration, Sales, Projects, Engineering,
     Purchase, Warehouse, Production, Quality, Finance, Service, Maintenance, HR.
R-37 PLANT ACCESS (new). Each user gets plants (units) by checkbox: one, two, or all of
     TAL / SAW / VAR (and any added later), plus one Default plant.
     - Users with one plant always work in that plant.
     - Users with more plants choose which plants to view after login and from the top bar:
       one, two or all of their plants.
     - Lists, dashboards and reports show the combined data of the chosen plants.
     - Creating or posting a document always needs exactly ONE plant (picked in the form).
     - The server never shows a plant that is not ticked on the user.
R-38 PERSONAL WORKSPACE (new). Every user has their own Menu page, Home and "My Dashboard", built from
     their role, departments, plants and their own data. Users can pin, hide and reorder.
R-39 AUTOMATION (new): mail automation and attendance automation are standard features, controlled
     by Admin from screens (on/off, timing, recipients, templates).
R-40 TESTING THROUGH THE SCREENS (new). Every phase ships Playwright "feeders" that type data in
     through the real screens as real roles, and "flow tests" that run each user journey.
     Phase 32 feeds a full company dataset through the screens and runs every journey.
     No test data is ever written straight into the database (except the empty-DB migrations).
R-41 CLIENT DOCUMENTS (new). After every phase the builder updates:
     - docs/clicntmassage.md — the message you send to the client: what's new + what's ready +
       how to test;
     - docs/client-test-guide.md — the full, cumulative test book by role.
     Logins are always written as <id>/<password> placeholders.



## 4. Client requirement map (documents received 2026-11-06)
Flow RFQ → Quotation → SO → MRP → PR → PO → GRN → Inbound QA → Production → IPQC → Final QA → FG → Dispatch → Invoice → Payment.
| Need | Phase |
|---|---|
| Supplier type MATERIAL / CONTRACTOR; customer price template; item alternate codes; Excel import of masters | 6 |
| Format & Settings engine, customer-wise formats, Department-Head-only Settings | 6B |
| Powder stock monitoring sheet; Quality Inspection stock status; batch / expiry | 8 |
| PO delivery tracking (Delayed); vendor quotation costing; vendor invoice; GRN creates inspection lot | 9 |
| Internal RFQ review; customer-wise quotation; dispatch list; delivery challan | 10 |
| GST on vendor and sales invoices | 11 |
| Inspection forms, 8D, quality alert, registers, PPM / quality cost, instruments + calibration, MOM, CI | 12 |
| MRP, in-process checkpoints, FG after Usage Decision, daily board, job work | 13 |
| Gate pass / vehicle on challan | 18 |
| Project-isolated email + sent log; requirements matrix; quality dashboards | 19 |
Already built in Phase 5 and reusable: approval routing, inbox (Approval Center), notifications, email outbox.
