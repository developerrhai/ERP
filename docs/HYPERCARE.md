# Phase 20-L: 4-Week Hypercare Plan

## Cadence & Triage
- **Weeks 1–2:** Daily 15-minute cross-functional triage (Owner, Finance/CA, Plant Heads for TAL/SAW/VAR, Tech Lead).
- **Weeks 3–4:** 3x weekly triage (Mon / Wed / Fri).
- **Change Freeze:** Strictly hotfixes & data corrections only — no new features during Hypercare.

## SLAs
| Severity | Definition | Response | Target Resolution / Workaround |
|---|---|---|---|
| **Sev-1** | Production down, Trial Balance imbalance, Stock != GL, Payroll/GST blocked | **1 hour** | **4 hours** |
| **Sev-2** | Single workflow bug with manual workaround, non-blocking report issue | **4 hours** | **Next business day** |

## Daily Owner Checklist
1. Verify automated RDS snapshot & weekly S3 `pg_dump` Object Lock status (`sawant-erp-backup-missing` alarm silent).
2. Review CloudWatch `/sawant-erp/api` 5xx count, pg-boss failed job queue, and `rateLimit` anomalies.
3. Run Trial Balance Check (`Dr - Cr = 0`) and Inventory Valuation = GL Stock Control reconciliation across TAL, SAW, and VAR.
4. Review stuck Approval Center requests older than SLA.

## Exit Criteria
- **2 consecutive weeks** with **zero Sev-1 incidents**.
- **Clean first month-end close** signed off by CFO & Plant Accountants across TAL, SAW, and VAR.

