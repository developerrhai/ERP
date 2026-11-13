# PHASE 16

# PHASE 16 — Payroll
(ERRATA E-22 keys; E-29 example fix; R-21 decisions.)

## 1. Goal
Pay every employee correctly each month: attendance → bank file, payslip, statutory files and GL journal.

The engine computes every figure. Prototype bugs fixed: flat PT ₹200 with no February ₹300; TDS as a
% of gross; ESIC eligibility checked monthly; Gross and Net typed by hand.

**Guardrails:**
- every statutory figure is a dated, reviewed data row (R-23);
- a locked run is never edited (R-09);
- every run is approved (R-06) and posted via PostingService (R-07);
- formulas use a safe parser (no eval).

## 2. Pages
- **Prototype pages (12, titles and tabs kept):** pay-structure, pay-processing, pay-overtime,
  pay-incentive, pay-loan, pay-pf, pay-esic, pay-pt, pay-tds, pay-payslip, pay-bank, pay-register.
- **New:** Statutory Rates (under Settings), F&F Settlement, Gratuity & Bonus, Payroll Settings
  (rounding, days basis, PF policy).

## 3. Rules (defaults; all rows needs_review; R-21 decisions applied)
- **PF:**
  - employee 12 %; employer 12 %, split EPS 8.33 % on wages capped at ₹15,000 (max ₹1,250) and the rest EPF;
  - EDLI 0.5 % on ≤ ₹15,000; admin 0.50 % with a ₹500 minimum;
  - **restrict_to_ceiling = true**; VPF is employee-only;
  - EPS stops at age 58; members who joined after 1-Sep-2014 above ₹15,000 are excluded from EPS (flag);
  - **PF wages = CODE_WAGES** (R-21).
- **ESIC:**
  - employee 0.75 %, employer 3.25 %; coverage ceiling ₹21,000 (₹25,000 for persons with disability);
  - contribution periods Apr–Sep and Oct–Mar: covered at the start → contributes the whole period;
  - OT excluded from the coverage test but included in contribution wages;
  - employee nil when the daily average ≤ ₹176;
  - rounded up to the next rupee.
- **Maharashtra PT:**
  - men: ≤ 7,500 nil; 7,501–10,000 ₹175; above ₹200, February ₹300;
  - women: ≤ 25,000 nil; above ₹200 / ₹300;
  - exemptions: disability ≥ 40 %, parent of a disabled child, age ≥ 65.
- **MLWF:** employee ₹25 + employer ₹75 in the June and December payrolls (due 15 Jul / 15 Jan).
- **Salary TDS, Income-tax Act 2025, FY 2026-27, new regime by default:**
  - slabs 0–4 L nil; 4–8 L 5 %; 8–12 L 10 %; 12–16 L 15 %; 16–20 L 20 %; 20–24 L 25 %; > 24 L 30 %;
  - standard deduction ₹75,000; rebate up to ₹60,000 when taxable ≤ ₹12 L, with marginal relief;
  - surcharge 10 / 15 / 25 % with relief; cess 4 %;
  - the UI shows labels, not section numbers.
- **Code on Wages (in force 21-Nov-2025):**
  - each component carries code_wage_class INCLUDED / EXCLUDED;
  - excluded parts above 50 % of total pay are added back to wages;
  - **Special Allowance = INCLUDED** (R-21).
  - Example: Basic 10,000; HRA 8,000; Conveyance 4,000 → excluded 12,000 > 11,000 → add back 1,000 →
    PF wage 11,000.
- **Bonus:** eligible with wage ≤ ₹21,000 and ≥ 30 days worked; computed on min(wage, max(₹7,000,
  minimum wage)) at **8.33 %** (R-21); accrued monthly.
- **Gratuity:**
  - last wage × 15/26 × completed years (a part year > 6 months counts as a full year); cap ₹20 L;
  - eligible after 5 years, fixed-term after 1 year (pro-rata);
  - monthly provision 4.8077 % of Basic + DA.
- **OT:** (Basic + DA) / 26 / 8 × 2 per hour (multiplier is a data row).
- **Days basis:** calendar days (R-21).
- **Files:**
  - ECR 2.0 (#~# separated: UAN, name, gross, EPF/EPS/EDLI wages, contributions, NCP days, refund);
  - ESIC Excel upload;
  - bank templates: Generic NEFT CSV, HDFC, ICICI, SBI CMP — data rows, validated against each bank's sample.

## 4. Database (<ts>_phase16_payroll; money (18,2))
- **pay_components**(code, name, kind EARNING/DEDUCTION/EMPLOYER_CONTRIB, calc_type FIXED/FORMULA/
  ATTENDANCE/INPUT/STATUTORY, formula, prorate, taxable, pf_wage, esic_wage, pt_wage, code_wage_class,
  bonus_wage, gratuity_wage, rounding, payslip_order, payslip_label_hi, gl_key, active)
- **pay_structures** + lines (component, formula/amount, sequence)
- **employee_salary_assignments**(employee, structure, monthly_ctc, effective_from/to, revision, status)
  + salary_assignment_lines (overrides)
- **salary_revisions**(old/new CTC, effective_from, reason, approval, arrears_computed)
- **payroll_periods**(fiscal_period, month, start, end, days_basis, status)
- **payroll_runs**(run_no, period, unit (null = all), run_type REGULAR/ARREAR/FNF/BONUS/REVERSAL,
  status DRAFT → CALCULATED → PENDING_APPROVAL → APPROVED → LOCKED → POSTED → PAID, totals, approval,
  journal, locked_at/by, calc_job_id, input_hash) — only one REGULAR run per period per unit
- **payroll_run_employees**(paid_days, lop, ncp, gross, deductions, net, employer_cost,
  status OK/WARN/ERROR/HELD, messages, snapshot)
- **payroll_run_lines**(component, amount, basis, rate, rate_row_id, source STRUCTURE/OT/INCENTIVE/
  LOAN/ARREAR/MANUAL, note)
- **statutory_rates**(rate_type PF/EPS/EDLI/PF_ADMIN/ESIC/PT_SLAB/MLWF/TAX_SLAB/STD_DEDUCTION/REBATE/
  SURCHARGE/CESS/BONUS/GRATUITY/CODE_WAGE_50/OT_MULTIPLIER, state, regime, gender, slab_from/to,
  month_applicable, rate, amount, cap, min_amount, effective_from/to, source_url, needs_review,
  reviewed_by/at) — no overlapping ranges for the same key
- **esic_contribution_periods**(employee, period_start, covered, decided_on_wage)
- **employee_loans** + loan_schedule
- **ot_entries**(date, shift, eligible/approved hours, multiplier row, amount, approval, period, run_line)
- **incentive_schemes / incentive_entries; bonus_accruals**
- **tax_declarations**(regime NEW/OLD, locked) + items (section, declared, proof, verified) + previous_employer_income
- **tds_computations** (snapshot per employee per run: projected gross, exemptions, std deduction,
  taxable, tax, rebate, surcharge, cess, annual tax, TDS to date, months remaining, current TDS)
- **bank_file_templates; bank_transfer_batches**(status GENERATED/UPLOADED/ACKED/PARTIAL/FAILED) + lines
  (utr, status, fail_reason)
- **payslips**(payslip_no, pdf_doc, released_at, email_status, download_count)
- **fnf_settlements; gratuity_records**
- **Account keys:** PT_PAYABLE, LWF_PAYABLE, EMPLOYEE_LOAN, BONUS_PAYABLE, GRATUITY_PROVISION

## 5. Algorithms (pg-boss payroll.calculate; same input_hash → same result)
**Per employee, in this order:**
1. Assignment (split by days at a mid-month revision).
2. Attendance (paid days, LOP, NCP, OT).
3. Pro-rate = paid days / calendar days; each component = round(monthly × factor).
4. FORMULA components in topological order (safe parser: + − × ÷ min / max / round / if; cycles rejected).
5. OT, incentives, arrears.
6. Gross.
7. Code-wage add-back.
8. PF, ESIC, PT, MLWF.
9. Loan EMIs.
10. TDS.
11. Net (negative → employee HELD, EMI deferred).
12. Employer contributions, bonus and gratuity accruals.
13. Lines + snapshot.

Each component is rounded to the rupee, half-up.

**TDS (monthly projection):**
- annual = YTD taxable + this month + remaining months × current monthly + approved one-offs +
  previous-employer income − standard deduction → slabs → rebate / relief → surcharge → cess.
- This month = max(0, (annual tax − TDS to date) / months left including this one).

**Arrears:** a back-dated revision adds ARREAR lines to the next open run, using each original month's
rates. Locked runs are never touched.

**Worked example — February 2027 (28 days; ESIC period Oct–Mar; February PT):**
| | A Ramesh (M, SAW) | B Sunita (F, TAL) | C Vikram (M, VAR) |
|---|---|---|---|
| Monthly Basic / HRA / Special / Conveyance | 9,000 / 3,600 / 3,400 / 1,000 | 12,000 / 4,800 / 6,200 / 1,600 | 60,000 / 30,000 / 58,400 / 1,600 |
| Paid days | 26 (LOP 2) | 28 | 28 |
| Earned | 8,357 / 3,343 / 3,157 / 929 | 12,000 / 4,800 / 6,200 / 1,600 | 60,000 / 30,000 / 58,400 / 1,600 |
| OT 6 h @ 9,000 / 208 × 2 | 519 | – | – |
| **Gross** | **16,305** | **24,600** | **1,50,000** |
| PF wage / contribution base | 11,514 / 11,514 | 18,200 / 15,000 | 1,18,400 / 15,000 |
| Employee PF 12 % | 1,382 | 1,800 | 1,800 |
| ESIC 0.75 % | 123 (covered: fixed gross 17,000 ≤ 21,000) | not covered | not covered |
| PT (February) | 300 | 0 (woman ≤ 25,000) | 300 |
| TDS | 0 | 0 | 12,565 |
| Loan EMI | 1,000 | – | – |
| **Deductions / Net** | **2,805 / 13,500** | **1,800 / 22,800** | **14,665 / 1,35,335** |
| Employer EPS / EPF | 959 / 423 | 1,250 / 550 | 1,250 / 550 |
| Employer ESIC 3.25 % | 530 | – | – |
| Gratuity 4.8077 % of earned Basic | 402 | 577 | 2,885 |
| Bonus 8.33 % × 7,000 | 583 | 583 | n/a |

- **C's TDS:** projected 18,00,000 − 75,000 = 17,25,000 → tax 1,45,000 + cess 5,800 = 1,50,800;
  paid to January 1,25,670 → (1,50,800 − 1,25,670) / 2 = **12,565**.
- **Establishment:** EDLI 208; admin minimum ₹500.

**GL journal (by department cost centre):**
| Key | Dr | Cr |
|---|---|---|
| SALARY_EXPENSE (gross) | 1,90,905 | |
| SALARY_EXPENSE (employer PF 4,982 + EDLI 208 + admin 500) | 5,690 | |
| SALARY_EXPENSE (employer ESIC) | 530 | |
| SALARY_EXPENSE / GRATUITY_PROVISION | 3,864 | 3,864 |
| SALARY_EXPENSE / BONUS_PAYABLE | 1,166 | 1,166 |
| PF_PAYABLE | | 10,672 |
| ESI_PAYABLE | | 653 |
| PT_PAYABLE | | 600 |
| TDS_PAYABLE | | 12,565 |
| EMPLOYEE_LOAN | | 1,000 |
| SALARY_PAYABLE | | 1,71,635 |
| **Total** | **2,02,155** | **2,02,155** |

- On PAID: Dr SALARY_PAYABLE / Cr Bank (from the bank acknowledgement). A reversal run posts the mirror.

**Bank file:**
- Group paid employees by bank, render the template, validate IFSC (11 characters) and account,
  store via DocumentService.
- Importing the bank acknowledgement marks lines PAID / FAILED; failed lines are re-issued in a new batch.

**F&F** (from the Phase 15 handoff): pay to LWD, leave encashment, notice pay / recovery, gratuity if
eligible, pro-rata bonus, full loan recovery, TDS recomputed → approval → FNF run. Paid within the
F&F due date.

## 6. API (/api/v1/payroll)
- **Setup:** /components, /structures, /assignments, /revisions, /statutory-rates (+ /:id/review)
- **Runs:**
  - POST /runs; POST /runs/:id/calculate (202)
  - GET /runs/:id/employees?status=; GET /runs/:id/employees/:eid/lines
  - POST /runs/:id/hold/:eid | submit | lock | post | reverse
- **Inputs:** /ot-entries, /incentives, /loans (+ disburse | foreclose), /tax-declarations, /fnf
- **Exports:**
  - GET /runs/:id/ecr.txt | esic.xlsx | pt-summary.xlsx | mlwf.xlsx | register.xlsx | tds-quarterly.xlsx | tds-annual-cert
  - POST /runs/:id/bank-batches; GET /bank-batches/:id/file; POST /bank-batches/:id/ack
- **Payslips:** POST /runs/:id/payslips/release (email job); GET /payslips/:id.pdf
- **Import:** POST /imports/salary-assignments

## 7. UI
- **Clerk wizard on pay-processing:**
  1. Month & unit.
  2. Check inputs (attendance locked, OT / incentives approved, joiners / leavers).
  3. Calculate (progress bar).
  4. Review: exceptions first; comparison with last month (net change > 10 % highlighted); the line
     breakdown shows each formula and the rate used.
  5. Submit.
  6. Lock & Post (approver).
  7. Bank file → upload acknowledgement.
  8. Release payslips.
- **Statutory Rates:** a yellow "Needs review" badge; a run cannot be locked while any rate it uses is unreviewed.
- **Payslip PDF** reproduces the index.html V9.2 layout:
  - letterhead, "PAYSLIP / For <Month>";
  - 12-field employee block;
  - Earnings | Amount | Deductions | Amount grid;
  - employer contributions / CTC box;
  - shaded NET PAY band with the amount in words in lakh/crore;
  - ₹ and Devanagari font; optional Hindi labels;
  - non-zero optional lines only (VPF, MLWF, Arrears, Incentive).

## 8. Messages
| Message |
|---|
| "Attendance for {unit} {month} is not locked. Ask HR to lock it in Attendance first." |
| "{Emp} has no salary structure from {date}. Assign one in Salary Structure." |
| "PAN missing — TDS will be deducted at the higher no-PAN rate." (warning) |
| "UAN missing for {Emp}; ECR row will be rejected by EPFO." (error for PF members) |
| "Bank IFSC {x} is not 11 characters / account fails check." |
| "Net pay is negative (₹-x). Employee put on HOLD; loan EMI deferred." |
| "Statutory rate {name} is not reviewed. Run cannot be locked." |
| "This run is locked. Corrections go into next month as arrears or reversal." |
| "Formula for {component} refers to unknown item {X}." |
| "Circular formula: A → B → A." |

## 9. Audit & notifications
- **Audit:**
  - every read of salary data (lines, payslip, register, bank file) with user, reason and IP;
  - every state change, rate review, override, hold or manual line (before/after);
  - bank numbers masked; only BankFileService decrypts them.
- **Notifications:**
  - run submitted → approvers; decided → clerk;
  - payslip released → employee email with PDF;
  - bank failures → clerk;
  - statutory due reminders: PF / ESIC by the 15th; PT; MLWF 15 Jul / 15 Jan; quarterly TDS.

## 10. Tests
- **Unit:**
  - PF: under / over ceiling, restricted or not, age 58+, EPS-excluded, admin ₹500 minimum;
  - ESIC: period continuity, joiner, OT exclusion, round-up, ₹176 rule;
  - PT: every slab, woman at 25,000 and 25,001, February;
  - MLWF: June and December only;
  - TDS: 12,00,000 nil, 12,10,000 marginal relief, 18,00,000, 55,00,000 surcharge relief, old regime;
  - code-wage add-back; bonus; gratuity (4 y 7 m → 5 years, fixed-term, cap);
  - words: 1,35,335 → "One Lakh Thirty Five Thousand Three Hundred Thirty Five".
- **Golden test:** the exact 3-employee example + journal.
- **Integration:** lifecycle; blocked out-of-order transitions; ETag; idempotent calculate / post;
  reversal run; arrears; F&F.
- **Exports:** ECR format, ESIC columns, bank templates.
- **E2E:** clerk wizard; payslip PDF snapshot vs the V9.2 layout.
- 3 clean runs.

## 11. Acceptance
- [ ] A real February run matches hand calculations to the rupee, with nothing typed by hand.
- [ ] The journal balances and posts.
- [ ] ECR and ESIC files pass validation; the bank file passes the bank's validator.
- [ ] Payslips match the layout and are emailed.
- [ ] A locked run can't be edited by any route.
- [ ] No statutory constant in code (grep).

## 12. Out of scope
Direct filing to EPFO / ESIC / TRACES / PT portals, actuarial gratuity, PT outside Maharashtra (table
supports it, no rows), reimbursement claims (Phase 15 expense), gratuity trust, contractor labour payroll.

## 13. Owner check
1. Do the Statutory Rates show PF 12 % / 15,000, ESIC 0.75 / 3.25 / 21,000, PT 175 / 200 / 300 (women
   25,000), MLWF 25 / 75, tax slabs, 75,000 and 4 %?
2. Does a payslip match your CA's spreadsheet?
3. February payslip: PT ₹300? A woman on ₹24,600: PT 0?
4. Does the posted journal show in the GL?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md (R-01..R-24, esp. R-21), ERRATA.md (E-29),
PHASE-16.md, Phase 3–15 code as built, and index.html V92 payslip functions. 1 migration
<ts>_phase16_payroll per §4 + GL keys + non-overlap constraint; load statutory rows from §3 with
source_url, needs_review=true; no demo employees. 2 packages/calc/payroll pure functions (prorate,
evalFormula safe parser, codeWageAddBack, pf, esic, ptMaharashtra, mlwf, tdsProjection, otAmount,
bonus, gratuity, amountInWordsIndian), every rate passed in as a row — no constants; tests = official
examples + §5 golden set. 3 services PayrollCalc (pg-boss, input_hash), RunState (approval via Phase 5;
lock blocks every write; reverse = REVERSAL run), Arrears, Loan, Tds, Fnf, PostingAdapter (journal §5
by department cost centre), BankFile (templates + ack), StatutoryExport (ECR #~#, ESIC xlsx, PT, MLWF,
quarterly TDS), Payslip (PdfService reproducing v92PayslipPDF; email job). 4 API §6; salary reads
audited; decrypt only in BankFileService. 5 UI 12 pages + 4 new, wizard §7, messages §8. 6 tests §10,
3 clean runs. Migrations local dev/test only (R-16). Never push; commit only if asked. Write
PHASE-16-REPORT.md.

