# PHASE 02
# PHASE 02 — Roles & access v2

## 1. Goal & why
Make roles data, not code (R-03). Make access department-aware and unit-aware. Make one rule decide both the menu and the API.

**What exists today:**
- `apps/api/src/core/rbac/role-rules.ts` hard-codes 5 roles: SUPER_ADMIN 100, ADMIN 80, MANAGER 60, LEAD 40, MEMBER 20. `MANAGEABLE_ROLES` is hard-coded too.
- `prisma/schema.prisma` has `enum Role`, and `users.role` and `role_permissions.role` use it.
- Two CHECK constraints depend on the enum: `users_department_required` and `role_permissions_no_super_admin` (migrations `20261101000000_init`, `20261102000000_phase2_admin`).
- `permission-model.ts` knows 7 actions and 3 scopes (OWN/DEPARTMENT/ALL).
- `access.ts → decide()` uses "most specific non-null cell wins", so a page `true` can beat a family `false`. Explicit deny therefore does not always win.
- Users have a single department and no approval limit.
- `context-repository.ts → hasAllUnits(role)` hard-codes "ADMIN and above".
- `modules/roles/*` is read-only.
- The web has a hard-coded `ROLE_LABEL` in `PermissionMasterPage.tsx`.

**What is wrong or missing:**
- No Director, CFO, General Manager or Department Head roles. The prototype `seedSystem` has 8 roles; ROADMAP has 9.
- No UNIT scope.
- No submit, post, cancel, print or import actions.
- No extra departments (R-04).
- No approval limit (the prototype has `approvalLimit`).
- Role Master cannot add or edit roles.
- No "effective access" viewer.
- Two prototype defects remain: `DEPT_FAMILIES.Administration=["*"]` is never expanded, and the menu filters by department even for scope `*`, so the menu and the permission check disagree.

## 2. Pages in scope
| id | Title | Must do |
|---|---|---|
| admin-roles | Role Master | List roles: name, code, level, users, status, system badge. Add, edit, and delete (only when unused and not a system role). "Copy permissions from" when adding. |
| admin-permissions | Permission Master | **Roles** tab: role × 12 actions + Scope on the `*` row, plus family/page overrides (Inherit/Allow/Deny). **Department Access** tab: as today. New **Effective access** tab: pick a user and see the resolved rights with the reason for each. |
| admin-users | User Master | Role picked from the database. Home department + extra departments. Approval limit (₹). "Check access" button. |
| admin-departments | Department Master | The "in use" count also includes user_departments. |

## 3. Business logic & research
**Sources:**
- NIST RBAC (csrc.nist.gov/projects/role-based-access-control): core RBAC (users → roles → permissions) plus a numeric hierarchy (`level`).
- OWASP Authorization Cheat Sheet: deny by default, least privilege, check on every request, prevent escalation, test the rules.
- ERPNext: Role, Role Profile, User Permission, and actions submit/cancel/print/import.
- Odoo: groups give rights; record rules filter rows.
- SAP: authorization objects with org levels.

**Rules adopted:**
1. One role per user.
2. The role `level` is used **only for administration** (who manages whom). Roles do not inherit permissions from each other; each role's matrix is explicit.
3. An explicit deny on a family or page row always wins.
4. Scope order: OWN < DEPARTMENT < UNIT < ALL.
5. The approval limit is stored now and enforced in Phase 5.
6. The prototype's CFO pseudo-scope "finance" becomes family rows with scope ALL. No special code.

## 4. Database design
**Migration A — `<ts>_phase02_scope_unit`** (on its own, because Postgres cannot use a new enum value in the same transaction):
~~~sql
ALTER TYPE "DataScope" ADD VALUE IF NOT EXISTS 'UNIT' BEFORE 'ALL';
~~~

**Migration B — `<ts+100>_phase02_roles_v2`** (one transaction):

1. **Create table `roles`:**
   - `id uuid pk`
   - `code varchar(30) unique`, CHECK `^[A-Z][A-Z0-9_]{1,29}$`. Immutable: a trigger rejects any change to it.
   - `name varchar(60) unique`
   - `description varchar(300)`
   - `level int`, CHECK 1–99
   - `is_system bool`
   - `all_units bool`
   - `status`
   - `version`, plus the audit columns
   - Partial unique index: only one role row with code `SUPER_USER`. Index on `level`.
2. **Insert the 9 system roles:**

   | code | name | level | all_units |
   |---|---|---|---|
   | SUPER_USER | Super User | 99 | yes |
   | ADMINISTRATOR | Administrator | 95 | yes |
   | DIRECTOR | Director | 90 | yes |
   | CFO | CFO | 80 | yes |
   | GENERAL_MANAGER | General Manager | 70 | yes |
   | DEPT_HEAD | Department Head | 60 | no |
   | DEPT_MANAGER | Department Manager | 50 | no |
   | SUPERVISOR | Supervisor | 30 | no |
   | EMPLOYEE | Employee | 10 | no |

3. **Move users to role ids.** Add `users.role_id` and fill it with this mapping:
   - SUPER_ADMIN → SUPER_USER
   - ADMIN → ADMINISTRATOR
   - MANAGER → DEPT_MANAGER
   - LEAD → SUPERVISOR
   - MEMBER → EMPLOYEE

   Abort if any user is left unmapped. Then make the column NOT NULL, add the FK (ON DELETE RESTRICT) and an index.
4. **Replace the department CHECK with a trigger:** department is required unless the role is SUPER_USER.
5. **Add `users.approval_limit numeric(18,2)`:**
   - NULL means unlimited and is allowed only for SUPER_USER (enforced by a trigger).
   - Backfill: SUPER_USER → NULL, everyone else → 0.
6. **Move `role_permissions` to role ids:**
   - Add `role_id` and fill it with the same mapping.
   - Replace the unique key with `(role_id, resource)`.
   - FK with ON DELETE CASCADE.
   - A trigger forbids rows for SUPER_USER.
7. **Add 5 action columns:** `submit`, `post`, `cancel`, `print`, `"import"` (booleans).
   - Backfill `*` rows from the §5.4 defaults. Override rows stay NULL, meaning "inherit".
   - Extend the "default row complete" CHECK to all 12 actions.
   - Set ADMINISTRATOR `*.approve` to false.
8. **Drop the old enum:** drop `users.role`, drop `role_permissions.role`, then `DROP TYPE "Role"`.
9. **Create table `user_departments`:**
   - `user_id` (FK, cascade on user delete)
   - `department_name` (FK to departments.name, update cascade, delete restrict)
   - `created_at`, `created_by_id`
   - PK `(user_id, department_name)`
   - Trigger: must differ from the user's home department, at most 10 rows per user.
10. **Seed permission rows** for DIRECTOR, CFO, GENERAL_MANAGER and DEPT_HEAD per §5.4. Add a `family:Administration` deny row for every role below level 95.
11. **Write an audit row** `ROLES_MIGRATED` with the count per old → new role.

The whole migration is live-safe: a failure part-way through rolls back everything.

**Prisma changes:**
- New models `Role` and `UserDepartment`.
- `User.roleId`, `approvalLimit Decimal?`.
- `RolePermission.roleId` + the 5 new booleans.
- `DataScope` gains `UNIT`.

## 5. Services, rules & algorithms
**5.1 AccessUser.** `{id, roleId, roleCode, level, allUnits, departments: [home, ...extra]}`. It is loaded from the database on every request; the JWT carries no role.

**5.2 `decide(user, page, action)`, step by step:**
1. Unknown page → false.
2. Module control missing or disabled → false. Only SUPER_USER keeps `controls` (so it can re-enable the module).
3. `allow_*` switches veto everyone, Super User included:
   - add and import ← allowAdd
   - edit ← allowEdit
   - delete ← allowDelete
   - export and print ← allowExport
4. SUPER_USER → true.
5. Administration family and role level below 95 → false (hard rule).
6. Resolve the cell:
   - If the page row or the family row has an explicit `false` → **false (deny wins)**.
   - Otherwise, if either has `true` → true.
   - Otherwise use the `*` row.
   - No `*` row → false.
7. Scope = the most specific non-null scope (page → family → `*`). Default OWN.
8. Department gate: if the scope is OWN or DEPARTMENT, the page's family must be in the combined department_families of all the user's departments. UNIT and ALL skip this gate.
9. The `controls` action needs level ≥ 95.

**5.3 Data scope, applied in repository SQL:**
- **OWN:** `created_by_id = me`.
- **DEPARTMENT:** the record's department is one of my departments, or the page's owner department is one of mine.
- **UNIT:** no department filter. The unit comes from the request context and must be in user_units.
- **ALL:** like UNIT, and "All units" is allowed only if `role.all_units`.
- `hasAllUnits(user)` becomes `role.all_units`.

**5.4 Seed defaults (`*` rows):**
| Role | Rights | Scope |
|---|---|---|
| Super User | bypasses everything (no rows) | ALL |
| Administrator | view, add, edit, delete, submit, export, print, import, controls (no approve, post or cancel) | ALL |
| Director | everything except controls | ALL |
| CFO | `*` row: nothing (OWN). Family rows for Finance & Accounts, Indian Taxation, Sales, Procurement / SCM, Business Intelligence and Executive: everything except delete and controls, scope ALL | — |
| General Manager | everything except delete and controls | ALL |
| Department Head | everything except controls | DEPARTMENT |
| Department Manager | everything except controls and import | DEPARTMENT |
| Supervisor | view, add, edit, submit, export, print | DEPARTMENT |
| Employee | view, add, edit, submit, print | OWN |

Every role below level 95 also gets `family:Administration` = all false. The seed is insert-if-missing and records `rolesV2` in `system.seed`.

**5.5 Who manages whom:**
- An actor manages a target only if `actor.level > target.level`.
  - Exception: a Super User may create, deactivate or reset other Super Users.
  - Nobody changes a Super User's role, departments or limit.
- **Roles:**
  - Create, edit or delete only roles with `level < actor.level`. A new or edited level must also be below the actor's level.
  - Levels 95 and 99 are reserved for system roles.
  - A system role's code and level are locked; its name can be edited.
- **Permissions:** edit only roles below your own level, and **never your own role**.
- **Self-escalation:** nobody can change their own role, departments, approval limit or status (403).
- **Last Super User:** refuse to deactivate the last active Super User (409). Use a transaction with `SELECT … FOR UPDATE` on the Super User rows.
- **Delete a role:** only if it is not a system role and has 0 users. Otherwise 409 IN_USE or PROTECTED.
- **Deactivate a role:** only if it has no users. Inactive roles cannot be assigned.

**5.6 Cache** (single process, R-10):
- Key: `userId | roleId | roleVersion | departments | unitIds`. TTL 60 s.
- Invalidate on any write to roles, role_permissions, user_departments, users (role/department/status), department_families, module_controls or departments.

**5.7 Effective access.** `explain(user, page)` returns `{actions, scope, reasons[]}`. Each reason names the step that decided, e.g. "Denied by family row Administration" or "Family not in departments Sales, Purchase".

**5.8 Edge cases:**
- A department rename cascades automatically.
- An inactive extra department is ignored.
- A role level change applies on the user's next request.
- Every `requireMinRole('ADMIN')` becomes `requireMinLevel(95)`.

## 6. API endpoints
All under `/api/v1`, with the chain authenticate → requirePasswordChanged → resolveContext → requirePageAction → validate (zod `.strict()`). PATCH, PUT and DELETE need `If-Match`.

| Method & path | Permission | Request → Response | Errors |
|---|---|---|---|
| GET /roles | view admin-roles | → list with userCount, canManage, version | 401, 403 |
| POST /roles | add admin-roles | {code, name, level, description?, allUnits?, copyFromRoleId?} → 201 | 422, 409 DUPLICATE, 403 LEVEL |
| PATCH /roles/:id | edit admin-roles | {name?, level?, description?, allUnits?, status?} | 404, 409 PROTECTED / IN_USE / VERSION |
| DELETE /roles/:id | delete admin-roles | → 204 | 409 PROTECTED / IN_USE |
| GET /permissions | view admin-permissions | → {roles: [{roleId, code, name, level, editable, version, rows}], families, actions, scopes} | |
| PUT /permissions/:roleId | controls admin-permissions + level rule | {rows} replaced in one transaction | 403, 409, 422 |
| GET /users/:id/effective-access?family= | view admin-permissions | → {user, pages: [{pageId, title, family, actions, scope, reasons}]} | 404 |
| GET /me/permissions?pageId= | signed in | 12 actions + scope | |
| GET /me/menu | signed in | built only from can(view) | |
| GET /meta/roles | signed in, level ≥ 95 | assignable active roles | |
| POST /users, PATCH /users/:id | add / edit admin-users | roleId, department, extraDepartments[], approvalLimit (decimal string or null) | 403 SELF / LEVEL, 409 PROTECTED, 422 |

## 7. UI screens & user flow
Use the index.html look throughout. Never use browser `prompt()`.

**Role Master**
1. The table shows Role · Level · Users · Status · Action. System roles show a grey "System" chip and no Delete button.
2. **＋ Add Role** opens a modal with:
   - Role name
   - Code (filled from the name automatically)
   - Level, with the hint "Higher number = more authority. Must be below your own (95)."
   - Description
   - "Can work in all units"
   - "Copy permissions from"
3. After Save, the toast says "Role added", and the row shows a "Set permissions →" link.

**Permission Master — Roles tab**
1. One row per role: a Scope select (Own records / Department / Unit / All), 12 checkboxes and a Save button per row.
2. Rows you cannot edit are greyed out with the hint "You can only change roles below your own."
3. "Overrides ▸" shows per-family and per-page cells that cycle Inherit (–) → Allow (green ✓) → Deny (red ✕). A legend explains them.

**Permission Master — Effective access tab**
1. Search for a user and pick them.
2. Optionally filter by family.
3. A read-only grid of pages × actions appears. Tapping a ✕ shows the reason in plain words.

**User Master**
- Columns: Name · Login · Department · Extra departments · Role · Approval Limit (₹) · Status · Action.
- The modal has:
  - a Role dropdown listing only the roles you may assign;
  - Home department;
  - "Also works in" (chips);
  - Approval limit ₹, with the hint "Used for approvals. 0 = cannot approve amounts.";
  - Units.
- A **Check access** button opens the effective-access drawer.

## 8. Validation & exact messages
| Situation | Message |
|---|---|
| Duplicate role name | "A role with this name already exists." |
| Bad code | "Code must be 2–30 capital letters, digits or _." |
| Duplicate code | "This code is already used." |
| Bad level | "Level must be a whole number from 1 to 99." |
| Level at or above your own | "You can only create roles below your own level (95)." |
| Reserved level | "Levels 95 and 99 are reserved." |
| Deleting or editing a system role | "System roles cannot be deleted. Their code and level are fixed." |
| Role in use | "This role is assigned to 3 users. Move them to another role first." |
| Editing your own role's permissions | "You cannot change your own role's permissions." |
| Editing yourself | "You cannot change your own role, departments, approval limit or status." |
| Target user too senior | "You can only manage users below your own role." |
| Last Super User | "At least one active Super User is required." |
| Extra department same as home | "Choose departments other than the home department." |
| Too many extra departments | "Up to 10 extra departments." |
| Bad approval limit | "Enter an amount of 0 or more with up to 2 decimals." |
| Empty limit for a non-Super User | "Only a Super User can have no limit." |
| Granting Administration below level 95 | "Administration pages are only for Administrator and Super User." |
| Stale version | "Someone else changed this. Reload and try again." |

## 9. Audit & notifications
- New audit actions:
  - ROLE_CREATED, ROLE_UPDATED, ROLE_DELETED (with before/after)
  - PERMISSIONS_UPDATED (with before/after rows)
  - USER_ROLE_CHANGED
  - USER_DEPARTMENTS_UPDATED
  - USER_APPROVAL_LIMIT_CHANGED
  - ROLES_MIGRATED
  - ACCESS_DENIED_SELF_ESCALATION (with IP)
- Add labels for all of them to the web action catalog.
- No notifications in this phase (they come in Phase 5).

## 10. Tests
- **Pure `decide()` tables:**
  - deny beats a page allow;
  - the inherit chain;
  - UNIT and ALL skip the department gate;
  - extra departments are combined;
  - the Administration hard rule;
  - allow_* vetoes even the Super User;
  - print and import vetoes.
- **Migration test:** a database with 5 old-enum users is migrated. Check:
  - the mapped role codes;
  - the new columns;
  - no NULL role_id;
  - the ROLES_MIGRATED audit row;
  - a second run changes nothing.
- **API tests:** for every endpoint, 401 / 403 / 404 / 422 / 409, the happy path, and an audit row with before/after.
- **Hierarchy tests:**
  - an Administrator cannot create level 95+;
  - an Administrator cannot edit Administrator permissions;
  - nobody can edit themselves;
  - a Department Manager gets 403 on /users;
  - deactivating the last Super User returns 409;
  - only a Super User can create a Super User.
- **Generated route matrix:** every route × 9 roles × 3 departments gives the expected 200 or 403, and every route has a guard.
- **Menu = permission:** for every role × department, `/me/menu` equals {pages where can(view)}.
  - A Director sees 21 families.
  - A non-Administrator in the Administration department sees no admin pages.
- **Scope SQL:** record lists under OWN / DEPARTMENT / UNIT / ALL, with and without an extra department.
- **Cache:** a change is visible on the next request.
- **Playwright stories:**
  - Add "Plant Head" (level 65, copied from Department Head), set scope Unit and assign it to a user. The user sees every family for their unit.
  - Give a Sales user the extra department Finance. The Finance menu appears.
  - The effective-access tab shows "Denied by family row".
  - The last Super User is protected.
- Three clean runs.

## 11. Acceptance checks
- [ ] `enum Role` is gone. The roles table has 9 system roles with R-03 levels.
- [ ] All existing users and permission rows are mapped. Nobody loses their login.
- [ ] Role Master add/edit/delete works, with the level and system guards.
- [ ] The matrix shows 12 actions and 4 scopes. Deny beats allow.
- [ ] CFO reaches only the finance families (scope ALL). GM cannot delete. Supervisor cannot delete or approve. Employee sees only their own records.
- [ ] Administrator cannot approve by default and cannot edit their own or a higher role.
- [ ] Self-escalation is blocked. The last Super User is protected.
- [ ] Extra departments widen the menu and the DEPARTMENT scope.
- [ ] The approval limit is stored, shown in ₹ and audited.
- [ ] The menu equals view permission for every role × department.
- [ ] The effective-access viewer explains every ✕.
- [ ] The route matrix test is green. 3 clean runs.

## 12. Out of scope
- Approval engine, use of the approval limit, approval matrix → Phase 5.
- Notifications → Phase 5.
- Designations → Phase 3.
- Multiple roles per user and role profiles → not planned.
- Field-level permissions → Phase 20.
- Scope rules inside each typed module → that module's phase, using the §5.3 helper.
- SSO and 2FA → Phase 1 / Phase 20.

## 13. Owner manual check
1. Log in as Super User and open **Roles**. 9 roles appear, levels 99 down to 10.
2. **＋ Add Role**: "Plant Head", level 65, copy from Department Head. Save. The new row appears.
3. Open **Permissions** → Plant Head → set Scope to Unit → Save.
4. On the CFO row, open **Overrides**. The finance families show ✓; the others show –.
5. Open **Users** and edit a Sales user. Add "Also works in: Finance" and an approval limit of 50,000. Save.
6. Click **Check access** for that user. Finance pages show ✓. An Administration page shows ✕ with "Only for Administrator and Super User".
7. Log in as that user. The Finance & Accounts menu is now visible.
8. Log in as Administrator and try to edit the Administrator row in Permissions. It is greyed out.
9. As the only Super User, try to deactivate yourself. The message reads "At least one active Super User is required."
10. . Open **Audit Trail**. You see ROLE_CREATED, PERMISSIONS_UPDATED and USER_DEPARTMENTS_UPDATED.

## 14. Build prompt
~~~text
Phase 02 — Roles & access v2. Read CLAUDE.md, docs/phases/STANDARDS.md, docs/phases/ROADMAP.md, docs/phases/PHASE-02.md, then docs/archive/phase2/CONTRACT.md, apps/api/README-PHASE2.md, apps/api/src/core/rbac/*, modules/{roles,permissions,users,department-access}/*, core/context/*, modules/records/repository.ts, core/seed/defaults.ts.
1. Migrations <ts>_phase02_scope_unit (alone) and <ts+100>_phase02_roles_v2 exactly per §4 steps 1–11. Safe on a live DB; abort if any row is unmapped. Ask the owner before applying to any shared DB.
2. Replace role-rules.ts constants with DB-driven helpers (level, canManageLevel, requireMinLevel(95)); AccessUser = roleId/code/level/allUnits/departments; hasAllUnits = role.all_units.
3. access.ts: 12 actions, 4 scopes, explicit-deny-wins, department gate on home+extra departments (skipped for UNIT/ALL), Administration hard rule level ≥ 95, print/import mapped to allowExport/allowAdd, cache §5.6, explain().
4. Repository scope SQL per §5.3.
5. API §6 with all rules of §5.5, exact messages of §8, audits of §9.
6. Seed §5.4 insert-if-missing ('rolesV2').
7. Web: Role Master modal, Permission Master 12-action matrix + scope + overrides + Effective access tab, User Master role dropdown from API, "Also works in" chips, ₹ limit, Check access drawer. Remove hard-coded role labels/enums from apps/web. Same index.html look.
8. Tests §10 incl. route matrix and menu==can(view); Playwright stories; 3 clean runs.
Write docs/phases/PHASE-02-REPORT.md. State "DB changes: 2 migrations". Do not commit unless asked; never push.

 