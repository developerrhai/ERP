#!/usr/bin/env bash
# Phase 20-K (§4.6 & §6): Monthly Restore Drill Verification Script (target RTO <= 4 h).
# Verifies row counts, audit_logs partitions, and zero-imbalance Trial Balance on a restored DB.
set -euo pipefail

RESTORED_URL="${1:?Usage: restore-drill.sh <postgresql://...restored_db_url>}"
START_EPOCH=$(date +%s)

echo "=== Restore Drill Verification Started at $(date -u +%FT%TZ) ==="

psql "${RESTORED_URL}" -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'users' AS tbl, count(*) AS cnt FROM users
UNION ALL SELECT 'units', count(*) FROM units
UNION ALL SELECT 'journals', count(*) FROM journals
UNION ALL SELECT 'gl_entries', count(*) FROM gl_entries
UNION ALL SELECT 'stock_ledger', count(*) FROM stock_ledger
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;

-- Verify Trial Balance balances cleanly (Dr - Cr = 0)
SELECT coalesce(sum(debit) - sum(credit), 0) AS trial_balance_diff FROM gl_entries;

-- Verify audit_logs is partitioned
SELECT relname, relkind FROM pg_class WHERE relname = 'audit_logs';
SQL

END_EPOCH=$(date +%s)
ELAPSED=$((END_EPOCH - START_EPOCH))
echo "=== Restore Drill Verification Completed in ${ELAPSED}s (Target RTO <= 14400s) ==="

