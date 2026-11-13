# PHASE 29 — Report (built and API-tested; web not browser-tested)

Built locally on 2026-11-13. Nothing committed, pushed or deployed.

## What was built
**Database** — migration `20261217000000_phase29_workplace` (idempotent): `tasks` (+ `ops_task_dependencies`, `task_checklist`, `task_comments`), `shift_handovers`, `visitor_passes`, `canteen_meal_types` (4 seeded), `canteen_rates`, `canteen_entitlements`, `canteen_coupons`, `canteen_waste`, `canteen_months`, `canteen_vendor_bills`;
payroll component **`CANTEEN_DED`** (deduction, input); 9 notification types.

**API** (`modules/workplace/`, `/api/v1/ops/...`)
- **Tasks** numbered `T/<PLANT>/<FY>/…`: create (with checklist, dependencies, recurrence, approval flag), list / board / My Tasks / overdue / workload (red above 10 open or 3 overdue), start (**blocked by an unfinished dependency**: "Blocked by T/TAL/… (not done)."), progress, done (checklist must be ticked; approval-required tasks wait for a **different** person), approve, reopen (reason), comments, dependency loops refused; **recurring templates** create one task per working day (Mon-Sat, idempotent per date) at 00:05 IST; overdue notices once a day.
- **Shift handover**: draft, submit (outgoing in-charge), accept / reject (incoming only; reject needs a reason); not accepted within 30 minutes of the next shift's start alerts the department manager once.
- **Visitors** `VP/<PLANT>/<FY>/…`: pre-register (a host's own pass is approved at once; a gate registration asks the host), approve / reject by the host, QR token (only its hash is stored), **check-in** by pass or QR ("{host} has not approved this visit yet."), inside list with minutes and overstay, check-out, **overstay alert** (30 minutes after planned out, host + Security, once), pass PDF, only the last 4 characters of an ID, **anonymised after one year**, no-show at day end.
- **Canteen**: dated rates (GST, employee share), entitlement per shift, **scan** by employee code (unknown / other-plant person refused, "No lunch entitlement for shift GEN.", "Already served lunch today at 13:02.", an extra coupon allowed on request), money to the paisa (lunch 60 + 5 % = 63.00, employee 25.20, company 37.80), today's counts and last 5, register, department cost, waste log, **month close** (totals, journal **Dr Staff Welfare 6103 + Dr Employee Advances 1502 / Cr Accruals 2103**, notice to HR and Finance, "{Month} canteen is closed." afterwards), vendor bills (**more than 2 % over the meals served needs a second person**).
- **Payroll**: the run now reads a CLOSED canteen month and deducts the employee share as `CANTEEN_DED` (a line on the payslip, counted in net pay).
- Jobs: `ops.daily` (00:05 IST: recurring tasks, no-shows, anonymise), `ops.watch` (10 min: overstay, late handover, overdue).

**Web**: Task Management (Register, Department Board, My Tasks, Due & Overdue, Workload with colours, Task Approval; add task), Shift Roster & Handover (new handover, submit, accept, reject), Visitor Management (register, inside plant with overstay marker, pre-register, approve, check in, QR, check out), Canteen (counter with a large scan box, green / red result banner, today's counts and last 5; meal register; rate master; department cost and month close).

## Tests (`tests/phase29.test.ts`, 11 tests, all pass)
Pure: money example (22 lunches: employee 554.40, company 831.60, total 1,386.00), workload colours, loop detection, recurrence and Sunday skip, overdue / overstay / handover timer / variance (1,410 vs 1,380 = 2.17 % needs approval) / anonymisation.
API: task chain and block message, loop refused, checklist, approval by another person, reopen reason, workload 12 / 4 = RED, recurrence once per date and no Sunday, handover permissions / reject reason / late alert once / accept, visitor state machine with host approval, QR hash, overstay once, PDF, ID rules, anonymisation, canteen rate / entitlement / scan money / already served / extra / no entitlement / other plant / vendor variance / department cost / month close with a balanced journal (126 = 126) / closed month / the payroll sum.
Regression: Phase 15 and 16 (payroll) tests pass.

## Deviations / not done (carry-over)
1. **The payroll deduction was checked by its data and component**, not by a full payroll run (Phase 16's own run test still passes). Confirm on a real run after closing a canteen month.
2. Not built: Kanban **drag** with If-Match (buttons instead), phone "My Tasks" layout, the incoming-handover **banner at login**, the line-by-line handover grid on screen (lines are accepted by the API as JSON), visitor **pre-register link by SMS / email**, A6 pass with a QR image (the PDF is the standard document; the QR code is shown as text once), the **Visitor button on the Gate Kiosk** and the `/canteen/counter` standalone route (the counter is a tab), items carried → Phase 18 gate pass, selfie photo.
3. Canteen: contract workers and visitors as eaters (`person_kind` exists; scan accepts employees only), cash payment mode, waste log screen (API only), vendor-bill link to a purchase invoice, coupon cancel, an entitlement-per-shift screen (API only).
4. Automation `CREATE_TASK` (Phase 27 rule engine) is not wired (that engine is a carry-over). Counters `dept_work_counters` for tasks / shifts / visitors / meals and Home tiles are not filled.
5. Task `project_id`, `linked_doc_*` are stored but have no picker. Task approval uses a simple "different person" rule, not the Phase 5 approval engine.
6. Not run: feeders (40 tasks, 2 weeks of handovers, 25 visitors through the kiosk, 600 scans), the three flows with payroll, browser test.

## Deploy sheet (owner, by hand — not done by me)
1. Backup the production database. 2. `prisma migrate deploy` (migration `20261217000000_phase29_workplace`). No new dependencies or environment variables.
3. Build API and web, restart (new cron queues `ops.daily`, `ops.watch`), `/health` OK.
4. Set up the canteen: Rate Master (rate, GST, share), and entitlements per shift (API `PUT /ops/canteen/entitlements`; a screen is not built yet).
5. Smoke: a task with a dependency; Visitors ➜ Pre-register ➜ Approve ➜ Check in; Canteen counter ➜ scan the same code twice ("Already served"); Department Cost & Month ➜ Close month, then a payroll run shows CANTEEN_DED.
6. Rollback: all additive; the payroll change only adds a line when a closed canteen month exists.
