# Phase 2 Contract — Permissions, Departments, Module Controls, Settings, Audit

This contract builds on [`../phase1/CONTRACT.md`](../phase1/CONTRACT.md) and `apps/api/README-PHASE1.md`, which stay in force. Where this file differs, this file wins.

## 0. Goal
Make the prototype's administration screens real, with **every rule enforced on the server**:

* Department Master
* Role Master
* Permission Master
* Department → Menu access
* System Control Center (module controls)
* Letterhead & PDF settings
* Audit Trail viewer

The sidebar menu must come from the server, so a disabled module or a removed permission disappears immediately.

**Not in this phase:**
* Company, Branch and FY selectors (Phase 3)
* The generic record engine (Phase 4/5)
* Approvals (Phase 6)
* PDF generation (Phase 4). The letterhead is stored now and used later.

## 1. Roles stay fixed (owner decision O-4)
The 5 roles and their levels are fixed in code (`role-rules.ts`): SUPER_ADMIN 100, ADMIN 80, MANAGER 60, LEAD 40, MEMBER 20.

* Nobody creates, renames or deletes roles.
* **Role Master** (`admin-roles`) is a read-only page. It shows each role's label, level, user count, "who can create this role", and a link to its permissions.

## 2. Permission model

### 2.1 Actions
`view, add, edit, delete, approve, export, controls`. These are the prototype's 7 actions. `controls` means "may change admin/configuration screens".

### 2.2 Data scope
| Scope | Meaning |
|---|---|
| `OWN` | records the user created |
| `DEPARTMENT` | records of the user's department |
| `ALL` | everything |

Scope is stored and returned now. It is applied to record queries from Phase 4.

### 2.3 Tables (Prisma, snake_case plural)

**`departments`**
* `id uuid`, `code` (unique, `^[A-Z0-9]{2,10}$`), `name` (unique, 2–60 chars), `head` (text, nullable, ≤ 100)
* `status ACTIVE | INACTIVE`, `version`, timestamps, `createdById`

**`users.department` becomes a foreign key** to `departments.name`, with `ON UPDATE CASCADE ON DELETE RESTRICT`.
* Keep the column name and type (string name), so the Phase 1 API and UI keep working.
* A rename cascades to users.
* Deleting a department that users reference is impossible: the API returns 409 `IN_USE` before the DB does.

**`role_permissions`**: one row per (role, resource).
* `role` is one of ADMIN, MANAGER, LEAD, MEMBER. **There are never rows for SUPER_ADMIN, which is always allowed everything.**
* `resource` is `*` (role default) or `family:<Family Name>`. Page-level rows (`page:<id>`) are allowed in the schema but not edited in the UI this phase.
* 7 boolean action columns plus `scope`.
* Resolution: the most specific row wins, in the order page → family → `*`.

**`department_families`**: `(department_name FK, family)`, unique.
* Defines which menu families a department sees. This is the prototype `DEPT_FAMILIES`.
* `Administration` gets **all 22 families** (the prototype's `["*"]`).

**`module_controls`**: one row per page id (248). Taken from the prototype `ctrl()`:
* `enabled` (default true)
* `owner_department` (FK → departments.name; default from the prototype `ownerDept()` mapping)
* `approval_required` (default true, except for the families Executive, Business Intelligence, AI & Automation, Administration and Document Management)
* `allow_add`, `allow_edit`, `allow_delete`, `allow_export` (all true by default)
* `version`, `updatedById`, timestamps

**`settings`**: key/value JSON with `version`. This phase stores the key `letterhead`, with the prototype's 11 fields:
* `companyName` (required, ≤ 120)
* `legalName`, `address` (≤ 300)
* `phone` (≤ 30)
* `email` (email or empty)
* `website` (URL or empty)
* `gstin` (empty or a valid 15-character GSTIN pattern `^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`)
* `pan` (empty or `^[A-Z]{5}\d{4}[A-Z]$`)
* `cin` (empty or 21 characters `^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$`)
* `footer` (≤ 200)
* `signatory` (≤ 100)

Seed values are the prototype defaults ("RHAI Industries Pvt. Ltd.", "Configure registered address in System Settings", "System-generated document from RHAI Enterprise ERP", "Authorized Signatory").

### 2.4 Seed defaults
The seed is idempotent. It only inserts what is missing and never overwrites admin edits.

**Departments.** The 11 prototype departments. The code is the first 4 letters in upper case (as the prototype does): ADMI, SALE, PURC, FINA, HR, PROD, QUAL, MAIN, WARE, PROJ, SERV. "HR" stays "HR". Head is `"<Name> Head"`.

**`department_families`.** From `packages/registry/registry.json` → `deptFamilies`, with Administration expanded to all 22 families.

**`role_permissions`** (`*` rows):

| Role | view | add | edit | delete | approve | export | controls | scope |
|---|---|---|---|---|---|---|---|---|
| ADMIN | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ALL |
| MANAGER | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | DEPARTMENT |
| LEAD | ✓ | ✓ | ✓ | – | – | ✓ | – | DEPARTMENT |
| MEMBER | ✓ | ✓ | ✓ | – | – | – | – | OWN |

Plus one family row for every non-admin role: `family:Administration`, with all actions false. **Only ADMIN and above may use Administration pages.**

**`module_controls`.** All 248 pages, using the prototype `ownerDept()` mapping:
* CRM, Sales → Sales
* Procurement / SCM → Purchase
* Inventory, Warehouse / WMS, Logistics / Fleet → Warehouse
* Manufacturing → Production
* Quality / QMS → Quality
* Maintenance, Assets → Maintenance
* Finance & Accounts, Indian Taxation → Finance
* HRMS, Payroll → HR
* Projects → Projects
* Service / Support → Service
* everything else → Administration

### 2.5 The access decision (one function: `apps/api/src/core/rbac/access.ts`)
`can(user, pageId, action) → boolean` and `scopeFor(user, pageId) → OWN | DEPARTMENT | ALL`.

1. Unknown pageId → false.
2. Module control `enabled = false` → false for everyone except SUPER_ADMIN, and SUPER_ADMIN only for action `controls`. (A disabled module is hidden from every menu, including the Super Admin's. The Super Admin re-enables it from the System Control Center.)
3. If action ∈ {add, edit, delete, export} and the matching `allow_*` flag is false → false (for SUPER_ADMIN too: the switch is a business rule, not a permission).
4. SUPER_ADMIN → true.
5. **Department gate.** The page's family must be in the user's department families (`department_families`). Exceptions:
   * a role whose effective scope for that page is `ALL` skips the gate;
   * `admin-users` keeps its Phase 1 rule (ADMIN+).
6. **Role gate.** The effective `role_permissions` row (page → family → `*`) must have the action set to true.
7. **Hierarchy guard.** When the action is `controls`, the user must be ADMIN or above, whatever the table says.

**Caching.** Results may be cached for 60 s per user. Any write to `role_permissions`, `department_families`, `module_controls`, `departments` or the user clears the whole cache, so changes take effect on the next request (test it).

### 2.6 Who may edit what (hierarchy, same spirit as Phase 1)
* **Permission Master.**
  * SUPER_ADMIN may edit the rows of ADMIN, MANAGER, LEAD and MEMBER.
  * ADMIN may edit MANAGER, LEAD and MEMBER.
  * Nobody edits the rows of their own role or a higher role. 403 otherwise.
* **Department Master, Department Access, System Control Center, Letterhead:** needs `controls` on the respective page:
  * `admin-departments`;
  * `admin-permissions` for department access;
  * `admin-settings` for module controls and letterhead.
  * By default that means ADMIN and above.
* **Guards against locking yourself out:**
  * a module control cannot disable any page in the **Administration** family (409 `PROTECTED`);
  * the `Administration` department cannot be deleted or deactivated, and must keep all 22 families;
  * an ADMIN's `controls` permission on `*` cannot be turned off by anyone (409 `PROTECTED`).
* **Audit Trail viewer** (`admin-audit`): ADMIN and above, read-only.

## 3. API (all under `/api/v1`, Bearer auth, Phase 1 error format, `.strict()` zod, `If-Match` on every PATCH/PUT of a versioned row)

| Method & path | Who | Notes |
|---|---|---|
| `GET /me/menu` | any signed-in user | `{data:{families:[{name,icon,items:[{id,title}]}]}}`: only pages where `can(view)`, in registry order; families with no visible items are omitted |
| `GET /me/permissions?pageId=` | any | `{data:{pageId, actions:{view,add,edit,delete,approve,export,controls}, scope}}`, so the UI can enable or disable buttons |
| `GET /departments` | `view` on admin-departments | list + `userCount` |
| `POST /departments` | `controls` | `{code,name,head?}`. Duplicate code/name → 409 DUPLICATE |
| `PATCH /departments/:id` | `controls` | `{code?,name?,head?,status?}`; rename cascades; Administration protected |
| `DELETE /departments/:id` | `controls` | 409 IN_USE if users exist; also deletes its department_families rows; Administration protected |
| `GET /roles` | ADMIN+ | `[{code,label,level,userCount,canManage}]` |
| `GET /permissions` | ADMIN+ | `{data:{roles:[{role, editable:boolean, rows:[{resource, view…controls, scope, version}]}], families:[22 names]}}` |
| `PUT /permissions/:role` | per §2.6 | body `{rows:[{resource, view,…, controls, scope}]}` replaces that role's rows (transaction); `If-Match` = the role's max version or a role-level version (choose one and document it); validation: resource `*` must exist; families must be real registry families |
| `GET /department-access` | ADMIN+ | `{data:{departments:[{name, families:[...]}], families:[22]}}` |
| `PUT /department-access/:department` | `controls` on admin-permissions | `{families:[...]}`; Administration must stay at 22 |
| `GET /module-controls?family=&q=` | ADMIN+ | 248 rows: `{pageId,title,family,enabled,ownerDepartment,approvalRequired,allowAdd,allowEdit,allowDelete,allowExport,version}` |
| `PATCH /module-controls/:pageId` | `controls` on admin-settings | `If-Match`; Administration-family pages cannot be disabled |
| `GET /settings/letterhead` | any signed-in user | |
| `PUT /settings/letterhead` | `controls` on admin-settings | `If-Match`; validation per §2.3 |
| `GET /audit-logs?from=&to=&actorId=&action=&targetType=&q=&page=&size=` | ADMIN+ | newest first; size ≤ 100; returns actor name/loginId; `detail` included |
| `GET /audit-logs/:id` | ADMIN+ | |

**Audit actions** to add:
* `DEPARTMENT_CREATED`, `DEPARTMENT_UPDATED`, `DEPARTMENT_DELETED`
* `PERMISSIONS_UPDATED` (before/after rows)
* `DEPARTMENT_ACCESS_UPDATED`
* `MODULE_CONTROL_UPDATED`
* `SETTINGS_UPDATED`

New error code: `409 IN_USE` and `409 PROTECTED`.

**Phase 1 endpoints change:**
* `/meta/departments` returns **active departments from the DB** (still an array of names).
* User create/update validates the department against the DB (active only) instead of the constant.

## 4. Web (`apps/web`): prototype look

The prototype screens are the visual reference:
* `reference/screens/v92/ui-permissions.png`
* `ui-system-setup.png`
* `ui-system-controls.png`
* `ui-letterhead.png`
* `fam-22-Administration-admin-users.png`

The prototype code is in `reference/index.html`: `departmentMaster`, `roleMaster`, `permissionMaster`, `systemSetup`, `systemControls`, `letterheadSettings`, `approvalMatrix`.

**Sidebar**
* Uses `GET /me/menu` instead of filtering the registry on the client.
* The registry stays the source of titles and icons for routing.
* After any admin save that affects the menu, it refetches.

**Pages** (routes `/m/<pageId>`). Use the prototype classes (`.page-head`, `.card.table-wrap`, `.btn`, `.modal`, `.form-grid`, `.field`, `.master-grid .master`, `.status`).

* **`admin-departments` — Department Master.**
  * Prototype columns: Code, Name, Head, Status, plus **Users**; Action column.
  * "＋ Add Department" opens a modal (Code, Name, Head).
  * Edit modal also includes Status.
  * Delete uses a confirm modal and shows the 409 IN_USE message: "This department has N users. Move them first or deactivate the department."
  * The Administration row has no Delete or Deactivate.
* **`admin-roles` — Role Master.** Read-only table: Role, Level, Users, Can be created by, and a "Permissions" button that opens admin-permissions for that role.
* **`admin-permissions` — Permission Master.** Two sub-tabs (`.v9-subtabs` style).
  * **Role Permissions:** the prototype table. Rows = ADMIN, MANAGER, LEAD, MEMBER. Columns: Role, Scope (select OWN/DEPARTMENT/ALL), View, Add, Edit, Delete, Approve, Export, Controls (checkboxes), Save per row.
    * Rows the user may not edit are disabled, with a tooltip.
    * Super Admin is shown as a locked row with "All permissions (owner)".
    * Below the table, an expandable "Family overrides" section per role: a 22 × 7 grid of check states. Each cell is inherited (grey) or overridden (blue). Clicking cycles inherit → allow → deny → inherit.
  * **Department Access:** an 11 × 22 checkbox matrix (departments × families) with a Save per department. The Administration row is locked to all.
* **`admin-settings` — System Setup.** The prototype's tile grid with 9 tiles; keep the tile texts.
  * Wired tiles:
    * System Controls (→ `/m/admin-settings/controls`)
    * Department Master
    * User Master
    * Role Master
    * Permission Master
    * Letterhead & PDF (→ `/m/admin-settings/letterhead`)
  * Not-yet-built tiles (Company Master, Branch Master, Approval Matrix) show a "Phase 3" / "Phase 6" badge and are disabled.
* **System Control Center** (`/m/admin-settings/controls`).
  * The prototype table: Family, Module, Owner Department (select), Enabled, Approval, Add, Edit, Delete, Export (checkboxes), Save per row.
  * Family filter and search above the table.
  * Administration-family "Enabled" checkboxes are disabled.
  * Saving refreshes the sidebar.
* **Letterhead & PDF** (`/m/admin-settings/letterhead`).
  * The prototype form with 11 fields. Use human labels (Company Name, Legal Name, Address, Phone, Email, Website, GSTIN, PAN, CIN, Footer, Signatory) rather than the raw keys.
  * Field errors shown under the fields. "Save Letterhead" button.
  * A live **preview card**: letterhead header block (company name, address line, GSTIN | PAN | CIN) plus the footer and signatory, styled like the payslip preview `.v92-payslip-preview .ph`.
  * The prototype's "Test PDF" button is shown disabled with the title "PDF generation arrives in Phase 4".
* **`admin-audit` — Audit Trail.**
  * Filters: date from/to, action (select of known actions), user search, free text.
  * Table: Date Time, User, Action, Target, IP, Details button.
  * The details drawer shows `detail` as a readable key/value list. Before/after values go side by side when present.
  * Pagination.
* **Buttons on every page follow `/me/permissions`.** Without the right they are hidden or disabled; the server still enforces everything.
* **Navigation guard.** A page the user cannot view shows the "Access denied" card (direct URL included).

## 5. Tests (must pass three times in a row)

**API**
* The access function: a table-driven test over roles × department gate × family overrides × disabled modules × allow flags × Super Admin.
* Every endpoint, including negative paths: 403 by hierarchy, 409 IN_USE / PROTECTED / VERSION_CONFLICT, 422 validation.
* Cache invalidation: change a permission, then the next request reflects it.
* Seed idempotency: run twice, and admin edits survive.
* FK cascade on rename, and RESTRICT on delete.

**Web**
* Unit tests for each page: rendering, disabled rows, modal flows, 409/422 messages, permission-driven buttons.

**E2E** (root `tests/e2e`, owned by the orchestrator):
* the owner disables a module and it disappears from a member's menu;
* the owner removes `view` for MEMBER on the Sales family and the member loses it;
* deleting a department with users is refused;
* the letterhead is saved and reloads;
* the audit trail shows those actions.
