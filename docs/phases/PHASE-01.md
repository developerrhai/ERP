# PHASE 01 — Identity hardening
(Role names here are the pre-Phase-2 names; see ERRATA E-04.)

## 1. Goal & why
Bring sign-in, sessions and recovery up to OWASP ASVS 5.0 Level 2 before more modules go live.
Every security step must be one obvious button with plain messages.

**Keep (already good):**
- `modules/auth/service.ts`: generic login failures, Argon2id with a dummy verify, atomic lockout
  (10 failures → 15 min), refresh-token rotation with family reuse detection, logout-all,
  change-password revokes sessions.
- `core/auth/authenticate.ts`: re-checks the database on every request.
- `tokens.ts`: HS256 with iss/aud, and the `rt` cookie (httpOnly, SameSite=Strict, path /api/v1/auth).
- `rate-limit.ts`.
- `env.ts`: requires a JWT secret of at least 48 characters in production.
- Admin reset password.
- The web keeps the access token in memory only.

**Gaps:**
- G1. The password rule is "10 characters + 3 character classes" with no blocklist. NIST forbids
  composition rules.
- G2. Absolute session life is 7 days, which is too long. Idle time only moves on refresh, and the
  UI gives no warning before an idle sign-out.
- G3. Users have no "My sessions" screen.
- G4. Admins can only sign a user out by resetting the password. There is no Unlock.
- G5. No MFA.
- G6. "Forgot password" is static text.
- G7. Nginx does not forward the user's IP (review item D6), so every user looks like 127.0.0.1.
  One person's typos can block logins for the whole company.
- G8. No security headers on the web app, and no `Cache-Control: no-store` on the API.
- G9. The login page shows no previous sign-in, has no Caps Lock hint, and shows old role names.
- G10. Security policy lives only in env. `admin-security` is a generic page with no behaviour.
- G11. No JWT key rotation. Old session rows are never cleaned up.

## 2. Pages in scope
| Page | What it does |
|---|---|
| Login (/login) | Tabs: Sign In and Forgot. A second step asks for the MFA code. No Sign Up, no Company Code, no Department select, no demo box. |
| admin-security | Security Center cards. Tabs: Password Policy, MFA, Session Controls, IP Restrictions (empty-state note only), Security Events. |
| admin-users | Two new drawer tabs. **Authentication**: lock state, MFA state, last sign-in, buttons Unlock / Reset password / Reset two-step. **Session History**: list plus "Sign out everywhere". |
| admin-audit | New "Login Events" preset filter. |
| My Account → Security (/account/security) | Change password, two-step verification, my signed-in devices. |

## 3. Business logic & research (rules adopted)
**Sources:**
- NIST SP 800-63B-4: no composition rules, no forced expiry, check a blocklist, allow at least
  64 characters, rate-limit failures.
- OWASP ASVS 5.0 (V6 authentication, V7 sessions).
- OWASP cheat sheets: Session Management, Forgot Password, MFA, HTTP Headers.
- RFC 6238 (TOTP).
- ERPNext and Odoo 2FA designs.

**Decided:**
- **Passwords:** 12 to 128 characters, no character-class rules. Block the top 10,000 common
  passwords plus context words: sawant, readyhand, talwade, sawardari, varale, erp, password,
  the user's login ID, email and name parts. No expiry. Existing passwords are kept.
- **Lockout:** 10 failures → 15 minutes (editable from 3 to 20 failures and 5 to 1440 minutes).
  Admins get an Unlock button.
- **Sessions:**
  - Idle timeout 30 minutes (editable 5–240).
  - Absolute limit 12 hours (editable 1–72).
  - Warning shown 2 minutes before idle sign-out.
  - At most 10 live sessions per user; the oldest is signed out when the limit is reached.
- **MFA:** TOTP with an authenticator app, plus 10 single-use recovery codes. Only SUPER_ADMIN and
  ADMIN (later: level ≥ 95). Optional until the setting "mfaRequiredForAdmins" is switched on.
- **Forgot password:**
  - If SMTP is not set up: "Ask your administrator".
  - If SMTP is set up: email a link valid for 30 minutes. A completed reset revokes all sessions.
- **Proxy:** TRUST_PROXY=2 (Vercel → Nginx → Node). The account lockout is stored per account in
  the database, so a faked IP cannot bypass it.

## 4. Database design — migration <ts>_phase01_identity_hardening
**users — add columns:**
- password_changed_at (backfill from updated_at)
- previous_login_at, previous_login_ip, last_login_ip
- mfa_enabled bool default false
- mfa_secret_enc text (AES-256-GCM, format "v1:iv:tag:ct")
- mfa_pending_secret_enc
- mfa_enrolled_at
- mfa_last_step bigint (stops a code being reused)
- CHECK (NOT mfa_enabled OR mfa_secret_enc IS NOT NULL)

**sessions — add columns:**
- family_started_at NOT NULL default now() (backfill: the earliest created_at in the family;
  copied forward on every rotation)
- mfa_verified bool
- revoked_by_id (FK users, SET NULL)
- New revoke reasons: admin_revoked, user_revoked, idle, session_cap, mfa_reset.
- Index on (user_id) WHERE revoked_at IS NULL.

**New tables:**
- **user_mfa_recovery_codes**: id, user_id (FK, cascade), code_hash char(64), used_at, created_at.
  UNIQUE(user_id, code_hash).
- **mfa_challenges**: id (= challengeId), user_id, attempts (CHECK ≤ 5), expires_at (5 minutes),
  consumed_at, ip, user_agent, created_at.
- **password_reset_tokens**: id, user_id, token_hash UNIQUE, expires_at, used_at, requested_ip,
  created_at.

**Settings row `security_policy`:**
~~~
{"passwordMinLength":12,"maxFailedLogins":10,"lockoutMinutes":15,"idleMinutes":30,
 "absoluteHours":12,"maxSessionsPerUser":10,"mfaRequiredForAdmins":false}
~~~
Env values stay as hard ceilings.

**Data step:** revoke any live session family older than 12 hours (reason policy_migration).
Those users simply sign in again once.

## 5. Services & rules
- **core/auth/password-policy.ts**
  - checkPasswordPolicy(pw, identity, policy): checks length, then the blocklist (also with
    trailing digits and symbols stripped), then context words of 4+ characters.
  - The blocklist is the SecLists 10k list (MIT licence), loaded into a Set at boot.
- **core/auth/security-policy.ts**: getPolicy() reads the settings row with a 30-second cache,
  clamped to the env ceilings.
- **Session is live when all of these hold:**
  - not revoked;
  - now < family_started_at + absoluteHours;
  - now < expires_at;
  - now < last_used_at + idleMinutes.
- **Updating last_used_at:**
  - authenticate updates it at most once per 60 seconds (conditional updateMany).
  - Requests with header X-Activity: background never update it.
  - The refresh cookie's maxAge is the smaller of the absolute end and now + 12 h.
- **Session cap:** at login, if the user already has the maximum, revoke the oldest family in the
  same transaction.
- **MFA login:**
  1. Password OK and account not locked.
  2. If MFA is on, return {mfaRequired, challengeId, expiresIn:300}. No cookie yet.
  3. POST /auth/mfa/verify:
     - lock the challenge row (FOR UPDATE);
     - accept a TOTP code from time step t−1, t or t+1, only if newer than mfa_last_step;
     - or accept an unused recovery code (shown as XXXX-XXXX).
  4. On success: issue the session with mfa_verified=true.
  5. On failure: attempts+1, and the failure also counts toward the account lockout.
- **Forced MFA:** a new guard requireMfaSatisfied returns 403 MFA_SETUP_REQUIRED for an admin without
  MFA when the policy requires it, except on /auth/me, /auth/mfa/*, /auth/logout and /meta/*.
- **MFA setup:**
  - Library otpauth: 20-byte secret, issuer "Sawant Group ERP", label = loginId.
  - QR code drawn server-side.
  - Secret encrypted with MFA_ENCRYPTION_KEY (env; required in production).
  - Setup needs the current password. Enable needs a valid code.
  - On enable: 10 recovery codes are shown once, and other sessions are revoked.
  - Disable needs password + code, and is refused while the policy forces MFA.
- **Admin actions** (Unlock, Sign out everywhere, Reset two-step):
  - Checked with assertCanManage.
  - Never allowed on yourself.
  - Only SUPER_ADMIN may reset an ADMIN's two-step.
- **Email reset:**
  - Enabled only when SMTP_HOST, SMTP_PORT and SMTP_FROM are set.
  - The request always answers 202 after about 300 ms, whether or not the email exists.
  - Token: 32 random bytes, stored as sha256, valid 30 minutes.
  - The link is ${APP_BASE_URL}/reset-password#token=… (a fragment, so it never reaches server logs).
  - Confirm runs in one transaction with a single-use update, applies the policy, revokes all
    sessions and sends a "password changed" email.
- **Previous login:** shown to the user after sign-in.
- **JWT:** add a `kid` header. JWT_ACCESS_SECRET_PREVIOUS (optional) is accepted for verification
  only. In production, refuse a secret with fewer than 16 distinct characters.
- **Cleanup (daily):**
  - sessions revoked or expired more than 90 days ago;
  - challenges older than 1 day;
  - reset tokens older than 7 days.
  - Audit rows are never deleted.
- **Headers:**
  - API: `Cache-Control: no-store` plus helmet defaults.
  - Web (vercel.json):
    - CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`
    - HSTS 1 year
    - nosniff
    - Referrer-Policy strict-origin-when-cross-origin
    - Permissions-Policy camera=(), microphone=(), geolocation=()
- **Proxy:**
  - Nginx must forward X-Real-IP, X-Forwarded-For and X-Forwarded-Proto. Set TRUST_PROXY=2.
  - Log a warning at boot if production still uses "loopback".
  - New endpoint GET /health/whoami shows the IP the server sees.

## 6. API endpoints (all under /api/v1)
| Method & path | Guard | Request → Response | Errors |
|---|---|---|---|
| POST /auth/login | limiters | {identifier,password} → session OR {mfaRequired,challengeId,expiresIn} | 401, 423, 429 |
| POST /auth/mfa/verify | 10/min/IP | {challengeId,code} → session + cookie | 401 MFA_CODE_INVALID / MFA_CHALLENGE_EXPIRED, 423 |
| GET /auth/sessions | auth | my devices | |
| DELETE /auth/sessions/:familyId | auth | → 204 | 404 not yours, 409 CURRENT_SESSION |
| POST /auth/sessions/revoke-others | auth | → {revoked:n} | |
| GET /auth/mfa | auth | eligible / enabled / required / recovery codes left | |
| POST /auth/mfa/setup | auth | {currentPassword} → QR + secret | |
| POST /auth/mfa/enable | auth | {code} → recovery codes | |
| POST /auth/mfa/disable | auth | {currentPassword, code} | |
| POST /auth/mfa/recovery-codes | auth | {currentPassword, code} → new codes | |
| GET /auth/password-policy | public | min/max length, emailResetAvailable | |
| POST /auth/password-reset/request | 3/h per email + 10/h per IP | {email} → 202 | FEATURE_DISABLED |
| POST /auth/password-reset/confirm | 10/h per IP | {token, newPassword} → 204 | RESET_LINK_INVALID |
| GET /users/:id/sessions | admin-users view | sessions | |
| POST /users/:id/sessions/revoke-all | admin-users edit | | |
| POST /users/:id/unlock | admin-users edit | | 409 NOT_LOCKED |
| POST /users/:id/mfa/reset | admin-users edit | | |
| GET/PUT /settings/security | admin-security view / edit, If-Match | policy | |
| GET /health/whoami | admin-security view | {ip, forwardedFor, trustProxy, protocol} | |

/auth/me also returns previousLoginAt, previousLoginIp, mfaEnabled and mfaSetupRequired.

## 7. UI & user flow
- **Sign in:** same two-column look as index.html.
  - Fields "Email / User ID" and "Password" (with Show) and a Caps Lock hint.
  - Primary button: "Sign In to ERP".
  - Left panel: neutral features, no role names.
  - Footer: "Authorised users only. All sign-ins are logged."
- **Two-step screen:** "Enter your 6-digit code".
  - Numeric field; the form submits automatically at 6 digits.
  - Links: "Use a recovery code instead" and "Back to Sign In".
- **After sign-in:** toast "Welcome, <name>. Last sign-in: 03-11-2026 18:42 from 10.0.4.7." (IST).
- **Forgot tab:**
  - Without SMTP: "Your administrator resets passwords. Contact your Administrator with your login ID."
  - With SMTP: an email field, then "If this email belongs to an account, a reset link is on its way.
    It works for 30 minutes."
- **Password fields** show a live checklist: ✓ 12+ characters, ✓ not a common password, ✓ passwords match.
- **Idle warning modal:** "You will be signed out in 2:00 because nothing happened for a while."
  Button: "Stay signed in".
- **My Account → Security:**
  - Password card.
  - Two-step card with a 3-step wizard: password → scan QR and enter code → save 10 codes
    (Download/Print, then tick "I saved these codes").
  - Devices table, with "This device" marked, a Sign out button per row, and the primary button
    "Sign out all other devices".
- **Admin user drawer:**
  - Authentication tab: Unlock / Reset password / Reset two-step. Disabled buttons explain why
    (e.g. "Account is not locked.").
  - Session History tab.
- **admin-security:**
  - Policy form.
  - Cards: Admins without two-step, Locked accounts, Failed sign-ins today, Proxy check
    (green when the IP is not 127.0.0.1).

## 8. Exact messages
| Situation | Message |
|---|---|
| Too short | "Password must be at least 12 characters." |
| Too long | "Password must be at most 128 characters." |
| Common password | "This password is too common. Choose a longer phrase, e.g. three unrelated words." |
| Personal or company word | "Do not use your name, login ID, email or the company name in your password." |
| Mismatch | "The two passwords do not match." |
| Same as current | "New password must be different from the current one." |
| Wrong login | "Email / User ID or password is incorrect." |
| Locked | "Too many failed attempts. Try again in N minutes or ask your administrator to unlock your account." |
| Bad MFA code | "That code did not work. Check the time on your phone and try the newest code." |
| MFA too slow | "This sign-in took too long. Please sign in again." |
| Recovery code format | "Recovery codes look like ABCD-1234." |
| Bad reset link | "This reset link has expired or was already used. Ask for a new one." |
| MFA can't be turned off | "Two-step verification is required for administrators. You cannot turn it off." |
| Forced MFA | "For security, administrators must turn on two-step verification before continuing." |
| Policy range | "Idle timeout must be between 5 and 240 minutes." (same pattern for every field) |
| Admin acting on self | "Use My Account → Security for your own account." |

Toasts:
- "Signed out of 3 other devices."
- "Account LOG-RAMESH unlocked."
- "Two-step verification turned on. Keep your recovery codes safe."

## 9. Audit & notifications
- New audit actions:
  - MFA_CHALLENGE_ISSUED, MFA_SUCCESS, MFA_FAILED, MFA_RECOVERY_CODE_USED
  - MFA_ENABLED, MFA_DISABLED, MFA_RECOVERY_REGENERATED, MFA_RESET_BY_ADMIN
  - SESSION_REVOKED, SESSIONS_REVOKED_OTHERS, SESSIONS_REVOKED_BY_ADMIN, SESSION_IDLE_EXPIRED
  - ACCOUNT_UNLOCKED
  - PASSWORD_RESET_REQUESTED (stores the hashed email, never the token), PASSWORD_RESET_COMPLETED
  - SECURITY_POLICY_UPDATED (with before/after)
- Every row stores IP and user agent.
- Emails (only when SMTP is set up): reset link, password changed, two-step on/off,
  "an administrator signed you out".

## 10. Tests
- **Unit:**
  - blocklist and context words;
  - RFC 6238 Appendix B vectors (secret "12345678901234567890", T=59 → 94287082);
  - time-step window and replay;
  - AES-GCM round trip and tamper detection;
  - policy clamping.
- **API:**
  - every new endpoint: 401 / 403 / 404 / 422 and the happy path;
  - MFA: no cookie before verify; wrong code counts toward lockout; 6th attempt refused;
    a reused step is refused; a recovery code works only once;
  - the forced-MFA guard;
  - idle expiry (fake clock), absolute 12 h, the 10-session cap;
  - revoking someone else's session → 404;
  - admin actions respect the hierarchy and never apply to self;
  - reset returns 202 for an unknown email and takes the same time; the token is single-use and
    expires; FEATURE_DISABLED without SMTP;
  - policy update with If-Match;
  - an audit row for every write;
  - no-store header;
  - TRUST_PROXY=2 gives the correct client IP;
  - the previous JWT key still verifies; an unknown kid → 401.
- **Concurrency:**
  - 10 parallel verifies of one challenge → exactly 1 succeeds;
  - parallel reset confirms → 1 succeeds;
  - unlock racing a login failure;
  - no deadlocks when last_used_at is touched in parallel.
- **Playwright:**
  - (a) sign in, see the previous-login toast;
  - (b) enable two-step, then sign in with a code and with a recovery code;
  - (c) two browsers: sign out the other device;
  - (d) lock a user, then unlock;
  - (e) idle warning;
  - (f) Forgot tab without SMTP;
  - (g) no Sign Up, Company Code, Department or demo text on the login page.
- 3 clean runs.

## 11. Acceptance checks
- [ ] A 12-character blocklisted password is refused; "correct horse battery" is accepted.
- [ ] Lock after 10 failures and admin Unlock both work and are audited.
- [ ] Idle and absolute limits are enforced by the server; the warning modal appears.
- [ ] My Sessions can sign out one device or all other devices.
- [ ] An admin can sign a user out everywhere without resetting the password.
- [ ] TOTP enrol, verify and recovery codes work; code replay is blocked; forced MFA works.
- [ ] Email reset works with SMTP; without SMTP the "ask administrator" text shows.
- [ ] Nginx headers and TRUST_PROXY=2 are in place; whoami shows the real IP.
- [ ] The web has CSP, HSTS and frame-ancestors headers; the API sends no-store.
- [ ] The login page matches index.html without Sign Up, Company Code, Department or the demo box.
- [ ] The migration was tested on a copy of production data.
- [ ] 3 clean runs; PHASE-01-REPORT.md written.

## 12. Out of scope
| Item | Owner |
|---|---|
| Editable roles | Phase 2 |
| In-app notifications, new-device alerts | Phase 5 |
| IP allow-lists, SSO/LDAP, passkeys, shared rate-limit store, penetration test | Phase 20 |
| SMS OTP | Never (NIST restricts it) |
| Employee self-service accounts | Phase 15 |

## 13. Owner manual check
1. Open the login page. There is no Sign Up, Company Code or demo box.
2. Enter a wrong password twice. You see the generic message.
3. Sign in correctly. You see the "Last sign-in" toast.
4. Avatar → My Account → Security → Turn on two-step, and scan with your phone.
5. Save the codes, then Finish.
6. Sign out and sign in again with the phone code.
7. Sign in from a second browser. From the first, click "Sign out all other devices". The second
   browser goes to the login page.
8. Users → a test user → Authentication → Unlock / Sign out everywhere.
9. Security → Proxy check is green and shows your real IP.
10. Set the idle timeout to 5, wait, and the warning appears.
11. Audit Trail → Login Events shows every step above.

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md, ERRATA.md and PHASE-01.md, then
apps/api/src/modules/auth/*, core/auth/*, core/rate-limit.ts, config/env.ts, modules/users/*,
modules/settings/*, apps/web/src/pages/LoginPage.tsx, LoginLayout.tsx, auth/*, lib/api.ts,
docs/archive/DEPLOYMENT-REVIEW.md.
Rules: never push/commit unless asked; never read .env*; hand-written SQL migration
<ts>_phase01_identity_hardening + schema.prisma; ask before applying it to any shared DB;
routes→controller→service→repository; chain authenticate→requirePasswordChanged→
requireMfaSatisfied→resolveContext→requirePageAction→validate; audit every write;
exact messages of §8; DD-MM-YYYY; index.html look.
Do in order:
1 migration + security_policy row + session backfill/revoke;
2 password-policy with SecLists 10k + context words;
3 security-policy service + /settings/security;
4 session liveness, cap, no-store;
5 My Sessions + admin session/unlock/mfa-reset endpoints;
6 TOTP MFA (otpauth, qrcode, AES-256-GCM), challenges, recovery codes, replay guard, forced-MFA guard;
7 MailService + email reset (FEATURE_DISMailService + email reset (FEATURE_DISABLED without SMTP);
8 JWT kid + previous secret, prod checks, /health/whoami, daily cleanup;
9 web: login parity, MFA step, previous-login toast, idle modal, /reset-password, checklist,
  /account/security, admin-users tabs, admin-security page, Login Events filter;
10 vercel.json headers; add Nginx block + TRUST_PROXY=2 to docs and .env.example (names only);
11 tests §10, 3 clean runs.
Write PHASE-01-REPORT.md with: DB changes, new env vars (MFA_ENCRYPTION_KEY, SMTP_HOST/PORT/USER/
PASS/FROM, APP_BASE_URL, JWT_ACCESS_SECRET_PREVIOUS), results, and the server steps the owner must
do (Nginx block, TRUST_PROXY=2, generate the MFA key).

