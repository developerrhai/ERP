# PHASE 25 — Report (core built, NOT tested)

Built locally on 2026-11-13. Nothing committed, pushed or deployed. By the owner's instruction no tests were run while building;
only `tsc` (API and web, both clean). The small-batch test round follows (see the end of this report for its result, if filled in).

## What was built
**Database** — migration `20261213000000_phase25_movements` (not yet applied anywhere): `workflow_rules` (seeded with 8 default-chain rules),
`work_movements` (state machine, **one open movement per document** by a partial unique index, SLA, late flag), `movement_lines`, `movement_attachments`,
`movement_events` (append-only: an update is refused by a trigger), `plant_routes` + `plant_route_steps`, `job_card_routes` (balance = planned − good − scrap, generated),
`transfer_notes`, `bom_material_flows` (shortage generated); notification types `work.sent`, `work.returned`, `work.late`, `work.accepted`.

**API** (`modules/work/`, `/api/v1/work`)
- `calc.ts` (pure): the state machine (SENT → RECEIVED → ACCEPTED → … → FORWARDED / COMPLETED / RETURNED / RECALLED), who may do each action (target side or sender),
  working-day SLA (Mon–Sat, Sundays and plant holidays skipped; **sent Friday 16:00 with 2 days = due Monday 16:00**), the V18 default-next map, late levels (1 = late, 2 = twice the SLA).
- **Move Forward** `POST /movements` (one transaction, locks the open movement first, so two simultaneous moves → the second gets a conflict): holder checks, "select a different next department",
  the target department must have an active user in the plant, the Responsible Manager must be one of them, required fields from the matrix, physical moves need lines, SLA clock, number `MOV/<PLANT>/<FY>/00001`,
  history event, department counters, notification to the target managers, audit.
- `POST /movements/:id/receive | accept | return | recall | complete`: only the right side may act (messages as in the spec), "Already received by {name} at {time}", return needs ≥ 10 characters and creates a new SENT movement back to the sender,
  short receipt needs a reason per line and writes a `SHORT_RECEIPT` event.
- `GET /inbox` (tabs To Receive / To Accept / In Work / Returned / Sent by us / All; filters; newest first; keyset "Next"), `GET /work-center`, `GET /docs/:docType/:docId/movement` (holder + full history), `GET /movements/:id/lines`.
- **Edit lock**: the generic records engine now refuses an update while a movement is open and the editor's department is not the holder: "Currently with {dept} since {time}. Only they can edit it." (Owner/Admin and "all plants" users are exempt; a matrix rule can switch the lock off per page).
- Workflow Matrix: `GET/PUT /workflow-rules`, `GET /workflow-rules/suggest` (matrix first, then the V18 map). Audited.
- Job `work.late` every 10 min: marks late, tells the target manager; at twice the SLA tells the department head.
- Department counters (`dept_work_counters`) are refreshed in the same transaction; Home's To Receive / To Accept / In Work / Returned now show the real counts for the user's department in the chosen plants.

**Web**: Department Inbox (`dept-inbox`), Department Work Center (`dept-work`), All Department Movements (`dept-movement-inbox`), Workflow Matrix (`admin-workflow`),
the **Move Forward popup** (V40 field order, locked From, suggested next department, manager list filtered to the plant, cycle text), the **Return dialog** and the **History drawer**;
"Move Forward" and "History" buttons in the drawer of every generic record page.

## Deviations / not done (carry-over)
1. **No stock movement.** Plant-to-plant physical moves record lines, quantities and short receipts, but do **not** call StockService (no STOCK_IN_TRANSIT, no stock transfer on receive, no reversal on return, no write-off decision). The inter-plant stock rules of the spec are not met.
2. **No approval integration**: Move Forward does not check "approval pending" or "approval department approved", and `WAITING_APPROVAL` is never set; "Send for Approval" in the Work Center is missing. Required attachment types are stored but not checked.
3. **Pages not built** (tables exist, no UI/API): `plant-process-movement`, `plant-department-movement`, `plant-interplant-movement`, `plant-unit-routing` + route builder, `mfg-unit-route`, `mfg-transfer-note` (CRUD on `transfer_notes`), `flow-bom-approval` (BOM explosion, raise PR), `maint-part-movement`, `customer-receipts`, `my-approvals` movement link; `/plant-routes`, `/job-card-routes/:id/continue`, `/transfer-notes`, `/bom-material-flows` endpoints.
4. **One Inbox page with a department picker** instead of one page per department (`dept-inbox-<dept>`): the registry is static, so per-department page ids would need the registry to be built from the departments table.
5. **360° trace drawer** (PO / SO / MO block) is the plain History drawer; the project/SO/PO/MO columns are stored but not filled.
6. Bulk Receive / Accept, the filter row (project, plant, priority, date), the receive dialog with a lines grid and short quantity, the "Recall" confirmation and the Responsible-Manager notification by email (Phase 27) are not built (single-row buttons only; the lines API exists).
7. SLA uses the plant's holiday calendar (Phase 15) and Sunday off; the per-plant working-day pattern is fixed at Monday–Saturday.
8. `project_events` rows (Phase 26 reads them) are not written yet; movement events are in `movement_events`.
9. Not run: any test (state-machine table, 409 on two Move Forwards, edit lock, short receipt, return reverses stock, SLA with Sunday and holiday, counters = live counts, plant rule, p95). Feeders and flows of §10 not written.

## Deploy sheet (owner, by hand — not done by me)
1. Backup the production database.
2. `prisma migrate deploy` (migration `20261213000000_phase25_movements`, forward-only, idempotent). No new dependencies, no new environment variables.
3. Build API and web, restart (new cron queue `work.late`), `/health` OK.
4. Smoke: Workflow Matrix → set Sales Orders next = Production; open a Sales Order → Move Forward → Production (suggested); sign in as Production → Department Inbox → To Receive → Received → Accepted;
   as Sales try Edit on the order ("Currently with Production since …"); History shows the times.
5. Rollback: all changes are additive; the only edit to existing behaviour is the edit lock in the generic records update, which only applies to documents that have an open movement.

## Test round (2026-11-13, small batches, API only)
`tests/phase23-25.test.ts` (new, 14 tests) passes: plant rules, the 90 % / 75 % colour edges, SLA over a Sunday and a holiday, the state machine through the API
(send, receive, accept, return, recall, short receipt, one open movement per document, wrong department refused), the Workflow Matrix suggestion, targets, TV link
(read-only, wrong token 401, POST 405, rotated link stops), Menu / favourites / search / Home. Bugs found and fixed by the round: wrong column name `user_departments.department_name`;
an empty user id passed to the target lookup; an Owner without a department could not send (now names the sending department).
Also green: context (49), records + numbering (44), forms / all-GET-routes / users (39). `phase3-context.test.ts` expectations updated for the new `unitIds` field.
Not run: the web unit tests, the e2e / crawler / feeders (blocked: two old servers hold ports 4100 and 5180 and the Prisma engine file, and memory is under 1 GB),
and the remaining API test files (a full run was stopped by the system for low memory). Known failing before and after: Phase 21 web-push test, Phase 11 date-dependent tests.
