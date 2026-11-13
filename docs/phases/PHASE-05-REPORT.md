# Phase 05 Completion Report — Approval engine + notifications

**Date**: 06-11-2026 (IST)
**Status**: BUILT, tested locally, DEPLOYED BY THE OWNER to AWS (backend) and Vercel (frontend). Commits `27a1da6`, `3a355c7`.
**Spec**: `docs/phases/PHASE-05.md`. Governing standard: `STANDARDS.md`, `ROADMAP.md`, `ERRATA.md`, `CLAUDE.md`.

## 1. What was built
| Area | Result |
|---|---|
| Migrations | `20261111000000_phase05_approval_engine`, `20261111010000_phase05_notifications` (+ Prisma models) |
| Engine | `modules/approvals`: ApprovalDocHandler registry (generic-records handler for every generic page), submit / approve / reject / return / withdraw / reassign / statusOf, matrix service (validate, save, delete, preview, resolve by specificity), delegation, queries (inbox, scoped list, counts), view model |
| Rules | snapshot at submit; request `FOR UPDATE`; SoD (requester, creator, one level per user); final-level limit; amount-less rule; delegation (one hop, "on behalf of"); Idempotency-Key + If-Match on every verb |
| Lock matrix | `Pending Approval`, `Posted`, `Approved` fully locked; `Rejected` editable and resubmittable; `/status` on Pending Approval / Approved / Posted / Cancelled = 409 RECORD_LOCKED |
| Jobs (pg-boss, Asia/Kolkata) | `approvals.sla-scan` (15 min), `approvals.reminder` (09:30), `notifications.digest` (08:30), `email.send` (every minute), `notifications.purge` (weekly); all idempotent; failures notify Administrators |
| Notifications | `notify()` inside the caller's transaction, email outbox (SMTP optional; SKIPPED without it), preferences, 8 types |
| Seed | 9 departments (all except Administration) × 4 levels = rule sets, CFO for Finance, SLA 48 h, escalate to next level's role |
| Web | Approval Matrix page, Approval Center (4 tabs) + journey drawer, Approvals tab on generic pages + record-drawer journey, Submit/Withdraw, lock tooltip, bell (badge 99+, 60 s poll, focus refresh, drawer), Notification Center + Preferences, dashboard "My Approvals (n)", `approval-matrix` redirect |
| API | `/approval-matrix`, `/approvals/*`, `/pages/:p/records/:id/approve|reject|return|withdraw`, `/notifications`, `/notification-preferences` (incl. `/approvals/delegation-targets` for the delegation form) |

## 2. DATABASE CHANGES (all of them)
### 2.1 `20261111000000_phase05_approval_engine`
* `CREATE EXTENSION IF NOT EXISTS btree_gist` (**the server needs the `postgresql16-contrib` package**).
* `approval_rule_sets` (UNIQUE NULLS NOT DISTINCT on department, doc_type, unit), `approval_rules` (CHECK exactly one of role/user, thresholds ≥ 0, SLA 1..720, level 1..10).
* `approval_requests` (partial UNIQUE index: one PENDING request per document), `approval_steps`, `approval_step_assignees`.
* `approval_actions` (partial UNIQUE: one decision per step; one APPROVE per user per request; **append-only trigger on UPDATE**).
* `approval_delegations` (CHECK to ≠ from, ≤ 90 days; **GiST exclusion constraint** against overlapping ACTIVE ranges per user).
### 2.2 `20261111010000_phase05_notifications`
* `notifications` (UNIQUE user + dedupe key, index user/read/created), `notification_preferences`, `email_outbox`.
### 2.3 Data (not schema)
* Approval matrix seed (insert-if-missing). No fake requests or notifications.

## 3. Deviations from the spec (and why)
* **Notification types are code, not a table** (spec §4 lists no table; "seeded" is met by the type registry).
* **`email_outbox.next_attempt_at`** column added so retries can back off (1, 2, 4, 8 minutes, FAILED after 5).
* **`/status` on a Cancelled document is now 409** (spec §5), changing the Phase 4 422 for that one case; tests updated.
* **A one-level request needs its approver's limit ≥ the amount** (the level is also the final level, spec §3.8).
* **Status words:** documents use `Pending Approval` (spec) while the old Phase 4 `Pending` stays only as a legacy lock row.
* `GET /approvals/delegation-targets` added (a normal user cannot list users through `/users`).
* Phase 4 tests changed because submit now goes through the engine (Administration needs a rule set; statuses list grew). See §5.

## 4. Test results
See §7.

## 5. Files outside Phase 5 that had to be touched
`engine/lock-matrix.ts`, `engine/field-schema.ts` (status lists), `modules/records/service.ts` + `routes.ts` (submit + verbs), `core/jobs/index.ts`, `core/audit/audit-service.ts`, `core/http/errors.ts`, `server.ts`, `core/seed/run-seed.ts`, web `Topbar`, `ModulePage`, `App`, `DashboardPage`, `RecordDrawer`, `RegisterTab`, `GenericModulePage`, test helper defaults. Existing tests updated: `lock-matrix`, `phase4-engine`, `phase4-records`, `phase4-schema`, `phase4-fixes`, web `GenericModulePage.test`, `Phase4.test`.
Root `package.json` engines relaxed to `>=20` (Vercel refused Node 20).

## 6. Known issues
* **58 API tests were already failing before Phase 5** (roles v2, scope, password policy, env checks, admin masters now "custom"). They are unchanged; `npm run verify` cannot be green until that clean-up pass.
* The API typecheck reports errors only in old test files; `src` is clean.
* e2e (`npm run e2e`) not run: it needs the migrations applied to `rhai_erp_e2e` (owner approval).
* Email is untested against a real SMTP server (Mailpit); the outbox / retry logic is tested with a fake transport.
* The Matrix dialog drops a named-user "escalate to" (only roles are editable in the UI; the API supports both).
* Production needed: `postgresql16-contrib` and `MFA_ENCRYPTION_KEY` (both done by the owner on 06-11-2026).

## 7. Three clean runs (API, from a freshly reset rhai_erp_test)
| Run | Test files | Tests |
|---|---|---|
| 1 | 38 passed, 16 failed (54) | 857 passed, 58 failed, 6 skipped (921) |
| 2 | 38 passed, 16 failed (54) | 857 passed, 58 failed, 6 skipped (921) |
| 3 | 38 passed, 16 failed (54) | 857 passed, 58 failed, 6 skipped (921) |

* **All Phase 5 tests pass in every run:** phase05-approvals 38/38, phase05-notifications 19/19.
* The 58 failures are the SAME pre-existing ones listed in the Phase 4 report §7 (16 files: access, auth-login, auth-session, inv-migration-m1, kit-registry, meta-audit, password, permissions, phase02-roles, phase2-review, phase3-users, phase4-fixes, phase4-schema, production-config, rate-limit-env, rbac-matrix). None is a Phase 5 file.
* Web: 38 files, 358 tests, all passing; the API build and the web build both pass.
* Migrations were also applied to rhai_erp and rhai_erp_e2e (local) on 06-11-2026, and to the AWS server by the owner.
* `npm run e2e` was not run in this session.

## 8. Manual check list for the owner
1. Administration → Approval Matrix shows Department / Level / Threshold / Approver (not requests).
2. Save Level 1 = ₹0 and Level 3 = ₹50,000 with no Level 2 → "Level 2 is missing."
3. As a Purchase Employee, create a ₹75,000 record → Submit for Approval → "Pending L1/2", Edit greyed.
4. Submit again → "Already pending approval."
5. As the Employee, Approval Center: no Approve on your own request.
6. As the Purchase Department Manager: bell shows 1; open it; Approve. As Director try to approve → "This level needs Department Head."
7. As a Department Head with a ₹50,000 limit → "needs an approval limit of ₹75,000"; raise the limit and approve → Approved, locked.
8. Reject with a short reason → asks for 10+ characters; the requester's bell says Rejected.
9. Delegate the Manager to another user for today → that user approves; history shows "on behalf of".
10. Notification Center → Preferences → Approvals email = Daily digest; reload; still saved.
