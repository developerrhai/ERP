# PHASE 24 — Dashboards suite: My Dashboard for every user, department, plant, owner and module dashboards, drill-down, targets, alerts, TV mode, emailed dashboards

## 1. Goal
Far more than V40's dashboards:
- **every user** has their own dashboard with their own data;
- every department, every plant and the Owner have rich dashboards;
- every module has an analytics dashboard;
- every number can be clicked down to the records;
- targets and red/amber/green;
- alerts when a KPI crosses a limit;
- a big-screen TV mode for the shop floor;
- dashboards emailed as PDF on a schedule.

## 2. Pages
| Page | What it is |
|---|---|
| my-dashboard | personal; new |
| dashboard | department dashboard, V39 layout + more |
| plant-dashboard | new; one plant or a comparison of the selected plants |
| owner-console | the Owner cockpit (V35 + more) |
| command-center | restyled |
| ops-mfg-dashboard | V40 |
| bi-sales, bi-purchase, bi-inventory, bi-finance, bi-branch, bi-profit | rebuilt as module analytics |
| bi-production, bi-quality, bi-hr, bi-maintenance, bi-projects, bi-service, bi-logistics | new module analytics |
| bi-dashboards | dashboard builder |
| kpi-targets | new |
| kpi-alerts | new |
| /tv/:dashboardId | TV mode |

## 3. Rules
- Every widget reads **scoped** data: the selected plants (R2-6) × the user's data scope
  (OWN/DEPARTMENT/UNIT/ALL, Phase 2).
- My Dashboard always uses OWN data, plus the department queues the user works in.
- No widget ever shows a made-up number. With a 0 denominator it shows "—" + "No data in period".
- Every KPI has: a formula text, a source ("from posted invoices"), a row count, the last refresh time,
  and a drill-down link.
- **Comparisons:** this period vs last period, and vs the same period last year; per plant when 2+ are
  selected.
- **Periods:** Today, This week, MTD, QTD, YTD (FY), Custom. Indian number format in lakh/crore.
- **Speed:** widgets read kpi_snapshots and counters (refreshed every 5–15 min, or on events). Only
  "Today" counters are live, and they come from counter tables.

## 4. Database (<ts>_phase24_dashboards)
- kpi_definitions (Phase 19): add scope_kinds[], drill_page, drill_filter_tpl, format
  (inr/pct/count/days/hours/ratio), direction, owner_department, formula_text, source_text
- kpi_snapshots: add unit_id (already per unit), user_id null (for OWN KPIs), period_kind
  DAY/WEEK/MONTH/QUARTER/FY, compare values
- kpi_targets(kpi, unit_id null, department_id null, user_id null, period_kind, period_start, target,
  amber_pct default 90, red_pct default 75, set_by)
- widgets_library(code, title, kind KPI/CHART_LINE/CHART_BAR/CHART_DONUT/STACKED/HEATMAP/FUNNEL/
  GAUGE/TABLE/LIST/COUNTER/CALENDAR/MAP_PLANT/QUEUE_CARDS, dataset, params_schema, min_size, roles[])
- dashboards (Phase 19): add kind MY/DEPARTMENT/PLANT/OWNER/MODULE/CUSTOM, layout jsonb
  (grid 12 columns: x, y, w, h, widget, params), shared_with_roles[], tv_enabled, tv_token_hash,
  refresh_seconds
- user_dashboard_overrides(user, dashboard, layout) — personal changes over the role default
- kpi_alert_rules(kpi, scope, condition (> < crosses target), threshold, period, recipients
  (roles/users), channels in_app/push/email, cooldown_hours, active)
- kpi_alert_events(rule, value, at, delivered)
- dashboard_schedules(dashboard, cron, format PDF, recipients users[], plants mode SAME_AS_RECIPIENT)

## 5. Content, formulas and examples
**A. Widget library** (40+, seeded):
| Area | Widgets |
|---|---|
| Sales | Sales MTD; Order book; Quotation→order %; Top 10 customers; Sales by product family; Sales by plant; Sales trend 12 months; Overdue receivables; Collection efficiency; DSO; Dispatch due this week; Lost-reason Pareto |
| Purchase | Open PO value; Deliveries due/overdue; Supplier OTIF; PPV; MSME payments due; PR→PO days |
| Inventory | Stock value; Value by ageing (heatmap); ABC split; Dead stock; Below reorder; QC hold value |
| Production | OEE today (gauge); OEE trend; Plan vs actual; Downtime Pareto; WIP value; Job cards running; Rejection % |
| Quality | FPY; NCR open by age; Defect Pareto; Supplier PPM; Calibration due; CAPA overdue |
| Finance | Cash & bank; P&L MTD; Gross margin %; AR ageing donut; AP due 7 days; GST due calendar; Expense by head |
| HR | Headcount; Present today; Attendance % heatmap (days × departments); Late arrivals; Leave today; Attrition; Overtime hours |
| Maintenance | Breakdowns open; MTBF/MTTR trend; PM compliance; Spares below minimum |
| Projects | Active; Late gates; CPI/SPI; Budget burn |
| Service | Open tickets by SLA; First-time fix %; AMC renewals |
| Logistics | Shipments in transit; Freight cost per kg; Vehicles with expiring documents |
| Work | Department queues (8 cards, V39); My approvals; My tasks; Stuck movements; Exceptions |
| People ops | Visitors inside now; Meals today; Contract workers on site |

**B. Formulas (examples):**
| KPI | Formula |
|---|---|
| Collection efficiency | collections in month / (opening AR + invoiced in month) × 100 |
| DSO (90 days) | AR / credit sales of the last 90 days × 90 |
| Supplier OTIF | lines received on/before promise AND in full / lines due × 100 |
| FPY | lots passed at first inspection / lots inspected × 100 |
| OEE | A × P × Q (Phase 13) |
| Present today | P + HD×0.5 + on duty / active headcount (Phase 28 live) |

- **Collection efficiency example:** opening AR ₹50,00,000 + invoiced ₹70,00,000 = ₹1,20,00,000;
  collected ₹54,00,000 → **45.0 %**.
- **DSO example:** AR ₹48,00,000; credit sales of 90 days ₹1,44,00,000 → **30 days**.
- **Supplier OTIF example:** 60 lines due, 51 on time and in full → **85.0 %**.

**C. My Dashboard** — the default layout by role (the user can add, remove, move or resize widgets;
"Reset to default" is always available):
| Role / job | Widgets (OWN data unless marked) |
|---|---|
| Salesperson | My sales MTD vs target (gauge); my pipeline by stage; my quotations awaiting reply > 7 days; my customers overdue; my follow-ups today; my orders to dispatch this week |
| Buyer | My open POs; my deliveries due/overdue; my PRs waiting for PO; my supplier rejections |
| Store keeper | GRNs to post today; put-away pending; picks pending; my plant's QC hold |
| Production supervisor | My work centres' OEE today; job cards running; downtime today; handover pending (Phase 29) |
| Quality inspector | Lots waiting for me; NCRs I own; instruments due |
| Accountant | Invoices to post; bank lines unreconciled; payments due; GST calendar |
| HR | Present today; missed punches; leave requests; joiners and leavers this month |
| Department Manager / Head | Department queues (V39 cards) + team workload + department KPIs + approvals waiting |
| Every employee | My attendance this month (calendar); leave balance; last payslip; my tasks; my approvals; my documents returned |
| Director / Owner | Owner console widgets (G) |

**Target example:** salesperson target ₹25,00,000 for November, achieved ₹18,75,000 → 75 % → amber
(amber below 90 %, red below 75 % → exactly 75 % = amber).

**D. Department dashboard (V39 + more):**
1. hero;
2. the 8 V39 queue cards;
3. 4 department KPIs with trend sparklines;
4. 2 charts;
5. the team workload table (person, open tasks, approvals waiting, overdue);
6. active projects;
7. activity feed.

**E. Plant dashboard:**
- one plant → its KPIs;
- 2–3 plants → a **comparison grid**: rows = KPIs, columns = plants + total, colour per target;
  click a cell to drill down.

**F. Module analytics pages:** a filters row (period, plant, department, customer/supplier/item/employee
as relevant) + 6–10 widgets + "Download PDF" + "Email this dashboard".

**G. Owner console:**
- KPIs per plant + total: sales, collections, cash/bank, receivables overdue, payables due, production
  vs plan, rejection %, present today, contract workers on site;
- pending approvals by age;
- stuck movements;
- critical NCRs; exceptions;
- email/push health; system health (Phase 23/31 checks);
- needs_review statutory rows.

**H. Drill-down:** every KPI and chart segment → the list page with the same filters
(`/m/sales-invoices?period=MTD&unit=TAL,SAW&status=posted`). The list header shows
"Filtered from dashboard: Sales MTD" with ✕ to clear.

**I. Alerts:**
- the job kpi.alerts after each snapshot refresh; crossing a threshold → notification/email
  (Phase 21) with the value, target and a link;
- cooldown, default 24 h.
- **Example:** "Rejection % > 3 % (today 4.2 % at SAW)" → Quality Head (push + email).

**J. TV mode:** /tv/:id?token= — read-only signed token (rotatable), large fonts, auto-refresh every
60 s, auto-cycles pages every 20 s, no menu. For the shop-floor screen per plant.

**K. Scheduled dashboard emails:** e.g. "Owner daily at 08:00 — Owner console PDF". Each recipient
gets it in their own plants and scope (never wider).

## 6. API
- GET /dashboards/my | department/:dept | plant | owner | module/:code
- GET /widgets/:code/data?period=&units=&params=
- PUT /dashboards/:id/layout (personal override); POST /dashboards/:id/reset
- CRUD /dashboards (builder, Admin + allowed roles)
- CRUD /kpi-targets; CRUD /kpi-alerts
- POST /dashboards/:id/tv-token
- GET /tv/:id (token)
- CRUD /dashboard-schedules
- GET /dashboards/:id/export.pdf

## 7. Screens
- 12-column grid; drag/resize in "Edit layout" mode; widget picker drawer (search, category,
  preview).
- Every widget card: title, period chip, value, trend arrow (green/red by direction), the "i" button
  (formula, source, rows, refreshed at), ⋯ (Drill down, Export CSV, Remove).
- Charts: Chart.js; max 3 colours from the tokens; Indian format on axes and tooltips; a tooltip on
  every point; legend below.
- Phone: one column; KPIs as a horizontal swipe row.

## 8. Messages
| Case | Message |
|---|---|
| no data | "No data for this period." |
| target missing | "No target set — ask your manager." (grey chip) |
| TV token expired | "This screen link expired. Ask Admin for a new link." |

## 9. Audit & notifications
Layout changes are not audited; builder dashboards, targets, alert rules and schedules are audited.
Alerts are delivered via Phase 21.

## 10. Tests
- **Calc:** every §5B example; amber/red edges (exactly 90 %, exactly 75 %).
- **Scope:** an OWN user never sees others' numbers; a plant subset sums correctly.
- **Snapshot vs live SQL:** equal within ±0.01 on fixtures.
- **Alerts:** cooldown works.
- **TV:** the token is read-only (POST → 401).
- **Speed:** each dashboard < 500 ms.
- **Feeders:**
  - set targets through kpi-targets;
  - create 2 alert rules;
  - make 2 personal layouts (salesperson, store keeper);
  - schedule the owner email.
- **Flows:**
  - (a) post invoices through the screens → Sales MTD rises after the refresh;
  - (b) the salesperson's dashboard shows only their own orders;
  - (c) drill-down opens the filtered list with the same count;
  - (d) an alert email arrives in the mail catcher;
  - (e) TV mode cycles.

## 11. Acceptance
- [ ] Every role has a useful My Dashboard by default.
- [ ] 12 department, plant-compare, Owner and 13 module dashboards are live.
- [ ] Every number drills down.
- [ ] Targets and alerts work.
- [ ] TV mode and emailed dashboards work.
- [ ] Speed within budget. Zero-error gate. Client documents updated.

## 12. Out of scope
External BI tools; AI narrative beyond Phase 19.

## 13. Owner check
1. My Dashboard as a salesperson: are only their own orders shown, with a target gauge?
2. Owner: select TAL + SAW. Does the comparison grid show both plus the total?
3. Click Sales MTD. Does the list open with the same total?
4. Open the TV link on a phone. Does it refresh by itself?

## 14. Build prompt
~~~
Read …, PHASE-24.md, Phase 19 BI code. Add chart.js through one <Chart>. Seed the widget library
and the role default layouts. Every widget = dataset + ScopeFilter (plants + scope). Snapshot jobs,
alerts, TV tokens, schedules via Phase 21. Feeders/flows §10. Zero-error gate ×3. Local commit.
Report + Deploy sheet + client documents.
~~~

## 15. Client documents
**NEW:**
- My Dashboard for everyone (your own numbers, your targets).
- Bigger department dashboards.
- Plant comparison.
- Owner console.
- 13 module analytics dashboards.
- Click any number to see the records behind it.
- Targets with green/amber/red.
- Alerts by email/app.
- TV screen mode.

- Dashboards emailed every morning.

**Test book:**
- **Salesperson:** My Dashboard. ✔️ Only your orders; the target gauge.
- **Manager:** Targets → set ₹25 lakh for a salesperson. ✔️ The gauge shows the % achieved.
- **Owner:**
  1. Choose two plants. ✔️ The comparison grid.
  2. Click Sales MTD. ✔️ The same total in the list.
- **Admin:** create a TV link → open it on the shop-floor screen. ✔️ It refreshes every minute.
