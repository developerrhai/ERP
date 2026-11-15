# DECISIONS — binding rulings of the architect across all plans

Written 2026-11-03 after reading the FOUNDATION-CHANGE and open-question lists of plans 02, 03, 04, 05, 06. **Where a plan text disagrees with this file, this file wins and the plan text must be edited to agree.** Reviewers check the plans for a zero count of the superseded patterns listed here.

## A. Database conventions

| ID | Decision | Consequence for the plans |
|---|---|---|
| D-01 | **No `company_id` column on any new table.** The system has exactly one company; none of the built tables carries it. | Remove every `company_id` column, index part, FK and sentence. Unique keys become `(code)`, `(doc_type, code)` etc. `ctx.companyId` is not used by services. Grep must find **0** `company_id` outside this file and the foundation note. |
| D-02 | Audit columns are `created_by_id`, `updated_by_id`, `deleted_by_id` (not `created_by`). | Rename everywhere. |
| D-03 | **Migrations are hand-written SQL.** Never `prisma migrate dev`. A builder creates `apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`, adds scalar models to `schema.prisma`, runs `npx prisma generate`, then `npm run db:reset:test`. | Already written into `00-BUILDER-RULES.md` §6. Any plan text saying `migrate dev` is wrong. |
| D-04 | Lines store **`uom` as the code text** (`'Nos'`, `'Kg'`) that references `uoms.code`, not `uom_id`. | Matches the built `items.base_uom`. Inventory owns `uoms`. |
| D-05 | Parties and documents store `currency_code text` (default `'INR'`), not a currency FK. | |
| D-06 | `TaxService.compute(db, input)` is **async** and delegates to a pure `computeWithRates(rates, input)`. | |
| D-11 | **No CHECK constraints for open lists of types.** `stock_ledger.voucher_type` and `document_links.from_type/to_type` reference lookup tables `stock_voucher_types(code)` and `document_types(code)`. Each module's migration only `INSERT … ON CONFLICT DO NOTHING` its own codes. | Inventory (M1) creates both tables and backfills the existing codes (`OPENING, RECEIPT, ISSUE, ADJUSTMENT, TRANSFER_OUT, TRANSFER_IN, REVERSAL`). Plans 03/04/06 insert theirs (`DELIVERY`, `SALES_RETURN`, `QC_OUT`, `QC_IN`, GRN/return codes, `LEAD, OPP, DLP, DSP, CN, SRET, COL` …). No plan rebuilds a CHECK. |
| D-12 | Tax invoice and sales credit-note numbers use the compact ≤16-character formats chosen by plan 04 (`TAL/2627/00001`, `CN/TAL/2627/0001`) because GST Rule 46 / the e-invoice portal limit the serial to 16 characters. All other documents keep `<PFX>/<UNIT>/<FY>/<0001>`. | Accepted. |

## B. Shared engine kit (ONE mechanism, four plans had four names)

| ID | Decision |
|---|---|
| D-07 | The extensions of the generic/typed page machinery are built **once**, in a new plan file **`07-ENGINE-KIT.md`**, tickets `T-KIT-01…`, built **before any module ticket**. It defines: schema `tabPanels` (the single name; `tabViews`/`tabPanels` merged), panel section types (including `funnel`, `bars`, `timeline`, `calendar`, `board`, tables, KPI tiles), `LinesEditor` line kinds, header `commands`, `requires` = `add|edit|delete|approve`, widened `lookup` kinds (+`suffix`), `readOnlyCreate`, typed filters, action `payload`, per-page print/PDF template registry. Module plans **use** the kit and only add their own panel builders and line kinds; they no longer contain tickets that build the kit (Inventory T-INV-04, SCM T-SCM-05 kit parts, FIN FC-4, SAL FC-5, QMS `tabPanels`). |

## C. Ownership

| ID | Decision |
|---|---|
| D-08 | `tds_sections` and the threshold tracker `supplier_tds_ledger` are owned by **SCM (03)**. Finance only adds columns (`kind`, `new_section`, `payment_code`, `return_form`) and its `tds_entries` is a **register fed from the tracker**, never a second computation. |
| D-09 | Customer receipts, their allocation and sales credit notes are owned by **Sales (04)**. Finance mirrors them read-only and posts the journals from the events. Finance manual credit/debit notes cover corrections with no goods movement. |
| D-13 | Accounting events carry **symbolic account keys** (`INVENTORY`, `GRIR`, `AR`, `SALES`, `OUTPUT_CGST` …) and Finance maps them with `posting_rules` of kind MAP (Finance 4.1.4 is the master). Producers (02, 03, 04, 06) must emit exactly the payload shape in Finance 4.1.3/4.1.4. Reversals use `*_CANCELLED` events. |
| D-14 | `admin-uom` is a typed page owned by Inventory. |
| D-15 | Customer credit exposure is company-wide across all units. |
| D-16 | QMS calls Plan 03's `qcDecide` for GRN quality decisions (no second stock posting); rejected stock stays in the QC-hold warehouse; supplier returns use Plan 03's debit note. Plan 03's `post` calls `QmsInboundPort.onGrnPosted`. |
| D-17 | The built page `inv-reconciliation` field **Variance is a quantity** (`qty`), not money (the generic classifier had it wrong). The fixture is corrected by the Inventory ticket. |
| D-18 | The built inventory pages are repaired to the **frozen registry fields** (Stock Balance 16 fields, ledger columns, missing Opening/Warehouse fields, `Date` label). Inventory plan §1.2 lists them; they are early tickets. |
| D-19 | Kanban (`crm-pipeline`): keep the five frozen lanes New, Qualified, Proposal, Negotiation, Won; `Lost` is an optional hidden sixth lane (plan 04 reading accepted). |
| D-20 | Inventory DEC-07 (backdated postings are **not** recomputed) is accepted for v1 with a guard: a posting dated before the last ledger entry of that item+warehouse is refused with `BACKDATED_POSTING` unless the user has `approve`; revisit later. |

## D. Statutory data (treated as data, re-verified before coding)

| ID | Decision |
|---|---|
| D-21 | All rates, thresholds, due dates, section numbers and rounding rules for GST, TDS/TCS, PF/ESIC, MSME interest are **rows in tables with effective dates**, never constants. Every statutory claim marked "(unverified)" in the plans must be re-verified against the official text **by the architect before the ticket that uses it is handed to the builder**; the builder never decides a statutory number. |
| D-22 | TDS amounts round to the nearest rupee (data setting). Rent TDS threshold is a data row (re-verify: annual vs monthly limit under the Income-tax Act 2025). |
| D-23 | v1 makes **no calls to government portals** (GSTN, IRP, e-way bill, TRACES, EPFO, ESIC). Files/JSON are generated; IRN/e-way numbers are entered manually or through the adapter interface with a mock. |

## E. Process

| ID | Decision |
|---|---|
| D-24 | The client's quality sheets (`doc from clint/`) are confidential: git-ignored, never in web searches, only sanitised structure in plans. |
| D-25 | Plans are rewritten, never patched with "overrides earlier text". One truth per fact. |
