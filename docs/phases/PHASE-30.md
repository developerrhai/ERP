# PHASE 30 — Contract Labour Management (V40 V13: 17 pages)

## 1. Goal
Control every contract worker and contractor:
- licence/agreement/insurance validity;
- work orders with headcount and budget;
- KYC, medical and safety before deployment;
- automatic attendance (Phase 28 engine) matched to the gate;
- wage computation and wage slips;
- contractor bills reconciled to the muster and wage register;
- PF/ESIC proof before payment;
- safety, PPE, medical, incidents.

## 2. Pages (V40 ids; tabs and fields from V40 PROFILES)
| Page | Tabs |
|---|---|
| cl-command-center | |
| cl-contractors | Contractor Register / Prequalification / Agreement & Licence / Statutory Codes / Insurance & Banking / Risk & Approval |
| cl-workorders | Work Order Register / Scope & Headcount / Rate Schedule / Plant Deployment / Budget Control / Approval & Renewal |
| cl-workers | Worker Register / KYC & Aadhaar / Skill & Trade / Statutory Details / Medical & Safety / Gate & ID Card |
| cl-onboarding | |
| cl-deployment | |
| cl-attendance | Daily Muster / Gate Reconciliation / Shift Attendance / Overtime / Absence & Late / Monthly Muster Roll |
| cl-wages | Wage Register / Attendance Input / Earnings / Statutory Deductions / Net Pay / Bank Advice & Wage Slip |
| cl-invoices | Invoice Register / Attendance Reconciliation / Wage Reconciliation / GST & TDS / Payment Approval / Outstanding |
| cl-compliance | Compliance Dashboard / Licence & Agreement / PF & ESIC / Muster & Wage Register / Returns & Insurance / Exceptions & Audit |
| cl-safety | Safety Register / Induction / Toolbox Talk / Permit & Authorization / Training Matrix / Expiry Alerts |
| cl-ppe | |
| cl-medical | |
| cl-incidents | Incident Register / Immediate Action / Investigation / Root Cause / CAPA / Closure & Cost |
| cl-gatepass | |
| cl-canteen | |
| cl-exit | |

## 3. Rules (R-33, each value a dated row with needs_review)
- **Law:** OSH Code 2020 (contract-labour chapter) from 21-Nov-2025: contractor licence/registration
  thresholds, principal-employer duties, registers. Stored with law_basis.
- **Wages:**
  - minimum wages per skill and zone (Maharashtra notification rows) — the wage rate can't be lower;
  - OT 2× (row);
  - PF 12 % on wages up to the ceiling; ESIC 0.75 % / 3.25 % within the ceiling; Maharashtra PT
    (Phase 16 rows reused).
- **Payment only after proof:** the bill can't be approved unless all of these for the month are
  uploaded and verified, otherwise PAYMENT_BLOCKED (CFO may approve only the undisputed part with a
  reason, never a full override):
  - PF ECR + challan;
  - ESIC challan;
  - wage bank proof;
  - muster and wage register signed.
- **GST on manpower supply:** 18 % (row); RCM flag as data; TDS 194C via the Phase 9 engine.
- **Deployment is allowed only if all are valid on the date:** contractor licence, agreement and
  insurance; work order active with headcount and budget left; worker KYC verified, medical fit,
  safety induction valid, police verification (if the row requires it), PPE issued.
- **Aadhaar** in the Phase 15 vault (last 4 digits shown).
- **Plants:** work orders and deployments are per plant; command center per selected plants.

## 4. Database (<ts>_phase30_contract_labour)
- contractors (V40 fields: Contractor Code, Contractor Name, Legal Entity, PAN, GSTIN, Labour Licence
  No, Licence Valid Until, PF Code, ESIC Code, Insurance Policy, Insurance Expiry, Agreement No,
  Agreement Start, Agreement End, Contact Person, Mobile, Email, Bank Account (encrypted), IFSC,
  Risk Rating, Status, Approval Status) + supplier_id (Phase 6, for AP)
- cl_work_orders (V40: Work Order No, Contractor, PO No, Site/Plant (unit_id), Department, Scope of
  Work, Skill Category, Required Headcount, Rate Type, Rate, OT Rate, Start Date, End Date, Budget,
  Utilized, Balance (generated), HR/Purchase/Finance Approval → one 3-level approval, Status)
- cl_workers (V40: Worker ID, Worker Name, Contractor, Aadhaar (vault), Mobile, DOB, Gender,
  Skill Category, Trade, Department, Unit, Work Order No, Joining Date, Contract End Date, Shift,
  Wage Rate, PF UAN, ESIC IP No, Police Verification, Medical Fitness, Safety Induction)
  + biometric_code, photo_document_id, status
- cl_onboarding_checks(worker, check KYC/MEDICAL/INDUCTION/POLICE/PPE/ID_CARD, done_at, valid_until,
  document_id, verified_by)
- cl_deployments(worker, work_order, unit_id, department, from, to) — no overlap per worker (exclusion)
- cl_attendance (V40: Attendance No, Date, Worker, Shift, Punch In, Punch Out, Regular Hours, OT Hours,
  Status, Payable Days, Gate Match, Supervisor Approval, Remarks) — written by the Phase 28 engine
  (category CONTRACT)
- cl_wage_sheets(unit_id, month, contractor, status DRAFT/COMPUTED/LOCKED) + cl_wage_lines (V40: Payable
  Days, Daily Wage Rate, Basic Wages, OT Hours, OT Rate, OT Amount, Allowance, Bonus, Gross Wages,
  PF Rate %, PF Employee, ESIC Rate %, ESIC Employee, Professional Tax, TDS, Other Deduction,
  Total Deduction, Net Pay, Bank Ref)
- cl_invoices (V40: Invoice No/Date, Contractor, GSTIN, Work Order, PO, Billing Month, Service
  Description, Headcount, Basic Labour Value, OT Value, Reimbursement, Service Charge %/Amount,
  Taxable Value, GST Rate %, Tax Type, CGST, SGST, IGST, Gross Invoice) + recon jsonb, tds, net_payable,
  purchase_invoice_id, status
- cl_compliance_months (V40: Compliance No, Month, Contractor, Work Order, Labour Licence, Licence
  Expiry, Agreement Valid, PF Challan, PF ECR, ESIC Challan, Muster Roll, Wage Register, Bank Proof,
  Bonus Register, Insurance Valid, Return Filed, Open Exceptions, Compliance Score %, Risk Level, Status,
  Approval Status) + cl_compliance_docs(month, kind, document_id, verified_by/at)
- cl_safety_records, cl_ppe_issues, cl_medical, cl_incidents (V40 fields) with capa_id (Phase 12)
- cl_gatepasses (→ Phase 18), cl_canteen (→ Phase 29 coupons, person_kind CONTRACT), cl_exits

## 5. Logic and examples
**A. Wage sheet** (per contractor per month — the principal employer's check):
| Line | Amount |
|---|---|
| 26 days × ₹600 basic | 15,600.00 |
| OT 10 h × (600/8 = 75) × 2 = 150/h | 1,500.00 |
| **Gross** | **17,100.00** |
| PF 12 % × min(15,600, ceiling 15,000) | 1,800.00 |
| ESIC 0.75 % × 17,100 = 128.25 → rounded up | 129.00 |
| PT (Maharashtra, male, > ₹10,000) | 200.00 (February 300.00) |
| **Net** | **14,971.00** |

Wage slip PDF per worker; bank advice Excel.

**B. Bill reconciliation:**
- the contractor bills 40 workers × 26 days = 1,040 man-days; the muster shows 1,028 → difference 12
  man-days × ₹600 = **₹7,200 disputed**;
- the wage component vs the locked wage sheet within ±₹1 per worker;
- service charge % from the work order;
- GST 18 %; TDS 194C.
- Only the undisputed part can be approved for payment.

**C. Compliance score** = passed checks / required checks × 100. 11 checks (licence, agreement,
insurance, PF ECR, PF challan, ESIC challan, muster roll, wage register, bank proof, bonus register
(annual), return filed) with 10 passed → **90.91 %** → payment blocked (PAYMENT_BLOCKED until 100 %).

**D. Work order budget:** budget ₹12,00,000, utilised ₹10,90,000 → 90.83 % → amber alert at ≥ 90 %;
100 % blocks new deployments and bills above the balance.

**E. Deployment check example:** worker CW-0412, medical valid until 02-11-2026; deploying on
12-11-2026 → blocked "Medical fitness expired on 02-11-2026."

**F. Gate match:** the attendance day needs a gate IN within ±60 min of the first punch (Phase 18 gate /
contract gatepass). A mismatch → an exception on the daily muster, and supervisor approval is needed
before the day becomes payable.

**G. Expiry alerts (Phase 27 #35):** licence / agreement / insurance / medical / induction / police /
PPE at 30/15/7/0 days → HR + EHS + the contractor's email.

**H. Incidents:** severity Major or above → a Phase 12 CAPA; lost-time hours feed the safety KPI
(LTIFR on the HR/EHS dashboard).

## 6. API
/cl/* CRUD for every table, plus:
- POST /cl/workers/:id/deploy | release
- GET /cl/attendance?month=&contractor=
- POST /cl/wages/:sheet/compute | lock; GET /cl/wages/:sheet/slips.pdf | bank-advice.xlsx
- POST /cl/invoices/:id/reconcile | submit
- GET /cl/compliance/:month; POST /cl/compliance/:id/verify-doc
- GET /cl/command-center?units=

## 7. Screens
- **Command center:** KPI tiles (workers on site now, contractors active, licences expiring 30 days,
  wage sheets pending, bills blocked, incidents this month), headcount chart by contractor × plant,
  the blockers list (red), expiry calendar.
- All pages are typed pages with V40 tabs and the ActionBar.
- The bill reconciliation shows a side-by-side table with differences highlighted.

## 8. Messages
| Case | Message |
|---|---|
| medical expired | "Can't deploy: medical fitness expired on {date}." |
| ESIC challan missing | "Payment blocked: ESIC challan for {month} not uploaded." |
| low rate | "Wage rate ₹{r} is below the minimum wage ₹{m} for {skill}." |
| headcount full | "Work order headcount full ({n}/{n})." |
| budget | "Work order budget used {p} %." |

## 9. Audit & notifications
Every check, deployment, wage lock, reconciliation, verification and block is audited. Alerts through
Phase 27; the payment block → contractor email (automation).

## 10. Tests
- deployment gates (each check);
- gate match;
- the wage example to the rupee + February PT;
- reconciliation;
- compliance score;
- budget alerts;
- Aadhaar never in the clear;
- plant scope.
- **Feeders:** 3 contractors, 3 work orders (one per plant), 60 workers with onboarding documents,
  all through the screens; device-simulator punches for a month; challans uploaded through the
  compliance screen.
- **Flows:** (a) muster → wage sheet → bill → compliance 100 % → payment approved → Phase 9 invoice with
  TDS; (b) a missing ESIC challan blocks; (c) an expired medical blocks deployment.

## 11. Acceptance
- [ ] A full month for 60 contract workers runs end to end.
- [ ] Blocks work.
- [ ] Command center live.
- [ ] Zero-error gate. Client documents updated.

## 12. Out of scope
Contractor portal; state labour portal filings.

## 13. Owner check
1. Deploy a worker with expired medical. Is it blocked with the reason?
2. Bill without the ESIC challan. Does it say "Payment blocked"?
3. Command center for TAL+SAW. Are the numbers right?

## 14. Build prompt
~~~
Read …, PHASE-30.md, V40 cl-* PROFILES and v13*. Reuse the Phase 28 engine, Phase 16 rates,
Phase 9 AP/TDS, Phase 12 CAPA, Phase 18 gate, Phase 15 vault. Seed law rows needs_review only.
Feeders/flows §10. Zero-error gate ×3. Local commit. Report + Deploy sheet + client documents.
~~~

## 15. Client documents
**NEW:** Contract Labour Management — contractors, work orders, workers with KYC/medical/safety checks,
automatic daily muster from the machines, wage sheets and wage slips, contractor bills checked against
attendance and wages, compliance score with payment block, safety, PPE, incidents.

**Test book:**
- **HR:** ＋ Worker with an expired medical → Deploy. ✔️ Blocked with the date.
- **Finance:** a contractor bill. ✔️ Shows "12 man-days disputed ₹7,200".
- **Finance:** Approve without the ESIC challan. ✔️ "Payment blocked".
- **Owner:** Command center. ✔️ Workers on site per plant.

---
