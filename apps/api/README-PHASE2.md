# apps/api: Phase 2 choices and deviations

These are the places where the API makes a choice that `docs/phase2/CONTRACT.md` leaves open, or differs from it. Phase 1 choices stay in `README-PHASE1.md`.

## Orchestrator clarifications (2026-11-02), implemented

1. **Nullable override cells.** On `family:` and `page:` rows, the 7 action columns and `scope` are nullable; `null` means "inherit from the next less specific row" (page → family → `*`). `*` rows are never null: the DB enforces this with CHECK `role_permissions_default_complete`, and PUT returns 422 with `fields["rows.N.<cell>"]`. `access.ts` resolves **each action and the scope independently**: the most specific non-null value wins, and a cell that is null everywhere resolves to `false` / `OWN`. `GET /permissions` returns `null` for inherited cells and PUT accepts `null`. **On PUT, an override row whose cells are all null is not stored** (it carries no information). The seeded `family:Administration` rows are explicit `false` (a deny), not null.
2. **`PUT /permissions/:role` If-Match** = the highest `version` among the role's rows (as returned by GET, also exposed as `roles[].version`). Every row written gets that version + 1.
3. **Letterhead shape:** `GET` and `PUT /settings/letterhead` respond `{data:{value:{...11 fields}, version}}`. The PUT body is the bare `{...11 fields}` with `If-Match`.
4. **Audit log rows:** `{id, at, action, targetType, targetId, ip, userAgent, detail, actor:{id,name,loginId}|null}` (no separate `actorId` field; the `actorId` _filter_ stays on the query).
5. **`PUT /department-access/:department`:** no version / If-Match; last write wins, and the change is audited. **`DELETE /departments/:id`:** an optional If-Match, checked if present.

## If-Match and versions

- **`PUT /permissions/:role` uses a role-level version.** It is the highest `version` among that role's rows. `GET /permissions` returns it as `roles[].version`, and the PUT echoes it in `ETag`. A successful PUT rewrites every row of the role at `version + 1`. A per-role advisory lock serialises concurrent PUTs, so two writers cannot both pass the check.
- **`PUT /settings/letterhead`:** If-Match is the setting row's version (`data.version`). `0` means "not created yet" (only if the row is missing; the seed creates it).
- **`PUT /department-access/:department` takes no If-Match.** `department_families` rows are not versioned (§3 asks for If-Match only on versioned rows). The replace runs in a transaction with a per-department advisory lock.
- **`DELETE /departments/:id` takes an optional If-Match.** If present it must match (409 otherwise); if absent the delete goes ahead.
- Every versioned PATCH/PUT returns `ETag: "<new version>"`.

## Access decision (`src/core/rbac/access.ts`)

- **`decide()` is a pure function of (user, page, action, data)** and follows §2.5 step by step. `can()` and `scopeFor()` use a per-user profile (all 248 pages × 7 actions) cached for 60 s. The cache key is `userId|role|department`, so a role or department change also misses the cache.
- **Invalidation:** any write to departments, department access, permissions, module controls or users (create, update, reset-password) clears the whole cache. A generation counter stops a profile that was computed during an invalidation from being stored afterwards. The cache is **per process**; a multi-instance deployment needs a shared bus (Redis pub/sub, as PLAN §5.2 says), which is not in this phase.
- **A page with no `module_controls` row is treated as disabled (fail closed).** The seed creates a row for every registry page and fills in any that go missing on re-run.
- **`admin-users`** skips the department gate and requires ADMIN+, whatever the table says (its Phase 1 rule).
- **`requirePageAction(pageId, action)`** is the reusable route guard for Phase 4. It refuses unknown page ids at boot. Phase 2 uses it for the `controls`/`view` checks in §2.6. Endpoints the contract marks "ADMIN+" use `requireMinRole('ADMIN')`.

## Endpoints

- **`GET /me/menu` and `GET /me/permissions` keep the Phase 1 gate:** while `mustChangePassword` is set they return `403 PASSWORD_CHANGE_REQUIRED` (only `/auth/me`, `/auth/change-password`, `/auth/logout` and `/meta/*` are exempt).
- **`GET /me/permissions`:** unknown `pageId` → `404 NOT_FOUND`; missing `pageId` → 422.
- **`GET /permissions`** lists ADMIN, MANAGER, LEAD and MEMBER only. SUPER_ADMIN has no rows (the UI shows the locked "All permissions (owner)" row). Each role carries `editable` and `version`. Rows are ordered `*` first, then families in registry order, then pages.
- **`PUT /permissions/SUPER_ADMIN`** → 403. An unknown role → 422.
- **Row validation (422 with `fields` like `rows.3.resource`):** exactly one `*` row, families must be registry families, pages must be registry ids, no duplicate resources, strict keys.
- **Protection:** an ADMIN `*` row with `controls: false` → 409 `PROTECTED`. Only `*` is protected; an ADMIN `family:Administration` override is not blocked (the contract only names `*`).
- **`GET /roles`** also returns `creatableBy` (roles allowed to create that role, from role-rules.ts), for the Role Master's "Can be created by" column.
- **`GET /departments`** includes inactive departments (with `status`). `GET /meta/departments` returns only ACTIVE ones, in creation order (the 11 seeded ones first, in prototype order).
- **`POST /departments`:** the code is trimmed and upper-cased before the `^[A-Z0-9]{2,10}$` check. Name uniqueness is checked case-insensitively before insert (the DB index is case-sensitive).
- **`PATCH /departments/:id` with the Administration department:** rename → 409 `PROTECTED`; `status: INACTIVE` → 409 `PROTECTED`; code and head may change.
- **`DELETE /departments/:id`:** 409 `IN_USE` with the contract message if users reference it, **and also** 409 `IN_USE` if it owns module controls (the FK is RESTRICT, so the DB would refuse anyway). Its `department_families` rows are deleted with it.
- **Department access with a department name in the path:** `PUT /department-access/:department` takes the URL-encoded name (e.g. `Service%20Desk`). Families are stored and returned in registry order. Duplicates or unknown names → 422. Administration must be given all 22 → otherwise 409 `PROTECTED`.
- **`GET /module-controls`** returns `{data:[...], meta:{total}}`, in registry order. `family` filters exactly; `q` matches title or pageId case-insensitively. Each row also has `title`, `family` and `updatedAt`.
- **`PATCH /module-controls/:pageId`:** `ownerDepartment` must be an ACTIVE department (422). Disabling an Administration-family page → 409 `PROTECTED`.
- **Letterhead:**
  - The PUT body is the full object, but only `companyName` is required. Optional fields default to `''`.
  - GSTIN, PAN and CIN are trimmed and upper-cased before the pattern check. `website` must be an http(s) URL.
  - The response is `{data:{value:{...11 fields}, version}}` (clarification 3). A stored value that fails validation is replaced by the defaults on read.
  - The seed value of `legalName` is the company name; the contract does not give one.
- **`GET /audit-logs`:**
  - `from`/`to` accept `YYYY-MM-DD` (a date-only `to` covers that whole day) or an ISO timestamp.
  - `q` searches action, targetType, targetId, IP, and the actor's name and login ID. It does **not** search inside `detail` (JSONB) in this phase.
  - `audit_logs.actor_id` is now a FK to users with `ON DELETE NO ACTION`. Users are never deleted, and the append-only trigger would refuse a SET NULL anyway.

## Phase 1 changes

- **`/meta/departments` and user create/update read the departments table.** An inactive or unknown department → 422 `fields.department` "Choose one of the listed departments.". On update, the department is checked only when it changes. The users list filter `department` is now a free string.
- **`users.department` is a FK to `departments.name`** (`ON UPDATE CASCADE ON DELETE RESTRICT`), widened to `VARCHAR(60)` to match `departments.name`.

## Data migration and seed

- **Migration `20261102000000_phase2_admin` inserts the 11 departments before adding the FK.** It also inserts any other department value already on a user, with a generated code `D<8 hex>`, so the FK can never fail on existing data. It adds CHECKs: department code format and name length; `role_permissions.role <> 'SUPER_ADMIN'`; resource format `*` / `family:…` / `page:…`.
- **`seedPhase2Defaults()` (`src/core/seed/defaults.ts`)** runs from `npm run db:seed` and from the test global setup.
  - Departments, department families and role permissions are applied **once**. The categories applied are recorded in the internal setting `system.seed`, so re-running never re-adds a row an admin deleted.
  - Module controls and the letterhead are insert-if-missing on every run. Neither can be deleted through the API, and this also picks up pages added to the registry later.
  - Nothing existing is ever updated.
- **Registry:** read at boot from `packages/registry/registry.json` (overridable with `REGISTRY_PATH`) and validated with zod. It is not copied into the API, and it is loaded with `fs` rather than imported, because the registry package is ESM with JSON import attributes and the API is CommonJS.
- **Audit `targetType` values:** `Department`, `RolePermissions` (targetId = role), `DepartmentAccess` (targetId = department id), `ModuleControl` (targetId = pageId), `Setting` (targetId = key).
