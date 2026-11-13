# PHASE 28 — ATTENDANCE AUTOMATION (auto device sync, auto calculation, auto alerts, auto leave/LOP rules, auto OT, live attendance, auto muster lock to payroll)

## 1. Goal
Attendance runs by itself every day:
- punches arrive from the biometric devices automatically;
- each day is calculated automatically (present, late, half day, OT, missed punch);
- people and managers are reminded automatically;
- policy rules apply automatically (late marks, missed punches, absences) with an approval trail;
- OT goes to approval automatically;
- the month locks and flows into payroll automatically.

The same engine serves staff, workers and contract labour (Phase 30). It builds on Phase 15.

## 2. Pages
| Page | What it is |
|---|---|
| hr-attendance | gets new tabs Live Board and Automation Log |
| hr-attendance-devices | new: Devices & Sync |
| hr-attendance-policies | new: Automation Policies |
| hr-geo-sites | new: Mobile punch sites |
| hr-ess | gets a Punch button for allowed staff, plus My Attendance calendar alerts |
| att-live-board | new: who is inside now, per plant / department / shift |

## 3. Rules (statutory limits remain Phase 15 rows)
**Device connection, 3 ways** (per device):
1. **Push:** devices that support the ZKTeco "ADMS/iclock" push protocol post logs to the ERP endpoint
   (/iclock/cdata). The device serial must be registered. Confirm the protocol support per device
   model during setup.
2. **Agent:** a small Windows service on a plant PC reads the vendor software database or export folder
   (ZKTeco attlog, eSSL eTimeTrackLite) every 5 minutes and pushes signed batches (HMAC key per
   agent) to the ERP.
3. **Manual:** the Phase 15 file upload stays as a fallback.

**Calculation:** the Phase 15 day engine runs **on every punch batch** (affected employee-days only)
and nightly for all.

**Automation policies** — each one per plant, per employee category, with on/off and a dated
effective_from:
| Policy | Default |
|---|---|
| Late-mark rule: N late marks in a month → deduct X day | OFF; when ON: 3 lates → 0.5 day LOP |
| Missed punch: if not regularised within D days | HD (half day) after 3 days, as LOP part |
| Auto-absent: no punch and no leave by shift end + 2 h → provisional A | ON |
| Absence covered by leave balance automatically (CL/EL) — creates a leave application for approval, not final | OFF |
| Auto OT capture: OT candidate minutes → OT approval request to the manager | ON |
| Auto comp-off offer for weekly-off/holiday work | ON |
| Auto shift detection for flexible rosters (nearest shift start within ±90 min) | OFF |
| Mobile punch (ESS) inside geo-fence, with optional selfie | OFF; per role |
| Buddy-punch alert: two different codes on one device within 3 s, repeatedly | ON (alert only) |
| Muster auto-lock: day 2 of the next month at 18:00, after warnings on day 1 | ON |

- **Every automatic change is an "auto action" with a reason**, visible to the employee and reversible
  by HR with a reason (audited). Nothing silently changes pay.
- **Plants:** devices, policies, geo-sites and live boards are per plant; HR users see only their plants
  (R-37).

## 4. Database (<ts>_phase28_attendance_automation)
- attendance_devices (Phase 15): add connection PUSH/AGENT/MANUAL, serial_no, agent_id, last_seen_at,
  last_punch_at, status ONLINE/STALE/OFFLINE, timezone
- attendance_agents(id, unit_id, name, key_hash, last_seen_at, version, status)
- device_sync_logs(device/agent, at, received, inserted, duplicates, unknown_codes, error)
- attendance_policies(unit_id, category WORKER/STAFF/CONTRACT, policy_key LATE_MARK/MISSED_PUNCH/
  AUTO_ABSENT/AUTO_LEAVE/AUTO_OT/AUTO_COMPOFF/AUTO_SHIFT/MOBILE_PUNCH/BUDDY_ALERT/AUTO_LOCK,
  enabled, params jsonb, effective_from, updated_by)
- attendance_auto_actions(employee, date, policy_key, action (MARK_HD/MARK_LOP/MARK_A/CREATE_LEAVE_REQ/
  CREATE_OT_REQ/OFFER_COMPOFF/SHIFT_ASSIGNED/LOCKED), before jsonb, after jsonb, reason, reversed_by,
  reversed_at, reverse_reason)
- attendance_alerts(employee, date, kind MISSED_PUNCH/LATE/ABSENT/OT_PENDING/BUDDY/DEVICE_OFFLINE,
  sent_channels, status)
- geo_sites(unit_id, name, lat, lng, radius_m, active); mobile_punches(employee, at, lat, lng, accuracy_m,
  site_id, inside bool, selfie_document_id, device_info)
- live_presence(unit_id, employee_id, department_id, status INSIDE/OUT, last_punch_at) — updated per punch

## 5. Logic and examples
**A. Device push** (POST /iclock/cdata?SN=…):
- an unknown serial → 401 + alert;
- otherwise parse lines (code, time, status) → insert ON CONFLICT DO NOTHING (device + code + time) →
  enqueue `att.compute` for (employee, date) pairs → update live_presence → device last_seen.

**B. Day calculation** (Phase 15 example): shift 07:00–15:30, break 30, grace 10; punches 07:14 and
18:05 → worked 621 min, late 14, OT candidate 135 (floor((621 − 480)/15) × 15 = 135), status P.
- Late ≥ 1 min after grace → a late mark.
- Auto OT → OT request "135 min on 12-11" to the manager (approve or reject; within the quarterly cap
  row).

**C. Late-mark policy example** (ON, 3 → 0.5 LOP): late on 4th (14 min), 11th (12 min), 18th (25 min) →
on the 18th:
- auto action MARK_LOP 0.5 day, reason "3rd late mark in November (4, 11, 18)";
- the employee and manager are notified;
- HR can reverse it with a reason.

**D. Missed punch example:** only IN 07:05 on Tuesday → status MIS.
- Wednesday 10:00: reminder (push + email) to the employee, CC the manager — "Missed out-punch on
  Tue 10-11. Regularise in ESS."
- Regularised + approved → recalculated → P.
- Not done by Friday 18:00 (3 days) → auto action MARK_HD, reason "Missed punch not regularised in 3 days".

**E. Auto-absent:** no punch, no leave, not a holiday or weekly off → at shift end + 2 h → provisional
A (grey). It becomes final at the muster lock. If the AUTO_LEAVE policy is on and the employee has a
CL/EL balance → a leave request is created for the employee to confirm or reject within 3 days, then
for manager approval.

**F. Live board:**
- inside now = live_presence INSIDE (last punch IN today, within the shift window), by department and
  shift, with contract workers shown separately (Phase 30);
- expected vs inside → % present now.
- **Example (SAW, A shift):** expected 180, inside 171 → 95.0 %.

**G. Daily attendance report** (automation #32, 10:30): per department manager, an Excel with present /
late / absent / missed punch / on leave, and a body summary.

**H. Month end:**
- day 1 at 10:00: "Attendance locks tomorrow 18:00 — 12 missed punches pending" to HR + managers;
- day 2 at 18:00: auto-lock → the Phase 15 summary → payroll inputs (paid days, LOP, OT approved,
  night shifts) → a notification to Payroll "November attendance locked: 642 employees, LOP 37.5 days".

**I. Mobile punch:** ESS Punch button → GPS fix with accuracy ≤ 100 m → inside a geo-site radius →
accepted (selfie if the policy says so); outside → refused "You are 640 m from Talwade gate. Punch from
inside the site."

**J. Device health:** no data for 30 minutes during shift time → STALE alert to HR + IT; no data for
2 hours → OFFLINE + an email.

## 6. API
- POST /iclock/cdata (device push, serial auth); GET /iclock/getrequest (keep-alive)
- POST /att/agents/batch (HMAC)
- CRUD /hr/att/devices | agents | policies | geo-sites
- GET /hr/att/live?unit=&dept=
- GET /hr/att/auto-actions?employee=&month=; POST /hr/att/auto-actions/:id/reverse {reason}
- POST /ess/punch {lat, lng, accuracy, selfie?}
- GET /hr/att/device-health

## 7. Screens
- **Devices & Sync:** device cards (status dot, last punch, today's punches, unknown codes link), a
  "Download agent" button with setup steps, sync log table.
- **Policies:** one card per policy with a switch, parameters, effective date, and a plain-English
  preview ("If a worker is late 3 times in a month, 0.5 day is deducted").
- **Live board:** big tiles per department (inside / expected), shift filter, TV mode (Phase 24).
- **Employee calendar:** days coloured; an auto-action icon with a tooltip giving the reason; a
  "Regularise" button.
- **Automation log:** filters by policy and plant; Reverse button for HR.

## 8. Messages
| Case | Message |
|---|---|
| unknown device | "Device {serial} is not registered." |
| outside geo-fence | "You are {m} m from {site}. Punch from inside the site." |
| locked | "November attendance is locked. Ask HR head to unlock with a reason." |
| reverse | "Reason required to reverse an automatic change." |
| OT cap | "Approving this exceeds the quarterly overtime limit." |

## 9. Audit & notifications
All auto actions, reversals, policy changes, device registrations and locks are audited.
Notifications: automations #31–33, device stale/offline, buddy alert (HR only), OT requests (manager).

## 10. Tests
- push parser; duplicate punches ignored; an agent HMAC with a wrong key → 401;
- every §5 example with a fake clock;
- policies off → no auto actions;
- reversal restores and recalculates;
- lock → payroll inputs equal the summary;
- geo-fence edges (radius ± 1 m);
- live board counts;
- device health timings.
- **Feeders:**
  - register 3 devices (one per plant) and 1 agent in the admin screens;
  - set the policies through screens;
  - punches are sent by a device simulator (an HTTP push like a real device — this is the real input
    path, not a DB write);
  - regularise through ESS screens; approve OT through manager screens.
- **Flows:** (a) a month of punches for 30 employees → auto actions → reminders in the mail catcher →
  lock → payroll run (Phase 16) uses the exact paid days; (b) a mobile punch inside/outside.

## 11. Acceptance
- [ ] Punches arrive with no manual upload.
- [ ] Days compute within 1 minute of a punch.
- [ ] Reminders and reports are sent automatically.
- [ ] Policies apply with reasons and can be reversed.
- [ ] OT goes to approval.
- [ ] Auto-lock feeds payroll.
- [ ] Live board correct.
- [ ] Zero-error gate. Client documents updated.

## 12. Out of scope
Face-recognition devices' own cloud; payroll changes (Phase 16 already reads the summary).

## 13. Owner check
1. Punch on the device at the gate. Does the Live board count rise within a minute?
2. Skip the out-punch. Is there a reminder next morning at 10:00?
3. Does the daily attendance Excel reach managers at 10:30?

## 14. Build prompt
~~~
Read …, PHASE-28.md, Phase 15 attendance code. Build the iclock push endpoint, the agent (separate
small Node package tools/att-agent with a Windows service installer script, no secrets in the repo),
policies, auto actions, alerts via Phase 21/27, live presence, auto-lock. Feeders use a device
simulator over HTTP. Zero-error gate ×3. Local commit. Report + Deploy sheet (device setup steps) +
client documents.
~~~

## 15. Client documents
**NEW:** Attendance now runs automatically: punches arrive from the machines by themselves, each day
is calculated at once, missed punches are reminded the next morning, late-mark and missed-punch rules
apply with a clear reason, overtime goes to the manager for approval, managers get a daily report at
10:30, the month locks on the 2nd and goes straight into payroll, and a Live Board shows who is inside
now.

**Test book:**
- **HR:** Devices → each device shows "Online". ✔️ The last punch time is recent.
- **Employee:** miss an out-punch. ✔️ A reminder at 10:00 next day; regularise in ESS.
- **Manager:**
  1. OT request appears. ✔️ Approve.
  2. 10:30 email. ✔️ The Excel lists your department.
- **HR Head:** Policies → Late-mark ON. ✔️ The 3rd late mark shows "−0.5 day" with the reason.
- **Owner:** Live Board TV. ✔️ Inside-now per department.

---
