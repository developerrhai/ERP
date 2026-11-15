# Phase 20-E: Performance Benchmarking & Indexing Guide

## Commands
- Seed `_perf` database (refuses `NODE_ENV=production` and any DB not ending in `_perf`):
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rhai_erp_perf npx tsx tools/perf-seed.ts`
- Run k6 suite against staging / local cluster proxy:
  `k6 run -e BASE_URL=http://127.0.0.1:5010 -e K6_USER=owner -e K6_PASS=<redacted> -e SOAK_DURATION=30m tests/perf/k6-suite.js`
- Verify 0 unindexed foreign keys (`20-D` / `20-E`):
  `npx tsx tools/verify-fk-indexes.ts`

## Adopted Targets & Patterns (§5(a))
- List endpoints: `p95 < 300 ms` at 100 virtual users (`100k` rows per hot table).
- Voucher posting: `p95 < 800 ms`; error rate `< 0.5%`.
- N+1 query guard (`apps/api/src/core/db/prisma.ts`): tracks SQL count per request via `AsyncLocalStorage`, attaches `X-Query-Count`, logs warning above `25` queries, and fails strict verification requests (`X-Assert-No-N-Plus-One: 1`).
- Keyset cursor helpers (`apps/api/src/core/http/pagination.ts`): opaque base64url `(sortValue, id)` cursors and `"10,000+"` capped display counts backed by composite keyset indexes (`20261202030000_phase20_d_indexes_and_fk_coverage`).

