# Phase 2 — What changed and why (2026-11-02)

Spec: [`CONTRACT.md`](CONTRACT.md). API choices are in `apps/api/README-PHASE2.md`.

## What you can now do (Super Admin / Admin)

| Screen | What it does | Why |
|---|---|---|
| **Department Master** (`admin-departments`) | Add, edit, activate/deactivate and delete departments. You cannot delete a department that still has users or owns modules. Administration is protected | The prototype used `prompt()` popups and deleted departments that were still in use |
| **Role Master** (`admin-roles`) | Read-only list of the 5 fixed roles, their levels, user counts, and who can create each one | Roles are fixed by your decision; this page explains them |
| **Permission Master** (`admin-permissions`) | Per role: View/Add/Edit/Delete/Approve/Export/Controls plus data scope (Own/Department/All). Per menu section you can override with allow / deny / inherit. A **Department Access** tab sets which menu sections each department sees | The prototype's permission table existed but nothing on the server enforced it |
| **System Control Center** (`admin-settings/controls`) | Switch any of the 248 modules on/off, set its owner department, approval required, and allow Add/Edit/Delete/Export | The prototype's control table, made real |
| **Letterhead & PDF** (`admin-settings/letterhead`) | Company name, address, GSTIN/PAN/CIN (validated), footer, signatory, with a live preview | Used by all PDFs from Phase 4 |
| **Audit Trail** (`admin-audit`) | Who did what and when, with before/after values. Filter by date, action, user and text | Every admin change is recorded and can never be edited |

**Menu from the server.** The sidebar comes from the server. A switched-off module or a removed permission disappears **immediately**, and the server refuses direct API calls too.

## Safety rules added (from the independent review)
* **Administration pages cannot be reached by roles below Admin**, whatever the permission table says.
* Admins cannot be stripped of `controls`, and Administration pages cannot be switched off. So nobody can lock everyone out.
* **Unsaved edits are never silently lost** when you save another row or change a filter. A banner shows "N unsaved changes".
* **"Changed by someone else" (409)** now offers a **Reload** button for just that row.
* **Search treats `%` and `_` literally.** Paging is capped so huge scans are impossible.
* **No-op saves** do not create audit noise.
* **Setup self-repair.** The setup defaults (departments, permissions, module controls, letterhead) are re-created at server start if missing. A migrated database never ends up with an empty menu.
* **CORS tightened.** It is an exact list of allowed websites (`WEB_ORIGINS`). This replaced an unsafe "any `*.vercel.app` / anything containing `localhost`" rule added by another session.

## Files

### API (`apps/api`)

**New database migration** `prisma/migrations/20261102000000_phase2_admin`:
* tables `departments`, `role_permissions`, `department_families`, `module_controls`, `settings`;
* `users.department` linked to departments (a rename cascades, a delete is blocked while the department is in use).

**New modules:** `src/modules/{me,departments,roles,permissions,department-access,module-controls,settings,audit-logs}`, layered like Phase 1 (routes, controller, service, repository, schemas).

**Core:**

| File | Why |
|---|---|
| `src/core/rbac/access.ts` | The one decision "may this user do X on page Y", with a 60 s cache cleared on every change |
| `permission-model.ts` | The actions, the scopes and the default permission rows |
| `src/core/registry.ts` | Loads the 248-page registry |
| `src/core/seed/{defaults,run-seed}.ts` | The idempotent defaults; also run at boot |
| `src/core/http/if-match.ts` | Shared conflict protection |
| `src/core/http/query-safety.ts` | Safe search and paging limits |

**Tests:** `tests/{access,departments,permissions,controls-settings-audit,seed,phase2-review}.test.ts`, plus `phase2-helpers.ts`. **408 tests, green on 3 consecutive runs.**

### Web (`apps/web`)

**Pages:** `src/pages/admin/`:
* `DepartmentMasterPage`, `RoleMasterPage`, `PermissionMasterPage` + `DepartmentAccessTab` + `permissionModel`;
* `SystemSetupPage`, `ControlCenterPage`, `LetterheadPage`, `AuditTrailPage`;
* `adminApi` (typed API calls).

**Shared:**

| File | Why |
|---|---|
| `src/lib/menu.ts` | Server menu store |
| `usePagePermissions.ts` | Shows or hides buttons by permission |
| `useLoad.ts` | Loading and error state |
| `errors.ts` | One wording for errors |
| `src/components/Pager.tsx` | Shared pager |
| `ErrorMessage.tsx` | Error banner with a Reload button |
| `UserPicker.tsx` | User search box for the audit filter |

**Tests:** 164 web tests, green on 3 consecutive runs.

### End-to-end (`tests/e2e/phase2.spec.ts`) — 8 scenarios on the real system
* Disabling a module removes it from a member's menu.
* Removing View removes access.
* A member hacking the permission API gets 403.
* Deleting a department that has users is refused.
* Adding and deleting a department.
* The letterhead is saved and validated.
* The audit trail records everything.
* **Phase 1 + 2 together: 20/20 passing.**

## Not done in Phase 2 (by design)
Company/Unit/FY selectors (Phase 3), record pages (Phase 4), approvals (Phase 6), PDF generation (Phase 4).
