# Phase 20-F: Deployment Findings D1–D13 & Secret Rotation Checklist

Run **every** item before production cut-over (`npm run verify` + owner sign-off):

- [ ] **D1 (GitHub Token):** Revoke legacy classic/PAT tokens used during development; confirm `git remote -v` contains HTTPS/SSH without embedded PAT (`npm run secrets:scan` green).
- [ ] **D2 (Published Passwords):** Disable/reset every default/seeded password; provision one named personal user account per staff member (no shared department logins); enable mandatory password change & MFA for Administrator / Super User (`level >= 95`).
- [ ] **D3 (JWT Secret):** Rotate `JWT_ACCESS_SECRET` to a newly generated 48+ byte CSPRNG value (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`). Also set new `MFA_ENCRYPTION_KEY`.
- [ ] **D4 (DB Roles & Passwords):** Set unique strong passwords for `erp_owner`, `erp_app`, and `erp_readonly`; remove superuser credentials from `.env`; confirm `erp_app` cannot `UPDATE`/`DELETE` `audit_logs` or access `_prisma_migrations`.
- [ ] **D5 (SUPERADMIN_* Env):** Remove `SUPERADMIN_LOGIN_ID`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` from production `.env` after initial owner bootstrap.
- [ ] **D6 (Nginx Forwarded Headers + `TRUST_PROXY=2`):** Apply `infra/nginx/sawant-erp.conf` passing `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`; set `TRUST_PROXY=2` in PM2 `ecosystem.config.cjs`.
- [ ] **D7 (SSH StrictHostKeyChecking):** Use `-o StrictHostKeyChecking=accept-new` (never `no`).
- [ ] **D8 (Health Check):** Deploy scripts wait on `GET /api/v1/health/ready` (`erp-a:5011` then `erp-b:5012`).
- [ ] **D9 (.env Handling):** Production `.env` lives strictly at `/app/sawant-erp/.env` (`chmod 600`), never inside release tarballs or deploy scripts.
- [ ] **D10 (Deploy Order):** Expand-only DB migrations (`erp_owner`) -> `pm2 reload erp-a` -> ready -> `erp-b` -> ready -> smoke check -> Vercel production promote.
- [ ] **D11 (Vercel Auto-Deploy OFF):** Disable automatic git production builds in Vercel; manually promote preview after backend health passes.
- [ ] **D12 (Dedicated Nginx Vhost):** Store vhost solely at `/etc/nginx/conf.d/sawant-erp.conf` with a dated backup before editing.
- [ ] **D13 (Pinned Prisma Version):** `deploy-release.sh` pins `prisma@${PRISMA_VERSION}` from `package.json` (`5.22.0`).
- [ ] **CSP Enforcement (`vercel.json`):** Run `Content-Security-Policy-Report-Only` for 1 week in staging/early prod, verify 0 violation reports, then switch to enforced `Content-Security-Policy`.

