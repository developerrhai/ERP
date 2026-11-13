# Phase 02 Completion Report — Roles & Access v2

**Date**: 05-11-2026 (IST)  
**Status**: COMPLETE / GREEN  
**Governing Standard**: NIST RBAC, OWASP Authorization Cheat Sheet, docs/phases/PHASE-02.md, docs/phases/STANDARDS.md  
**Scope**: Dynamic DB-driven roles, 12 actions, 4 scopes, explicit deny wins, extra departments, approval limits, Role Master CRUD, Permission Master 12-action matrix & Effective Access viewer, and User Master integrations.

---

## 1. Executive Summary

Phase 02 transforms roles and permissions into dynamic, database-driven models with comprehensive organizational and unit awareness:
1. **Roles as Data (R-03)**: Dropped the hard-coded `enum Role`. Created the `roles` table with 9 system roles with NIST/R-03 levels (1–99), system role immutability triggers, and hierarchical management rules (`actor.level > target.level`).
2. **12 Actions & 4 Scopes**: Expanded actions to 12 (`view`, `add`, `edit`, `delete`, `approve`, `export`, `controls`, `submit`, `post`, `cancel`, `print`, `import`) and scopes to 4 (`OWN`, `DEPARTMENT`, `UNIT`, `ALL`). Replaced "most specific non-null cell wins" with explicit-deny-wins logic.
3. **Department & Unit Awareness**: Created `user_departments` supporting up to 10 extra departments per user. Extra departments dynamically expand both the menu and the `DEPARTMENT` data scope. `UNIT` and `ALL` scopes skip the department gate entirely, and "All units" is authorized dynamically via `role.all_units`.
4. **Approval Limits & Safeguards**: Added `approval_limit numeric(18,2)` with Super User NULL/unlimited support. Enforced self-escalation guards (cannot modify own role, departments, approval limit, or status) and last active Super User deactivation guard (409 conflict).
5. **Effective Access & Explainability**: Implemented `explain(user, page)` detailing resolved actions, scopes, and reason strings for every permission grant or denial. Integrated into the "Effective access" tab in Permission Master and the "Check access" drawer in User Master.
6. **Unified Menu & Permission Rule**: Ensured `/me/menu` is built strictly from `can(user, page, 'view')`, ensuring the navigation sidebar and API authorization rules always agree.

---

## 2. Database Changes

**DB changes: 2 migrations**

### Migration 1: `20261108000000_phase02_scope_unit`
Executed alone to safely add `UNIT` enum value to PostgreSQL type `DataScope` before `ALL`:
```sql
ALTER TYPE "DataScope" ADD VALUE IF NOT EXISTS 'UNIT' BEFORE 'ALL';
```

### Migration 2: `202611080100_phase02_roles_v2`
Atomic live-safe transaction executing Steps 1–11 of §4:
1. **`roles` table created**:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `code VARCHAR(30) UNIQUE NOT NULL` (format checked `^[A-Z][A-Z0-9_]{1,29}$`, immutable via trigger `trg_roles_code_immutable`)
   - `name VARCHAR(60) UNIQUE NOT NULL`
   - `description VARCHAR(300)`
   - `level INTEGER NOT NULL CHECK (level >= 1 AND level <= 99)`
   - `is_system BOOLEAN NOT NULL DEFAULT FALSE`
   - `all_units BOOLEAN NOT NULL DEFAULT FALSE`
   - `status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'`
   - Audit columns (`version`, `created_at`, `updated_at`, `created_by_id`, `updated_by_id`)
   - Indexes: Partial unique index for single `SUPER_USER` row, index on `level`.
2. **9 System roles seeded**:
   - `SUPER_USER` (Level 99, all_units: true, is_system: true)
   - `ADMINISTRATOR` (Level 95, all_units: true, is_system: true)
   - `DIRECTOR` (Level 90, all_units: true, is_system: true)
   - `CFO` (Level 80, all_units: true, is_system: true)
   - `GENERAL_MANAGER` (Level 70, all_units: true, is_system: true)
   - `DEPT_HEAD` (Level 60, all_units: false, is_system: true)
   - `DEPT_MANAGER` (Level 50, all_units: false, is_system: true)
   - `SUPERVISOR` (Level 30, all_units: false, is_system: true)
   - `EMPLOYEE` (Level 10, all_units: false, is_system: true)
3. **`users` table migrated**:
   - Added `role_id UUID REFERENCES roles(id) ON DELETE RESTRICT`.
   - Backfilled existing users: `SUPER_ADMIN → SUPER_USER`, `ADMIN → ADMINISTRATOR`, `MANAGER → DEPT_MANAGER`, `LEAD → SUPERVISOR`, `MEMBER → EMPLOYEE`.
   - Made `role_id` `NOT NULL`.
   - Trigger `trg_users_department_check` ensures department is required unless role is `SUPER_USER`.
4. **`users.approval_limit` added**:
   - Column `approval_limit NUMERIC(18,2)`.
   - Trigger `trg_users_approval_limit_check` ensures NULL is permitted only for `SUPER_USER`.
   - Backfilled: `SUPER_USER → NULL`, others → `0.00`.
5. **`role_permissions` table migrated**:
   - Replaced `role` with `role_id UUID REFERENCES roles(id) ON DELETE CASCADE`.
   - Unique key `(role_id, resource)`.
   - Added 5 boolean action columns: `submit`, `post`, `cancel`, `print`, `import`.
   - Trigger `trg_role_permissions_no_super_user` prevents permission rows for `SUPER_USER`.
   - Constraint `role_permissions_default_row_complete` ensures `*` rows define all 12 actions and scope.
6. **Dropped obsolete enum**:
   - Dropped columns `users.role`, `role_permissions.role`, and enum type `Role`.
7. **`user_departments` table created**:
   - `(user_id, department_name)` compound primary key.
   - Foreign keys to `users(id)` and `departments(name)`.
   - Trigger `trg_user_departments_rules` validates differing from home department and caps extra departments at 10.
8. **Permissions seeded & audited**:
   - Seeded `*` rows and family overrides per §5.4.
   - Inserted audit log entry `ROLES_MIGRATED` with mapped user counts.

---

## 3. Services & Business Logic

- **Role Hierarchy (`role-rules.ts`)**:
  - Replaced hard-coded constants with DB-driven helpers: `canManageLevel(actorLevel, targetLevel)`, `hasMinLevel(level, 95)`, `isReservedLevel(level)`.
  - Maintained backward-compatible bridge helpers for existing test suites.
- **Access Decision Engine (`access.ts`)**:
  - 12 actions, 4 scopes, step-by-step algorithm per §5.2.
  - Hard rule: Administration pages require `level >= 95`.
  - Switch overrides (`allowAdd`, `allowEdit`, `allowDelete`, `allowExport`) veto all users including Super User (`print` maps to `allowExport`, `import` maps to `allowAdd`).
  - Single-process access cache with 60s TTL and automatic invalidation on any authorization write.
- **Repository Scope SQL (`records/repository.ts`)**:
  - `visibilitySql(user, scope)` applies multi-department awareness using `g.department = ANY($departments)`.
- **API Endpoints (`/api/v1`)**:
  - `GET /roles`, `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id` with §5.5 hierarchy enforcement and §8 exact validation messages.
  - `GET /permissions`, `PUT /permissions/:roleId` with 12 actions and atomic replacement.
  - `GET /users/:id/effective-access?family=` returning granular resolution reasons.
  - `GET /meta/roles` restricted to `level >= 95`.
  - `POST /users` and `PATCH /users/:id` updated for `roleId`, `extraDepartments`, and `approvalLimit`.

---

## 4. Web Application Features

1. **Role Master (`RoleMasterPage.tsx`)**:
   - Lists roles sorted by level descending with clean columns (`Role`, `Level`, `Users`, `Status`, `Action`).
   - System roles display grey "System" chip with Delete disabled.
   - Add/Edit Role modal with automatic code generation, level description hints, "Copy permissions from" selector, and unit permissions toggle.
2. **Permission Master (`PermissionMasterPage.tsx`)**:
   - **Role Permissions tab**: 12-action matrix with Scope selector (`Own records`, `Department`, `Unit`, `All`) and Save button.
   - Non-manageable roles are disabled with explanatory tooltips.
   - Overrides toggle displaying Inherit (`–`), Allow (`✓`), Deny (`✕`).
   - **Effective Access tab**: Standalone tab to pick any user, optionally filter by family, and view the resolved 12-action rights and plain-text explanation reasons.
3. **User Master (`UserMasterPage.tsx` & `UserFormModal.tsx`)**:
   - Contract columns: `Name, Login ID, Email, Department, Role, Units, Status, Last Login, Action`.
   - Form modal with dynamic DB-driven roles, home department, "Also works in" chips (extra departments), Approval limit (₹), and Units checkboxes.
   - "Check access" drawer (`EffectiveAccessDrawer.tsx`) to inspect effective rights with family filtering and explanation drilldown.

---

## 5. Verification & Test Results

### 3 Consecutive Clean Test Runs

#### Backend (`apps/api`)
Command: `npx vitest run --fileParallelism=false tests/phase02-roles.test.ts tests/users.test.ts`
- **Run 1**: 2 test files, 45 tests passed clean (15.35s)
- **Run 2**: 2 test files, 45 tests passed clean (16.07s)
- **Run 3**: 2 test files, 45 tests passed clean (15.38s)

#### Frontend (`apps/web`)
Command: `npx vitest run src/pages/admin/ src/pages/users/`
- **Run 1**: 10 test files, 90 tests passed clean (25.58s)
- **Run 2**: 10 test files, 90 tests passed clean (24.02s)
- **Run 3**: 10 test files, 90 tests passed clean (24.24s)

Full Frontend Suite (`apps/web`):
- `npx vitest run`: **35 test files, 332 tests passed clean (50.57s)**.

---

## 6. Acceptance Checklist (§11)

- [x] `enum Role` is gone. The roles table has 9 system roles with R-03 levels.
- [x] All existing users and permission rows are mapped. Nobody loses their login.
- [x] Role Master add/edit/delete works, with the level and system guards.
- [x] The matrix shows 12 actions and 4 scopes. Deny beats allow.
- [x] CFO reaches only the finance families (scope ALL). GM cannot delete. Supervisor cannot delete or approve. Employee sees only their own records.
- [x] Administrator cannot approve by default and cannot edit their own or a higher role.
- [x] Self-escalation is blocked. The last Super User is protected.
- [x] Extra departments widen the menu and the DEPARTMENT scope.
- [x] The approval limit is stored, shown in ₹ and audited.
- [x] The menu equals view permission for every role × department.
- [x] The effective-access viewer explains every ✕.
- [x] The route matrix test is green. 3 clean runs completed.
