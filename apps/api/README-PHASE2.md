# apps/api: Phase 2 choices and deviations

These are the places where the API makes a choice that `docs/phase2/CONTRACT.md` leaves open, or differs from it. Phase 1 choices stay in `README-PHASE1.md`.

## Orchestrator clarifications (2026-11-02), implemented

1. **Nullable override cells.** On `family:` and `page:` rows, the 7 action columns and `scope` are nullable; `null` means "inherit from the next less specific row" (page → family → `*`). `*` rows are never null: the DB enforces this with CHECK `role_permissions_default_complete`, and PUT returns 422 with `fields["rows.N.<cell>"]`. `access.ts` resolves **each action and the scope independently**: the most specific non-null value wins, and a cell that is null everywhere resolves to `false` / `OWN`. `GET /permissions` returns `null` for inherited cells and PUT accepts `null`. **On PUT, an override row whose cells are all null is not stored** (it carries no information). The seeded `family:Administration` rows are explicit `false` (a deny), not null.
2. **`PUT /permissions/:role` If-Match** = the highest `version` among the role's rows (as returned by GET, also exposed as `roles[].version`). Every row written gets that version + 1.
3. **Letterhead shape:** `GET` and `PUT /settings/letterhead` respond `{data:{value:{...11 fields}, version}}`. The PUT body is the bare `{...11 fields}` with `If-Match`.
4. **Audit log rows:** `{id, at, action, targetType, targetId, ip, userAgent, detail, actor:{id,name,loginId}|null}` (no separate `actorId` field; the `actorId` _filter_ stays on the query).
5. **`PUT /department-access/:department`:** no version / If-Match; last write wins, and the change is audited. **`DELETE /departments/:id`:** an optional If-Match, checked if present.

## Review fixes (2026-11-02, independent review)

- **2: Seed is fail-closed.** `runSeed()` (`src/core/seed/run-seed.ts`, used by `npm run db:seed`) runs `seedPhase2Defaults()` first, with no env needed. The `SUPERADMIN_*` variables are required **only when no SUPER_ADMIN exists**; errors name the bad variable but never echo its value. `server.ts` also runs `seedPhase2Defaults()` (insert-if-missing only) **at boot, before listening**, so a freshly migrated DB never runs with empty module controls or permissions. If that step fails, the error is logged and the server still starts; access stays fail-closed, because a page without a module control is treated as disabled.
- **3: Hard rule in `decide()`.** A page in the Administration family is refused to anyone below ADMIN, whatever the tables say. `PUT /permissions/{MANAGER|LEAD|MEMBER}` returns 409 `PROTECTED` for any `true` action on `family:Administration` or on a `page:` row of an Administration page. The explicit deny row `family:Administration` (all actions `false`) is always kept: it is re-inserted if the PUT omits it, and null ("inherit") cells on it are stored as `false`.
- **4:** For ADMIN, `controls: false` on `family:Administration` or on an Administration page's `page:` row → 409 `PROTECTED` (as for `*`). `null` (inherit) is allowed.
- **5: Page permissions on top of ADMIN+.**
  - `GET /permissions` and `GET /department-access` need `view` on `admin-permissions`.
  - `GET /module-controls` needs `view` on `admin-settings`.
  - `GET /roles` needs `view` on `admin-roles`.
  - `GET /audit-logs`, `/audit-logs/:id` and `/audit-logs/actions` need `view` on `admin-audit`.
  - `GET /users` and `/users/:id` need `view` on `admin-users`; `POST /users` needs `add`; `PATCH /users/:id` and `POST /users/:id/reset-password` need `edit`.
  - All of this is in addition to the hierarchy rules. As a result the module control's `allow_add` / `allow_edit` on `admin-users` now also switches user creation and editing off, for the owner too.
- **7: FK races map to 422.** A FK violation (P2003) on user create/update returns 422 `fields.department`. On a module-control PATCH it returns 422 `fields.ownerDepartment`. These only happen if the row disappears between the check and the write.
- **9: No-op writes.** `PATCH /departments/:id`, `PATCH /module-controls/:pageId`, `PUT /department-access/:department` and `PUT /settings/letterhead` with nothing changed return the current DTO, with no version bump, no audit row and no cache flush. If-Match is still checked first, so a stale version is still a 409. `PUT /permissions/:role` was not in scope and still always writes.
- **10:** `GET /audit-logs/actions` → `{data:[...AUDIT_ACTIONS]}`. The list query is now one parameterised SQL statement (`Prisma.sql` fragments, never string concatenation). `q` matches action, target type, target id, IP, **`detail::text`**, and the actor's name and login ID (case-insensitive).
- **12: Wildcard escaping and offset cap.** `%`, `_` and `\` are escaped in every SQL `contains`/`ILIKE` search (users `q`, audit `q`), so they match literally. The module-controls `q` is an in-memory substring match over the 248 registry rows, so wildcards never applied there. Paging is capped at an offset of 10,000 rows (`(page − 1) × size ≤ 10000`, otherwise 422) for `/users` and `/audit-logs`.

## CORS: exact allow-list

- `WEB_ORIGINS` is a comma-separated list of **exact** origins. `CORS_ORIGINS` (the name the live server's `.env` uses) and `WEB_ORIGIN` (Phase 1, single value) are accepted as aliases, and values from all three are combined. If none is set, the default is `http://localhost:5173`.
- Each entry must be canonical `scheme://host[:port]`: http or https, no path, no trailing slash, no wildcard. Anything else fails boot validation.
- Only a listed origin is echoed, with `Access-Control-Allow-Credentials: true`. Any other origin (e.g. `https://evil-localhost.com`, `https://x.vercel.app`) gets no CORS headers, so the browser blocks the response. Requests without an `Origin` header (same-origin, curl, server-to-server) are unaffected.
- This replaces the callback added in commit 5216398, which allowed any origin ending in `.vercel.app` or containing `localhost`, with credentials.

## Production deployment notes (no code)

- **CORS is not needed for the main path.** The browser talks to Vercel, Vercel rewrites `/api` to Nginx, and Nginx forwards to the API, so the browser sees same-origin. Set `WEB_ORIGINS` / `CORS_ORIGINS` only for origins that really call the API cross-origin.
- **There are two proxy hops (Vercel → Nginx → API).** With the default `TRUST_PROXY=loopback`, Express trusts only Nginx on localhost and takes `req.ip` from the last `X-Forwarded-For` entry, which is the Vercel edge address. **Every user would then share one rate-limit bucket** (login 5/min per IP+identifier, 20/min per IP; 300/min global). Two settings fix this:
  - Set `TRUST_PROXY=2`, so Express skips Nginx and Vercel and uses the real client address. Alternatively list the exact proxy addresses/subnets, e.g. `TRUST_PROXY=loopback, <vercel egress ranges>`. Never use `true`: with `true`, any client can spoof `X-Forwarded-For`.
  - Nginx must forward the chain: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` and `proxy_set_header X-Forwarded-Proto $scheme;`. It must **append** to the header Vercel sent, not replace it.
- Afterwards, check that `req.ip` (in the pino request logs and in `audit_logs.ip`) shows real client addresses and not the Vercel or Nginx address.

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
- **Administration pages** (all of them, including `admin-users`) require ADMIN+, whatever the table says. `admin-users` also skips the department gate (its Phase 1 rule).
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
