# Phase 15: Human Resource Management System (HRMS) — Implementation Report

## 1. Executive Summary
Phase 15 (HRMS) has been implemented in local codebase in strict adherence to `docs/phases/PHASE-15.md`. The module handles the complete lifecycle from recruitment to exit, time & attendance with biometric integration, append-only leave ledger, employee expense claims posting to GL, and Employee Self-Service (ESS) with DPDP Act 2023 compliance.

---

## 2. Deliverables Summary

### A. Database Migrations (`apps/api/prisma/migrations/`)
1. `20261127000000_phase15_a_employees`:
   - `employees`, `employee_identity_vault` (AES-256-GCM encrypted Aadhaar & Bank accounts), `employee_bank_accounts`, `employee_emergency_contacts`, `employee_family`, `employee_assignments`, `pii_access_log`.
2. `20261127010000_phase15_b_recruitment`:
   - `job_requisitions`, `candidates`, `candidate_applications`, `interviews`, `interview_feedback`, `offers`, `onboarding_templates`, `onboarding_cases`, `onboarding_tasks`.
3. `20261127020000_phase15_c_time_attendance`:
   - `shifts`, `shift_rotation_rules`, `shift_rosters`, `weekly_off_patterns`, `attendance_devices`, `attendance_sync_runs`, `attendance_punches`, `attendance_days`, `attendance_period_summary`.
4. `20261127030000_phase15_d_leave`:
   - `leave_types` (seeded EL, CL, SL, ML, COMP, LOP, OD), `leave_policies`, `leave_ledger` (with append-only DB trigger forbidding `UPDATE` and `DELETE`), `leave_applications`.
5. `20261127040000_phase15_e_expenses`:
   - `account_defaults` and `posting_rules` for `EMPLOYEE_ADVANCE` (1502) and `EMPLOYEE_PAYABLE` (2104); `expense_categories`, `expense_claims`, `expense_claim_lines`, `employee_advances`.
6. `20261127050000_phase15_f_talent_exit_ess`:
   - `training_programs`, `perf_cycles`, `exit_cases`, `exit_clearance_tasks`, `fnf_handoffs`, `hr_requests`, `privacy_notices` (seeded DPDP Notice v1.0), `privacy_notice_acceptances`.

### B. Pure Calculation Engines (`packages/calc/src/hr/`)
- **Algorithm A (`attendance.ts`):** Shift detection, first IN / last OUT, break deduction, grace periods (15m), late/early detection, OT candidate minutes, night shift span detection.
- **Algorithm B (`attendance.ts`):** Period summary aggregation, payable days, LOP count, weekly offs.
- **Algorithm C (`leave.ts`):** Earned leave accrual (1/20 worked days, half-up rounding).
- **Algorithm D (`leave.ts`):** Sandwich rule calculation across weekly offs and holidays.
- **Algorithm E (`leave.ts`):** Compensatory off expiry tracking.

### C. Backend API (`apps/api/src/modules/hr/`)
- `hr-crypto.ts`: AES-256-GCM encryption/decryption, Verhoeff Aadhaar validation, masking, IFSC validation.
- `employee-service.ts`: Scoped directory, onboarding, identity vault encryption, dated assignments, audited PII reveal logging.
- `attendance-service.ts`: Shifts, rosters, biometric device sync with cursor, punch exceptions, day recomputation.
- `leave-service.ts`: Append-only ledger management, balance calculation, sandwich rule calculation.
- `expense-service.ts`: Claims workflow, receipt validation, PostingService GL journal creation (`EMPLOYEE_PAYABLE`).
- `exit-service.ts`: Resignation, department clearance checklist, F&F handoff to Payroll.
- `recruitment-service.ts`: Requisitions, candidate pipeline, DPDP retention purge.
- `ess-service.ts`: Employee self-service dashboard and privacy notice acceptance.
- `routes.ts`: Mounted at `/api/v1/hr`.

### D. Frontend Web UI (`apps/web/src/pages/hr/`)
- `HrEmployeesPage.tsx`: Directory, masked vault display, audited sensitive reveal modal, onboarding modal.
- `HrAttendancePage.tsx`: Daily attendance calendar, shifts, work hours, late/early flags.
- `HrLeavePage.tsx`: Balance cards, apply leave modal, sandwich rule calculator.
- `HrExpensePage.tsx`: Expense claim list, claim submission modal.
- `HrEssPage.tsx`: Employee self-service portal, DPDP Act 2023 privacy notice acceptance banner, attendance & balances.

