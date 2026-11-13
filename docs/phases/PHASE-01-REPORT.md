# Phase 01 Completion Report — Identity Hardening

**Date**: 05-11-2026 (IST)  
**Status**: COMPLETE / GREEN  
**Governing Standard**: NIST SP 800-63B, OWASP ASVS 5.0 (V6 Authentication, V7 Session Management)  
**Scope**: Password policy hardening, TOTP MFA, session controls, my sessions & admin unlock/mfa-reset, security policy management, and client security headers.

---

## 1. Executive Summary

Phase 01 delivers complete identity hardening across the authentication and session lifecycle:
1. **Passwords**: Transitioned from composition rules to NIST SP 800-63B guidelines (12 to 128 characters, no character classes, SecLists 10,000 common passwords blocklist + context words: `sawant`, `readyhand`, `talwade`, `sawardari`, `varale`, `erp`, `password`, and user identity attributes).
2. **Two-Factor Authentication (MFA)**: Implemented RFC 6238 TOTP with `otpauth` (20-byte secret encrypted using AES-256-GCM format `v1:iv:tag:ct`), server-side QR generation, row-level challenge locking (`SELECT ... FOR UPDATE`), 10 single-use recovery codes (`XXXX-XXXX`), time-step replay prevention (`mfa_last_step`), and the forced-MFA middleware (`requireMfaSatisfied`).
3. **Session Controls**: Enforced idle timeout (30m, editable 5–240m), absolute lifetime (12h, editable 1–72h), 10-session concurrent limit per user (oldest session family revoked on cap with reason `session_cap`), and `Cache-Control: no-store` on all API responses.
4. **Self & Admin Management**:
   - User self-service: "My Account → Security" (`/account/security`) with Password card, Two-step wizard, and signed-in Devices table.
   - Admin controls: User Master drawer with "Authentication" tab (Unlock, Reset Password, Reset Two-step) and "Session History" tab ("Sign out everywhere").
   - Security Center (`admin-security`): real-time dashboard cards, security policy configuration with `If-Match` optimistic concurrency, and embedded Login Events audit trail.
5. **Proxy & Identity**: Support for `TRUST_PROXY=2`, `/health/whoami` endpoint, email password reset (with graceful `FEATURE_DISABLED` fallback when SMTP is not configured), and dual-secret JWT rotation (`kid: "k1"`, `kid: "k0"` with `JWT_ACCESS_SECRET_PREVIOUS`).

---

## 2. Database Changes

### Migration File
Hand-written migration: `apps/api/prisma/migrations/20261107000000_phase01_identity_hardening/migration.sql`

### Columns Added to `users`
- `password_changed_at TIMESTAMP(3)` (backfilled from `updated_at`)
- `previous_login_at TIMESTAMP(3)`
- `previous_login_ip VARCHAR(45)`
- `last_login_ip VARCHAR(45)`
- `mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`
- `mfa_secret_enc TEXT` (AES-256-GCM formatted string: `v1:iv:tag:ct`)
- `mfa_pending_secret_enc TEXT`
- `mfa_enrolled_at TIMESTAMP(3)`
- `mfa_last_step BIGINT` (prevents TOTP time-step replay attacks)
- Table constraint: `CHECK (NOT mfa_enabled OR mfa_secret_enc IS NOT NULL)`

### Columns Added to `sessions`
- `family_started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP` (backfilled from earliest `created_at` in each family)
- `mfa_verified BOOLEAN DEFAULT FALSE`
- `revoked_by_id UUID REFERENCES users(id) ON DELETE SET NULL`
- `revoked_reason` expanded to support: `admin_revoked`, `user_revoked`, `idle`, `session_cap`, `mfa_reset`, `policy_migration`
- Partial Index: `CREATE INDEX idx_sessions_user_live ON sessions(user_id) WHERE revoked_at IS NULL`

### New Tables
1. **`user_mfa_recovery_codes`**:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `code_hash CHAR(64) NOT NULL` (SHA-256 hash of formatted code `XXXX-XXXX`)
   - `used_at TIMESTAMP(3)`
   - `created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
   - Unique constraint: `UNIQUE (user_id, code_hash)`
2. **`mfa_challenges`**:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts <= 5)`
   - `expires_at TIMESTAMP(3) NOT NULL` (5-minute TTL)
   - `consumed_at TIMESTAMP(3)`
   - `ip VARCHAR(45)`
   - `user_agent TEXT`
   - `created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
3. **`password_reset_tokens`**:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `token_hash CHAR(64) NOT NULL UNIQUE` (SHA-256 hash of random 32-byte hex token)
   - `expires_at TIMESTAMP(3) NOT NULL` (30-minute TTL)
   - `used_at TIMESTAMP(3)`
   - `requested_ip VARCHAR(45)`
   - `created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`

### Settings Row
Row `security_policy` seeded in table `settings`:
```json
{
  "passwordMinLength": 12,
  "maxFailedLogins": 10,
  "lockoutMinutes": 15,
  "idleMinutes": 30,
  "absoluteHours": 12,
  "maxSessionsPerUser": 10,
  "mfaRequiredForAdmins": false
}
```

### Data Migration
- Backfilled `password_changed_at` from `updated_at`.
- Backfilled `family_started_at` to the earliest session creation timestamp within each session family.
- Revoked all live session families older than 12 hours with reason `policy_migration`.

---

## 3. Environment Variables

The following environment variables have been added to `.env.example` (names only, no secrets):

| Variable Name | Required | Default / Format | Purpose |
|---|---|---|---|
| `MFA_ENCRYPTION_KEY` | Production | 64 hex characters (32 bytes) or 32-byte base64 | AES-256-GCM symmetric key used to encrypt TOTP secrets at rest |
| `TRUST_PROXY` | Production | `2` | Number of trusted upstream reverse proxies (Vercel → Nginx → Node) for correct client IP resolution |
| `APP_BASE_URL` | Production | `https://erp-taupe-delta.vercel.app` | Base URL used to formulate fragment-based password reset links (`#token=...`) |
| `SMTP_HOST` | Optional | Hostname | Outgoing SMTP mail server host |
| `SMTP_PORT` | Optional | `587` / `465` | Outgoing SMTP mail server port |
| `SMTP_USER` | Optional | Username | SMTP authentication username |
| `SMTP_PASS` | Optional | Secret | SMTP authentication password |
| `SMTP_FROM` | Optional | Email address | Outgoing `From:` header (e.g., `Sawant Group ERP <no-reply@sawantgroup.in>`) |
| `JWT_ACCESS_SECRET_PREVIOUS` | Optional | 48+ characters | Previous access secret during key rotation; accepted for verification only |

*Note: If `SMTP_HOST`, `SMTP_PORT`, or `SMTP_FROM` is unset, the MailService reports unconfigured, and `POST /auth/password-reset/request` returns HTTP 503 `FEATURE_DISABLED`.*

---

## 4. Test & Verification Results

### Clean Test Execution (3 Consecutive Runs)
Tests were executed against the local database (`rhai_erp`) without mocks of security logic.

- **Run 1**: 2 files, 33 tests passed (26.32s)
  - `tests/phase01-identity.test.ts`: 17 passed
  - `tests/password.test.ts`: 16 passed
- **Run 2**: 2 files, 33 tests passed (25.60s)
  - `tests/phase01-identity.test.ts`: 17 passed
  - `tests/password.test.ts`: 16 passed
- **Run 3**: 2 files, 33 tests passed (26.49s)
  - `tests/phase01-identity.test.ts`: 17 passed
  - `tests/password.test.ts`: 16 passed

### Build & Security Verification
- **`npm run build`**:
  - `apps/api`: compiled with 0 TypeScript errors via `tsconfig.build.json`.
  - `apps/web`: compiled with 0 TypeScript errors via `tsconfig.json` and bundled production assets via Vite.
- **`npm run secrets:scan`**:
  - Scanned 520 files across the repository.
  - Zero secrets or private keys detected.

---

## 5. Owner Server Steps (Action Required by Owner)

Before deploying Phase 01 to production on EC2, the server owner must perform the following three steps:

### Step 1: Generate the MFA Encryption Key
Run this command on the server or a secure terminal to generate a 32-byte random hex key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Place the resulting 64-character string in the server's `.env`:
```ini
MFA_ENCRYPTION_KEY=<generated_64_char_hex_key>
```

### Step 2: Configure Upstream Proxy Headers in Nginx
Ensure the `/sawant-erp/` location block in `/etc/nginx/sites-available/institute-api.rhaitech.online` (or active Nginx configuration) forwards client IP and scheme headers:

```nginx
location /sawant-erp/ {
    rewrite ^/sawant-erp/(.*) /$1 break;
    proxy_pass http://127.0.0.1:5010;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 30m;
}
```
Test and reload Nginx:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Step 3: Update Server `.env` & Apply Database Migration
In `/app/sawant-erp-backend/.env` (on EC2):
1. Add `TRUST_PROXY=2`.
2. Add `APP_BASE_URL=https://erp-taupe-delta.vercel.app`.
3. Add `MFA_ENCRYPTION_KEY=<generated_key>`.
4. (Optional) Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` if email password recovery is desired.

Apply the hand-written database migration:
```bash
npx prisma migrate deploy
```

Restart the PM2 application:
```bash
pm2 restart sawant-erp-backend
```

### Step 4: Verification
Log in as Super Admin, open **Security Center** (`/m/admin-security`), and verify:
- The **Proxy Check** card displays the real public client IP (not `127.0.0.1`) and shows the green badge: **"Secure (Real IP forwarded)"**.
