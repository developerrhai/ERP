# PHASE 24 — Report (core built, NOT tested)

Built locally on 2026-11-13. Nothing committed, pushed or deployed. By the owner's instruction no tests were run while building;
only `tsc` (API and web, both clean). All testing is in the final small-batch round after Phase 25.

## What was built
**Database** — migration `20261212000000_phase24_dashboards` (not yet applied anywhere): `kpi_definitions` gets `format`,
`drill_page`, `drill_filter_tpl`, `formula_text`, `source_text` (drill pages and sources back-filled for the 20 existing KPIs);
`kpi_targets`, `widgets_library` (one KPI widget per KPI + 5 work widgets), `dashboards` extra columns, `user_dashboard_overrides`,
`kpi_alert_rules`, `kpi_alert_events`, `dashboard_schedules`, `dashboard_tv_tokens`; notification type `kpi.alert`.

**API** (`modules/dashboards/`)
- `calc.ts`: pure rules - achievement % (higher-good = value/target, lower-good = target/value, 0 = 100 %), colour (**green at or above 90 %,
  amber at or above 75 %, otherwise red; exactly 90 is green, exactly 75 is amber**), additive-total rule, alert-crossed rule, daily-cron due check.
- Dashboards: `GET /dashboards/my`, `/dashboards/dept/:dept`, `/dashboards/plant` (comparison grid: rows = KPIs, columns = chosen plants + total),
  `/dashboards/owner` (grid + pending approvals by age + statutory rows waiting for review), `/dashboards/module/:code` (sales, purchase, inventory,
  finance, production, quality, hr, maintenance, projects, service, logistics), `/dashboards/widgets`. Every KPI card carries value, target, %, colour,
  formula text, source, record count, refresh time and the drill-down page. Values come from the Phase 19 KPI formulas (real SQL); a missing
  value is `null` ("No data in period"), never a made-up number. A total is added only for amounts and counts, never for %, days or ratios.
- Personal layout: `PUT /dashboards/:key/layout`, `POST /dashboards/:key/reset` (any user, own only).
- Targets: `GET/POST/DELETE /kpi-targets` (most specific wins: person > department > plant > everyone > the Phase 19 default). Audited.
- Alerts: `GET/POST/PATCH/DELETE /kpi-alerts`, job `kpi.alerts` every 15 min: checks each active rule per plant, notifies the recipients through Phase 21
  (`kpi.alert`), at most once per cooldown, records `kpi_alert_events`. Audited.
- TV: `POST /dashboards/:key/tv-token` (only the hash is stored, expires, creating a new one stops the old), public read-only `GET /tv/:key?token=`
  (any other method gets 405; a bad or expired token gets 401).
- Emailed dashboards: `GET/POST/DELETE /dashboard-schedules`, job `dashboard.emails` every 5 min sends due **daily** schedules ("m h * * *");
  each recipient gets the figures for THEIR plants only.
- Pages registered (API + web): My Dashboard, Plant Dashboard, Owner Console, KPI Targets, KPI Alerts, and Production / Quality / HR / Maintenance /
  Projects / Service / Logistics Analytics.

**Web**: KPI tile (value, target, colour chip, the "i" explanation with formula / source / records / refresh time, click-through to the records),
comparison grid, plain-SVG bar chart, `My Dashboard`, `Plant Dashboard` (+ "Create TV link"), `Owner Console`, module analytics pages, KPI Targets and
KPI Alerts registers with add forms, and the TV page `/tv/:key?token=` (large figures, refreshes every 60 s, cycles plants every 20 s).

## Deviations / not done (carry-over)
1. **Charts are plain SVG, not Chart.js** (no new dependency, no install). Only a bar chart exists; line / donut / heatmap / funnel / gauge widgets are not built.
2. **"My Dashboard" is not strictly "own data" for KPIs**: the Phase 19 KPI formulas are plant-level, so the department KPIs shown are the plant's (a note on the page says so).
   The user's own queues (approvals, own documents by status) are strictly their own. Role-specific default layouts (salesperson, buyer, store keeper...) are not seeded.
3. **No KPI snapshots / compare values**: cards are computed live from the formulas on each open (no `kpi_snapshots` refresh job, no vs-last-period or vs-last-year arrows, no Today/Week/MTD/QTD/YTD switch;
   each KPI keeps the period its formula defines). Speed (< 500 ms) is unmeasured.
4. **Drag / resize layout editing and the widget picker drawer** are not built; the layout save/reset API and the widget library table exist.
5. **Drill-down** opens the KPI's list page with `?from=<kpi>&unit=<plant>`, but the list does not yet apply those filters or show "Filtered from dashboard" with ✕.
6. **PDF export** (`GET /dashboards/:id/export.pdf`, "Download PDF") is not built; emailed dashboards are an HTML table in the email body, not a PDF.
7. **Dashboard builder CRUD** (`/dashboards` create/edit/delete custom dashboards) is not built (Phase 31 admin builders may cover it).
8. **Schedules and alert recipients have no pickers in the UI**: alert rules default to "notify me"; the schedules API exists but there is no page for it yet.
9. Alert rules and TV links have no page for listing/revoking links.
10. Not run: any test (calc edges at exactly 90 % / 75 %, scope, cooldown, TV 405/401, speed). Feeders/flows of §10 not written.

## Deploy sheet (owner, by hand — not done by me)
1. Backup the production database.
2. `prisma migrate deploy` (migration `20261212000000_phase24_dashboards`, forward-only, idempotent `IF NOT EXISTS`). No new dependencies, no new environment variables.
3. Build API and web, restart (two new cron queues start: `kpi.alerts`, `dashboard.emails`), `/health` OK.
4. Smoke: KPI Targets -> add Sales Invoiced MTD target for the month; My Dashboard shows the target and a colour; Plant Dashboard with two plants shows both and a total
   for amounts; "Create TV link" -> open it in a private window (refreshes by itself); KPI Alerts -> add a rule on Pending Approvals above 0 and see the notification within 15 minutes.
5. Rollback: all changes are additive; no existing page or API was removed (`/dashboards/department/:dept` of Phase 19 is untouched).

## Test round (2026-11-13, small batches, API only)
`tests/phase23-25.test.ts` (new, 14 tests) passes: plant rules, the 90 % / 75 % colour edges, SLA over a Sunday and a holiday, the state machine through the API
(send, receive, accept, return, recall, short receipt, one open movement per document, wrong department refused), the Workflow Matrix suggestion, targets, TV link
(read-only, wrong token 401, POST 405, rotated link stops), Menu / favourites / search / Home. Bugs found and fixed by the round: wrong column name `user_departments.department_name`;
an empty user id passed to the target lookup; an Owner without a department could not send (now names the sending department).
Also green: context (49), records + numbering (44), forms / all-GET-routes / users (39). `phase3-context.test.ts` expectations updated for the new `unitIds` field.
Not run: the web unit tests, the e2e / crawler / feeders (blocked: two old servers hold ports 4100 and 5180 and the Prisma engine file, and memory is under 1 GB),
and the remaining API test files (a full run was stopped by the system for low memory). Known failing before and after: Phase 21 web-push test, Phase 11 date-dependent tests.
