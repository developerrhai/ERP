# PHASE 15

# PHASE 15 — HRMS (employees, time, leave, expenses, talent, exit, ESS)
(ERRATA E-22 keys EMPLOYEE_PAYABLE / EMPLOYEE_ADVANCE; E-25 holiday calendars are owned here.)

## 1. Goal
Replace the 12 HRMS prototype pages with real, audited records.
- Factory shift workers and staff become employees linked to user accounts, so they can use ESS.
- Attendance is computed from biometric punches that **arrive by themselves** from the punching machines
  (automatic fetch, §3 and §5 H2); each employee carries his own biometric code. Files stay as a fallback.
- Leave follows dated policy rows.
- Expenses post to the GL.
- Exit hands a clean F&F record to payroll.

**Phase 16 depends on:** attendance_period_summary (paid days, LOP, OT), leave balances / encashment,
bank / PAN / UAN / ESIC, and the F&F handoff.

All statutory numbers live in hr_statutory_rules with effective_from, source_url and needs_review (R-23).

## 2. Pages (prototype tabs kept)
| Page | Tabs → real behaviour |
|---|---|
| hr-employees | Directory, Employment Profile (Employee 360°: photo + 14 facts), Personal & Statutory (masked IDs), Organization Assignment (dated history), Documents, Lifecycle (timeline). Plus a Virtual ID card PDF; the company name comes from settings (fixes the hard-coded "RHAI TECHNOLOGY"). |
| hr-recruitment | Requisitions, Candidate Pipeline (board), Interviews, Offers, Joining Forecast, Analytics |
| hr-onboarding | Queue, Document Collection, Joining Checklist, IT Asset Allocation, Induction, Probation |
| hr-attendance | Daily, Monthly Calendar, Late/Early/OT, Device Logs (import), Regularization, Analytics |
| hr-shifts | Shift Master, Rosters, Rotation Rules, Night Shift, Weekly Off & Holiday, Coverage |
| hr-leave | Requests, Balances, Approval Queue, Calendar, Policy Rules, Analytics |
| hr-expense | Claims, Receipts & Categories, Policy Validation, Approval Queue, Payment Link, Analytics |
| hr-performance | Cycles, Goals & KRAs, Check-ins, Ratings, Calibration, Analytics |
| hr-training | Calendar, Programs, Participants, Assessments, Certificates (expiry), Effectiveness |
| hr-documents | Documents, Expiry Tracker, Verification, Access Control, Acknowledgements, Compliance |
| hr-exit | Cases, Resignation Approval, Clearance, Final Settlement (handoff), Exit Interview, Attrition |
| hr-ess | My Profile, My Attendance, My Leave, My Payslips (shows "available after Phase 16" until then), My Expenses, HR Requests |

## 3. Rules (law status verified 4-Nov-2026; every value is data)
- **Labour Codes** (Wages, IR, SS, OSH) are in effect from 21-Nov-2025.
- **Maharashtra** has only published draft 2026 rules. Until they are final, the Factories Act /
  Maharashtra Factories Rules and the MH Shops & Establishments Act 2017 still apply.
  - Every rule row carries a law_basis (FACTORIES_ACT / OSH_CODE / MH_SE_2017 / MATERNITY …) and an
    effective date. HR switches the basis by adding rows; no code change.
- **Seeded rows (all needs_review):**
  | Rule | Value |
  |---|---|
  | Daily / weekly hours | 9 h/day (Factories Act; 8 h under OSH), 48 h/week |
  | Rest | after 5 h |
  | Spread-over | 10.5 h |
  | OT pay | 2× ordinary wages, with worker consent |
  | OT cap | quarterly cap row (115 / 125 / 144 h — unresolved) |
  | Earned leave | 1 day per 20 days worked |
  | EL eligibility | 180 days (Codes) vs 240 (old) |
  | Carry-forward cap | 30 (Factories / OSH) vs 45 (MH S&E) |
  | Casual leave | 8 days (MH S&E) |
  | Rounding | ≥ 0.5 day rounds up |
  | F&F | due within 2 working days (Code on Wages s.17(2)) |
  | Maternity | 26 weeks (12 after two children) |
- **DPDP** (Rules notified 13-Nov-2025; most duties from about 13-May-2027): build now —
  purpose-limited fields, access log, encryption, retention (rejected candidates purged), breach hook,
  privacy notice at the first ESS login and on the candidate form.
- **Aadhaar** (UIDAI vault rule):
  - the full number only in employee_identity_vault (AES-256-GCM, via the existing applyAadhaar engine);
  - everywhere else only the last 4 digits;
  - optional, and never used as the attendance key.
- **Biometric devices — two ways in, one punch table:**
  - **File import:** ZKTeco / eSSL attlog.dat is tab-separated with no header: user_id, timestamp, verify, in/out, workcode.
    Vendor CSVs differ, so imports use mapping profiles, each tested against a sample file.
  - **Automatic fetch (the normal way):** the punching machine sends its logs to the vendor's web service
    (for example the "Smart Office" web API), and the ERP **pulls** them on a schedule. Nobody uploads a file
    and nobody types a punch. One adapter per vendor behind a common interface; the first adapter is the
    Smart Office style `GetDeviceLogs` call (a date range, optionally one machine serial number; the answer
    is a list of `{EmployeeCode, LogDate or DateTime "YYYY-MM-DD HH:MM:SS", SerialNumber}`).
  - **Each employee carries his own biometric code** (`employees.biometric_code`, unique among active
    employees, entered on the Employment Profile, in the onboarding checklist and in the employee import).
    It is the only key between a machine log and an employee. It is never the Aadhaar number.
  - Direction is **not trusted** from the machine or guessed from odd/even counts (a double tap would flip
    every later punch): the first punch of the day window is IN and the last is OUT (algorithm A).
  - The vendor API key is a **secret**: kept in the secret store / environment, referenced by name from
    `attendance_devices.api_key_ref`, never in code, never in the database, never in a log or URL that is
    printed. Every value of the fetch (interval, overlap, timeout, failure limit) is data on the device row.
  - Reference (read only, never copy keys from it): the sister project `kurumkar-classes`,
    `backend/src/services/smartOffice.service.js` and `smartOfficeWatcher.js`. Keep: a pull from the vendor
    API by date, the biometric code per person, a one-minute watcher, a manual override that a real punch may
    replace. **Do not repeat:** the API key and a default server address written in the code; the API url
    (with the key) printed to the log; the "last punch seen" kept only in memory (lost on every restart);
    no raw punches stored (only the computed result); direction by odd/even; unknown codes only printed.
- **Designs adopted from ERPNext HR / Odoo:** punches kept separate from computed attendance; an
  immutable leave ledger; dated policy assignments.

## 4. Database (<ts>_phase15_hr_core / _time / _leave / _talent / _exit_ess)
**Core:**
- employees(emp_code EMP/<UNIT>/<0001>, user_id (nullable unique), first/middle/last name, gender, dob,
  marital_status, mobile (unique among active), personal/official email, photo_document_id,
  employment_type_code PERMANENT/PROBATION/FIXED_TERM/CONTRACT/TRAINEE/APPRENTICE,
  worker_category WORKER/STAFF, joining_date, confirmation_date, probation_end,
  status ACTIVE/ON_NOTICE/SEPARATED/ABSCONDING, biometric_code unique, pan, aadhaar_last4, uan, esic_ip,
  pf_applicable, esic_applicable, blood_group, addresses, notice_days, law_basis_code, contractor_name)
- employee_identity_vault(employee PK, aadhaar_enc, ref_key, key_version) — separate grants
- employee_bank_accounts(ifsc, account_enc, last4, is_primary, verified_at, effective_from)
- employee_emergency_contacts, employee_family (nominees)
- employee_assignments(effective_from/to, unit, department, designation, cost_centre,
  reporting_manager_employee_id, grade, reason JOIN/TRANSFER/PROMOTION/REDESIGNATION/MANAGER_CHANGE, remarks)
  - no overlapping dates (exclusion constraint); view v_employee_current
- pii_access_log(user, employee, field, purpose, at, ip)
- hr_statutory_rules(law_basis_code, rule_key MAX_DAILY_MIN/MAX_WEEKLY_MIN/OT_MULTIPLIER/
  OT_QUARTER_CAP_MIN/EL_DAYS_PER_WORKED/EL_ELIGIBILITY_DAYS/EL_CARRY_CAP/FNF_DUE_WORKING_DAYS/
  REST_AFTER_MIN/SPREAD_OVER_MIN, value, effective_from, source_url, needs_review, verified_by)

**Recruitment and onboarding:**
- job_requisitions; candidates(consent_at, purge_after); candidate_applications; interviews;
  interview_feedback
- offers(offered_ctc, join_date, status DRAFT/PENDING/APPROVED/SENT/ACCEPTED/DECLINED/WITHDRAWN, letter_document_id)
- onboarding_templates + tasks(owner role, due offset, doc_type, blocking); onboarding_cases + tasks

**Time:**
- shifts(code, start, end, break_min, grace_in/out, half_day_min, absent_below_min, full_day_min,
  ot_start_after_min, ot_block_min, ot_min_min, is_night, crosses_midnight, punch window before/after)
- shift_rotation_rules(pattern); shift_rosters(employee, date, shift or OFF; unique)
- weekly_off_patterns + employee_weekly_off
- **holiday_calendars(unit, year) + holidays(date, name, type)** — the owner of E-25
- attendance_devices(code, name, vendor FILE_ZKTECO/FILE_ESSL/API_SMART_OFFICE, unit, location, serial_no,
  base_url, api_key_ref (name of the secret, never the key), poll_interval_sec, overlap_min, timeout_ms,
  fail_limit, offline_alert_min, cursor_at (last punch time safely fetched), last_ok_at, last_error,
  consecutive_failures, active)
- attendance_import_profiles(vendor, source_kind FILE/API, field map such as EmployeeCode → biometric_code,
  LogDate|DateTime → punch_at, SerialNumber → device, timezone Asia/Kolkata) — each tested against a sample
  file or a recorded API answer
- attendance_imports(sha256 unique) for files
- **attendance_sync_runs**(device, window_from/to, trigger SCHEDULE/MANUAL/BACKFILL, started_at, finished_at,
  fetched, inserted, duplicates, unknown_codes, status OK/PARTIAL/FAILED, error, triggered_by) — one row per
  fetch, so HR can see what came in and when
- attendance_punches(employee, device, punch_at, direction, source DEVICE/API/ESS_GEO/MANUAL, import or
  sync_run; unique per device + code + time; the raw biometric code is kept even when it matches nobody)
- attendance_punch_exceptions(device, biometric_code, punch_at, sync_run, resolved_employee_id, resolved_at)
  — punches with an unknown code wait here and are attached when the code is linked to an employee
- attendance_days(employee, date, shift, first_in, last_out, worked_min, late_min, early_min,
  ot_candidate_min, ot_approved_min, status P/HD/A/WO/H/L/LHD/MIS/WOP/HP, flags, locked, rule_snapshot)
- attendance_regularisations; ot_approvals(minutes, decision OT_PAY/COMP_OFF)
- attendance_period_summary(employee, period, payable_days, present, wo, holiday, paid_leave, lop_days,
  ot_min, night_shifts, late_marks, locked_at)

**Leave:**
- leave_types(code EL/CL/SL/ML/COMP/LOP/OD, paid, half_day, sandwich, sandwich_cross_app,
  requires_doc_after_days, max_per_application, encashable, applies_to_category)
- leave_policies + rules (accrual WORKED_DAYS/MONTHLY/ANNUAL_GRANT/NONE, rate, eligibility, carry cap,
  accumulation cap, encash, dates)
- leave_policy_assignments (dated)
- leave_ledger(employee, type, txn_date, kind ACCRUAL/GRANT/AVAIL/REVERSAL/CARRY_FWD/LAPSE/ENCASH/
  ADJUST/COMP_CREDIT/COMP_EXPIRE, days signed, ref, expires_on) — **append-only**; balance = SUM
- leave_applications(from/to, half days, days_computed, reason, attachment, status, approval)

**Expense:**
- expense_categories(limits by grade, gl_key, receipt_required_above)
- expense_claims + lines(date, category, amount, GST, receipt, policy_breach)
- employee_advances

**Talent:** training_programs/sessions/participants(certificate, valid_until); perf_cycles, perf_goals
(Σ weight = 100), perf_reviews.

**Exit and ESS:**
- exit_cases(type RESIGNATION/TERMINATION/RETIREMENT/DEATH/ABSCONDING/CONTRACT_END, resignation_date,
  notice_days, expected_lwd, approved_lwd, shortfall_days, waived, status)
- exit_clearance_tasks, exit_interviews
- fnf_handoffs(LWD, paid_days_last_period, el_encashable_days, notice_shortfall_days, recoveries,
  advances_outstanding, due_by, status READY/CONSUMED)
- hr_requests (ESS tickets)

## 5. Algorithms (packages/calc/hr)
**A. Attendance day** (job hr.attendance.compute after each import and nightly):
- Shift from the roster (else the default shift).
- Punch window = shift start − before … end + after. A night shift belongs to its **start date**.
- First punch = IN, last = OUT (device direction ignored). A single punch → MIS.
- worked = out − in − break (break only when the span > REST_AFTER).
- late = in − start (once grace is exceeded, the full minutes count); early = end − out.
- Status by worked minutes: ≥ half_day → P (HD if < full_day); < absent_below → A.
- Weekly off / holiday with punches → WOP / HP; without punches → WO / H. Approved leave overrides → L / LHD.
- ot_candidate = floor((worked − shift net) / block) × block, if ≥ minimum. **Not paid until approved**,
  and approval is refused above the quarterly cap.
- Flags EXCEEDS_DAILY / EXCEEDS_WEEKLY. The late-mark penalty is company policy, off by default.
- **Example:** shift 07:00–15:30, break 30, grace 10, full day 450, half 240, OT block 15, min 30;
  punches 07:14 and 18:05 → worked 621, late 14, OT candidate 135, status P, EXCEEDS_DAILY when the
  daily limit is 540.
- **Night example:** 22:52 → 07:20 next day → counted on the start date, worked 478, P, night_shift = 1.

**B. Period summary:**
- payable = P + 0.5 × HD + WO + H + paid leave.
- LOP = A + unresolved MIS (by policy) + LOP leave + 0.5 × unpaid HD.
- Locking the summary locks its days; unlocking needs the HR head and a reason.
- **Completeness check before summarising or locking:** every active machine has fetched up to the end of the
  period (`cursor_at` ≥ period end) and no unknown-code punch of the period is still unresolved. If not, HR
  sees which machine or code and must tick "I accept" with a reason; the exception is audited. Payroll
  (Phase 16) therefore never receives a month with silently missing punches.

**C. Leave accrual** (monthly on the 1st; year end on 1-Jan):
- WORKED_DAYS (factory EL): worked = P + 0.5 × HD + paid leave + lay-off / maternity days. If ≥
  eligibility → round_half_up(worked / 20). Examples: 250 → **13**; 175 with eligibility 180 → 0.
- MONTHLY (staff): pro-rata from the joining date.
- Carry = min(closing, cap). The excess is ENCASH (if allowed; sent to payroll) or LAPSE. CL lapses at
  year end. Every step is a ledger row.

**D. Leave days:**
- Sandwich is a per-type flag, **default OFF** (EL never; CL may be ON).
- cross_app ON stops splitting applications around a weekend.
- Example: CL Friday + Monday → 4 days with sandwich ON, 2 with it OFF.
- Half days only on the first or last day. Balance check: available − pending ≥ requested. Only LOP can go negative.

**E. Comp-off:**
- An approved WOP/HP with ≥ half_day worked → COMP_CREDIT (expires +90 days) **or** OT pay, never both.
- An expiry job writes COMP_EXPIRE.

**F. Notice and last working day:**
- expected LWD = resignation + notice days; shortfall unless waived.
- F&F due = LWD + FNF_DUE_WORKING_DAYS.
- At LWD + 1, job hr.exit.finalise: SEPARATED, user deactivated, assignment closed.

**G. Scope:**
| Scope | Who | Sees |
|---|---|---|
| SELF | employee | own record through ESS |
| TEAM | manager | reports via recursive tree, depth ≤ 10; attendance / leave / approvals only — no salary, bank, Aadhaar or PAN |
| DEPT | department head | their departments |
| UNIT | HR executive | their units |
| ALL | HR head / director | everything |

- Sensitive fields need hr.sensitive.view, and every reveal is logged with a purpose.

**H. Imports:**
- Parse with the device profile, map biometric_code, insert ON CONFLICT DO NOTHING.
- Unknown codes go to an exceptions list. A re-uploaded file (same sha256) → IMPORT_DUPLICATE.
- Employee import uses the Phase 4 wizard.

**H2. Automatic punch fetch** (job `hr.attendance.sync`, every device's `poll_interval_sec`, default one
minute; pg-boss, one run at a time per device):
1. Window = `cursor_at − overlap_min` … now (Asia/Kolkata business day; a night shift may reach into the
   previous date, so the window never starts later than the previous day's punch window). The overlap
   re-reads recent punches that the machine uploaded late; the unique key makes that harmless.
2. Call the vendor adapter with the device's API key (read from the secret store at call time) and the date
   range. A timeout, a non-list answer, or an answer that says `status: false` is a **failed run**: nothing
   is written, `consecutive_failures` goes up, and the old cursor stays. After `fail_limit` failures in a row
   the device is shown "not reporting" and HR is notified; the first good run clears it.
3. Normalise each log: biometric code (trimmed text), `punch_at` as an instant in Asia/Kolkata (+05:30),
   machine serial. Insert `ON CONFLICT DO NOTHING` on (device, code, time). Codes that match no active
   employee go to `attendance_punch_exceptions` (counted, never lost, never printed with a key).
4. Move `cursor_at` to the latest punch time **inside the same transaction** as the inserts, so a restart
   or a crash never loses or repeats a punch.
5. Enqueue `hr.attendance.compute` for only the (employee, date) pairs that received a new punch, and for
   today's late/early marks. Locked periods are not recomputed (ROSTER_LOCKED); the punch is still stored.
6. Today's view is live: an employee's first punch appears on the Daily view within one interval.
7. HR can run **Sync now** for one device, and a **Backfill** for a date range (limit per request is data),
   for the days a machine or the internet was down. Backfill and schedule share the same idempotent path.
8. Linking a biometric code to an employee later attaches that code's waiting exception punches and
   recomputes those days. Changing or clearing a code writes an audit row; the old punches stay with the
   employee they were matched to.
9. A manual regularisation or an approved OT/leave overrides the computed day, but never deletes a punch.
   A real punch that arrives after a regularisation shows a "punch received after regularisation" flag for
   HR instead of silently changing the approved day.
10. Optional (off by default, per company setting): send the employee a "Punch recorded at HH:MM" message
    in ESS when a new punch arrives.

**I. Expense GL:**
- Approved claim: Dr category gl_key (cost centre) [+ eligible input GST] / Cr EMPLOYEE_PAYABLE (party EMPLOYEE).
- Advance: Dr EMPLOYEE_ADVANCE / Cr bank. Settlement nets the advance; cancellation reverses.

## 6. API (/api/v1/hr)
- **Employees:** /employees (+ /:id/assignments, /link-user, /reveal {field, purpose}, /id-card.pdf, /360)
- **Recruitment:** /requisitions, /candidates, /applications/:id/move, /interviews (+ feedback),
  /offers (+ submit | send | accept | decline | convert, letter.pdf)
- **Onboarding:** /onboarding-cases, /onboarding-tasks/:id/complete
- **Time:**
  - /shifts, /rotation-rules, /rosters (bulk PUT by week), /holiday-calendars, /holidays, /weekly-offs
  - /attendance/imports (?dry_run=1)
  - /attendance/devices (+ /:id/test-connection | sync-now | backfill {from, to}); the API key is never
    returned and never accepted in a normal save (it is set through the secret store)
  - /attendance/sync-runs (list, one run with its counts and errors), /attendance/exceptions (+ /:id/resolve)
  - /employees/:id/biometric-code (PUT; unique among active employees)
  - /attendance/days (+ /:id/recompute)
  - /regularisations, /ot-approvals
  - /attendance/periods/:p/summarise | lock | unlock
- **Leave:** /leave-types, /leave-policies, /leave-assignments, /leave/balances, /leave/ledger,
  /leave/applications (+ submit | cancel), /leave/preview
- **Expense:** /expense-categories, /expense-claims, /advances
- **Talent:** /training/*, /performance/*
- **Exit:** /exits (+ submit | clearance | interview | handoff)
- **ESS:** /ess/me | attendance | leave | expenses | requests — always use ctx.employeeId and ignore any
  id sent by the client
- **Rules:** /statutory-rules (+ verify)

Approval doc types: LEAVE, REGULARISATION, OT, EXPENSE, OFFER, REQUISITION, EXIT.

## 7. UI
- **Employee 360:** real photo (EXIF stripped). ID card PDF: company, photo, code, designation, unit,
  blood group, emergency mobile, QR of the code. **Never Aadhaar.**
- **Organization Assignment:** timeline plus an "Apply change from date" drawer.
- **Device Logs:** upload → dry run (ok / duplicate / unknown) → commit → progress.
  - **Machines panel (automatic fetch):** one card per machine: name, last good sync, next sync, punches
    received today, unknown codes waiting, and a green / amber / red state ("not reporting for 25 minutes").
    Buttons: Test connection, Sync now, Backfill dates. A run list shows each fetch with its counts.
  - **Unknown codes list:** each code with its punch count and a "Link to employee" picker.
  - **Employment Profile:** a "Biometric code" field with a plain error if another active employee has it.
- **Monthly calendar:** colour-coded; click a day for punches and Regularise.
- **Roster:** week grid with drag-fill from rotation rules and a coverage bar.
- **ESS (mobile first, 48 px buttons):** 5 tiles — Today's punch, Apply leave, My balance, Claim
  expense, Ask HR. Leave in 3 steps showing "days counted" and "balance after".
- **Manager inbox:** one-tap approve / reject with a reason.

## 8. Messages
| Code | Message |
|---|---|
| EMP_DUP_MOBILE | "This mobile is already used by active employee EMP/…" |
| EMP_PAN_INVALID | "PAN must look like ABCDE1234F" |
| AADHAAR_INVALID | "Aadhaar number must be 12 digits (Verhoeff check failed)" |
| ASSIGN_OVERLAP | "Another assignment already covers these dates" |
| MANAGER_CYCLE | "This manager reports (directly or indirectly) to this employee" |
| ROSTER_LOCKED | "Attendance for this period is locked" |
| IMPORT_DUPLICATE | "This file was already imported on …" |
| PUNCH_UNKNOWN_CODE | "{n} punches have codes not linked to any employee" |
| BIO_CODE_DUP | "This biometric code is already used by active employee EMP/…" |
| DEVICE_API_FAIL | "The attendance machine service did not answer. Last good sync: {time}" |
| DEVICE_SYNC_RUNNING | "A sync for this machine is already running" |
| DEVICE_BACKFILL_RANGE | "Choose at most {n} days at a time" |
| DEVICE_NO_KEY | "No access key is set for this machine. Ask the administrator" |
| LEAVE_INSUFFICIENT | "You have {x} days; this needs {y} days" |
| LEAVE_OVERLAP | "You already have leave on these dates" |
| LEAVE_BACKDATE_LIMIT | "Leave older than {n} days needs HR" |
| LEAVE_DOC_REQUIRED | "Attach a medical certificate for more than {n} days" |
| OT_QUARTER_CAP | "Approving this exceeds the quarterly overtime limit" |
| OT_NO_CONSENT | "The worker has not consented to overtime" |
| EXP_RECEIPT_REQUIRED | "Receipt required above ₹{n}" |
| EXP_LIMIT | "Above the limit for your grade; needs extra approval" |
| GOAL_WEIGHT_SUM | "Goal weights must total 100" |
| EXIT_PENDING_CLEARANCE | "{n} clearance items open" |
| RULE_NEEDS_REVIEW (HR users only) | "A statutory rule used here is not yet verified" |

## 9. Audit & notifications
- **Audit:** every change with before/after; sensitive values masked; PII reveals logged; period unlock reasons.
- **Notifications:**
  - submissions and decisions;
  - MIS punch reminder at 10:00 the next day;
  - document / certificate expiry at 30 and 7 days;
  - probation ending in 15 days;
  - LWD in 7 days;
  - F&F due;
  - comp-off expiring in 7 days;
  - import finished with unknown codes;
  - a machine is not reporting for `offline_alert_min` minutes, and when it reports again (HR);
  - unknown biometric codes waiting after a sync (once a day, not once a minute);
  - candidate purge done.

## 10. Tests
- **Unit:**
  - §5 A–F examples; midnight shift; single punch;
  - grace 10 vs 11 min; OT floor, minimum and quarterly cap;
  - accrual 250 → 13, 175 → 0; carry / lapse / encash;
  - sandwich on/off and cross-application; half days;
  - comp-off expiry; LWD with holidays.
- **API:**
  - scope matrix of 5 scopes × 6 resources;
  - ESS id tampering refused; reveal logged;
  - assignment overlap; manager cycle;
  - import idempotency;
  - **automatic fetch against a recorded vendor answer (no real network):** the same window fetched twice
    inserts nothing the second time; an overlapping window only adds the new punches; the cursor survives a
    restart (read from the database, not memory); a late punch inside the overlap is picked up;
    an unknown code lands in the exceptions list and is attached when linked; a timeout, a non-list answer
    and `status: false` each leave the cursor and the punches untouched and raise the failure count;
    `fail_limit` failures flag the device and notify HR once; two runs for one device cannot overlap;
    a night-shift punch after midnight is counted on the shift's start date; the API key never appears in
    any log line, error message or API answer; a punch after a locked period is stored but not recomputed;
  - duplicate biometric code refused (BIO_CODE_DUP), and clearing a code is audited;
  - leave ledger is append-only (no UPDATE grant);
  - expense journal balanced + reversal;
  - offer → employee;
  - exit finalise deactivates the user.
- **E2E:** phone leave → manager approves → balance drops; import → calendar → regularise → summary.
- 3 clean runs.

## 11. Acceptance
- [ ] A ZKTeco .dat and an eSSL CSV import correctly.
- [ ] **Punches arrive by themselves:** with a machine linked to the vendor service, a punch made on the
      machine shows on the Daily view within two poll intervals, with no file and no typing, for an employee
      who has a biometric code; the same punch is never counted twice, even after a restart or a backfill.
- [ ] A machine that stops answering is shown "not reporting" and HR is told; when it comes back the missed
      punches are fetched and the days are right.
- [ ] No access key in the code, the database, the logs or any API answer.
- [ ] The calendar matches a hand sheet for 5 employees × 1 month, incl. a night shift.
- [ ] The summary feeds Phase 16 the exact paid days / LOP / OT.
- [ ] The full Aadhaar exists only, encrypted, in the vault; every screen and PDF shows only the last 4.
- [ ] No literal 48 / 180 / 20 / 2.0 in HR code.
- [ ] ESS works at 360 px.

## 12. Out of scope
Payroll (Phase 16), IR Code procedures / standing orders / contract-labour licensing, geofencing,
background-check APIs, portals, LMS content, Hindi/Marathi translation (Phase 20).

Also out: a machine **pushing** to the ERP directly (ADMS / vendor push protocols), and other vendor
adapters than the ones listed in §3. The automatic fetch (§5 H2) **is in scope**; it pulls from the vendor's
web service. Reading the machine's own memory over the network is not.

## 13. Owner check
1. Open an employee: real photo; the ID card shows only the last 4 Aadhaar digits?
2. Upload a real device file: "n imported, 0 unknown"?
2b. Give one worker his biometric code, punch on the real machine, wait one or two minutes: does the punch
    appear on Device Logs and the Daily view by itself? Unplug the internet of the machine for 30 minutes:
    does the card turn "not reporting", and after it returns, are the missed punches there?
3. Do one worker's late / OT minutes match HR's paper calculation?
4. Worker on a phone applies 1 CL: "Balance after: x"?
5. Manager approves: does the balance change?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md (R-01..R-24), ERRATA.md, PHASE-15.md, Phase 2–14
code as built. 1 migrations <ts>_phase15_* per §4 (lookup tables not CHECKs; seed only lookups +
hr_statutory_rules needs_review + source URLs; no demo employees); 2 packages/calc/hr with §5 examples
as tests first; 3 services: EmployeeService (dated assignments, user link, vault via applyAadhaar,
encrypted bank, reveal + pii_access_log), ScopeService, AttendanceImportService, pg-boss jobs
hr.attendance.sync (the automatic punch fetch of §5 H2: a vendor-adapter interface, the Smart Office style
adapter first, cursor and punches saved in one transaction, secret read from the store at call time, no
key in any log; contract tests on recorded vendor answers) / compute / summarise, hr.leave.accrue /
yearend, hr.compoff.expire, hr.exit.finalise, hr.candidates.purge; LeaveService (append-only ledger); ExpenseService via PostingService (register
EMPLOYEE_PAYABLE, EMPLOYEE_ADVANCE keys); approvals via ApprovalService; FnfHandoff; 4 API §6 with
ETag, Idempotency-Key, §8 codes; 5 UI 12 pages + ID card + offer letter PDFs + mobile ESS; 6 audit §9,
tests §10, 3 clean runs. Never hard-code a statutory number; never store full Aadhaar outside the vault.
Migrations local dev/test only (R-16). Never push; commit only if asked. Write PHASE-15-REPORT.md.


