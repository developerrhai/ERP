# PHASE 05

# PHASE 05 — Approval engine + notifications
(Read ERRATA.md first: E-03 no commit unless asked, E-11 endpoint paths, E-04 role levels.)

## 1. Goal & why
One approval engine on the server. Every business document from Phase 6 onward calls it, and nobody
can set Approved or Rejected by hand (R-06). Real in-app and email notifications are built in the
same phase.

**Prototype defects this fixes:**
- The requester could approve their own request.
- A Director could click through every level alone.
- approvalLimit was never checked.
- The department came from an editable field.
- Status was free text.
- Approved rows stayed editable.
- 147 pages with no amount always needed level 1 only.
- admin-approval opened the queue, not the matrix.
- The bell showed hard-coded counts.

**Today:** there are no approval tables. module_controls.approval_required exists. changeStatus
refuses Approved/Rejected. The Topbar bell is disabled. pg-boss arrives in Phase 4.

**Needs:** Phase 2 (roles with levels, users.approval_limit, departments), Phase 3 (units),
Phase 4 (lifecycle, lock matrix, submit hook).

## 2. Pages in scope
| Page | Screen |
|---|---|
| admin-approval ("Approval Matrix") | The **matrix editor**. An "Approval Center" button opens the center. |
| approval-matrix (non-menu) | Redirects to admin-approval. |
| Approval Center / My Approvals (/approvals; dashboard button "My Approvals (n)") | Tabs: Waiting for me · Submitted by me · All (in my scope) · Delegations. |
| notifications ("Notification Center") | Real list, filters, Preferences tab. |
| Bell drawer (Topbar 🔔) | Unread badge, latest 20, "Mark all read", "View all". |
| Approvals tab on every module page | Requests for this page, plus an "Approval journey" timeline in the record drawer. |
| scm-approval | **Phase 9** — the same Approval Center filtered to purchase documents. |

## 3. Business logic & research
**Sources (the builder re-checks the links):**
- SAP MM release strategy;
- Oracle AME (first responder wins, serial levels);
- ERPNext Workflow + Authorization Rule;
- Odoo double validation and the Approvals app;
- Zoho Books multi-level approval;
- COSO 2013 and PCAOB AS 2201 (segregation of duties);
- pg-boss; nodemailer.

**Rules adopted:**
1. **Matrix key** = department (required) + document type (page id, optional) + unit (optional).
   - The levels of one key form a **rule set**.
   - The most specific set wins as a whole; sets are never merged.
   - Order: dept+doctype+unit > dept+doctype > dept+unit > dept.
2. **Applicable levels** = every level whose threshold ≤ amount, in level order. Level 1 must start at ₹0.
3. **Levels run one after another.** Within a level, any one approver may decide (first responder).
   "2 of 3 must approve" is not in v1.
4. **Snapshot at submit:** the steps are copied when the request is created, so later matrix changes
   never affect requests in flight.
5. **Department** = the document's stored owner department (set at create, not editable).
   If it is empty, the page's module_controls.owner_department is used. Never the request body.
6. **"Approver by role"** means users who:
   - hold that exact role;
   - have "approve" on the page;
   - have access to the document's unit;
   - and whose home or extra departments include the document's department.
   Roles of level ≥ 70 (GM, CFO, Director) are company-wide. Super User and Administrator do not
   approve by default; they configure and may **Reassign** a stuck step, with a reason.
7. **Segregation of duties:**
   - the requester and the creator can never approve any level;
   - one user approves at most one level of a request.
8. **Limit check:** at the final level, the approver's approval_limit must be ≥ the amount.
9. **Documents without an amount:** levels 1..N, where N = the set's no_amount_levels (default 1).
   No limit check.
10. **Delegation:** from-user → to-user for a date range, optionally for one department only.
    - The delegate acts with the delegator's role and limit, but under their own segregation rules.
    - History shows "Ravi (on behalf of Meena)". One hop only.
11. **Escalation:** when due_at (= activated_at + sla_hours) passes, the escalate-to person is **added**
    to the pool and notified. Escalation never approves anything automatically.
12. **Outcomes:**
    - **Reject** → the document becomes Rejected and editable; resubmitting starts cycle + 1.
    - **Return** → the document goes back to Draft; a comment is required.
    - **Withdraw** (the requester, while pending) → Draft.
13. **approval_required = false** → Submit goes straight to Approved, recorded as AUTO_APPROVED evidence.

## 4. Database design
Migrations `<ts>_phase05_approval_engine` and `<ts>_phase05_notifications`. The first runs
`CREATE EXTENSION IF NOT EXISTS btree_gist`.
~~~
approval_rule_sets(id, department_id, doc_type null, unit_id null, no_amount_levels 1..10 default 1,
  active, version, audit cols, UNIQUE NULLS NOT DISTINCT(department_id, doc_type, unit_id))
approval_rules(id, rule_set_id cascade, level 1..10, threshold numeric(18,2) >=0,
  approver_role_id null, approver_user_id null, CHECK exactly one of role/user,
  sla_hours 1..720 default 48, escalate_role_id null, escalate_user_id null, UNIQUE(rule_set_id, level))
approval_requests(id, doc_type, doc_id, doc_code, doc_title, unit_id, department_id,
  amount numeric(18,2) null, rule_set_id, rule_set_version, cycle default 1,
  status PENDING|APPROVED|REJECTED|RETURNED|WITHDRAWN|CANCELLED, current_level, total_levels,
  requested_by, requested_at, decided_at, doc_version, version,
  UNIQUE (doc_type, doc_id) WHERE status='PENDING')
  INDEX (status, department_id), (requested_by, status), (doc_type, doc_id)
approval_steps(id, request_id cascade, level, rule_id, threshold, approver_role_id, approver_user_id,
  limit_required, status WAITING|PENDING|APPROVED|REJECTED|RETURNED|CANCELLED,
  activated_at, due_at, escalated_at, escalate_role_id, escalate_user_id,
  acted_by null, on_behalf_of null, acted_at, comment varchar(1000), UNIQUE(request_id, level))
  INDEX (status, due_at)
approval_step_assignees(step_id, user_id, via ROLE|USER|DELEGATION|ESCALATION|REASSIGN,
  on_behalf_of null, PK(step_id, user_id))
approval_actions(id, request_id, step_id null, action SUBMIT|AUTO_APPROVED|APPROVE|REJECT|RETURN|
  WITHDRAW|ESCALATE|REMIND|REASSIGN|CANCEL, actor_id null, on_behalf_of null, comment,
  from_status, to_status, at, idempotency_key null,
  UNIQUE(step_id) WHERE action IN ('APPROVE','REJECT','RETURN'),
  UNIQUE(request_id, actor_id) WHERE action='APPROVE')          -- append-only
approval_delegations(id, from_user_id, to_user_id <> from, department_id null, from_date, to_date
  (>= from, <= 90 days), reason, status ACTIVE|REVOKED, audit cols,
  EXCLUDE USING gist (from_user_id WITH =, daterange(from_date,to_date,'[]') WITH &&) WHERE ACTIVE)
notifications(id, user_id cascade, type, severity INFO|ACTION|WARN, title, body, link, entity_type,
  entity_id, dedupe_key null, created_at, read_at, emailed_at, digested_at,
  UNIQUE(user_id, dedupe_key), INDEX(user_id, read_at, created_at desc))
notification_preferences(user_id, type, in_app default true, email OFF|INSTANT|DIGEST default INSTANT,
  PK(user_id, type))
email_outbox(id, to_email, subject, html, text, status QUEUED|SENT|FAILED|SKIPPED, attempts,
  last_error, created_at, sent_at)
~~~

**Seed** (from the prototype matrix, 10 departments excluding Administration; SLA 48 h; each level
escalates to the next level's role):
| Level | Threshold | Approver |
|---|---|---|
| L1 | ₹0 | Department Manager |
| L2 | ₹50,000 | Department Head |
| L3 | ₹2,00,000 | General Manager |
| L4 | ₹10,00,000 | Director (CFO for Finance) |

Notification types are seeded too. No fake requests or notifications.

## 5. Services & algorithms
~~~ts
interface ApprovalDocHandler {
  snapshot(tx, docId): Promise<{code; title; amount: Decimal|null; department: string; unitId; createdBy; status; version}>;
  onSubmitted(tx, docId, req): Promise<void>;  // doc -> 'Pending Approval'
  onApproved (tx, docId, req): Promise<void>;  // doc -> 'Approved' (module may post next)
  onRejected (tx, docId, req): Promise<void>;  // doc -> 'Rejected'
  onReturned (tx, docId, req): Promise<void>;  // doc -> 'Draft' (also withdraw)
}
ApprovalService.register(docType, handler)   // generic-records handler registered for all generic pages
ApprovalService.submit(caller, docType, docId, opts:{docVersion, idemKey})
ApprovalService.approve|reject|return(caller, requestId, {comment, version, idemKey})
ApprovalService.withdraw(caller, requestId); reassign(admin, stepId, userId, reason)
ApprovalService.statusOf(docType, docId)
~~~
- submit is called **only from the server**. The engine reads amount, department and unit from
  handler.snapshot inside the transaction; the API never accepts them from the client.

**Submit** (one transaction):
1. Lock the document row FOR UPDATE and check its If-Match version.
2. Status must be Draft or Rejected, and the caller must have "submit".
3. If approval_required is false → create an APPROVED request + AUTO_APPROVED, call onApproved, stop.
4. Resolve the rule set by specificity. None → 422 NO_APPROVAL_RULE.
5. Choose the levels: amount null → the first no_amount_levels; otherwise thresholds ≤ amount.
6. Compute each level's approver pool, excluding the requester and the creator.
   - Each level needs at least one eligible person; the final level needs one with limit ≥ amount.
   - Otherwise 422 NO_ELIGIBLE_APPROVER (with the level).
7. Insert the request (a second submit hits the unique index → 409 ALREADY_PENDING), the steps
   (L1 PENDING with due_at, the rest WAITING), the L1 assignees and the SUBMIT action.
8. Call onSubmitted, write the audit row, and notify with APPROVAL_ASSIGNED.

**Approve:**
1. Lock the request FOR UPDATE. Status must be PENDING; If-Match = the request version.
2. The current step must be PENDING, otherwise 409 LEVEL_ALREADY_DECIDED.
3. Resolve the caller's authority: either the caller is eligible right now, or an active delegation's
   delegator is. Otherwise 403 NOT_YOUR_LEVEL.
4. Segregation of duties: not the requester or creator, and has not approved an earlier level.
   The unique index is the backstop.
5. At the final level with an amount: the authority's limit must be ≥ the amount, otherwise 403 OVER_LIMIT.
6. Mark the step APPROVED.
   - If there is a next level: activate it (set due_at, add assignees, notify).
   - Otherwise: request APPROVED → onApproved → notify the requester.
7. Bump the version and write the audit row.

**Reject / Return / Withdraw:**
- Reject and Return need the same lock and authority checks, and a comment of at least 10 characters.
- Withdraw: requester only, while PENDING.
- All three cancel the remaining steps and call the matching callback.

**Locking (extends the Phase 4 lock matrix):**
- Edit, delete and /status are refused while the document is Pending Approval, Approved, Posted or
  Cancelled → 409 RECORD_LOCKED.

**Concurrency:**
- The request row lock means a second approver waits and then gets 409.
- Idempotency-Key on every verb means a double click on Approve never approves level 2.
- The unique indexes are the last guard.

**Delegation:**
- Create: validate the range and overlap (409) and that to-user ≠ from-user, then add DELEGATION
  assignees to the delegator's pending steps.
- Steps activated later also include active delegates.
- Revoke removes those assignees.

**Jobs** (pg-boss, Asia/Kolkata):
| Job | When | Does |
|---|---|---|
| approvals.sla-scan | every 15 min | Overdue steps (not yet escalated) → set escalated_at, add ESCALATION assignees, record ESCALATE, notify (dedupe key esc:<stepId>) |
| approvals.reminder | daily 09:30 | One reminder per user for items waiting more than 24 h |
| notifications.digest | daily 08:30 | DIGEST users' unread items in one email |
| email.send | on demand | Drains email_outbox with 5 retries and backoff; marks SKIPPED when there is no SMTP |
| notifications.purge | weekly | Deletes read items older than 180 days |

- Every job is idempotent.
- A failed job notifies Administrators (SYSTEM_JOB_FAILED).

**Notifications:**
- NotificationService.notify(tx, userIds, {type, title, body, link, dedupeKey}) inserts inside the
  caller's transaction, so a rolled-back action sends nothing.
- INSTANT email users also get an outbox row.
- Email = company name, document code, amount and an "Open in ERP" link. No approve-by-email.
- SMTP settings come from env (SMTP_HOST/PORT/USER/PASS/FROM, APP_BASE_URL). In-app works without SMTP.

## 6. API (/api/v1, ETag/If-Match, Idempotency-Key on POST)
**Matrix:**
| Method & path | Permission | Purpose |
|---|---|---|
| GET /approval-matrix?department=&docType=&unit= | view admin-approval | sets and their levels |
| PUT /approval-matrix/sets | controls | replace a whole set atomically |
| DELETE /approval-matrix/sets/:id | controls | the department default set cannot be deleted |
| POST /approval-matrix/preview {department, docType?, unitId?, amount?} | view | chosen set, levels and eligible approvers by name |

**Document verbs** (same path as Phase 4 submit):
- POST /pages/:p/records/:id/approve | reject | return | withdraw (page permission).

**Approval Center:**
- GET /approvals/inbox?docType=&q=&page=
- GET /approvals/requests?status=&docType=&department=&mine=submitted&page= (scoped)
- GET /approvals/requests/:id
- GET /approvals/doc/:docType/:docId
- POST /approvals/requests/:id/approve | reject | return | withdraw
- POST /approvals/steps/:id/reassign {userId, reason} (Administrator, level ≥ 95)
- GET /approvals/counts → {waitingForMe, submittedPending, overdue}
- GET/POST /approvals/delegations; POST /approvals/delegations/:id/revoke

**Notifications:**
- GET /notifications?unread=&type=&page=
- GET /notifications/unread-count
- POST /notifications/:id/read; POST /notifications/read-all
- GET/PUT /notification-preferences
- POST /notifications/test-email (Administrator)

7. UI & user flow (index.html look)
1. **Approval Matrix:**
   - Filters: Department, Document type (or "All documents"), Unit (or "All units").
   - Table: Department | Document | Unit | Level | Threshold (₹) | Approver | SLA (h) | Escalate to | Actions.
   - "＋ Add Rule Set" / "Edit set" opens one dialog with level rows and "Levels for documents without
     amount", with inline errors.
   - A "Test an amount" box shows which levels apply and who would approve.
   - Read-only for users without "controls".
2. **Approval Center:**
   - KPIs: Waiting for me · Submitted by me · Overdue · My Role/Limit.
   - Columns: Request | Department | Module | Record | Amount | Level n/N | Waiting on | Due | Status | Action.
   - Approve / Reject / Return appear only for assignees. Reject and Return ask for a comment;
     Approve asks to confirm.
   - Clicking a row opens the journey drawer: each level with role, person, time, comment and
     "on behalf of".
3. **Delegations tab:** an "I will be away" form (To user, From, To, Department, Reason) and a list
   with Revoke.
4. **Module page:**
   - "Submit for Approval" shows for Draft/Rejected documents when the user has "submit"; otherwise hidden.
   - While pending, Edit/Delete are disabled with the tooltip "Locked while pending approval", and the
     requester sees Withdraw.
   - A chip shows "Pending L2/4 · Department Head".
5. **Bell:** badge (99+ max), polled every 60 s and on window focus. The drawer lists the latest 20;
   clicking an item marks it read and opens the link.
6. **Notification Center:**
   - Chips: All / Unread / Approvals / System.
   - "Mark all read".
   - Preferences grid: type × (In-app, Email Off / Instant / Daily digest).
   - In-app APPROVAL_ASSIGNED is locked on.
7. **Dashboards:** "My Approvals (n)" uses /approvals/counts.

## 8. Exact messages
| Code | HTTP | Message |
|---|---|---|
| MATRIX_LEVEL_GAP | 422 | "Levels must run 1, 2, 3… without gaps. Level {n} is missing." |
| MATRIX_FIRST_THRESHOLD | 422 | "Level 1 must start at ₹0." |
| MATRIX_THRESHOLD_ORDER | 422 | "Level {n} threshold must be higher than level {n-1} (₹{x})." |
| MATRIX_APPROVER_REQUIRED | 422 | "Choose a role or a named user for level {n}, not both." |
| MATRIX_SAME_USER | 422 | "{name} cannot be the approver at two levels of the same set." |
| MATRIX_DUPLICATE_SET | 409 | "A rule set already exists for this department, document and unit." |
| NO_APPROVAL_RULE | 422 | "No approval rules are set for {department}. Ask the administrator to add them in Approval Matrix." |
| NO_ELIGIBLE_APPROVER | 422 | "Nobody other than you can approve level {n} ({role}). Ask the administrator to assign an approver." |
| ALREADY_PENDING | 409 | "Already pending approval." |
| NOT_SUBMITTABLE | 409 | "Only Draft or Rejected documents can be submitted. This one is {status}." |
| RECORD_LOCKED | 409 | "This document is {status} and cannot be changed." |
| SELF_APPROVAL | 403 | "You cannot approve a request you raised or created." |
| ONE_LEVEL_ONLY | 403 | "You already approved level {n} of this request. Another approver must act." |
| NOT_YOUR_LEVEL | 403 | "This level needs {role}. You are not an approver for it." |
| OVER_LIMIT | 403 | "This needs an approval limit of ₹{amount}. Your limit is ₹{limit}." |
| LEVEL_ALREADY_DECIDED | 409 | "This level was already decided by {name} at {time}. Refresh to see the latest." |
| COMMENT_REQUIRED | 422 | "Please write a reason (at least 10 characters)." |
| DELEGATION_OVERLAP | 409 | "You already have a delegation between {from} and {to}." |
| DELEGATION_SELF | 422 | "You cannot delegate to yourself." |

## 9. Audit & notifications
**Audit** (target = the document; detail = request, level, amount, actor, on behalf of, comment):
- APPROVAL_SUBMITTED, APPROVAL_APPROVED_LEVEL, APPROVAL_APPROVED, APPROVAL_REJECTED,
  APPROVAL_RETURNED, APPROVAL_WITHDRAWN, APPROVAL_ESCALATED, APPROVAL_REASSIGNED
- APPROVAL_MATRIX_CHANGED (before/after)
- DELEGATION_CREATED, DELEGATION_REVOKED
- Add all of them to the web action catalog.

**Notification types:**
- APPROVAL_ASSIGNED → the approver pool
- APPROVAL_DECIDED → the requester
- APPROVAL_LEVEL_PASSED → the requester
- APPROVAL_ESCALATED → the escalation target and the pool
- APPROVAL_REMINDER
- DELEGATION_STARTED → the delegate
- SYSTEM_JOB_FAILED → Administrators
- Phase 4's documentExpiring hook now delivers DOCUMENT_EXPIRING.

## 10. Tests
- **Matrix:**
  - gap, first ≠ 0, non-increasing thresholds, both role and user, same user on two levels;
  - specificity with 4 sets;
  - the snapshot is unchanged after a matrix edit.
- **Levels:** ₹0 / 49,999 / 50,000 / 2,00,000 / 10,00,000 / 10,00,001 → 1 / 1 / 2 / 3 / 4 / 4 levels;
  an amount of null → no_amount_levels.
- **Segregation of duties:**
  - the requester cannot approve; the creator cannot approve;
  - a Director cannot approve L1 (exact role);
  - the same user cannot approve two levels;
  - Super User → 403.
- **Limit:** a GM with a ₹5 L limit on a ₹8 L document → 403; the CFO path for Finance.
- **Department:** taken from the stored owner; a department sent in the body is ignored.
- **Concurrency:**
  - two approvers on the same step with Promise.all → exactly one 200 and one 409;
  - two submits → one 409 ALREADY_PENDING;
  - double Approve with the same key → one action row plus the replay header.
- **Lifecycle:**
  - submit → L1..L4 → Approved;
  - reject → edit → resubmit (cycle 2);
  - return → Draft;
  - withdraw;
  - approval_required=false → AUTO_APPROVED.
- **Locking:** PATCH / DELETE / status while Pending, Approved or Posted → 409. An Employee without
  "submit" → 403 and the button is hidden.
- **Delegation:** "on behalf of" works; an overlap → 409; a delegate who is the requester is blocked;
  an expired delegation → 403.
- **Jobs (fake clock):**
  - escalation fires once even when the job runs twice;
  - reminder dedupe;
  - digest grouping;
  - outbox retry, and SKIPPED without SMTP.
- **Notifications:**
  - unread count and read-all;
  - preferences are respected;
  - in-app APPROVAL_ASSIGNED cannot be disabled;
  - another user's notifications → 404.
- **UI:**
  - the bell updates after an action;
  - inline matrix errors;
  - buttons appear only for assignees;
  - journey drawer timestamps.
- 3 clean runs.

## 11. Acceptance checks
- [ ] A ₹3,00,000 Purchase document routes Department Manager → Department Head → General Manager,
      each a different person, and the history shows names and times.
- [ ] Nothing except the engine can set Approved or Rejected. A grep for 'Approved' writes outside
      the approval handlers finds 0.
- [ ] admin-approval opens the matrix with the 40 seeded rules (10 departments × 4 levels).
- [ ] An overdue step escalates within 15 minutes of due_at, and the bell shows it.
- [ ] Without SMTP the app runs and outbox rows become SKIPPED. With SMTP (e.g. Mailpit) the email arrives.
- [ ] 3 clean runs. The report lists the DB changes.

## 12. Out of scope
| Item | Owner |
|---|---|
| Approve from email, WhatsApp/SMS | Phase 19 |
| "2 of 3 must approve" quorum | Not in v1 |
| Business-hours SLA calendar | Not in v1 |
| Rules on fields other than amount, department, unit and doc type | Not in v1 |
| Amendment/revision of approved documents | Module phases |
| scm-approval page | Phase 9 |
| Real-time push | Not in v1 (polling only) |
| Re-routing requests already in flight | Not in v1 (use Reassign) |
| Multi-currency thresholds | Not in v1 |

## 13. Owner manual check
Use test users: 4 per department plus a Director.
1. Administration → Approval Matrix. Does it show Department / Level / Threshold / Approver, not a
   list of requests?
2. Save Level 1 = ₹0 and Level 3 = ₹50,000 with no Level 2. Does it say "Level 2 is missing"?
3. As a Purchase Employee, create a ₹75,000 record and click Submit for Approval. Does it show
   "Pending Approval L1/2", with Edit greyed out?
4. Submit again quickly from a second tab. Does it say "Already pending approval."?
5. As that same Employee, open the Approval Center. Are there no Approve buttons on your own request?
6. As the Purchase Department Manager: does the bell show 1, and does it open the record? Approve it.
   Then, as the Director, try to approve. Does it say "This level needs Department Head"?
7. As a Department Head with a ₹50,000 limit: does Approve say "needs an approval limit of ₹75,000"?
   Raise the limit to ₹1,00,000 in Users and approve. Is it Approved, and no longer editable?
8. Reject another request with a short reason. Does it ask for at least 10 characters? After a proper
   reason, does the requester's bell say "Rejected"?
9. Delegate the Department Manager to another user for today. Can that user approve, and does the
   history show "on behalf of"?
10. Notification Center → Preferences → Approvals email = "Daily digest". Is it still saved after reload?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md, ERRATA.md, PHASE-05.md, then
docs/archive/plan/09-user-will-break-it.md (B-02, B-03, B-08, B-31–B-35, B-70),
apps/api/src/modules/records/service.ts (changeStatus), engine/lock-matrix.ts, engine/field-schema.ts,
modules/module-controls/*, apps/web/src/shell/Topbar.tsx, and index.html functions approvalLevels,
submitApproval, canApproveReq, approveReq, rejectReq, approvalCenter, approvalsTab, approvalMatrix,
notificationPage, notifications, seedSystem.
1 migrations phase05_approval_engine + phase05_notifications per §4 (btree_gist, partial unique
  indexes, exclusion constraint) + Prisma models; ask owner before applying to any shared DB;
2 modules/approvals with the ApprovalDocHandler registry (generic-records handler for all generic
  pages); snapshot re-read in the transaction; request FOR UPDATE; SoD, one-level rule, final-level
  limit, amount-less rule, delegation; Idempotency-Key + If-Match on every verb;
3 extend the Phase 4 lock matrix for pending/approved; replace the Phase 4 submit hook;
4 pg-boss jobs approvals.sla-scan, approvals.reminder, notifications.digest, email.send,
  notifications.purge — all idempotent;
5 modules/notifications: notify() inside the caller's transaction, email outbox, nodemailer (SMTP
  optional, env names in .env.example only), preferences;
6 seed the prototype matrix (10 departments × 4 levels, CFO for Finance, SLA 48 h) + notification types;
7 web: Approval Matrix page, Approval Center (4 tabs), Approvals tab + journey drawer, Submit/Withdraw
  + lock chips, bell with badge/drawer/60 s polling, Notification Center + Preferences; index.html look;
8 tests §10 incl. Promise.all concurrency; exact §8 messages; nothing from §12.
3 clean runs. Write PHASE-05-REPORT.md with DB changes. Do not commit unless the owner asks; never push.
~~~


