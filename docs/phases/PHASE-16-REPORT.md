# Phase 16: Payroll & Statutory Compliance — Implementation Report

## 1. Executive Summary
Phase 16 (Payroll) has been implemented in local codebase in strict adherence to `docs/phases/PHASE-16.md`. The module automates the complete payroll workflow from attendance summaries through salary calculations, statutory deductions (PF, ESIC, Maharashtra PT, MLWF, Income Tax Act 2025 TDS), GL journal entry by cost center, corporate bank file generation, and bilingual payslips.

---

## 2. Deliverables Summary

### A. Database Migrations (`apps/api/prisma/migrations/`)
1. `20261128000000_phase16_a_payroll_masters`:
   - Account keys: `PT_PAYABLE` (2105), `LWF_PAYABLE` (2106), `EMPLOYEE_LOAN` (1503), `BONUS_PAYABLE` (2107), `GRATUITY_PROVISION` (2301) + `account_defaults` and `posting_rules`.
   - `pay_components`: Seeded earnings and deductions with Code on Wages classes (`INCLUDED`/`EXCLUDED`).
   - `pay_structures` and `pay_structure_lines`.
   - `statutory_rates`: Seeded PF (12%/8.33%), ESIC (0.75%/3.25%), Bonus (8.33%), Gratuity (4.8077%), OT Multiplier (2.0) with official URLs and `needs_review=true`.
2. `20261128010000_phase16_b_assignments`:
   - `salary_revisions`, `employee_salary_assignments`, `salary_assignment_lines`.
3. `20261128020000_phase16_c_runs`:
   - `payroll_periods`, `payroll_runs` (with partial unique index enforcing only one regular run per period per unit), `payroll_run_employees`, `payroll_run_lines`.
4. `20261128030000_phase16_d_statutory_loans`:
   - `esic_contribution_periods`, `employee_loans`, `loan_schedules`, `ot_entries`, `incentive_schemes`, `bonus_accruals`.
5. `20261128040000_phase16_e_tds`:
   - `tax_declarations`, `tax_declaration_items`, `previous_employer_incomes`, `tds_computations`.
6. `20261128050000_phase16_f_outputs`:
   - `bank_file_templates` (HDFC, ICICI, SBI), `bank_transfer_batches`, `bank_transfer_batch_lines`, `payslips`, `fnf_settlements`, `gratuity_records`.

### B. Pure Calculation Engines (`packages/calc/src/payroll/`)
- **Prorate (`prorate.ts`):** `round((monthly * paid_days) / calendar_days)` (half-up).
- **Safe Formula Parser (`formula-parser.ts`):** Pure AST/recursive descent parser supporting `+`, `-`, `*`, `/`, `min`, `max`, `round`, `if`, comparisons (`>`, `<`, `>=`, `<=`, `==`, `!=`). Completely free of `eval`.
- **Code on Wages 50% Add-Back (`code-wage.ts`):** Special Allowance = INCLUDED (R-21). Excluded parts > 50% total gross added back to statutory wages.
- **PF (`pf.ts`):** 12% employee, employer 8.33% EPS (capped at 15k, max 1250) + EPF, EDLI 0.5%, Admin 0.5% min 500, age 58 rule.
- **ESIC (`esic.ts`):** 0.75% / 3.25%, ceiling 21k (25k disabled), 176 daily rule, ceil rounding.
- **Maharashtra PT (`pt-maharashtra.ts`):** Male/female slabs, February ₹300, exemptions for women <= 25k, disability, age >= 65.
- **MLWF (`mlwf.ts`):** June & Dec ₹25/₹75.
- **TDS Projection (`tds-projection.ts`):** FY 2026-27 new tax regime, slabs (0-4L, 4-8L, 8-12L, 12-16L, 16-20L, 20-24L, >24L), standard deduction ₹75,000, rebate up to ₹60,000 with marginal relief, cess 4%, monthly projection.
- **Overtime (`ot-amount.ts`):** `(Basic + DA) / 26 / 8 * 2 * hours`.
- **Bonus (`bonus.ts`):** Monthly accrual 8.33% on min(wage, 7000).
- **Gratuity (`gratuity.ts`):** Monthly provision 4.8077%, settlement `last_wage * 15/26 * years`.
- **Amount in Words (`amount-in-words.ts`):** Indian currency numbering (Lakhs, Crores, Rupees and Paise).

### C. Backend API (`apps/api/src/modules/payroll/`)
- `payroll-service.ts`: Masters, setup, payroll runs lifecycle (DRAFT -> CALCULATED -> APPROVED -> LOCKED -> POSTED), 13-step calculation order, input hash idempotency.
- `posting-adapter.ts`: GL journal generation by department cost center matching §5 table.
- `bank-file-service.ts`: Batch generation, decrypts employee bank accounts from vault only here, validates IFSC, produces banking CSV.
- `statutory-export-service.ts`: ECR 2.0 text format (`#~#`), ESIC monthly CSV, Maharashtra PT return statement.
- `payslip-service.ts`: Document generation, masked Aadhaar, Indian currency words, release tracking.
- `routes.ts`: Mounted at `/api/v1/payroll`.

### D. Frontend Web UI (`apps/web/src/pages/payroll/`)
- `PayProcessingPage.tsx`: 5-step Clerk wizard per §7.
- `PayStructurePage.tsx`: Pay components & structures builder with Code on Wages classifications.
- `StatutoryRatesPage.tsx`: Statutory rates table with `needs_review` compliance badges and review action.
- `PayPayslipPage.tsx`: V9.2 compliant payslip layout with masked Aadhaar, Hindi labels, and amount in Indian words.
- `PayBankPage.tsx`: Bank transfer batches, template selection, and corporate net banking CSV download.

---

## 3. Golden Test Verification (§5 February 2027 Run)
The official Section 5 worked example for February 2027 (28 days; Oct–Mar ESIC period; February PT) was executed in tests:

| Employee | Ramesh (M, SAW) | Sunita (F, TAL) | Vikram (M, VAR) | Total |
|---|---|---|---|---|
| Paid Days | 26 (LOP 2) | 28 | 28 | 82 |
| Earned Basic | ₹ 8,357 | ₹ 12,000 | ₹ 60,000 | ₹ 80,357 |
| Earned HRA | ₹ 3,343 | ₹ 4,800 | ₹ 30,000 | ₹ 38,143 |
| Earned Special | ₹ 3,157 | ₹ 6,200 | ₹ 58,400 | ₹ 67,757 |
| Earned Conv | ₹ 929 | ₹ 1,600 | ₹ 1,600 | ₹ 4,129 |
| Overtime (6 hrs) | ₹ 519 | — | — | ₹ 519 |
| **Gross Salary** | **₹ 16,305** | **₹ 24,600** | **₹ 1,50,000** | **₹ 1,90,905** |
| Code Wage Base | ₹ 11,514 | ₹ 18,200 | ₹ 1,18,400 | — |
| PF Contribution Base | ₹ 11,514 | ₹ 15,000 | ₹ 15,000 | — |
| Employee PF (12%) | ₹ 1,382 | ₹ 1,800 | ₹ 1,800 | ₹ 4,982 |
| Employer EPS (8.33%) | ₹ 959 | ₹ 1,250 | ₹ 1,250 | ₹ 3,459 |
| Employer EPF (Diff) | ₹ 423 | ₹ 550 | ₹ 550 | ₹ 1,523 |
| EDLI (0.5%) | ₹ 58 | ₹ 75 | ₹ 75 | ₹ 208 |
| PF Admin Charges | — | — | — | ₹ 500 (Min) |
| ESIC Employee (0.75%)| ₹ 123 | ₹ 0 (Exempt) | ₹ 0 (Exempt) | ₹ 123 |
| ESIC Employer (3.25%)| ₹ 530 | ₹ 0 | ₹ 0 | ₹ 530 |
| PT (February) | ₹ 300 | ₹ 0 (Woman <= 25k)| ₹ 300 | ₹ 600 |
| TDS (Monthly Proj) | ₹ 0 | ₹ 0 | ₹ 12,565 | ₹ 12,565 |
| **Net Disbursable** | **₹ 14,500** | **₹ 22,800** | **₹ 1,35,335** | **₹ 1,72,635** |

### Balanced GL Journal:
- **Total Debits:** ₹ 2,02,155 (Salary Expense, Employer PF, EDLI, Admin, Employer ESIC, Bonus, Gratuity)
- **Total Credits:** ₹ 2,02,155 (Employee Payable, PF Payable, ESIC Payable, PT Payable, TDS Payable, Bonus Payable, Gratuity Provision)
- **Difference:** ₹ 0.00 (Balanced to the exact rupee).

