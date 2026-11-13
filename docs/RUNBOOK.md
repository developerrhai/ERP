# Phase 20-K: Release, Migration & Rollback Runbook (Sawant Group ERP)

The owner executes production releases manually per `CLAUDE.md` — AI assistants never run deploy scripts or `git push`.

## 1. Pre-Release Gate
1. Confirm **3 consecutive clean runs** of `npm run verify` and `npm run e2e` from clean test DBs (`rhai_erp_test`, `rhai_erp_e2e`).
2. Confirm any DB migration in the release is **expand-only** (nullable columns, `CREATE INDEX CONCURRENTLY` via `infra/db/concurrent-indexes.sql` if touching hot tables).
3. Take a manual **Amazon RDS snapshot** named `pre-<sha>` before touching production.

## 2. Backend Deployment (EC2 `ap-south-1`, two fork workers)
1. Package & upload release tarball to EC2 (`/tmp/release-<sha>.tar.gz`).
2. SSH with `StrictHostKeyChecking=accept-new`.
3. Run the release script:
   ```bash
   export MIGRATION_DATABASE_URL="postgresql://erp_owner:<redacted>@<rds-endpoint>:5432/sawant_erp?sslmode=require"
   export PRE_SNAPSHOT_VERIFIED=true
   bash /app/sawant-erp/current/infra/release/deploy-release.sh <sha> /tmp/release-<sha>.tar.gz
   ```
   This script automatically:
   - unpacks `/app/sawant-erp/releases/<sha>/`
   - runs `npm ci --omit=dev` & pinned `prisma@5.22.0 generate`
   - applies `prisma migrate deploy` as `erp_owner`
   - flips `/app/sawant-erp/current` symlink
   - reloads `erp-a`, waits for `http://127.0.0.1:5011/api/v1/health/ready`, then reloads `erp-b` & waits for `:5012/ready`
   - retains the last 5 releases for 1-minute rollback.

## 3. Frontend Deployment (Vercel)
- Vercel automatic production deployment is **OFF** (D11).
- Only after backend `:5011` and `:5012` pass `/api/v1/health/ready` and smoke login succeeds, promote the verified Vercel Preview build to Production.
- Verify CSP headers cleanly (`Content-Security-Policy-Report-Only` for week 1, then enforced).

## 4. Rollback (~1 Minute)
1. Repoint symlink to previous release & reload workers cleanly:
   ```bash
   ln -sfn /app/sawant-erp/releases/<previous-sha> /app/sawant-erp/current
   pm2 reload /app/sawant-erp/current/infra/pm2/ecosystem.config.cjs --only erp-a && sleep 3
   pm2 reload /app/sawant-erp/current/infra/pm2/ecosystem.config.cjs --only erp-b
   ```
2. Trigger **Vercel Instant Rollback** in the Vercel dashboard.
3. **Never down-migrate**. For data corruption only, use Amazon RDS Point-In-Time Recovery (**PITR**) to a new RDS instance and run `infra/release/restore-drill.sh` to verify Trial Balance & row counts (`RTO <= 4 h`, `RPO <= 15 min`).


## 5. Release sheet for Phases 26-35 (owner, by hand)
1. Back up the production database first (Section 1.3).
2. New migrations to apply with `prisma migrate deploy`, in order: `20261214000000_phase26_project_spine`, `20261215000000_phase27_docs_mail`, `20261216000000_phase28_attendance_automation`, `20261217000000_phase29_workplace`, `20261218000000_phase30_contract_labour`, `20261219000000_phase31_control`, `20261220000000_phase34_external_integrations`, `20261221000000_phase35_fk_indexes`. All are additive and idempotent.
3. New dependency: `docx` 8.5.0 (run `npm ci` on the server). Set `MFA_ENCRYPTION_KEY` in the server environment (the integrations vault and webhook secrets use it).
4. Nginx: open the `/iclock` path to the API by hand (attendance machines push there). Do not change the live config without a backup.
5. After deploy: rotate existing webhook secrets (`POST /webhooks/endpoints/:id/rotate-secret`), because old rows hold the secret in plain text until rotated.
6. Smoke: `/api/v1/health/ready`, sign in, open Control Center, Integrations (all providers must show DISABLED), Stage Gates, Department Inbox.
7. Release checks (run from the repo root): `npm run secrets:scan`, `npm run check:unbounded`, `npx tsx tools/verify-fk-indexes.ts` (all must report 0), `npm run integrity` against the new database.
