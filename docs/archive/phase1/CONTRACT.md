# Phase 0 + 1 Contract — Foundation and Authentication

This is the single source of truth for Phase 0/1. Every agent and every file in this phase must follow it. If code and contract disagree, the contract wins; change the contract first (with a reason) and then the code.

## 0. Decisions from the product owner (2026-11-01)

These override PLAN.md where they differ.

| # | Decision | Effect |
|---|---|---|
| O-1 | **No company code** on login | The login form has only **Email / User ID** and **Password** |
| O-2 | **No sign-up** | The "Sign Up" tab is removed. Only administrators create users |
| O-3 | No department picker on login | The department is stored on the user and shown after login |
| O-4 | **5-level role hierarchy** | See §1 |
| O-5 | Only the Super Admin (the owner) can create Admins. An Admin can create every role below Admin. Nobody can create a Super Admin | See §1.2 |
| O-6 | The demo accounts box and the quick-department login buttons are removed | They were a security hole in the prototype (password-less login) |

## 1. Roles

### 1.1 The hierarchy

| Code | Label | Level | Notes |
|---|---|---|---|
| `SUPER_ADMIN` | Super Admin | 100 | The owner. **Exactly one** exists, created by the seed script from env. Cannot be created, deleted or demoted through the API |
| `ADMIN` | Admin | 80 | |
| `MANAGER` | Manager | 60 | |
| `LEAD` | Lead | 40 | |
| `MEMBER` | Member | 20 | |

### 1.2 Who can create and manage whom

This rule table lives in **one file**: `apps/api/src/core/rbac/role-rules.ts`. It is imported by both the API and the tests, and the web app gets it from `GET /api/v1/meta/roles`.

| Actor | May create / edit / deactivate / reset password of |
|---|---|
| SUPER_ADMIN | ADMIN, MANAGER, LEAD, MEMBER |
| ADMIN | MANAGER, LEAD, MEMBER |
| MANAGER, LEAD, MEMBER | nobody in Phase 1 |

Further rules:

* A user can never change their **own** role or status, and can never reset their own password through the admin endpoint. They use change-password instead.
* When a role changes, the actor must be allowed to manage **both** the old role and the new role.
* Viewing the user list: SUPER_ADMIN and ADMIN see all users. Other roles get 403.

## 2. Departments

The 11 departments come from the prototype `DEPARTMENTS`, in this order:

`Administration, Sales, Purchase, Finance, HR, Production, Quality, Maintenance, Warehouse, Projects, Service`

* Each user has a `department`. It may be null only for SUPER_ADMIN.
* In Phase 1 the department decides the **menu families shown** for MANAGER, LEAD and MEMBER, using the prototype `DEPT_FAMILIES` (`packages/registry/registry.json`).
* SUPER_ADMIN and ADMIN see all families.

## 3. Repository layout (no npm workspaces; each package has its own lockfile so agents can install in parallel)

```
erp/
├─ package.json            root scripts only (dev, test, verify, e2e) + concurrently + @playwright/test
├─ apps/api/               Express + TypeScript + Prisma (owner: API agent)
├─ apps/web/               React 18 + Vite + TypeScript (owner: Web agent)
├─ packages/registry/      extractor + registry.json (owner: Registry agent)
├─ tests/e2e/              Playwright end-to-end tests (owner: QA agent, after the build)
├─ reference/              index.html (read-only copy of the prototype) + screens/v92 (visual target)
└─ docs/                   PLAN, REGISTRY.csv, phase1/
```

## 4. Environment and ports

* PostgreSQL 18 is installed locally (no Docker on this machine).
  * Dev database: `postgresql://postgres:postgres@localhost:5432/rhai_erp`
  * Test database: `postgresql://postgres:postgres@localhost:5432/rhai_erp_test`
  * The old database `erp` belongs to a previous attempt. **Never touch it.**
* API: `http://localhost:4000`. Web (Vite): `http://localhost:5173`. Vite proxies `/api` → `http://localhost:4000`, so cookies are same-origin.
* `apps/api/.env.example` must list every variable. `.env` is git-ignored. Variables:
  * `DATABASE_URL`
  * `JWT_ACCESS_SECRET` (≥ 32 random bytes)
  * `ACCESS_TOKEN_TTL=15m`
  * `REFRESH_TOKEN_TTL_DAYS=7`
  * `SESSION_IDLE_MINUTES=30`
  * `PORT=4000`
  * `NODE_ENV`
  * `WEB_ORIGIN=http://localhost:5173`
  * `SUPERADMIN_LOGIN_ID`, `SUPERADMIN_EMAIL`, `SUPERADMIN_NAME`, `SUPERADMIN_PASSWORD` (used **only** by the seed)

## 5. Data model (Prisma, table names snake_case plural)

**User**
* `id uuid`
* `loginId` — unique, stored lowercase, `^[a-z0-9._@-]{3,64}$`
* `email` — unique, nullable, lowercase
* `name` — 2–100 chars
* `role` — enum `Role`
* `department` — string, nullable; must be one of §2
* `status` — enum `ACTIVE | INACTIVE`
* `passwordHash`
* `mustChangePassword bool` (default true)
* `failedLoginCount int`, `lockedUntil timestamptz?`, `lastLoginAt?`
* `createdById?` → User
* `createdAt`, `updatedAt`, `version int` (optimistic lock)
* A partial unique index guarantees **at most one SUPER_ADMIN** (raw SQL in the migration).

**Session**
* `id uuid`, `userId`
* `familyId uuid`
* `refreshTokenHash` (sha256 hex, unique)
* `userAgent`, `ip`
* `createdAt`, `lastUsedAt`, `expiresAt`
* `revokedAt?`, `revokedReason?`

**AuditLog**
* `id`, `at`
* `actorId?`, `action` (string), `targetType?`, `targetId?`
* `ip?`, `userAgent?`
* `detail jsonb`
* **Append-only:** a migration trigger raises on UPDATE and DELETE.

## 6. Security rules (must be implemented and tested)

**Passwords**
* Hashed with Argon2id via `@node-rs/argon2` (prebuilt on Windows; no `node-gyp`).
* Policy: at least 10 characters, at least 3 of {lowercase, uppercase, digit, symbol}, and not equal to the loginId or email.

**Login**
* Request: `identifier` (loginId or email, case-insensitive) + `password`.
* On failure, the reply is always the same: `401 INVALID_CREDENTIALS` "Invalid login ID or password." The API must not reveal whether the user exists.
  * Run a dummy Argon2 verify when the user does not exist, so response timing does not give it away.
* Inactive user → the same generic 401.

**Lockout**
* 10 consecutive failures lock the account for 15 minutes.
* While locked → `423 ACCOUNT_LOCKED` "Too many failed attempts. Try again in N minutes." (Even the correct password is refused while locked.)
* A successful login resets the counter.

**Rate limit**
* `POST /auth/login`: 5 requests/min per IP+identifier → `429 RATE_LIMITED` with `Retry-After`.
* Everything else: 300/min per IP.
* In-memory store (there is no Redis yet). Rate limits must be disable-able in the test env only through an explicit `RATE_LIMIT_DISABLED=true`.

**Tokens**
* Access token: JWT HS256, TTL 15 min, claims `{sub, sid, role}`. The client holds it **in memory only**.
* Refresh token: 32 random bytes, base64url.
  * Sent as the cookie `rt`: httpOnly, `SameSite=Strict`, `Path=/api/v1/auth`, `Secure` when `NODE_ENV=production`, `Max-Age` = refresh TTL.
  * Stored only as a sha256 hash.
* Each request re-checks the database for: the session not revoked or expired, the user ACTIVE, and the role taken **from the DB, not from the token** (a role change takes effect immediately).

**Rotation**
* Every `/auth/refresh` issues a new refresh token and marks the old one revoked (`rotated`).
* **Reuse detection:** if an already-rotated token is presented, every session in that `familyId` is revoked (`reuse_detected`) and the reply is 401.

**Idle and absolute timeout**
* No refresh for `SESSION_IDLE_MINUTES` → the session expires.
* Absolute expiry = refresh TTL.

**Must change password**
* While `mustChangePassword` is true, every endpoint except `/auth/me`, `/auth/change-password`, `/auth/logout` and `/meta/*` returns `403 PASSWORD_CHANGE_REQUIRED`.

**CSRF**
* The refresh cookie is SameSite=Strict and path-scoped. State-changing endpoints require `Authorization: Bearer` (which a browser never attaches automatically), so cookie-only CSRF is impossible.
* `/auth/refresh` and `/auth/logout` additionally require the header `X-Requested-With: rhai-web`.

**Headers and CORS**
* helmet defaults; `x-powered-by` off; JSON body limit 100 kb.
* CORS allows only `WEB_ORIGIN`, with credentials.

**Audit**
Write an AuditLog row for:
* `LOGIN_SUCCESS`, `LOGIN_FAILED` (`detail.identifier`, never the password), `ACCOUNT_LOCKED`
* `LOGOUT`, `LOGOUT_ALL`, `TOKEN_REUSE_DETECTED`
* `PASSWORD_CHANGED`
* `USER_CREATED`, `USER_UPDATED` (with before/after, never hashes), `USER_PASSWORD_RESET`

**Logging**
* pino.
* Redact `password`, `newPassword`, `currentPassword`, `authorization`, `cookie`, `passwordHash`.

## 7. API (`/api/v1`, JSON)

**Response shapes**
* Success: `{ "data": ..., "meta"?: {...} }`.
* Error: `{ "error": { "code": "STRING", "message": "Human text", "status": 422, "requestId": "...", "fields"?: { "fieldName": "message" } } }`.

**Status codes**
* 400 `BAD_REQUEST`
* 401 `UNAUTHENTICATED` / `INVALID_CREDENTIALS` / `SESSION_EXPIRED`
* 403 `FORBIDDEN` / `PASSWORD_CHANGE_REQUIRED`
* 404 `NOT_FOUND`
* 409 `CONFLICT` / `VERSION_CONFLICT` / `DUPLICATE`
* 422 `VALIDATION_ERROR`
* 423 `ACCOUNT_LOCKED`
* 429 `RATE_LIMITED`
* 500 `INTERNAL` (message "Something went wrong." plus requestId; no stack)

### Endpoints

| Method & path | Auth | Body / query | Success |
|---|---|---|---|
| `GET /health` | none | | `{data:{status:"ok", db:"ok"}}` |
| `POST /auth/login` | none | `{identifier, password}` | 200 `{data:{accessToken, expiresIn, user}}` + Set-Cookie `rt` |
| `POST /auth/refresh` | cookie + `X-Requested-With` | | 200 same as login (rotated cookie) |
| `POST /auth/logout` | cookie + `X-Requested-With` (Bearer optional) | | 204, cookie cleared |
| `POST /auth/logout-all` | Bearer | | 204 (all of my sessions revoked) |
| `GET /auth/me` | Bearer | | 200 `{data:user}` |
| `POST /auth/change-password` | Bearer | `{currentPassword, newPassword}` | 200 `{data:{accessToken, expiresIn, user}}`. Clears `mustChangePassword`, revokes **other** sessions |
| `GET /meta/roles` | Bearer | | `{data:[{code,label,level,canManage:boolean}]}` |
| `GET /meta/departments` | Bearer | | `{data:[...11 names]}` |
| `GET /users` | Bearer, ADMIN+ | `q, role, status, department, page=1, size=20 (max 100), sort=name\|-createdAt…` | `{data:[user], meta:{page,size,total}}` |
| `GET /users/:id` | Bearer, ADMIN+ | | `{data:user}` |
| `POST /users` | Bearer, per §1.2 | `{loginId, email?, name, role, department?, temporaryPassword}` | 201 `{data:user}`. `mustChangePassword=true` |
| `PATCH /users/:id` | Bearer, per §1.2 + header `If-Match: <version>` | any of `{email, name, role, department, status}` | 200 `{data:user}`. Setting INACTIVE revokes all of that user's sessions |
| `POST /users/:id/reset-password` | Bearer, per §1.2 | `{temporaryPassword}` | 204. Sets `mustChangePassword`, revokes all of that user's sessions |

**User DTO.** `{id, loginId, email, name, role, roleLabel, roleLevel, department, status, mustChangePassword, lastLoginAt, createdAt, updatedAt, version}`. Never include the hash, the lockout counters or session data.

**Validation.** Zod on body, query and params. Unknown keys are rejected (`.strict()`). Strings are trimmed.

## 8. Web app (`apps/web`)

**Look and feel**
* Copy the CSS **values** from `reference/index.html` (lines 8–23 hold the tokens, login, app shell, cards, buttons, tables, modal, drawer and toast styles) into `src/styles/*.css`, keeping the class names.
* Font: `Inter, Segoe UI, Arial, sans-serif`.

**Login page** must match `reference/screens/v92/00-login.png` (desktop 1440×900) and `00-login-mobile.png` (390 px), with these differences only:

* Left panel: identical layout (logo "RH", "RHAI Enterprise ERP", headline, paragraph, 4 feature cards, footer line). Text changes:
  * Badge: "V8 ADVANCED • QA GREEN" → **"ENTERPRISE ERP"**.
  * Paragraph: **"One secure workspace for every department. Your role and department decide what you can see and do, every action is recorded in the audit trail, and approvals follow your company's authority matrix."**
  * Feature 1: "🟢 QA Green" → **"🔐 Secure Sign-In"** / "Server-side authentication with account lockout and session control."
  * Feature 2: "🔐 Department Login" → **"🏢 Role Hierarchy"** / "Super Admin, Admin, Manager, Lead and Member levels."
  * Features 3 and 4 unchanged.
  * Footer: "Single-file local ERP demonstration. Production authentication should be server-side." → **"Authorised users only. All sign-ins are logged."**
* Right card:
  * "Welcome back" / "Sign in with your company account."
  * Auth tabs: only **Sign In** and **Forgot**, in a 2-column grid with the same tab styling.
  * Sign In: a field **"Email / User ID"** (`autocomplete="username"`, **empty by default**), and **Password** with the Show/Hide button (`autocomplete="current-password"`, empty).
  * The row "Session is verified on the server" ↔ "Forgot password?".
  * The **"Sign In to ERP"** button.
  * No company code, no department, no demo button, no demo box.
* Forgot tab: the text "For security, passwords are reset by your administrator. Contact your Admin or the Super Admin with your login ID." plus a "Back to Sign In" button (style `.auth-alt`).
* Messages use the `.msg.error / .msg.info / .msg.success` styles.
* The submit button disables and shows "Signing in…" while the request is pending, so a double click never sends twice.
* Enter submits.

**After login**
* If `mustChangePassword` is set, show the **Change Password** screen. It uses the same login-card look: "Set a new password", fields current/new/confirm, and policy hints that turn green as each rule is met. Nothing else is reachable until the password is changed.
* Otherwise show the **app shell**, matching the prototype `.app` layout (see `reference/screens/v92/dash-02-Sales.png`):
  * Sidebar: brand, "Search menu..." filter, and families from `packages/registry/registry.json`. SUPER_ADMIN and ADMIN see all 22 families; other roles see `DEPT_FAMILIES[user.department]`. Sections collapse.
  * Top bar: ☰ Menu, "Search all ERP records..." (disabled with the title "Available in a later phase"), Company/Branch/FY selects showing the static prototype options (disabled; real context arrives in a later phase), the health pill bound to `GET /health`, the ＋ and 🔔 buttons (disabled), and the account button (avatar initials, name, "Role • Department").
* **Dashboard route `/`.** The hero band "<Department or Administration> Dashboard" plus the user name and role, and a notice: "Modules are being enabled phase by phase. Your account and access are active." No fake numbers anywhere.
* **Users page `/m/admin-users`** (SUPER_ADMIN and ADMIN only; the menu item "Users" under Administration):
  * The prototype User Master look: page head "User Master", a "＋ Add User" primary button, and a table with columns Name, Login ID, Email, Department, Role, Status, Last Login, Action.
  * Search box, role/status filters, pagination.
  * Add/Edit use the prototype `.modal` + `.form-grid` + `.field` styles. The Role select offers only roles where `canManage` is true. The Department select offers the 11 departments.
  * Actions: Edit, Reset Password (a modal asking for a temporary password), and Activate/Deactivate (a confirm modal, never `window.confirm`).
  * Field errors from 422 responses are shown under the fields.
  * A 409 VERSION_CONFLICT shows "This user was changed by someone else. Reload and try again."
* Every other menu item routes to `/m/:pageId` and shows the page title from the registry with the notice "This module will be enabled in a later phase."
* **Account drawer** (prototype `.drawer`): avatar, name, login ID, Department, Role, a Change Password form, "Sign out of all devices", and a red "Sign Out" button.

**Auth client**
* The access token is kept in memory (module variable / React context), **never localStorage or sessionStorage**.
* On app load, call `/auth/refresh` to restore the session (this is how the session survives a browser refresh).
* On a 401 from any call, try a single refresh and retry once. If that also fails, go to /login.
* Logout in one tab is broadcast to the other tabs with `BroadcastChannel('rhai-auth')`.

**Routing.** React Router: `/login`, `/`, `/m/:pageId`, and `*` → a 404 card. Unauthenticated users are redirected to `/login?next=…`.

**Other rules**
* No `dangerouslySetInnerHTML`.
* Responsive at 1000 px and 600 px exactly like the prototype media queries.

## 9. Registry (`packages/registry`)

* `extract.ts` parses `reference/index.html` with **acorn** (no `eval` of the page). It finds the literals `MENU`, `PROFILES`, `DEPT_FAMILIES` and `DEPARTMENTS`, and applies the `Object.assign(PROFILES["pay-payslip"], {...})` override.
* It writes `registry.json` (`{generatedFrom, sha256, families:[{name, icon, items:[{id,title}]}], profiles:{id:{title,family,purpose,tabs,fields}}, deptFamilies, departments}`) and `registry.d.ts` types.
* The test asserts:
  * 22 families, 248 menu items, no duplicate ids;
  * 244 profiles, each with 6 tabs, 2,773 fields in total;
  * 11 departments;
  * `pay-payslip` has 37 fields;
  * every menu id equals the menu ids in `docs/REGISTRY.csv` (rows with `in_menu=yes`).
* `npm run extract` regenerates. The test also checks that `registry.json` is up to date with `reference/index.html` (via sha256).

## 10. Quality gates

* TypeScript `strict`, `noUncheckedIndexedAccess`. No `any`. ESLint plus Prettier.
* Every package has `npm run verify` = lint + typecheck + test, and it must pass.
* API tests run against `rhai_erp_test` (reset per run with `prisma migrate reset --force --skip-seed` in global setup). They cover every rule in §1.2 and §6 and every endpoint in §7, including the negative cases.
* No `console.log` in app code.
* Every source file starts with a 1–3 line comment saying **why the file exists**.

## 11. Implementation notes (merged)
The API builder recorded every choice the contract left open, and every security-review hardening, in `apps/api/README-PHASE1.md`. Those notes are part of this contract. Examples: the `REFRESH_RACE` 409 with a one-time grace, `SERVER_BUSY` 503, `PAYLOAD_TOO_LARGE` 413, the `TRUST_PROXY` and `ARGON2_MAX_CONCURRENCY` env settings, and a wrong current password giving 422.
