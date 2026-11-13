# PHASE 30 — Report (core built and API-tested; web not browser-tested)

Built locally on 2026-11-13. Nothing committed, pushed or deployed.

## What was built
**Database** — migration `20261218000000_phase30_contract_labour` (idempotent): `contractors`, `cl_work_orders` (balance is a generated column), `cl_workers` (Aadhaar last 4 only), `cl_onboarding_checks`, `cl_deployments`, `cl_attendance`, `cl_min_wages` (4 skill rows, all `needs_review`), `cl_wage_sheets` + `cl_wage_lines`, `cl_invoices`, `cl_compliance_months` + `cl_compliance_docs`, `cl_incidents`; 2 notification types.

**API** (`modules/contractlabour/`, `/api/v1/cl/...`)
- **Contractors**: PAN checked, a different person approves. **Work orders** `CWO/<PLANT>/<FY>/…`: the rate cannot be below the minimum wage ("Wage rate ₹300 is below the minimum wage ₹560 for Skilled."), another person activates, budget amber at 90 % and blocked at 100 %.
- **Workers** `CW/<PLANT>/<FY>/…`: Aadhaar last 4 only, wage ≥ minimum, onboarding checks (KYC, medical, induction, police, PPE, ID card with valid-until). **Deployment** is allowed only when everything is valid on the date, and says why not, first reason first:
  contractor not approved / licence / agreement / insurance, work order active and in dates, headcount ("Work order headcount full (1/1)."), budget, KYC, "Can't deploy: medical fitness expired on 02-11-2026.", induction, police (if required), PPE; one deployment per worker; release.
- **Muster**: `POST /cl/attendance/generate` builds the day from the device punches (first and last punch, break, 8 regular hours, overtime in quarter-hours, P / HD / A); a gate mismatch needs supervisor approval before the day is payable.
- **Wage sheet**: payable days and OT, daily rate checked against the minimum wage, PF 12 % on wages up to the ceiling, ESIC 0.75 % rounded up to the rupee within the ceiling, Maharashtra PT (February 300); **the spec example gives gross 17,100 and net 14,971**; compute again until locked; lock; bank advice Excel.
- **Bills**: man-days × work-order rate + OT + service charge, GST 18 %, TDS 194C (1 % for individual / HUF PAN, 2 % otherwise), refused above the work-order balance; **reconcile** against the muster (28 billed vs 26 mustered = 2 days = ₹1,200 + GST disputed); **payment approval** by another person: blocked unless the **compliance score is 100 %** ("Payment blocked: ESIC challan for 2026-11 not uploaded."), then only the undisputed part can be approved; the work-order budget is used up by the approved bill; the block is audited and notified.
- **Compliance**: 11 checks (licence, agreement, insurance from the contractor record; PF ECR, PF challan, ESIC challan, muster roll, wage register, bank proof, bonus register, return filed as uploaded proofs), each proof **verified by a different person**; score = passed / required (10 of 11 = 90.91 %).
- **Command center**: workers on site, active contractors, licences expiring in 30 days, wage sheets pending, bills blocked, incidents this month, headcount by plant and contractor, expiries, blockers; **plant-scoped**.
- **Incidents** `INC/<PLANT>/<FY>/…` with severity and lost time.

**Web**: Command Center, Contractors, Work Orders, Workers (add, checks, deploy, release; Onboarding and Deployment open the same page), Attendance (build muster, approve a mismatched day), Wages (compute, lines, bank advice, lock), Bills (add, reconcile, approve payment), Compliance (score, checks, upload, verify), Incidents.

## Tests (`tests/phase30.test.ts`, 10 tests, all pass)
Pure: the wage example to the rupee (and February), PT slabs, compliance 90.91 %, budget 90.83 % amber / 100 % blocked, 1,040 vs 1,028 = ₹7,200, 194C by PAN, deployment messages.
API: contractor / work-order rules and approvals by another person; Aadhaar last 4 only and no 12-digit number in any list; every deployment gate in turn; headcount full; a lapsed licence; the muster from punches; the wage sheet figures to the rupee, gate-mismatch day not payable until approved, bank advice file, lock, minimum wage re-checked; bill money, reconcile, payment blocked on the first missing proof and on the ESIC challan, 90.91 %, verify by another person, 100 %, only the undisputed part approved, budget used; command center plant scope; incident number.

## Deviations / not done (carry-over)
1. **Not built (tables or mention only):** prequalification / risk workflow tabs, rate schedule and plant deployment tabs, ID-card and gate-pass pages (`cl-gatepass`), `cl-canteen` (contract-worker meals; Phase 29 scan accepts employees only), `cl-exit`, PPE issue and medical registers as their own pages, toolbox talk / permit / training matrix, **wage slip PDF** (the lines and bank advice exist), GST / TDS tab and the Phase 9 purchase invoice posting (the bill stores GST and TDS but does not create an AP invoice), tax **RCM** flag, return filing tabs.
2. The gate match uses a field on the muster row (`gate_match`) that nothing sets yet: the Phase 18 gate pass is not connected, so every day is treated as matched.
3. Incident CAPA link (Phase 12) and the LTIFR dashboard KPI are not wired; expiry alerts (Phase 27 #35) are not running as an automation yet; the payment-block email to the contractor is not sent (an in-app notice is).
4. Statutory rows (min wage, PF / ESIC ceilings, PT slabs) are code defaults plus 4 minimum-wage rows flagged `needs_review`; they must be confirmed against the current Maharashtra notification before go-live.
5. Wage sheets are per plant, contractor and month; no OT cap check; PF/ESIC for workers whose UAN / IP number is missing is still worked out.
6. Not run: the feeders (3 contractors, 60 workers through the screens, a month of simulated punches), the three full flows, browser test.

## Deploy sheet (owner, by hand — not done by me)
1. Backup the production database. 2. `prisma migrate deploy` (migration `20261218000000_phase30_contract_labour`). No new dependencies or environment variables.
3. Build API and web, restart, `/health` OK. 4. **Confirm the minimum-wage rows** (`cl_min_wages`) with HR/legal before the first wage sheet.
5. Smoke: Contractors ➜ add and approve (second person) ➜ Work Orders ➜ activate ➜ Workers ➜ add, record checks, Deploy; Attendance ➜ Build muster; Wages ➜ Compute; Bills ➜ Reconcile ➜ Approve payment (blocked until the proofs are verified).
6. Rollback: all additive.
