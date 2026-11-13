# PHASE 29 — Workplace operations: Task Management, Shift Roster & Handover, Visitor Management, Canteen

## 1. Goal
Daily plant life from V40, connected to everything else:
- tasks for every employee, created by people and by automation;
- shift rotation with a formal handover;
- visitors from pre-approval to gate to exit;
- canteen meals with entitlement, cost and a payroll deduction.

All of them feed Home, the dashboards and mail automation.

## 2. Pages (V40 tabs exactly)
| Page | Tabs |
|---|---|
| ops-tasks | Task Register / Department Board / My Tasks / Due & Overdue / Workload / Task Approval |
| ops-shift-roster | Shift Rotation & Roster (+ Handover tab) |
| ops-visitors | Visitor Register / Pre-Approval / Gate Check-In / Inside Plant / Check-Out / Visitor Report |
| ops-canteen | Meal Register / Employee Consumption / Department Cost / Rate Master / Vendor Billing / Canteen Report |

The kiosk (/gate/kiosk, Phase 18) gets a "Visitor" button, and a canteen counter screen /canteen/counter
is added.

## 3. Rules
**Tasks:**
- fields (V40): Task ID, Task, Department, Assigned To, Assigned By, Priority, Start Date, Due Date,
  Progress %, Status, Approval Status, Remarks — plus plant, project, linked record, checklist,
  dependencies, recurrence;
- status Open → In Progress → (Blocked) → Done → Approved (if approval is required) / Cancelled;
- a finish-to-start dependency blocks Start;
- recurring tasks (daily/weekly/monthly/every N days) create the next task on completion or on schedule;
- overdue = due < today and not Done;
- automation (Phase 27 CREATE_TASK) can create tasks.

**Shift handover:**
- the outgoing in-charge submits: production status per line, issues, safety, pending jobs, materials short;
- the incoming in-charge must **Accept** (or Reject with a reason) within 30 minutes of shift start,
  otherwise an alert;
- rotation rules from Phase 15.

**Visitors:**
- fields (V40): Visit Pass No, Visitor Name, Mobile, Company, Person To Meet, Department, Visit Date,
  In Time, Out Time, Purpose, Vehicle No, ID Proof, Status, Approval Status — plus photo, planned out
  time, plant, items carried;
- flow: pre-registered (by the host, or at the gate) → host approves (push) → pass VP/<PLANT>/<FY>/00001
  with QR → check-in at the kiosk (photo, ID last 4 digits only) → inside → check-out;
- overstay = now > planned out + 30 minutes → alert the host + security;
- items carried in/out → a Phase 18 gate pass;
- data kept 1 year, then anonymised (DPDP).

**Canteen:**
- meal types and dated rates with GST % and employee share %;
- entitlement by shift;
- a coupon is issued by QR scan or employee code; one meal of a type per person per day unless an
  extra coupon is allowed;
- the monthly employee share → Payroll INPUT component CANTEEN_DED;
- the company share → GL Staff Welfare;
- the vendor bill is checked against meals served (variance > 2 % → approval);
- waste log.

**Plants:** everything belongs to a plant; boards and reports follow the selected plants (R-37).

## 4. Database (<ts>_phase29_workplace)
- tasks(task_no T/<PLANT>/<FY>/00001, unit_id, title, description, department_id, assigned_to,
  assigned_by, priority, start_date, due_date, progress_pct, status, approval_required, approval_status,
  project_id, linked_doc_type, linked_doc_id, recurrence jsonb, parent_task_id, remarks, done_at,
  approved_at, version)
  + task_dependencies(pred, succ, no cycles) + task_checklist(task, seq, text, done, done_by)
  + task_comments
- shift_handovers(unit_id, department_id, date, shift_id, outgoing_user, incoming_user,
  lines jsonb [{line, planned, actual, issue}], issues, safety_note, pending_jobs jsonb, materials_short,
  status DRAFT/SUBMITTED/ACCEPTED/REJECTED, accepted_at, reject_reason)
- visitor_passes(pass_no, unit_id, visitor_name, mobile, company, host_user_id, department_id,
  visit_date, planned_in, planned_out, purpose, vehicle_no, id_type, id_last4, photo_document_id,
  items jsonb, status PRE_REGISTERED/APPROVED/INSIDE/OUT/REJECTED/NO_SHOW/CANCELLED, approved_by/at,
  in_time, out_time, gate_pass_id, qr_token_hash, anonymised_at)
- canteen_meal_types(code, name, sort); canteen_rates(unit_id, meal_type, rate, gst_pct,
  employee_share_pct, effective_from); canteen_entitlements(unit_id, shift_id, meal_type)
- canteen_coupons(coupon_no, unit_id, person_kind EMPLOYEE/CONTRACT/VISITOR, person_id, date, meal_type,
  qty, rate, gst, total, employee_share, company_share, payment_mode PAYROLL/CASH/FREE, status, served_at)
  — unique (person, date, meal_type) unless an extra coupon is allowed
- canteen_waste(unit_id, date, meal_type, kg, reason)
- canteen_months(unit_id, month, status OPEN/CLOSED, payroll_batch_id, journal_id)
- canteen_vendor_bills(unit_id, month, supplier_id, meals_billed, meals_served, variance_pct,
  purchase_invoice_id, approval_id)
- Counters: tasks/shifts/visitors/meals → dept_work_counters, user_work_counters.

## 5. Logic and examples
**Workload:** per person: open tasks, overdue, approvals waiting; red above 10 open or 3 overdue.
Example: Ravi 12 open, 4 overdue → red.

**Recurrence:** "Daily 5S check, Mon–Sat, 08:30, Production TAL" → the next task is created at 00:05
each working day (idempotent per date).

**Handover:** shift A ends 15:30; the handover is submitted 15:20; B shift's in-charge doesn't accept by
16:00 → alert to the department manager "Handover A→B not accepted".

**Visitor overstay:** planned out 16:00; at 16:31 still INSIDE → alert to the host + security; the Live
board shows them in red.

**Canteen example:** lunch rate ₹60, GST 5 % → ₹63.00; employee share 40 % → ₹25.20; company ₹37.80.
22 lunches in November → employee ₹554.40 (CANTEEN_DED in payroll), company ₹831.60.
- Month close journal: Dr Staff Welfare 831.60 + Dr Employee recoveries (via payroll) / Cr Canteen
  Payable 1,386.00.
- Vendor bills 1,410 meals vs 1,380 served → variance 2.17 % > 2 % → approval needed.

## 6. API
- CRUD /ops/tasks (+ start | done | approve | reopen | comment); GET /ops/tasks/board?dept=&unit=;
  GET /ops/tasks/workload
- CRUD /ops/handovers (+ submit | accept | reject)
- CRUD /ops/visitors (+ approve | reject | check-in | check-out); GET /ops/visitors/:id/pass.pdf;
  GET /ops/visitors/inside
- CRUD /ops/canteen/rates | entitlements | waste; POST /ops/canteen/scan {code};
  POST /ops/canteen/months/:month/close; CRUD /ops/canteen/vendor-bills

## 7. Screens
- **Tasks:** list + Kanban board (drag status, If-Match) + workload bars + "My Tasks" on phone with big
  Start/Done buttons + checklist ticks.
- **Handover:** a form with a line-by-line table; the incoming in-charge sees an "Accept / Reject"
  banner at login.
- **Visitor:** pre-register form (host can share a link to the visitor's mobile through SMS/email, opt-in);
  A6 pass PDF with QR; Inside Plant list with timers.
- **Canteen counter:** one large scan box, the last 5 served, today's counts per meal; a red full-screen
  flash for "Already served".

## 8. Messages
| Case | Message |
|---|---|
| blocked task | "Blocked by T/TAL/2627/00012 (not done)." |
| handover not accepted | "Accept the handover from {name} first." |
| no entitlement | "No {meal} entitlement for shift {s}." |
| already served | "Already served lunch today at 13:02." |
| visitor not approved | "{host} has not approved this visit yet." |
| month closed | "November canteen is closed." |

## 9. Audit & notifications
Task assigned / overdue / approval; handover submitted / not accepted; visitor arrived (host push),
overstay; canteen month closed (HR + Finance); vendor variance approval.

## 10. Tests
- dependency cycles refused; recurrence idempotent;
- handover timers;
- visitor state machine, overstay, anonymisation after 1 year;
- canteen double-serve, entitlement, the example money to the paisa, payroll input total = the sum of
  shares, journal balanced.
- **Feeders:** 40 tasks (with dependencies and recurrence) by managers; handovers for 2 weeks of
  shifts; 25 visitors through the kiosk screens; 600 canteen scans through the counter screen.
- **Flows:** (a) a task chain finishes in order; (b) a visitor overstays; (c) canteen month close →
  payroll run shows the deduction.

## 11. Acceptance
- [ ] Tasks, handover, visitors and canteen work like V40, fill Home and the dashboards, and connect
      to Gate, Payroll and GL.
- [ ] Zero-error gate. Client documents updated.

## 12. Out of scope
Turnstiles, meal pre-booking app.

## 13. Owner check
1. Pre-register a visitor. Does the host get a push, and does the QR pass print?
2. Scan the same person twice for lunch. Does it say "Already served"?
3. Close the canteen month. Does payroll show the deduction?

## 14. Build prompt
~~~
Read …, PHASE-29.md, V40 v11*/v14*/v16* (reference). Build §4–§7; wire Phases 15/16/18/9/7 and
counters. Feeders/flows §10. Zero-error gate ×3. Local commit. Report + Deploy sheet + client documents.
~~~

## 15. Client documents
**NEW:** Task Management (board, my tasks, overdue, workload, recurring tasks); Shift Roster with a
proper handover; Visitor Management with QR pass and overstay alerts; Canteen with scanning, cost and
automatic payroll deduction.

**Test book:**
- **Manager:** ＋ Task with a dependency. ✔️ The second can't start before the first is done.
- **Security:** Kiosk → Visitor → check in. ✔️ The host gets a push.
- **Canteen:** scan twice. ✔️ "Already served".
- **HR:** Canteen → Close month. ✔️ Payroll shows CANTEEN_DED.
