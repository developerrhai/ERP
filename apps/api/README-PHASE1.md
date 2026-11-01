# apps/api: Phase 0/1 deviations and implementation choices

These are the places where the API differs from `docs/phase1/CONTRACT.md`, or makes a choice the contract leaves open. The contract owner can merge them into the contract.

> **Phase 2 update:** Phase 2 changed two Phase 1 behaviours. `GET /meta/departments` and user create/update now validate against the active rows of the `departments` table (not the hard-coded list), and `users.department` is a foreign key to `departments.name`. Every other Phase 2 choice is in [`README-PHASE2.md`](README-PHASE2.md).

## Deviations / additions to the contract

- **Refresh race grace window (new).** A rotated refresh token presented again within `REFRESH_REUSE_GRACE_SECONDS` (default 10, range 0–60) of its rotation does **not** revoke the family, **the first time only** (recorded in `sessions.grace_used_at`). It returns `409 REFRESH_RACE` "Session was refreshed in another tab. Retry.", sends no `Set-Cookie`, and writes the audit row `REFRESH_RACE` (not `TOKEN_REUSE_DETECTED`). Two simultaneous refreshes with the same cookie produce one `200` and one `409 REFRESH_RACE`. Outside the window the behaviour is unchanged: every session in the family is revoked (`reuse_detected`), the audit row is `TOKEN_REUSE_DETECTED`, and the reply is `401 SESSION_EXPIRED`. The web client should handle a 409 by waiting briefly and retrying `/auth/refresh` once (the browser already holds the newer cookie).
- **New error codes:** `409 REFRESH_RACE` (above), `503 SERVER_BUSY` (with `Retry-After: 1`, see below) and `413 PAYLOAD_TOO_LARGE` for JSON bodies over 100 kb (PLAN §6.6 lists 413; the contract's code list did not).
- **New audit action:** `REFRESH_RACE`.
- **New env variables:** `REFRESH_REUSE_GRACE_SECONDS`, `TRUST_PROXY` (default `loopback`), `ARGON2_MAX_CONCURRENCY` (default 8), `LOG_LEVEL` and `RATE_LIMIT_DISABLED` (refused unless `NODE_ENV=test`).
- **Passwords are not trimmed.** Every other string is. Whitespace is a legitimate password character. Passwords are also capped at 128 characters (policy) and 256 (schema) so a huge input cannot burn Argon2 CPU.
- **change-password revokes all of the user's sessions and issues a brand-new session** (new family) for the caller. The net effect matches the contract (other sessions are signed out, the caller gets fresh tokens and cookie), but the caller's previous refresh cookie also stops working.
- **Wrong current password on change-password returns `422 VALIDATION_ERROR`** with `fields.currentPassword`, not 401, so the web client's "on 401, refresh and retry" logic does not fire. These failures use the same lockout counter; the 10th returns 423, and while locked change-password returns `423` even with the right password.
- **The 10th consecutive failed login itself returns `423 ACCOUNT_LOCKED`** (the lock is set at that moment). Failures 1–9 return the generic 401. The lock resets the counter to 0, and failures are not counted while a lock is active.
- **Inactive users are checked before the lock,** so an inactive account always gets the generic 401.
- **A missing or wrong `X-Requested-With` on `/auth/refresh` or `/auth/logout` returns `403 FORBIDDEN`.**
- **`If-Match`:** missing → `400 BAD_REQUEST` "If-Match header required". Malformed → 400. Accepted forms: `3`, `"3"`, `W/"3"`. Successful PATCH responses carry `ETag: "<version>"`.
- **loginId and email share one namespace.** Login accepts either, so creating or updating a user is refused with `409 DUPLICATE` if the loginId equals anyone's email or the email equals anyone's loginId.
- **Refresh rotation creates a new session row** in the same family (it inherits the family's absolute `expiresAt`) and marks the old row `rotated`. The access token's `sid` therefore changes on every refresh, and an access token whose session was rotated stops working.
- **Idle timeout is also checked on every Bearer request** (not only on refresh): `lastUsedAt + SESSION_IDLE_MINUTES` must be in the future. `lastUsedAt` advances only on refresh. While the client refreshes every ≤ 15 min this never interrupts an active user.
- **Expired access token** → `401 SESSION_EXPIRED`. Missing, malformed or forged token → `401 UNAUTHENTICATED`. Revoked, expired or idle session, or inactive user → `401 SESSION_EXPIRED`.
- **`POST /auth/logout`** revokes the session named by the cookie, or failing that by a valid Bearer token. With neither, it is a no-op `204`. The cookie is always cleared.
- **`GET /health` with the DB down** returns `503 {data:{status:"degraded", db:"down"}}`.
- **The JWT also carries `iss` (`rhai-erp-api`) and `aud` (`rhai-erp-web`),** which are verified along with `alg=HS256`.
- **Auth responses send `Cache-Control: no-store`.**
- **The seeded Super Admin gets department `Administration`** (the contract allows null).
- **DB constraints beyond the contract:** CHECKs that `login_id` and `email` are lowercase and that `department` is set for every role except SUPER_ADMIN. The audit trigger also blocks `TRUNCATE`.
- **Layering:** the auth service reads users through `modules/users/repository.ts` instead of a duplicate repository. Sessions live in `core/auth/session-repository.ts`, shared by authenticate, auth and users.
- **`db:migrate` runs `prisma migrate deploy`** (non-interactive). The schema was authored with `migrate diff` plus hand-written SQL.

## Security review fixes (loop iteration 3)

1. **Atomic lockout.** The lock decision is made after the Argon2 verify, in one transaction with `SELECT … FOR UPDATE` on the user row (equivalent to the single-UPDATE form the review suggested, and it tells exactly one attempt that it set the lock, so `ACCOUNT_LOCKED` is audited once). A successful login is a conditional update (`locked_until IS NULL OR locked_until <= now()`): if no row matches, the reply is 423 and an active lock is never cleared. Thirty parallel wrong attempts produce at most 9 plain 401s; everything after the lock is 423.
2. **change-password brute force.** The user is re-read from the DB. If locked → `423 ACCOUNT_LOCKED`. Wrong current passwords use the same atomic counter. A new limiter allows **5/min per user id** on `/auth/change-password`.
3. **Trust proxy.** `app.set('trust proxy', TRUST_PROXY)`, default `loopback` (so the Vite dev proxy on localhost forwards the real client IP). `X-Forwarded-For` from a peer outside that list is ignored. Every IP-based limiter key uses express-rate-limit's `ipKeyGenerator` (IPv6 grouped by /64). This required upgrading **express-rate-limit 7.4.1 → 8.6.1**.
4. **Refresh grace once per token.** See the first bullet of the previous section. A second presentation of the same rotated token, even inside the window, is reuse: family revoked, 401, `TOKEN_REUSE_DETECTED`. New migration `20261101000100_security_hardening` adds `sessions.grace_used_at`.
5. **Secrets.** `JWT_ACCESS_SECRET` is refused if it contains `change-me` (any case, any environment). It must be at least 32 characters, and at least 48 in production. The `.env.example` placeholder therefore fails on purpose until it is replaced.
6. **Argon2 CPU/memory DoS.** A new **per-IP login limiter of 20/min**, independent of identifier, runs before the existing 5/min IP+identifier limiter. A process-wide semaphore allows at most `ARGON2_MAX_CONCURRENCY` (default 8) Argon2 operations in flight. When it is full, the request gets `503 SERVER_BUSY` with `Retry-After: 1` straight away (no queue). This applies to every hash/verify: login, change-password, create user, reset password.
7. **Lockout enumeration.** Unknown identifiers (normalised: trimmed, lowercased) keep an in-memory failure counter (TTL 15 min, LRU bounded at 10,000 entries), so they also return 423 after 10 failures with the same message. The counter is per process and resets on restart.
8. **PATCH check-then-write.** The version is checked against the loaded row before writing (`409 VERSION_CONFLICT`). The conditional update's WHERE now includes both `version` and the `role` the permission check used.
9. **loginId/email namespace in the DB.** A trigger on `users` INSERT/UPDATE OF login_id, email raises `unique_violation` if `login_id` equals another row's `email` or `email` equals another row's `login_id`. Per-value advisory locks serialise concurrent writers. Prisma reports this as P2002 without a target, so the service looks up which field collided and returns `409 DUPLICATE` with `fields`.
10. **LOGIN_FAILED / LOGIN_SUCCESS audit hygiene.** `detail.identifier` is stored only if it matches the loginId format or is a valid email; otherwise it is stored as `"<invalid-format>"`, so a password typed into the ID field is never persisted.
11. **Extra tests:** `Secure` on the `rt` cookie with a real `NODE_ENV=production` configuration; the must-change-password gate on `PATCH /users/:id` and `POST /users/:id/reset-password`.

## Open items

- Port 4000 on this machine is held by another process (`node dist/index.js`, PID 17860 at the time of writing). The API's default port is 4000 per contract; stop that process or set `PORT`.
- `npm install` reports `npm audit` advisories in the dependency tree; not yet reviewed.
