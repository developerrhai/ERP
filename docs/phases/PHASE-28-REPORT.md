# PHASE 28 — Report (built and API-tested; web not browser-tested)

Built locally on 2026-11-13. Nothing committed, pushed or deployed.

## What was built
**Database** — migration `20261216000000_phase28_attendance_automation` (idempotent): `attendance_devices` gets `connection` (PUSH / AGENT / MANUAL), `agent_id`, `last_seen_at`, `last_punch_at`, `status` (ONLINE / STALE / OFFLINE), `timezone`, and a unique serial; `attendance_days` gets `auto_lop` and `auto_hd`;
new `attendance_agents` (only a hash of the key is stored), `device_sync_logs`, `attendance_policies` (10 defaults), `attendance_auto_actions` (unique per employee, day, policy and action), `attendance_alerts`, `geo_sites`, `mobile_punches`, `live_presence`; 5 notification types; mail automations #31 and #32 switched to "Live".

**API** (`modules/attauto/`)
- **Device push** `POST /iclock/cdata?SN=…&table=ATTLOG` (also under `/api/v1/iclock`): the serial must be registered and active (else 401 "Device {serial} is not registered." and an alert); tab-separated lines are parsed (device clock = IST), duplicates ignored, unknown codes kept for HR, **only the affected employee-days are recalculated at once**, live presence is updated, the device becomes ONLINE, a sync-log row is written. `GET /iclock/cdata` (handshake) and `/iclock/getrequest` (keep-alive).
- **Agent** `POST /att/agents/batch` with `X-Agent-Id` and `X-Signature` = HMAC-SHA256 of the raw body with `sha256(agent key)`; a wrong signature is 401; the key is shown once.
- **Policies** per plant (the plant's own row wins over the all-plants row): late-mark (every 3rd late day of a month = 0.5 day, with the reason "3rd late mark in November (4, 11, 18)"), missed punch (half day after 3 days), auto-absent (provisional), auto-OT (an overtime request to the manager), buddy-punch alert, mobile punch, auto-lock. Each change is an **auto action with a reason**, once per employee-day and policy; HR **reverses** it with a reason (the day returns to what it was); a locked month refuses with "… attendance is locked. Ask HR head to unlock with a reason."
- **Reminders and reports**: next-morning missed-punch reminder (in-app, push and email to the employee and the manager, once); daily department report from 10:30 to each department manager (only their plant); device health (30 min = amber, 2 h = red, alert to HR once per change).
- **Month lock**: day 2 of the next month at 18:00 IST (settings per plant): every day is calculated, the Phase 15 summary is stored **including the automatic late deductions**, days are locked, HR is told; manual lock and **unlock with a reason** endpoints; a locked day does not change when a late punch arrives.
- **Live board** `GET /hr/att/live` (inside / expected / % per plant and department); **mobile punch** `POST /ess/punch` (GPS accuracy, nearest site, inside or "You are 640 m from Talwade gate. Punch from inside the site."; the punch goes through the same pipeline).
- Admin: devices, agents, sync logs, policies, geo sites, automation log (`/hr/att/auto-actions`).
- Jobs: `att.daily` (15 min, active from 10:00 IST), `att.health` (10 min), `att.lock` (hourly).

**Web**: Devices & Sync (device cards with status colour, last punch, today's punches, unknown codes; add device; agents with the one-time key; sync log), Attendance Policies (a card per policy with the switch, parameters, a plain-English preview, "All plants" or one plant; the Automation log with a Reverse button),
Punch Sites (with "Use my location"), Live Attendance Board (tiles per department, refreshes every 30 seconds).

## A real bug found and fixed in Phase 15
`attendance-service.ts` turned a shift's TIME column into text with `String(value).slice(0, 5)`. Prisma returns TIME as a Date, so the shift start and end became garbage and **lateness and overtime were always 0** in stored days. It now reads the hour and minute correctly (`hhmm()`); the spec example (07:14 and 18:05 on a 07:00 shift) now stores worked 621, late 14, overtime 135. **Days stored before this fix keep the old figures until they are recalculated** (a punch or the nightly run recalculates them).

## Tests (`tests/phase28.test.ts`, 16 tests, all pass)
Pure: parser and IST time, direction codes, geo-fence edges, late-mark counter, device health timings, lock date. API: device registration rules (serial needed, duplicate refused), unknown serial 401 + alert, the spec example, duplicates, unknown codes, sync log, auto OT, agent HMAC (wrong key 401, other plant refused), live board in/out, late-mark policy off / on / reason / not doubled / reversal / another plant not affected,
missed punch (reminder once, nothing on day 2, half day on day 3, reversal, policy off), buddy alert, device STALE / OFFLINE, daily department report (once, plant-safe), mobile punch (off, no site, poor GPS, outside with the distance, inside), month lock (due time, payroll summary with the automatic deduction, locked day unchanged, reversal refused, unlock needs a reason).
Regression: Phase 15 and Phase 16 tests, Phase 27 still pass.

## Deviations / not done (carry-over)
1. **No agent program**: the API is ready, but the small Windows service (`tools/att-agent`) and its installer are **not built**. "Download agent" is not on the screen.
2. Auto-leave (policy `AUTO_LEAVE`), auto comp-off offer and auto shift detection are **switches only** (no logic yet). Mobile punch has no selfie.
3. The ESS page has **no Punch button** yet (the API is ready); `hr-attendance` has no new "Live Board / Automation Log" tabs (they are separate pages); the employee calendar shows no auto-action icon.
4. The day-1 "attendance locks tomorrow" warning (10:00) is not sent. The lock notice goes to HR users of the plant, not to a Payroll department; payroll reads the locked summary (Phase 16 unchanged).
5. Daily report (#32) is a text email without the Excel attachment; the monthly summary (#33) is not built. Missed punch (#31) reminder works; "Reminder to the manager in CC" is a second recipient, not a CC header.
6. Auto-absent records a provisional-absence action only (the day status is whatever the Phase 15 engine computed); it is not a separate grey status. The OT quarterly-cap message is not checked on automatic requests.
7. Live "expected" counts everyone assigned to the plant except weekly-off / holiday / leave days; contract labour is not shown separately (Phase 30). TV mode of the board is not built.
8. Not run: the feeders through the screens with a device simulator, the month-of-punches-for-30-employees flow with payroll, the 1-minute day-calculation speed check, a real device or ADMS protocol check (confirm per model during setup), browser test of the new pages.

## Deploy sheet (owner, by hand — not done by me)
1. Backup the production database. 2. `prisma migrate deploy` (migration `20261216000000_phase28_attendance_automation`, forward-only). No new dependencies, no new environment variables.
3. Build API and web, restart (new cron queues `att.daily`, `att.health`, `att.lock`), `/health` OK.
4. **Open the device port**: biometric devices call `http://<server>/iclock/cdata` on the AWS server directly (not through Vercel). The Nginx config must pass `/iclock/` to the API; do this by hand (not done by me). Test with one device first.
5. Smoke: Devices & Sync ➜ register a push device with its serial ➜ punch on it ➜ the "Today" count rises; Live Board shows the person inside; Policies ➜ Late-mark ON for one plant.
6. Old attendance days keep their old lateness / overtime figures until recalculated (see the bug above).
7. Rollback: all additive; policies can be switched off in the screen; the Phase 15 TIME fix should stay.
