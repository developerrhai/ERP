# Phase 0 + 1 — What changed and why

Date: 2026-11-01. Spec: [`CONTRACT.md`](CONTRACT.md).

## 1. Your decisions, and how they were applied

| Your request | What was done | Why it is done this way |
|---|---|---|
| Login page must look like the prototype | Same two-panel login: left hero, card, tabs, fields, gradients, fonts. The CSS is copied from `index.html` with the same class names | Pixel parity with the prototype is the main goal (PLAN §7) |
| No company code | Removed. Login is **Email / User ID + Password** only | Your decision |
| No sign-up for employees | The "Sign Up" tab is removed. Only administrators create users | Your decision. The prototype's sign-up also let anyone choose the role "Department Head" (a security hole) |
| Roles: Super Admin (owner), Admin, Manager, Lead, Member, with 5 levels | Levels 100 / 80 / 60 / 40 / 20, defined in **one file**: `apps/api/src/core/rbac/role-rules.ts` | One rule table means the API, the web app and the tests can never disagree |
| Only the Super Admin creates Admins; an Admin creates any role except Super Admin | Super Admin → Admin, Manager, Lead, Member. Admin → Manager, Lead, Member. Nobody can create a Super Admin. Exactly one Super Admin can exist (also enforced by a database index) | You said both "only super admin can create admin" and "admin can create any role, not super admin". I read the first as the stricter rule, so Admins **cannot** create other Admins. If you want Admins to create Admins, it is a one-line change in `role-rules.ts` |
| "Forgot password" | The Forgot tab says "passwords are reset by your administrator". Admins reset the password from User Master, and the user must set a new one at the next sign-in | There is no email server yet. Admin reset is the normal flow for an internal ERP. An email reset link can be added later |
| Remove unwanted files | Old code from earlier attempts was removed (list in §2) | It mixed MongoDB and PostgreSQL, had no real tests, and earlier AI reports about it were wrong. The rebuild follows PLAN.md |

The Department picker was also removed from login. Each user's department is stored on the user and decides which menu families Managers, Leads and Members see (the prototype's `DEPT_FAMILIES` rule).

## 2. Files removed, and why

**A backup of everything removed:** `C:\Users\admin\Desktop\erp-legacy-backup-2026-11-01.tar.gz` (591 files, 19.6 MB). Nothing is lost.

| Removed | Reason |
|---|---|
| `server.js`, `controllers/`, `middleware/`, `models/`, `routes/` | An old Express server for **MongoDB** (mongoose). The project uses PostgreSQL, so this code was unusable |
| `src/`, `prisma/`, `dist/`, `tsconfig.json`, `package.json`, `package-lock.json` | An earlier TypeScript/Prisma attempt that was never verified, plus its build output. It was replaced by `apps/api` built to the contract |
| `client/` (files) | An earlier React attempt, replaced by `apps/web`. The empty folder is still locked by a running process (see "Needs your action") |
| `scripts/`, `tests/` (old), `screens/`, `create-tables.sql`, `Dockerfile.api`, `docker-compose.yml`, `.dockerignore`, `STEP1_SUMMARY.md`, `uploads/` | Helper and output files of the old attempts. Docker is not installed on this machine |
| `.env`, `.env.example` (root) | Replaced by `apps/api/.env(.example)`, so each app owns its configuration |
| `docs/AUDIT.md, COVERAGE.md, DECISIONS.md, PROGRESS.md, READONLY.md, RESEARCH.md, STATUS.md, TEST_STRATEGY.md, VISUAL_PARITY.md` | Reports from earlier AI sessions, which you said were wrong in places. They were replaced by `PLAN.md` and `docs/plan/` |
| `reference/prototype.css`, old `reference/screens/<Department>/` folders, the old login PNGs | Outputs of the earlier attempt, replaced by `reference/screens/v92/` (45 fresh screenshots) |

**Kept:** `index.html` (the prototype, not modified), `PLAN.md`, `docs/plan/`, `docs/REGISTRY.csv` and `reference/index.html` (a read-only copy for the tools).

The old PostgreSQL database `erp` was **not** touched. The new app uses new databases: `rhai_erp`, `rhai_erp_test` and `rhai_erp_e2e`.

## 3. Files added, and why

Every source file also starts with a comment explaining why it exists.

### Root
| File | Why |
|---|---|
| `package.json` | One place to install, run (`npm run dev`), verify and e2e-test everything |
| `.gitignore` | Keeps secrets (`.env`), dependencies, builds and test output out of git |
| `README.md` | How to run the project |
| `docs/phase1/CONTRACT.md` | The exact Phase 0/1 spec that all three builder agents followed, so their work fits together |
| `docs/phase1/CHANGES.md` | This file |

### `packages/registry` — the menu data, taken from the prototype
| File | Why |
|---|---|
| `extract.ts`, `src/parse.ts`, `src/literal.ts`, `src/validate.ts`, `src/build.ts` | Read `reference/index.html` and pull out its 22 families, 248 pages, 244 profiles, departments and department→family access. It parses the file as data (acorn) and **never executes** prototype code |
| `registry.json`, `registry.d.ts`, `index.ts` | The extracted data and its types. The web sidebar is built from it, so the menu is exactly the prototype's |
| `test/registry.test.ts`, `test/csv.ts` | Prove the counts (22 / 248 / 244 / 2,773 fields), and that the data matches `docs/REGISTRY.csv` and is not stale |
| `package.json`, `tsconfig.json`, `eslint.config.mjs`, prettier files | Tooling: strict TypeScript, lint, format |

### `apps/api` — the server
| File | Why |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/*` | The database tables `users`, `sessions` and `audit_logs`. The migration also adds:<br>• the "only one Super Admin" index;<br>• lowercase login ID and email checks;<br>• an **append-only** trigger, so audit rows can never be edited or deleted |
| `prisma/seed.ts` | Creates the single Super Admin (the owner) from `.env`. It runs safely more than once and never overwrites a password |
| `src/server.ts`, `src/app.ts` | Start the server, and build the app with security headers, CORS for the web origin only, a body size limit, logging and error handling |
| `src/config/env.ts` | Validates every setting at startup, so a missing secret fails immediately instead of at runtime |
| `src/core/auth/password.ts` | Argon2id password hashing and the password policy (≥ 10 characters, 3 of 4 character types, not the same as the login ID) |
| `src/core/auth/tokens.ts`, `session-repository.ts`, `authenticate.ts`, `auth-context.ts` | Short-lived access tokens (15 min, kept in memory only) and a rotating refresh cookie (httpOnly, SameSite=Strict, stored hashed). Every request re-checks the session and the user in the database, so deactivation or a role change takes effect **immediately** |
| `src/core/rbac/role-rules.ts`, `authorize.ts` | The 5-level hierarchy and who may manage whom, in one place |
| `src/core/rate-limit.ts` | Stops password guessing: 5 login attempts per minute per IP and login ID |
| `src/core/audit/audit-service.ts` | Records every sign-in, failure, lockout, logout, password change and user change |
| `src/core/http/*`, `src/core/logger.ts`, `src/core/db/prisma.ts`, `src/core/departments.ts`, `src/types/express.d.ts` | The standard error format, request ids, input validation, a logger that hides passwords and tokens, the DB client, and the 11 departments |
| `src/modules/auth/*` | Login, refresh, logout, logout from all devices, "me", change password |
| `src/modules/users/*` | User Master API: list, view, create, edit (with conflict protection), reset password, activate/deactivate. Every action checks the hierarchy |
| `src/modules/meta/*`, `src/modules/health/*` | Lists of roles (with "can I manage this?") and departments for the forms, and a health check for the green status pill |
| `tests/*` (8 files, 233 tests) | Prove every rule: login, lockout, sessions, token theft detection, the full 5×5 role matrix, validation, audit, rate limit |
| `scripts/reset-test-db.ts` | Resets the **test** database only. It refuses any other database |
| `.env.example`, `README-PHASE1.md`, configs | Settings template, the record of design choices, and tooling |

### `apps/web` — the screens
| File | Why |
|---|---|
| `src/styles/*.css` | The prototype's CSS (colours, fonts, spacing, layout), so screens look the same |
| `src/pages/LoginLayout.tsx`, `LoginPage.tsx` | The login screen, with your changes applied |
| `src/pages/ChangePasswordPage.tsx`, `components/ChangePasswordForm.tsx`, `PasswordHints.tsx` | Forces a new password at first sign-in. The rules turn green as you type |
| `src/shell/*` | The app frame from the prototype: sidebar menu filtered by role and department, top bar, health pill, and an account drawer (change password, sign out, sign out of all devices) |
| `src/pages/users/*` | User Master: search, filters, add, edit, reset password, activate/deactivate. The Role list only shows roles you are allowed to create |
| `src/pages/DashboardPage.tsx`, `ModulePage.tsx`, `NotFoundPage.tsx` | The landing page (no fake numbers), a "later phase" notice for modules not built yet, and the 404 / access denied pages |
| `src/lib/api.ts`, `src/auth/*` | The only network client. It refreshes the session quietly, coordinates refreshes between browser tabs (so two tabs never sign you out), and signs every tab out together |
| `src/lib/registry.ts`, `next-path.ts`, `password-policy.ts`, `format.ts` | Menu filtering, a safe "return to page" after login (blocks redirects to other sites), the password rules and formatting |
| `src/components/*` | Modal, drawer, toast and fields, with keyboard and screen-reader support |
| tests (7 files, 70 tests) | Prove login behaviour, double-click safety, menu filtering, refresh logic and User Master rules |

### `tests/e2e` — the whole system, tested like a real user
| File | Why |
|---|---|
| `auth.spec.ts` | 12 browser scenarios on a real API and database:<br>• login page rules;<br>• no user enumeration;<br>• double click;<br>• forced password change;<br>• browser refresh;<br>• owner creates an Admin;<br>• an Admin cannot create Admins;<br>• a Member's limited menu, and the API refusing them;<br>• a forged token;<br>• deactivation kicking a user out immediately;<br>• two tabs refreshing at once;<br>• logout in one tab logging out the others |
| `playwright.config.ts`, `start-api.mjs`, `e2e-env.mjs` | Start a fresh API (the e2e database reset every run) and the web app on ports 4100/5180 |

## 4. Bugs found and fixed during the build–test–review loop
1. **Two tabs signed the user out.** Both tabs refreshed the session with the same cookie, and the second refresh looked like a stolen token.
   * Fixed on both sides. The web app now runs one refresh at a time across tabs (Web Locks). The API gives a 10-second grace window that answers "retry" instead of revoking.
   * Proven by an e2e test.
2. **Mobile login overlap.** On narrow screens the shorter card covered the feature cards. Fixed: the layout now stacks cleanly at ≤ 1000 px. Desktop is unchanged.
3. **Users menu shown to non-admins.** Managers, Leads and Members in the Administration department saw the "Users" menu item. It is now hidden; the page and the API were already blocked.
4. **Independent security review (loop 3).** A separate reviewer agent audited the code read-only. The fixes below came out of it; each has a regression test. The API's full list of design choices is in `apps/api/README-PHASE1.md`, and it is part of this contract.
   * **Lockout bypass with parallel requests (High).** The lock is now decided atomically, with a row lock. A correct password can never clear an active lock.
   * **Password guessing via "Change password" (Medium).** It now respects the lockout and is limited to 5 attempts per minute per user.
   * **Rate limits and audit IPs keyed on the proxy instead of the real client (Medium).** Fixed with a `TRUST_PROXY` setting and IPv6-aware keys.
   * **The 10-second "two tabs" grace window could be abused by a token thief (Medium).** It is now granted only once per token. A second replay counts as theft and ends every session in the family.
   * **Placeholder JWT secret accepted (Medium).** Rejected at startup now.
   * **CPU exhaustion through mass login attempts (Medium).** Added a per-IP login limit and a cap on concurrent password hashing (8; extra requests get "server busy, retry").
   * **Lockout could reveal which accounts exist (Low).** Unknown login IDs now lock the same way real ones do.
   * **Edit-user race; login ID colliding with another user's email (Low).** Closed in the service and in a database trigger.
   * **Passwords typed into the login ID box (Low).** No longer stored in the audit log.
   * **Web app:**
     * a temporary server error or restart no longer signs you out;
     * every request times out after 10 seconds;
     * "DATABASE ISSUE" now shows in the health pill;
     * sign-out retries when the server is unreachable and tells you.

## 5. Verification (final run, 2026-11-01)
| Suite | Result |
|---|---|
| `packages/registry` | 12/12 tests (3 consecutive runs) |
| `apps/api` | 256/256 tests, lint and typecheck clean (3 consecutive runs from a reset test DB) |
| `apps/web` | 99/99 tests, lint and typecheck clean, production build OK (3 consecutive runs) |
| `npm run verify` (all three) | Exit 0 |
| `npm run e2e` (browser + API + PostgreSQL) | 12/12, **3 consecutive runs**, each from a freshly reset `rhai_erp_e2e` |

## 6. Needs your action
* **Two old processes from the deleted project are still running.** I was not permitted to stop them:
  * port **4000**: `node dist/index.js`, PID 17860;
  * port **5173**: `vite preview` from the old `client/` folder, PID 20516. It also locks the empty `client/` folder.
  * To fix: close their terminals (or `taskkill /PID 17860 /F` and `taskkill /PID 20516 /F`), then delete the empty `client` folder. Until then, run the new app on other ports (see `apps/web/README.md`) or stop them first.
* **Root `index.html` already had 4 uncommitted edits before this work started.** They were not touched. That file is the publicly deployed prototype (Vercel), which still contains the password-less demo login. Decide whether it should stay public.
* **Nothing is committed yet.** Review the changes, then commit on a branch.
