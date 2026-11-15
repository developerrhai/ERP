# 01 — Shared Foundation (every module plan must follow this)

Written by the architect. The module plans (02 Inventory, 03 SCM, 04 Sales/CRM, 05 Finance & Tax) **reuse these tables and interfaces and must not redefine them.** If a module needs a change here, it writes `FOUNDATION-CHANGE:` in its plan and stops; the architect decides.

Read `00-BUILDER-RULES.md` first. Existing code for patterns: `apps/api/prisma/schema.prisma`, `apps/api/src/modules/inventory/**`.

---

## 1. What already exists (do not rebuild)

| Area | Exists | Where |
|---|---|---|
| Users, roles (SUPER_ADMIN, ADMIN, MANAGER, LEAD, MEMBER), sessions, audit log | yes | Phase 1 |
| Departments, role permissions, department→family access, module controls, letterhead | yes | Phase 2 |
| Company (one), Units (Talwade/Sawardari/Varale), Financial Years, request context (`req.ctx`: company, unit, fy) | yes | Phase 3 |
| Generic page engine for ~206 pages (`generic_records`, `number_series`, idempotency, export) | yes | Phase 4 |
| Items, warehouses, stock vouchers (opening, receipt/issue, adjustment, transfer), `stock_ledger`, `stock_balances`, moving-average valuation, lookups | yes | Inventory slice |

Everything else in this file is **new** and is built by the tickets named in the module plans. Foundation tickets are numbered `FND-xx` and live at the top of the first plan that needs them (see §8).

---

## 2. Database conventions (all new tables)

* Table names `snake_case` plural. Primary key `id uuid default gen_random_uuid()`.
* **Standard columns on every business table:**
  `unit_id uuid null` (null = company-wide master), `created_at timestamptz default now()`, `created_by_id uuid`, `updated_at timestamptz`, `updated_by_id uuid`, `version int not null default 1`, `deleted_at timestamptz null`, `deleted_by_id uuid null`.
  **There is NO `company_id` column** (DECISION D-01 in `DECISIONS.md`): the system has exactly one company, and none of the built tables carries it. Unique indexes are therefore `(code)` or `(doc_type, code)`, never `(company_id, …)`.
  Audit column names end in `_id` (`created_by_id`), exactly like the built tables.
* **Documents** (anything with a number) also have: `code text not null`, `status text not null`, `doc_date date not null`, `fy_id uuid not null`, `unit_id uuid not null`, `department text`, and a unique index `(doc_type, code)`.
* **Lines** are in a child table `<document>_lines` with `document_id uuid fk on delete cascade`, `line_no int`, unique `(document_id, line_no)`.
* **Money** `numeric(18,2)`, **qty** `numeric(18,3)`, **rate** `numeric(18,6)`, **percent** `numeric(7,4)`. All have `CHECK` constraints for sign rules (e.g. `qty > 0`).
* **Enums** are stored as `text` with a `CHECK (col IN (...))` (easy to extend with a migration). Do not use Postgres `ENUM` types.
* **Foreign keys** always named `<table>_<col>_fkey`; index every FK column.
* **Immutable ledgers** (`stock_ledger`, `gl_entries`, `audit_logs`, `tax_ledger`) get a trigger blocking UPDATE/DELETE/TRUNCATE.
* **Never delete** a posted/approved document. Reverse it.
* Each migration is one folder `YYYYMMDDHHMMSS_<name>`, SQL checked by hand, **never** edit an already-applied migration.

---

## 3. Shared master tables (owner: this file; built by the first plan that needs them)

### 3.1 `parties` — one table for customers, suppliers, transporters, others
| Column | Type | Rule |
|---|---|---|
| `code` | text | unique; auto `CUS/00001` or `SUP/00001`, or user-entered `^[A-Z0-9/_-]{2,30}$` |
| `name` | text | 2–150, required |
| `legal_name` | text | optional |
| `is_customer`, `is_supplier`, `is_transporter` | bool | at least one true |
| `party_type` | text | `COMPANY`, `INDIVIDUAL`, `GOVERNMENT`, `SEZ`, `EXPORT` |
| `gstin` | text null | 15 chars + checksum; unique among live parties when present |
| `pan` | text null | `^[A-Z]{5}\d{4}[A-Z]$`, must equal GSTIN chars 3–12 when both given |
| `gst_registration_type` | text | `REGISTERED`, `COMPOSITION`, `UNREGISTERED`, `SEZ`, `OVERSEAS` |
| `state_code` | char(2) | GST state code of the main address |
| `msme_registered` bool, `msme_no` text, `msme_category` | | supplier payment alert (see Finance plan) |
| `tds_section_id`, `tds_rate_override` | uuid, numeric | default TDS for payments to this supplier |
| `payment_terms_id` | uuid fk `payment_terms` | |
| `credit_limit numeric(18,2)`, `credit_days int` | | customers |
| `currency_id` | uuid | default INR |
| `price_list_id` | uuid null | customers |
| `sales_person_id` | uuid null | users |
| `status` | text | `ACTIVE`, `INACTIVE`, `BLOCKED` |
Related: `party_addresses (party_id, type BILLING|SHIPPING|REGISTERED, line1, line2, city, district, state_code, pincode, country, gstin_override, is_default)`, `party_contacts (party_id, name, designation, mobile, email, is_primary)`, `party_bank_accounts (party_id, bank_name, account_no_enc, ifsc, holder_name, is_default, verified_at, verified_by)`.
**Rule:** changing a supplier bank account needs a second user to verify (`verified_by <> updated_by`) before payments use it.
**Pages:** `crm-customer360` and `sales-credit` are views over customers; `scm-suppliers` is the view over suppliers.

### 3.2 Terms and tax
* `payment_terms (code, name, due_days, early_discount_pct, early_discount_days)`.
* `tax_codes (code, name, kind GST|CESS|TDS|TCS|EXEMPT, rate numeric(7,4), is_inclusive bool)` and `tax_code_rates (tax_code_id, rate, effective_from, effective_to)` — **rates are effective-dated**, never hard-coded.
* `hsn_sac (code, description, is_service, default_tax_code_id, uqc, effective_from, effective_to)`.
* `tds_sections (code, description, rate_pct, threshold_single, threshold_annual, effective_from, effective_to, act_version '1961'|'2025')` (+ `no_pan_rate`).
* The existing page ids that edit these: `admin-taxes`, `tax-hsn`, `admin-currency`, `admin-uom` (they become typed pages in the Finance/Inventory plans).

### 3.3 Units of measure and currency
* `uoms (code, name, uom_class, decimals)` and `uom_conversions (item_id null, from_uom_id, to_uom_id, factor numeric(18,6))`. Item-specific rows win over global rows.
* `currencies (code, name, symbol, decimals)`, `exchange_rates (currency_id, rate_date, rate, source)`.

### 3.4 Document chain
`document_links (id, from_type, from_id, from_line_id null, to_type, to_id, to_line_id null, qty numeric(18,3) null, amount numeric(18,2) null, created_at)`.
Used for "create from" (PR → PO → GRN → Invoice, Quotation → Order → Delivery → Invoice) and for "quantity still open" = ordered − Σ linked downstream. Unique on `(from_type, from_line_id, to_type, to_line_id)`.

---

## 4. Standard document header/line columns

**Header** (`<doc>`): `code, doc_date, fy_id, unit_id, party_id (when relevant), currency_id, exchange_rate, place_of_supply_state, subtotal, discount_total, taxable_total, cgst_total, sgst_total, igst_total, cess_total, other_charges, round_off, grand_total, status, approval_status ('NA'|'PENDING'|'APPROVED'|'REJECTED'), remarks, cancelled_reason`.

**Line** (`<doc>_lines`): `line_no, item_id null, description, hsn_sac, qty, uom_id, base_qty, rate, discount_pct, discount_amount, taxable_value, tax_code_id, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, cess_amount, line_total, warehouse_id null, batch_no null, serial_nos jsonb null, delivery_date null, <module-specific columns>`.

**Totals are always computed by the server** (`TaxService.compute`), never taken from the client.

---

## 5. Service interfaces every module uses (names are fixed)

```ts
// packages are plain services in apps/api/src/core/** or apps/api/src/modules/<module>/**
NumberingService.next(tx, { docType, unitId, fyId }): Promise<string>        // exists: number_series
TaxService.compute(input: {
  lines: {qty, rate, discountPct?, discountAmount?, taxCodeId, hsn?}[],
  supplierStateCode: string, placeOfSupplyStateCode: string, date: Date,
  chargesTaxable?: Decimal, otherCharges?: Decimal
}): { lines: ComputedLine[], totals: Totals }      // intra-state => CGST+SGST (half each), else IGST; rates by date
StockService.postMovement(tx, MovementInput): Promise<LedgerEntry>            // exists (moving average, no negative stock)
StockService.reserve(tx, ...), StockService.release(tx, ...)                   // new in Inventory plan
AccountingService.post(tx, JournalInput): Promise<Journal>                     // new in Finance plan; balanced or throws
AccountingService.reverse(tx, journalId, reason): Promise<Journal>
PartyService.get(tx, id), PartyService.assertActive(tx, id)                    // new in Sales or SCM plan, whichever is first
ApprovalService.submit(tx, docType, docId)                                     // Phase 6 — until then documents have approval_status = 'NA'
```

**Auto-posting (accounting events).** Operational modules never write journal lines themselves. They call `AccountingService.post(tx, { event, docType, docId, date, lines })` with an **event name** (`PURCHASE_INVOICE_POSTED`, `SALES_INVOICE_POSTED`, `GRN_POSTED`, `DELIVERY_POSTED`, `STOCK_ADJUSTMENT_POSTED`, `PAYMENT_MADE`, `RECEIPT_RECEIVED` …). The account mapping lives in the `posting_rules` table (Finance plan) so accountants can change it without code. **Until the Finance module exists, modules call `AccountingService.post` which is a no-op stub that records the event in `accounting_event_queue` (table below).** This lets Inventory/SCM/Sales ship before Finance without rewriting them.

```
accounting_event_queue (id, event text, doc_type, doc_id, doc_date, payload jsonb,
                        status 'PENDING'|'POSTED'|'FAILED', journal_id null, error text null, created_at, processed_at)
```
Finance's first ticket drains this queue (idempotent by `(event, doc_type, doc_id)`).

---

## 6. Status vocabulary (use these words exactly)

* Transaction documents: `Draft → Submitted → Approved → In Process → Completed`, side exits `Rejected`, `Cancelled`, `On Hold`, `Closed`.
* Posted documents (stock/accounting): `Draft → Posted → Cancelled` (cancel = reversal).
* Masters: `Active`, `Inactive`, `Blocked`.
* The page-level status field is the one labelled exactly `Status`.

---

## 7. Cross-module contracts (who calls whom)

| Event | Producer | What happens |
|---|---|---|
| GRN accepted | SCM | `StockService.postMovement` (RECEIPT, into the receiving warehouse or QC hold) + `AccountingService.post(GRN_POSTED)` |
| Purchase Invoice posted | SCM | `AccountingService.post(PURCHASE_INVOICE_POSTED)` (+ TDS line) |
| Delivery / Dispatch posted | Sales | `StockService.postMovement` (ISSUE) + `AccountingService.post(DELIVERY_POSTED)` (COGS) |
| Sales Invoice posted | Sales | `AccountingService.post(SALES_INVOICE_POSTED)`; GST output ledger rows |
| Sales Return received | Sales | stock RECEIPT into returns warehouse + credit note |
| Stock adjustment posted | Inventory | `AccountingService.post(STOCK_ADJUSTMENT_POSTED)` |
| Receipt / Payment | Finance | settles invoices (`allocations`), updates party ledger |
| Reserve stock | Sales | `StockService.reserve` reduces `available`, not `on_hand` |

---

## 8. Ownership and order

| Order | Plan | Builds |
|---|---|---|
| 1 | `02-INVENTORY-WMS.md` | `uoms` (+conversions), reservation/batch/serial/expiry/valuation/reorder/reconciliation pages, warehouse structure, `StockService.reserve/release`, `AccountingService` **stub** + `accounting_event_queue`, `NumberingService` wrapper |
| 2 | `03-SCM-PROCUREMENT.md` | `parties` (suppliers side), `payment_terms`, `tax_codes`/`hsn_sac` (+ `TaxService`), PR/RFQ/Quote/Comparison/PO/GRN/Purchase Invoice, supplier evaluation, contracts, `document_links` |
| 3 | `04-SALES-CRM.md` | `parties` (customers side, extends 02), price lists, CRM tables, quotations → orders → delivery → invoices → collections, credit limits, returns |
| 4 | `05-FINANCE-TAX.md` | chart of accounts, `AccountingService` **real implementation**, `posting_rules`, journals, books, AP/AR, bank reco, GST returns, TDS/TCS, e-invoice/e-way JSON |

If a plan needs a table owned by a later plan, it uses the queue/stub in §5 or a nullable reference and says so.
