# PHASE 20

File: docs/phases/PHASE-20.md

# PHASE 20 — Hardening & go-live
(ERRATA E-17: command idempotency was built in Phase 4 — here it is only verified across processes. R-22 decisions.)

## 1. Goal
Take the ERP from "built" to "live" for TAL, SAW and VAR. Three things must be true:
- real money and stock figures are loaded and signed off;
- the system survives load and attack;
- the owner can deploy, roll back and restore without help.

**What blocks more than one API process today:**
- in-memory rate limits;
- a per-process access cache;
- boot seeding that races when two processes start together.

**Open deployment findings D1–D13 are go-live blockers:** GitHub token, published passwords, weak JWT
secret, Nginx IP headers, deploy migrations, CORS, StrictHostKeyChecking, health check, .env handling,
deploy order, shared Nginx file, prisma version.

## 2. Workstreams
| # | Workstream |
|---|---|
| 0 | Multi-process readiness: Postgres rate-limit store, LISTEN/NOTIFY cache bus, boot advisory lock, pg-boss workers |
| 1 | Infrastructure: RDS, S3 documents, backups/PITR, audit partitioning, DB roles, indexes |
| a | Performance |
| b | Security |
| c | Observability |
| d | Data migration and opening balances |
| e | UAT and parallel run |
| f | Training |
| g | Hindi UI |
| h | Accessibility |
| i | DPDP |
| j | Release and rollback runbook |
| k | Hypercare |

## 3. Standards adopted
- **Security:** OWASP ASVS 5.0 Level 2; ZAP baseline (fail on High).
- **Rate limits:** express-rate-limit custom store (~80 lines) instead of the low-activity
  rate-limit-postgresql package.
- **Database:**
  - PostgreSQL PITR, LISTEN/NOTIFY, declarative partitioning;
  - **Amazon RDS PostgreSQL ap-south-1 (R-22)**: automated backups + PITR, KMS encryption.
- **Jobs and processes:**
  - pg-boss SKIP LOCKED (safe across processes);
  - pm2 caveats → two fork-mode apps instead of cluster mode.
- **Testing and quality:** k6 thresholds; WCAG 2.1 AA with axe; react-i18next.
- **DPDP Rules 2025:** most duties apply from about 13-May-2027 (needs_review).
- **Cut-over practice:** freeze, reconcile, sign-off, one parallel close, 4 weeks hypercare.

## 4. Database & infrastructure
**4.1 Rate-limit store:**
~~~sql
CREATE UNLOGGED TABLE rate_limit_hits (
  key text NOT NULL, window_start timestamptz NOT NULL, hits int NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start));
-- INSERT … VALUES ($1, date_bin($w, now(), 'epoch'), 1)
--   ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limit_hits.hits + 1 RETURNING hits;
~~~
- PgRateLimitStore (increment / decrement / resetKey); same windows as today.
- A cleanup job every 5 min.
- If the DB is down: fail **open** for the global limit, **closed** (503) for login.

**4.2 Cache bus:**
- invalidateAccessCache() → pg_notify('erp_cache', '{"scope":"access"}') **inside** the writing
  transaction (so it is delivered on commit).
- Each process has one dedicated `pg` client running LISTEN erp_cache, which clears the local map.
- On reconnect, clear the cache. The 60 s TTL stays as a backstop.
- Readiness fails if the listener has been down for more than 30 s.

**4.3 Idempotency:** built in Phase 4. Here, verify a replay works across two processes.

**4.4 Process state:**
- Boot seeding wrapped in pg_advisory_lock('erp:boot-seed').
- ARGON2_MAX_CONCURRENCY = 4 per process.
- Pools capped: Prisma connection_limit 10, pg-boss max 5 (about 32 connections total).
- pg-boss teamSize 2 per process; cron schedules registered idempotently.

**4.5 Topology:** two pm2 fork apps, erp-a:5011 and erp-b:5012, behind an Nginx upstream (keepalive 16),
max_memory_restart 700M, kill_timeout 15000, rolling restart gated by health checks.

**4.6 Database host (R-22):**
- RDS PostgreSQL (same major version, ≥ 16), db.t4g.medium, Single-AZ, gp3, KMS encryption,
  rds.force_ssl, private subnet, security group open to the EC2 only.
- **Backups:**
  - automated backups kept 14 days (PITR, RPO ≤ 5 min);
  - AWS Backup daily (35 days) + monthly (12 months), copied monthly to ap-south-2;
  - weekly pg_dump to S3 with KMS + Object Lock (35 days).
- **Targets:** RPO 15 min, RTO 4 h.
- **Fallback:** Postgres on EC2 with pgBackRest to S3 (encrypted, weekly full, daily diff, WAL
  archive, weekly verify).
- No read replica at go-live (add one only if BI pushes CPU above 40 %).
- Restore drills monthly.

**4.7 Files to S3:**
- Bucket sawant-erp-prod-docs-aps1: public access blocked, bucket-owner enforced, SSE-KMS
  (alias/sawant-erp-docs), versioning (old versions expire after 90 days), TLS-only policy.
- Access via the EC2 instance role (no static keys).
- S3StorageService implements the Phase 4 StorageService interface (AWS SDK v3). Uploads stream
  through the API; downloads use 5-minute presigned URLs after the permission check.
- tools/migrate-files-to-s3: resumable, sha256 verified; local copies kept 30 days.
- dump/ and the client folder are never uploaded.

**4.8 Audit and DB roles:**
- audit_logs → monthly range partitions (create new → copy → swap → keep the old table 7 days).
- A monthly job pre-creates 3 months; a DEFAULT partition with an alert if it is not empty.
- Retention 8 years; older partitions detached → Glacier → dropped only by the owner role.
- Roles:
  - erp_owner: DDL / migrations via MIGRATION_DATABASE_URL;
  - erp_app: DML; on audit_logs **INSERT + SELECT only**; nothing on _prisma_migrations;
  - erp_readonly: support / BI.

**4.9 Indexes:**
- From pg_stat_statements after the k6 run: lists indexed on (unit, page, sort column DESC, id DESC);
  trigram for search text; jsonb_path_ops for JSONB filters.
- CREATE INDEX CONCURRENTLY in its own migration.
- verify flags any FK without an index.

## 5. Workstreams in detail
**(a) Performance:**
- Targets: list endpoints p95 < 300 ms at 100 virtual users with 100k rows per hot table; voucher
  post p95 < 800 ms; errors < 0.5 %.
- tools/perf-seed: refuses production and any DB not ending in _perf.
- k6 scenarios: login ramp to 20/s; lists with filters; create + approve voucher; reports;
  30-min soak 70/20/10.
- Plans: EXPLAIN (ANALYZE, BUFFERS) for the top 20 statements; auto_explain ≥ 300 ms.
- An N+1 guard fails tests at more than 25 queries per request.
- **Keyset pagination** with an opaque cursor; counts shown as "10,000+" above that.

**(b) Security:**
- docs/security/asvs-l2.csv: every L2 item Pass or N/A with a reason.
- ZAP baseline + API scan.
- npm audit (high), osv-scanner, Dependabot, gitleaks over the full history.
- **Rotate before go-live:**
  - D1: revoke the GitHub token, remote URL without it;
  - D2: reset every published password, one personal account per person (no shared department logins);
  - D3: new 48-byte JWT secret;
  - new DB passwords per role;
  - remove SUPERADMIN_* from the server .env;
  - D9: no secrets in deploy scripts.
- **Nginx:**
  - its own vhost sawant-erp.conf (D12) with a dated backup;
  - forwarded headers + TRUST_PROXY=2 (D6);
  - client_max_body_size 30m; limit_req 20 r/s burst 40; server_tokens off;
  - timeouts 60 s read / 10 s connect;
  - TLS via certbot, Mozilla intermediate (TLS 1.2 / 1.3), OCSP stapling, HSTS 1 year.
- **CSP and headers** in vercel.json: Report-Only for one week, then enforced.
- Backups encrypted. A test proves erp_app cannot UPDATE or DELETE audit_logs.

**(c) Observability:**
- pino → pm2 logs → CloudWatch Agent → /sawant-erp/api, kept 400 days. Redaction extended to Aadhaar,
  PAN, bank and IFSC fields.
- Metric filters: 5xx, p95, login failures, rate-limit hits, job failures. RDS Performance Insights.
- Health: /health/live (process only); /health/ready (DB, pg-boss, LISTEN client, S3, latest migration);
  /health for the web pill.
- **SNS alarms:**
  - 5xx > 1 % for 5 min;
  - p95 > 1 s for 10 min;
  - ready failing 2 min;
  - job failures > 5 / h;
  - backup missing;
  - disk > 80 %;
  - RDS CPU > 70 % for 15 min;
  - login-failure spike.
- UptimeRobot every minute.
- Sentry (no PII, scrubbed, source maps not public).

**(d) Data migration — cut-over 1-Apr-2027 (R-22):**
Imports through the Phase 4 wizard with dry run, error sheet and batched commit (import_batch_id,
source='OPENING'). The period before cut-over is locked.
| Dataset | Must reconcile to 0, per unit |
|---|---|
| GL trial balance | Dr = Cr; control accounts = sub-ledgers; = legacy TB |
| Stock (item × warehouse × batch/serial) | Σ value = GL inventory; qty = physical count |
| AR / AP open items | = control accounts; ageing = legacy |
| Employees + YTD payroll | YTD = legacy register; TDS = filed return |
| Asset register (book + IT blocks) | cost and accumulated depreciation = GL |
| Open POs / SOs | count and value = legacy |

- Reconciliation PDF + Excel per dataset, signed by the CFO and the department head, stored in DMS.
- Legacy system frozen from T-2 days. Two mock cut-overs in staging.

**(e) UAT:**
- One script pack per department: O2C, P2P, R2R + month close, Warehouse, Production, Quality,
  Maintenance, HR, Payroll, Projects / Service, Logistics, Admin / security.
- Each step records action, expected result, pass/fail, screenshot and signer.
- Staging uses migrated data with PII masked.
- Exit criteria: 0 Sev-1, ≤ 5 Sev-2 each with a workaround, ≥ 95 % passed, signed per department.
- **Parallel run in March 2027** for Finance, Inventory and Payroll; differences must be 0 or explained.

**(f) Training:**
- Role guides in English, Hindi and Marathi (docs/guides/<role>.<lang>.md), top 10 tasks each with screenshots.
- 2–4 minute videos with a human narrator.
- A "?" help button on each page; field hints from the registry; a "What's new" panel.
- Train-the-trainer: one super-user per department, three 1-hour sessions.

**(g) Hindi UI:**
- react-i18next with locales en / hi; the choice is saved in the user profile; switch in the top bar.
- ESLint no-literal-string; a test checks that hi has every en key.
- Numbers en-IN, dates dd-mm-yyyy; PDFs use Noto Devanagari.
- Master data is not translated. A native speaker reviews.

**(h) Accessibility:**
- axe on 22 sample pages + every custom page: 0 serious or critical issues.
- Keyboard-only paths for login, list → drawer → save, and approval.
- Visible focus, 4.5:1 contrast, labels everywhere.
- Small prototype fonts raised to a 12 px minimum (recorded deviation).

**(i) DPDP:**
- Employee data under the "employment" legitimate use (no consent needed). Individual customers,
  suppliers and contacts get a privacy notice.
- **Deliverables:**
  - notice page in English / Hindi / Marathi, shown at first login and linked in the footer;
  - grievance officer contact;
  - data-principal request register (access / correction / erasure; 30-day SLA);
  - retention table (books 8 years, GST 72 months, EPF / ESI per Act) + an anonymisation job;
  - breach runbook: notify affected people and the Board without delay, detailed report within 72 h;
  - processor agreements with AWS, Vercel and Sentry;
  - access logs kept ≥ 1 year.
- Live before 13-May-2027.

**(j) Release & rollback** (docs/RUNBOOK.md — the owner runs it by hand):
- **Gate:** verify 3× green + e2e; RDS snapshot pre-<sha>; migration is expand-only.
- **Backend:**
  1. Upload to /app/sawant-erp/releases/<sha>/.
  2. npm ci --omit=dev; pinned prisma migrate deploy as erp_owner.
  3. Switch the `current` symlink.
  4. pm2 reload erp-a → check :5011/ready → erp-b.
  5. Smoke test.
- **Frontend:** Vercel auto-deploy to production OFF (D11); promote the tested preview only after the
  backend is healthy.
- **Rollback:** symlink back + reload (~1 min; keep 5 releases); Vercel Instant Rollback; never
  down-migrate; PITR to a new instance only for data corruption.

**(k) Hypercare (4 weeks):**
- Daily 15-minute triage in weeks 1–2, then 3× a week.
- SLAs: Sev-1 response 1 h, fix or workaround 4 h; Sev-2 next business day.
- Fixes-only freeze.
- Daily checklist: backups, 5xx / job failures, TB balanced, stock = GL, pending approvals.
- Weekly report.
- Exit: 2 weeks with no Sev-1 and a clean first month-end close.

## 6. Go-live checklist
- [ ] Two API processes pass e2e 3×; a permission change is seen by the other process in < 2 s; rate
      limit is shared; command replay works across processes.
- [ ] k6 thresholds met (reports in docs/perf/).
- [ ] ZAP 0 High; ASVS L2 sheet complete; npm audit 0 high/critical; gitleaks clean.
- [ ] D1–D13 closed with evidence; all secrets rotated.
- [ ] RDS live with PITR; restore drill done (time recorded, TB balanced, row counts match; RTO ≤ 4 h).
- [ ] All documents on S3, checksums verified.
- [ ] Audit log partitioned; erp_app UPDATE/DELETE denied (test).
- [ ] Alarms fire in a test; uptime monitoring active.
- [ ] Every opening-balance reconciliation signed at 0 difference.
- [ ] UAT signed per department; parallel-run differences explained.
- [ ] Hindi and axe tests green; guides and videos published.
- [ ] DPDP notice, request register, retention job and breach runbook live.
- [ ] Every needs_review statutory row ticked by the CA / HR head (R-23).
- [ ] No demo or test data in production (SQL check).

## 7. Post-go-live backlog
RDS Multi-AZ, read replica, CDN, Marathi UI, ClamAV, dedicated domain / API host, SSO, containers,
annual third-party penetration test.

## 8. Build prompts (each sub-ticket starts with: read CLAUDE.md, STANDARDS, ROADMAP R-01..R-24, ERRATA, PHASE-20; verify 3× + e2e; no push or deploy)
| Ticket | Scope |
|---|---|
| 20-A Multi-process core | Re-inventory in-memory state; Postgres rate-limit store (4.1); NOTIFY cache bus (4.2); boot advisory lock; pool caps; two-process e2e harness (start-api twice behind a tiny proxy) |
| 20-B Health & observability | live/ready, redaction, Sentry, CloudWatch agent sample, alarm definitions in infra/cloudwatch/ |
| 20-C Storage to S3 | S3StorageService, presigned downloads, migrate-files-to-s3 with checksum and resume |
| 20-D DB hardening | Role split + grants, audit partitioning + job, index migration from pg_stat_statements, FK-index check |
| 20-E Performance | perf-seed (refuses prod), k6 suite, keyset pagination, N+1 guard, plan fixes |
| 20-F Security | ASVS sheet, ZAP rules + GitHub Action, CSP / headers, Nginx vhost sample, rotation checklist, gitleaks |
| 20-G Opening-balance imports | Six templates, dry run, reconciliation PDFs, period lock, sign-off records |
| 20-H Hindi i18n | — |
| 20-I Accessibility | — |
| 20-J DPDP | Notice, request register, retention job, breach runbook |
| 20-K Release | ecosystem.config.cjs, release-dir deploy script with backup gate and rolling health check, RUNBOOK.md, restore-drill script |
| 20-L Go-live docs | UAT packs, role guides in 3 languages, hypercare plan, go-live checklist in docs/PROGRESS.md |

Migrations for local dev/test only (R-16); production changes happen only through the RUNBOOK by the owner.
Write PHASE-20-REPORT.md.
