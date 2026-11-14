# PHASE 33 — Full company fed through the screens (Playwright), every user journey tested, V40 same-to-same finish, beauty pass, final client sign-off

## 1. Goal
1. **Feed a complete, realistic company through the front end:** every master, every transaction and
   every flow, typed in by Playwright logged in as the right users in the right plants. Nothing is
   written straight into the database.
2. **Run every user journey** for every role and prove the numbers agree (stock = GL, trial balance
   balanced, AR/AP = control accounts, payroll = attendance).
3. **Prove the ERP matches V40** in pages, tabs, fields, buttons and look, and polish it to look
   beautiful.
4. **Final client documents** and close the Phase 20 go-live items.

## 2. Deliverables
- tests/feed/full/ — the master feed, ordered by feed-order.json across Phases 22–31
- tests/flows/journeys/ — journeys per role
- docs/PARITY.md (generated); docs/visual/ (git-ignored screenshots); docs/feed-report.html
  (git-ignored; Playwright HTML report with videos)
- Final clicntmassage.md and client-test-guide.md

## 3. Rules
- **Targets:** only a database named *_staging or *_e2e (guard in global setup); never prod (R-40).
- **Data:** fictitious companies, people and addresses (no real client names); Indian formats (valid
  GSTIN/PAN check digits, IFSC formats); deterministic seed.
- **Input path:** only through the UI. Two exceptions are allowed, as in real life:
  1. biometric punches through the device push endpoint (the real device path);
  2. bank statement and 2B files through their upload screens.
- **Volume tiers:**
  | Tier | Content | Time |
  |---|---|---|
  | SMOKE | 1 week | about 20 min |
  | FULL | 3 months across 3 plants | parallel workers, resumable checkpoints |
- **Idempotent and resumable:** every feeder checks "already exists" by a business key before creating;
  checkpoints in tests/feed/state.json (git-ignored).

## 4. Database
None (staging only). The old user_preferences.unit_id/all_units columns are dropped here (E-40) after
the full run proves nothing reads them.

## 5. The full feed (order and volumes, FULL tier)
| Step | Done by (role, plants) | Through screens | Volume |
|---|---|---|---|
| 1 Company setup | Super User | company, 3 plants (TAL/SAW/VAR), FY, departments (12), designations, letterheads, numbering | — |
| 2 Users | Administrator | users with plant checkboxes: 1-plant, 2-plant, 3-plant users across 9 roles, 12 departments | 60 users |
| 3 Approval matrix, workflow matrix, mail automations, attendance policies, devices, geo-sites | Admin, HR | settings screens | — |
| 4 Masters | Purchase/Sales/Stores/HR | customers 80, suppliers 60, items 400 (RM/FG/spares/consumables), BOMs 30 (3 levels), routings 30, work centres 20, warehouses/bins, price lists, HSN, payment terms, banks | — |
| 5 Employees | HR | employees 300 (staff + workers) with bank/statutory data, shifts, rosters, leave policies | 300 |
| 6 Contract labour | HR/EHS | 3 contractors, 3 work orders, 60 workers with onboarding | 60 |
| 7 Opening balances | Finance | opening TB, stock, AR/AP open items through the cut-over console | — |
| 8 CRM → Sales | Sales users per plant | 150 enquiries, 120 quotations, 90 SOs (multi-line), 10 product-development projects with gates | — |
| 9 Movements | each department | every SO through the 14-step chain with Received/Accepted/Move Forward; 5 % returns; 3 % short receipts | ~1,200 movements |
| 10 Purchase | Purchase | PRs from shortages, RFQs, 3 quotes each, comparisons, 200 POs, GRNs with QC hold, put-away, purchase invoices with 3-way match exceptions, payments | — |
| 11 Production | Production | MRP runs, 150 production orders, job cards on the tablet shop-floor screen, material issues, scrap, FG receipts, multi-plant routes with transfer notes | — |
| 12 Quality | Quality | incoming inspections (AQL), NCRs with dispositions, 8D, calibration, final QC, quality certificates | — |
| 13 Dispatch & billing | Warehouse/Finance | DCs, e-way bill entries, invoices (mail automations fire), receipts, credit notes | — |
| 14 Attendance | device simulator + ESS + managers | 3 months of punches for 300 employees + 60 workers; regularisations, OT approvals, leave | — |
| 15 Workplace | all | 400 tasks, daily handovers, 300 visitors, ~18,000 canteen scans | — |
| 16 Payroll | HR/Payroll | 3 monthly runs with approvals, payslips emailed, bank files | — |
| 17 Contract labour | HR/Finance | wage sheets, bills, compliance docs, 1 blocked payment, 2 approved | — |
| 18 Maintenance & assets | Maintenance/Accounts | breakdowns by QR, PM orders, spares, capitalisation, depreciation runs | — |
| 19 Projects & service | Projects/Service | 6 customer projects with timesheets; 80 tickets; 10 AMCs | — |
| 20 Logistics & gate | Security/Logistics | gate-in for GRNs, gate-out for DCs, returnable passes, fuel logs | — |
| 21 Tax | Finance | GSTR-1 build for 2 months, 2B upload and reconciliation, TDS challans | — |
| 22 Month close | Finance | bank reconciliation, period close, P&L, balance sheet | — |
| 23 Admin config | Admin | custom fields, form rules, a module off for VAR, data import, a duplicate merge | — |

## 6. Journeys (flows) with checks
| # | Journey | Role(s) | Key checks |
|---|---|---|---|
| J1 | Order to cash | Sales → … → Finance | 360° = 100 %; invoice PDF fields; customer emails sent; AR = 0 after receipt |
| J2 | Procure to pay | Purchase/Stores/Quality/Finance | 3-way match; GRIR = 0; MSME due; supplier reminder email |
| J3 | Plan to produce | Planner/Production/Quality | MRP suggestion pegs to the SO; OEE = hand calculation; WIP = 0 at close |
| J4 | Hire to retire | HR/Employee/Manager | attendance automation → payroll; payslip email; F&F |
| J5 | Contract labour month | HR/Finance | the wage example; a block, then a pass |
| J6 | Department movement | every department | 14 handovers stamped; a Return; SLA late alert |
| J7 | Product development | Sales/Projects/Engineering/Quality | gates G01–G06; dossier PDF |
| J8 | Visitor & gate | Security/Host | pass, inside, overstay alert, check-out |
| J9 | Maintenance | Operator/Maintenance | QR breakdown → work order → MTTR on the dashboard |
| J10 | Multi-plant owner | Owner | picker 1/2/3 plants; totals = sum; plant comparison |
| J11 | Plant security | 1-plant user | can't see or post in other plants (UI + crafted API calls) |
| J12 | Admin control | Admin | custom field in flows; module off; view-as read-only |
| J13 | Dashboards | each role | My Dashboard shows OWN data only; drill-down counts equal the lists |
| J14 | Month end | Finance | TB balanced; stock value = GL inventory; AR/AP = sub-ledgers; GST register = GSTR-1 |

**Global integrity checks after the feed:**
- trial balance Dr = Cr per plant;
- stock ledger value = GL inventory accounts;
- AR/AP control = open items;
- payroll paid days = locked attendance;
- every posted document has a movement/approval trail where required;
- no page error in the crawler on the fed data.

## 7. Same-to-same and beauty finish
**A. PARITY.md** (generated from registry v2 vs the built app): every V40 page → menu place, title, tabs
(order), fields (order), buttons → ✅ / ❌ / "Changed on purpose (R-29/R-30 reason)".
**Target: 100 % ✅ or a reason.**

**B. Visual compare:** V40 page vs ERP page at 1440×900 and 390×844 with similar data; layout regions
(header, sidebar, cards, table header, button bar) diff ≤ 3 % (data masked).

**C. Beauty pass:**
- spacing scale; Lucide icons; skeletons; empty-state line illustrations;
- 150 ms transitions; focus rings; chip colours;
- print CSS;
- a subtle animated gradient only on hero banners (respects reduced motion);
- the login screen is not changed (R-30).

**D. Friendly pass:**
- "?" help on every page (EN/HI);
- a first-login tour (Home → My Work → Menu → Inbox → ActionBar → Help);
- "What's new" panel from clicntmassage.md;
- Hindi strings for all new pages.

**E. Speed proof:** k6 on the FULL dataset — R2-3 budgets met; Lighthouse on Home, Menu, Inbox, an SO
and the Owner console.

**F. Quality proof:** crawler × 9 roles × plant combos on the FULL data: 0 errors; axe 0 serious;
ZAP 0 High on the new routes.

**G. Close Phase 20:** two-process e2e ×3, k6 report, secret rotation (owner steps), RDS + restore
drill, S3, CloudWatch alarm test, opening balances signed, UAT signed (packs from
client-test-guide.md), CA/HR needs_review sign-off, zero demo data on prod.

## 8. Messages
None new.

## 9. Audit
The feed runs as real users, so the audit trail looks like real use (useful for UAT).

## 10. Tests
This phase IS the test: feed (SMOKE every night, FULL weekly) + journeys J1–J14 + the global integrity
checks + crawler + k6 + axe + ZAP + visual + parity.

## 11. Acceptance
- [ ] FULL feed completes through the screens with 0 failures.
- [ ] J1–J14 green 3 times.
- [ ] Integrity checks green.
- [ ] PARITY 100 % or reasoned.
- [ ] Visual diffs pass.
- [ ] Speed/quality proofs.
- [ ] Phase 20 checklist closed (owner items listed with exact steps).
- [ ] Final client documents.

## 12. Out of scope
Production data loading (cut-over uses the Phase 20 opening-balance console with real data).

## 13. Owner check
Watch the feed video of J1 and J10 in the Playwright report. Then open V40 and the ERP side by side
for Home, Menu, Sales Orders, Department Inbox, 360°, Contract Workers and the Owner console. Do they
look like the same product?

## 14. Build prompt
~~~
Read …, PHASE-32.md, all feeders/flows from Phases 22–31, registry v2. Build the full feed (SMOKE +
FULL tiers, resumable, staging/e2e guard), journeys J1–J14, integrity checks, PARITY.md, visual
compare, beauty/friendly passes, speed/quality proofs; then list the Phase 20 owner steps. Zero-error
gate ×3. Local commit. Final report + final client documents.
~~~

## 15. Client documents (final)
**clicntmassage.md:** "The complete ERP is ready for your final testing. It has been filled with
3 months of sample company data, entered through the screens exactly as your staff will do it, so
every screen, report and dashboard has realistic numbers. Same screens as the approved design, plus
department inbox, 360° order tracking, contract labour, attendance and mail automation, owner
controls…"

**client-test-guide.md:** complete, by role, every journey J1–J14 written as numbered steps with
✔️ results — this is the UAT book each department signs.

