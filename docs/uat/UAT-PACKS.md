# Phase 20-L: User Acceptance Testing (UAT) Script Packs & Parallel Run Plan

All 12 department UAT packs execute in **Staging** with masked PII after two mock cut-overs (`1-Apr-2027` target).

## Exit Criteria (§5(e))
- **0** Sev-1 defects;
- **<= 5** Sev-2 defects (each with a documented workaround);
- **>= 95%** test cases Passed and signed by Department Head;
- **March 2027 Parallel Run:** Finance, Inventory, and Payroll run side-by-side against legacy sheets with `0` unexplained variance.

## Department Packs
| # | Pack | Key Flows Tested (Action -> Expected Result -> Signer) | Signer Role | Status |
|---|---|---|---|---|
| 1 | **O2C (CRM & Sales)** | Lead -> Quotation -> Sales Order -> Reservation -> Dispatch -> Tax Invoice -> Payment Receipt -> Credit Limit Check | Sales Head | Ready for UAT |
| 2 | **P2P (Procurement)** | PR -> RFQ -> Vendor Comparison -> PO Approval -> GRN -> 3-Way Purchase Invoice Match -> AP Payment | Purchase Head | Ready for UAT |
| 3 | **R2R & Month Close (Finance)** | Chart of Accounts -> Journal Voucher -> Cost Center -> BRS -> GSTR-1/3B JSON -> Trial Balance / P&L / BS -> Period Close | CFO | Ready for UAT |
| 4 | **Warehouse & Inventory** | Opening Stock -> Bin Put-away -> Pick/Pack -> Inter-Unit Transfer (`TAL -> SAW`) -> Cycle Count -> Stock Valuation = GL | Warehouse Head | Ready for UAT |
| 5 | **Production (Mfg)** | BOM Revision -> Routing -> MRP Run -> Production Order -> Material Issue -> IPQC -> FG Receipt -> Variance Posting | Production Head | Ready for UAT |
| 6 | **Quality (QMS)** | Inspection Plan -> Incoming GRN QA -> 8D Report -> NCR -> CAPA -> Instrument Calibration Due Alert | Quality Head | Ready for UAT |
| 7 | **Maintenance & Assets** | Machine Master -> PM Schedule -> Breakdown WO -> Spares Consumption -> Capitalisation -> WDV/SLM Depreciation | Maintenance Head | Ready for UAT |
| 8 | **HRMS** | Employee Join -> Attendance Sync -> Shift Roster -> Leave Request & Approval -> Expense Claim -> Exit Finalisation | HR Head | Ready for UAT |
| 9 | **Payroll** | Salary Structure -> Payroll Run -> PF/ESIC/PT/LWF/TDS Statutory Files -> Payslip PDF (Noto Font) -> GL Salary Journal | HR / Finance | Ready for UAT |
| 10 | **Projects & Service** | Project WBS -> Milestones & Billing -> Timesheets -> AMC Contract -> Service Ticket SLA -> Mobile Visit & Claim | Projects Head | Ready for UAT |
| 11 | **Logistics, Fleet, Gate & DMS** | Transporter Lane -> Shipment & POD -> Vehicle Fuel/Service Log -> Returnable Gate Pass -> DMS Folder ACL & Search | Logistics / Security | Ready for UAT |
| 12 | **Admin, Security & Hardening** | Role Matrix -> Permission Sync (< 2 s multi-process) -> DPDP Request -> Opening Cut-Over Reconciliation & Audit Log Immutability | Administrator | Ready for UAT |

