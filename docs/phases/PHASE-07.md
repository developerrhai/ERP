# PHASE 07

# PHASE 07 — Finance core (General Ledger, posting engine, core reports)
(Read ERRATA.md first: E-08 soft-closed gate, E-09 numbering, E-10 account key names, E-20 dimensions.)

## 1. Goal & why
Build the one double-entry ledger that every later phase posts into. Phases 8–16 (stock, purchase,
sales, tax, manufacturing, assets, payroll) never write money figures anywhere else. They call
`PostingService.post()` **inside their own database transaction**, using symbolic account keys
(D-13). Finance maps each key to a real account through posting_rules.

**Two success rules (R-07):**
- Debit total = credit total for every journal, for every unit and for the whole company, at all times.
- Stock value = the GL inventory balance. Phase 8 proves this with the bridge built here.

**Changes from old plan 05:**
- Posting is **synchronous, inside the producer's transaction** (decision P7-D1). If the journal cannot
  post, the document cannot post either, so stock and GL can never drift apart.
- Approvals use the Phase 5 ApprovalService.

**Five defects in old plan 05b are fixed here:**
- (a) A trigger syntax error (NEW.NEW.unit_id).
- (b) Contra accounts were impossible (Accumulated Depreciation, Doubtful Debts, Sales Returns). Fixed
  with an is_contra flag.
- (c) posting_rules had no unit, so it could not map per-GSTIN GST ledgers.
- (d) journal statuses did not follow the standard lifecycle.
- (e) party_id pointed at a "parties" table. It is now party_type + party_id, because customers and
  suppliers are separate tables.

## 2. Pages in scope
| Page | Built in | Why |
|---|---|---|
| fin-coa (6 tabs) | 7 | Nothing can post without it. |
| fin-journal | 7 | Manual journal, approval, reversal. |
| fin-gl | 7 | Drill-down source for every report. |
| fin-cashbook, fin-bankbook | 7 | Other receipts/payments, contra, petty cash, running balance. Customer receipts link to Sales (Phase 10). |
| fin-bankreco | 7 (last part) | Only needs the bank book: CSV statement import + matching. |
| fin-costcenter, fin-profitcenter | 7 | Dimensions every line carries. |
| fin-budget (basic) | 7 | Budget vs actual. The Commitments tab stays empty until Phase 9. |
| fin-trial, fin-pnl, fin-bs, fin-cashflow | 7 | Schedule III reports, by unit and consolidated. |
| fin-ap, fin-debitnote | 9 | Need supplier invoices. |
| fin-ar, fin-creditnote, fin-ageing | 10 | Need sales invoices. |
| fin-expenses | 15 | Needs employees. |

The open_items / allocations tables and OpenItemService are built **now**, because PostingService
creates and settles them from AR/AP lines. Their pages come later.

## 3. Business logic & research (rules adopted)
**Sources** (re-verify):
- Schedule III, Companies Act 2013, Division I (as amended 24-Mar-2021): mca.gov.in/Ministry/pdf/Schedule_III.pdf
- ICAI Guidance Note on Schedule III
- ERPNext: Chart of Accounts, GL Entry, Journal Entry, Period Closing Voucher, Accounting Dimensions
- Odoo: account.move, lock dates
- TallyPrime: groups and ledgers

**Rules:**
1. **Document separate from ledger.** journal_entries + journal_lines are editable only in Draft.
   gl_entries is append-only and is the **only** source for reports.
2. **Group/ledger tree.** Groups never take postings. Every ledger has one root type; its normal
   balance follows that type unless it is a contra account.
3. **Dimensions on every line:** unit, cost centre, profit centre, party (project and AMC added later,
   E-20). **Every journal balances per unit, not just in total.** For a cross-unit journal,
   PostingService adds automatic INTER_UNIT lines (account 2800 "Inter-Unit Account"). 2800 nets to 0
   on consolidation, and an exception tab checks this.
4. **Lock levels** (Phase 3 periods):
   - Open → normal posting.
   - Soft-closed → only users with action "post" on admin-fy, with a reason (E-08).
   - Closed → nobody.
5. **Year-end close** = a Closing journal per unit, dated the FY end:
   - every income/expense account's FY balance moves to 3004 Retained Earnings;
   - balance-sheet accounts are cumulative, so nothing is carried forward;
   - P&L queries exclude closing rows;
   - reopening = reversing the closing journal.
6. **Perpetual inventory:** stock accounts move with every stock event. Schedule III shows expenses by
   nature, so the P&L calculator converts:
   - Changes in inventories (FG + WIP + Trading) = opening − closing of 1302, 1303, 1307 (from GL)
   - Purchases of stock-in-trade = trading COGS + change in 1307
   - Cost of materials consumed = (COGS + materials consumed + absorbed overhead contra) − changes −
     purchases of stock-in-trade
   - A unit test checks that net profit is identical in both views.
7. **GST ledgers per GSTIN** (returns are filed per GSTIN):
   - Input/output CGST, SGST, IGST, Cess and the RCM ledgers are **groups**, with one ledger per real
     GSTIN under each.
   - Units that share a GSTIN share those ledgers.
   - Unit-specific posting_rules map OUTPUT_CGST etc. per unit.
   - A unit with no GSTIN gets UNMAPPED_ACCOUNT_KEY for any GST key.
8. **Round-off is explicit.** The producer sends a ROUND_OFF line (|x| ≤ fin.max_round_off, default
   ₹1.00). Finance **never fills a difference itself**.
9. **Manual journals** at or above fin.journal_approval_threshold (a data value; the owner sets it) go
   through approval, and the maker cannot be the checker. Event journals need no approval, because
   their source document was already approved.
10. **Statutory numbers are data** (thresholds, limits, round-off cap).

## 4. Database design
Migrations (timestamps per E-01):
1. `_phase07_fin_coa`: accounts (one tree with is_group), cost_centers, profit_centers, report_lines, voucher_types
2. `_phase07_fin_ledger`: journal_entries, journal_lines, gl_entries, 4 guard triggers (with fixes), open_items, allocations
3. `_phase07_fin_events`: accounting_events, posting_rules, account_keys
4. `_phase07_fin_cash_bank_budget`: link the Phase 6 bank master + gl_account_id, payments, bank_statements, bank_statement_lines, bank_matches, budgets, budget_months
5. `_phase07_fin_close_reports`: gl_period_balances, fy_closings, functions fn_trial_balance, fn_account_balances, fn_book
6. `_phase07_fin_seed`: CoA, report lines, account keys, mapping rules, voucher types (INSERT … ON CONFLICT DO NOTHING)

**accounts:**
- code, name, parent_id, is_group, root_type (Asset / Liability / Equity / Income / Expense)
- normal_balance; is_contra — CHECK: normal_balance = (Debit if Asset/Expense else Credit) XOR is_contra
- account_type / sub_type ('Stock' marks inventory control accounts)
- party_required + control_side RECEIVABLE / PAYABLE (AR and AP control accounts)
- cost_center_required, gst_registration_gstin (for per-GSTIN tax ledgers), schedule3_line (FK report_lines), cf_class
- Rules:
  - **Manual journals to Stock accounts are refused** (CONTROL_ACCOUNT_MANUAL), overridable only with
    the fin.inventory_adjust permission.
  - Accounts are company-wide; the unit is a line dimension.
  - Code and root_type are locked once postings exist. A used account can be deactivated, never deleted.

**cost_centers:**
- code, name, parent_id, is_group, department_id, manager_user_id, unit_id, status.
- Each unit has a default cost centre (setting), used when an event line needs one and the producer
  sends none.

**profit_centers:** code, name, unit_id, manager_user_id, status. One default per unit.

**journal_entries:**
- status 'Draft','Pending Approval','Approved','Posted','Cancelled'; approval_request_id
- source MANUAL / EVENT / PAYMENT / SYSTEM / CLOSING / OPENING
- source_event, source_doc_type, source_doc_id, source_doc_no
- reversal_of_id, reversed_by_id, reversal_reason, auto_reverse_on, warnings jsonb
- total_debit, total_credit, version
- UNIQUE(source_event, source_doc_type, source_doc_id) WHERE reversal_of_id IS NULL

**journal_lines:**
- journal_id, line_no, unit_id, account_id
- debit, credit (numeric(18,2); exactly one is > 0)
- party_type CUSTOMER / SUPPLIER / EMPLOYEE, party_id (checked by the service)
- cost_center_id, profit_center_id, item_type, narration
- bill_mode, bill_doc_no, bill_due_date, open_item_id
- is_auto (inter-unit lines)

**gl_entries:**
- append-only (trigger), seq identity, the same dimensions, is_closing, is_reversal, reverses_gl_id.
- A deferred constraint trigger checks Σdebit = Σcredit **per journal AND per (journal, unit)**.

**open_items / allocations:** for AR/AP bills, with party_type.

**accounting_events:**
- event, doc_type, doc_id, doc_no, doc_date, unit_id, payload jsonb, payload_hash, journal_id,
  status POSTED / REVERSED, created_at, created_by_id.
- UNIQUE(event, doc_type, doc_id). Only successful posts are stored; a failure rolls back with the producer.

**account_keys:** key PK, description, expected_root_type. Seeded:
- Inventory and purchase: INVENTORY_RM, INVENTORY_WIP, INVENTORY_FG, STOCK_IN_TRANSIT, GRIR, AP,
  PURCHASE_EXPENSE, PURCHASE_PRICE_VARIANCE, SUPPLIER_ADVANCE
- Sales: AR, SALES, SALES_RETURNS, COGS, CUSTOMER_ADVANCE
- GST: OUTPUT_ and INPUT_ CGST / SGST / IGST / CESS, RCM_PAYABLE_CGST / SGST / IGST
- TDS/TCS: TDS_PAYABLE, TDS_RECEIVABLE, TCS_PAYABLE
- Cash and adjustments: ROUND_OFF, BANK_OR_CASH, STOCK_ADJUSTMENT, SCRAP_LOSS, CONSUMPTION_EXPENSE,
  OVERHEAD_ABSORBED
- Other: INTER_UNIT, DEPRECIATION, ACCUM_DEP, SALARY_EXPENSE, SALARY_PAYABLE, PF_PAYABLE, ESI_PAYABLE,
  OPENING_BALANCE_EQUITY
- Later phases add their own keys (E-22).

**posting_rules** (MAP only):
- line_key (FK account_keys); event ('*' or a specific event); unit_id (NULL = all units); seq
- condition jsonb (e.g. {"payload.invoiceType":["Export","SEZ"]})
- account_id or selector FIXED / PAYLOAD_BANK_ACCOUNT
- effective_from / effective_to, is_active
- Resolution order: specific event before '*', then specific unit before NULL, then lowest seq;
  effective on doc_date.
- A self-test endpoint replays stored samples.

**payments:** kind, unit_id, bank_or_cash_account_id, party, amount, instrument_utr, doc_date,
journal_id, status, version. Finance-originated vouchers only (other receipt/payment, contra, petty cash).

**Bank reconciliation:**
- bank_statements, bank_statement_lines, bank_matches.
- budgets (code, fy, unit, cost centre, account, control_mode Ignore / Warn / Stop, status, total)
  + budget_months.

**gl_period_balances** (fy, period, unit, account, debit, credit, built_at):
- Written when a period is soft-closed. A later override post rebuilds that period's rows in the same
  transaction.
- Reports use the snapshot for closed periods and live sums for open ones.
- A nightly check proves snapshot = raw sum.

**fy_closings:** fy, unit, journal_id, status Closed / Reopened, closed_by, closed_at.

**report_lines** — the Schedule III Division I tree:
- **Balance sheet:**
  - Shareholders' funds: Share capital; Reserves & surplus.
  - Non-current liabilities: Long-term borrowings; Deferred tax liability (net); Other long-term
    liabilities; Long-term provisions.
  - Current liabilities: Short-term borrowings; Trade payables split MSME / Others (using the supplier
    MSME flag and open items); Other current liabilities (statutory dues, GRIR, customer advances);
    Short-term provisions.
  - Non-current assets: PPE; Intangibles; CWIP; Intangibles under development; Non-current
    investments; Deferred tax asset (net); Long-term loans & advances; Other non-current assets.
  - Current assets: Current investments; Inventories; Trade receivables; Cash & cash equivalents;
    Short-term loans & advances (GST input, TDS receivable); Other current assets.
- **P&L:** Revenue from operations; Other income; Cost of materials consumed; Purchases of
  stock-in-trade; Changes in inventories; Employee benefits; Finance costs; Depreciation &
  amortisation; Other expenses; Exceptional items; Extraordinary items; Tax expense (current,
  deferred); Profit after tax.

**Seed chart of accounts** (about 150 ledgers, is_system):
- 1401–1404 and 2301–2308 are **groups**. FinanceSetupService.ensureGstLedgers() creates one ledger per
  real GSTIN at seed time and whenever a unit's GSTIN is set.
- Added accounts:
  - 1309 Materials in Transit (STOCK_IN_TRANSIT)
  - 2152 Stock Suspense
  - 2800 Inter-Unit Account
  - 5110 Materials Consumed
  - 5116 Overhead Absorbed (contra expense)
  - 6301 Interest Expense, 6401 Depreciation, 6501 Current Tax, 6502 Deferred Tax
- Contra flags: 1205, 1700–1761, 4107/4108.
- One bank ledger per real bank account, created under group 1100. No sample banks (R-15).

## 5. Services & algorithms (modules/finance/{coa,ledger,rules,periods,cashbank,budget,reports,close})
Pure maths lives in packages/calc/finance: balance, perUnitBalance, roundOff, trialBalance,
schedule3Pnl, schedule3Bs, cashflowIndirect, ageBuckets.

**Contract — frozen for Phases 8–16:**
~~~ts
PostingService.post(tx, e: {
  event: string;                 // 'SALES_INVOICE_POSTED'
  docType: string; docId: string; docDate: string /*YYYY-MM-DD*/; unitId: string;
  payload: { docNo: string; partyType?: 'CUSTOMER'|'SUPPLIER'|'EMPLOYEE'; partyId?: string;
    dueDate?: string; invoiceType?: string; bankAccountId?: string; narration?: string;
    lines: Array<{ account: AccountKey; debit: string; credit: string; unitId?: string;
      partyType?; partyId?; costCenter?: string; itemType?: string; narration?: string;
      projectId?: string; amcContractId?: string;      // added by Phase 17 (E-20)
      bill?: { mode:'NEW'|'AGAINST'; docNo?: string; dueDate?: string; openItemId?: string } }>;
    reverses?: string /* 'EVENT:docType:docId' */; reason?: string } })
  : Promise<{ journalId: string; voucherNo: string; replay: boolean }>
~~~
Example (GRN):
~~~json
{"event":"GRN_POSTED","docType":"goods-receipts","docId":"…","docDate":"2027-04-10","unitId":"TAL",
 "payload":{"docNo":"GRN/TAL/2027-28/0001","lines":[
  {"account":"INVENTORY_RM","debit":"50000.00","credit":"0"},
  {"account":"GRIR","debit":"0","credit":"50000.00"}]}}
~~~

**post(), step by step:**
1. Validate with zod: at most 2 decimals, exactly one side > 0 per line.
2. Look up accounting_events for this key:
   - same payload hash → return replay=true;
   - different hash → 409 EVENT_PAYLOAD_CHANGED;
   - otherwise insert the event row (the unique index decides any race; the loser re-reads).
3. If `reverses` is set → run the reversal path R.
4. Resolve every key through posting_rules. Missing → 422 UNMAPPED_ACCOUNT_KEY {key, unit}, and
   Finance admins are notified.
5. Period check through Phase 3 assertCanPost (row FOR SHARE): Open ok; Soft-closed needs the gate and
   a reason; Closed or missing → PERIOD_CLOSED / NO_PERIOD.
6. Account checks: active, not a group, party where required, cost centre where required (unit
   default for events).
7. Balance check: Σdebit = Σcredit with no tolerance. Then per unit: if a unit is unbalanced, add
   INTER_UNIT lines (is_auto=true) for the difference.
8. Voucher number:
   - events → `EV/<code>/<docNo>`;
   - manual journals → `JV/<UNIT>/<FY>/0001` through NumberingService.allocate (E-09).
9. Insert the header (Draft), the lines and the gl_entries, then set Posted. The deferred trigger
   re-checks the balance.
10. Open items: an AR/AP line with a party creates a bill (NEW) or allocates against one (AGAINST).
11. Audit JOURNAL_POSTED.

**R — reversal:**
- Find the original by (event, docType, docId); none → 422 ORIGINAL_NOT_FOUND.
- Refuse if ALREADY_REVERSED, if its open items are partly settled (SETTLED_DOCUMENT), or if it has a
  reconciled bank line (RECONCILED_ENTRY).
- Otherwise post a mirror journal (debit ↔ credit) dated the cancel date. That date must be ≥ the
  original date and in an open period.
- Set reversed_by_id, neutralise the open items, and set the event to REVERSED.
- Manual journals use JournalService.cancel(id, reason), which follows the same path (R-09).

**Manual journal lifecycle:**
- Draft (If-Match) → submit.
- At or above the threshold: Pending Approval → Approved → post. Below it: post directly.
- Posted → cancel = reversal journal.
- auto_reverse_on (accruals) is handled by the daily pg-boss job fin.auto-reverse.

**Year-end close — CloseService.closeYear(fyId, unitId?):**
- **Preconditions:**
  - all 12 periods are Soft-closed or Closed;
  - the FY trial balance balances;
  - no Draft or Pending journals in the FY;
  - Σ account 2800 = 0 consolidated.
- **Steps:**
  1. Take the advisory lock fin:yearend:<fy>.
  2. Per unit, take the FY balance of each income/expense account (excluding closing rows) and post the
     opposite, with the net going to 3004. Voucher type Closing, is_closing=true, dated the FY end,
     allowed past the period lock (system source only).
  3. Write fy_closings and set the FY to CLOSED.
- **Reopen:** needs the fin.yearend permission; reverses the closing journal and sets the FY back to OPEN.

**Reports** (SQL functions, Decimal in TS):
- **Trial balance** fn_trial_balance(from, to, units[], level):
  - opening = balance-sheet accounts cumulative to the day before "from", plus P&L accounts from the FY
    start; then the period's debits and credits; then closing;
  - each balance is shown on its natural side; "Variance" = a balance on the wrong side.
- **P&L and Balance Sheet:**
  - grouped by schedule3_line;
  - current-year profit shows under "Reserves & surplus – surplus in P&L" until the year is closed;
  - comparison columns: prior-year YTD and budget YTD.
- **Cash flow** (indirect, using cf_class CASH / WC / INVESTING / FINANCING / NONCASH):
  - profit after tax + non-cash items ± working-capital changes, then investing, then financing;
  - the change in cash accounts must equal the computed net (asserted).
- **Cash/bank book** fn_book(account, unit, from, to, cursor):
  - opening = sum before "from";
  - rows ordered by (posting_date, seq); running balance = opening + running sum;
  - keyset pagination carries the running balance forward.
- **Drill-down:** report line → accounts → GL rows → journal → source document.

**Locking:**
| Situation | Lock |
|---|---|
| Post vs period close | period row FOR SHARE vs FOR UPDATE |
| Approve / post / cancel | row FOR UPDATE + version |
| Cash payments | advisory lock fin:cash:<unit>:<account> + negative-cash check |
| Year close | advisory lock |
| Numbering | number_series row lock |

**Bridges:**
- GlBridge.inventoryBalance(unit, asOf) for Phase 8.
- Stock moved before Phase 8 posts nothing. Phase 8 posts a one-time STOCK_OPENING_POSTED per unit
  (Dr INVENTORY_* / Cr OPENING_BALANCE_EQUITY) at real values.

## 6. API ({data,meta}; If-Match on changes; Idempotency-Key on posts)
- **Chart of accounts:**
  - GET/POST/PATCH /finance/accounts
  - GET /finance/accounts/tree
  - POST /finance/accounts/:id/activate | deactivate
  - GET /finance/accounts/validate
- **Posting rules:** GET/PUT /finance/posting-rules; POST /finance/posting-rules/self-test
- **Journals:** GET/POST/PATCH /finance/journals; POST /finance/journals/:id/submit | approve | reject | post | cancel
- **Payments:** POST /finance/payments (kind = receipt | payment | contra | petty); POST /finance/payments/:id/cancel
- **Ledger and books:**
  - GET /finance/gl?account&unit&from&to&costCenter&cursor
  - GET /finance/books/cash | bank
- **Reports:** GET /finance/reports/trial-balance | pnl | balance-sheet | cash-flow
  ?fy&from&to&units=all|<ids>&compare=py|budget (+ .xlsx / .pdf via Phase 4)
- **Dimensions and budgets:** GET/POST /finance/cost-centers, /finance/profit-centers, /finance/budgets
  (+ approve, close)
- **Bank reconciliation:**
  - POST /finance/bank-statements (CSV)
  - POST /finance/bank-reco/:id/auto-match | reconcile | reopen
- **Periods and year:**
  - POST /finance/periods/:id/soft-close | close | reopen (soft-close builds the snapshot)
  - POST /finance/years/:id/close | reopen
- PostingService.post and reverse are internal only; there is no HTTP route for them.

## 7. UI & user flow (index.html look; plain words)
**Journal form, Simple mode:**
- Asks "What happened?": I paid money / I received money / Move money between bank & cash / Correct an
  entry / Advanced.
- Each choice fills the correct debit and credit lines.
- Labels read "Money goes to (Debit)" and "Money comes from (Credit)".

**Journal form, Advanced mode:** the full debit/credit grid.

**Both modes:**
- A live footer shows "Debit total ₹ / Credit total ₹ / Difference ₹". Post stays disabled while the
  difference ≠ 0.
- The account picker searches by code or name and shows hints (type, normal side, "needs party",
  "needs cost centre"). Party and cost-centre fields appear only when needed.
- An approval banner shows the threshold.
- Reversal opens a dialog for the reason (5–300 characters) and the date.

**Chart of accounts tabs:**
- Account Tree, with balance per unit.
- Account Master; code and type are locked once used.
- Group Mapping (report line per account).
- Posting Controls (key → account grid per unit, with self-test).
- Opening Balances (read-only until Phase 20).
- COA Validation: unmapped keys, groups without ledgers, units missing a GSTIN.

**Reports:** unit chips TAL / SAW / VAR / All. Every amount links to the GL, then to the journal, then
to the source document. Excel and PDF export.

**Cash/bank books:** a receipt/payment modal; the voucher is created already Posted. The "Customer
receipt" button is disabled until Phase 10.

**Bank reconciliation:**
- Two panes (bank | ERP).
- Auto-match on amount + date ±3 days + UTR; manual matching by drag.
- A difference tile.

## 8. Exact messages
| Code | HTTP | Message |
|---|---|---|
| JOURNAL_UNBALANCED | 422 | "Debits and credits differ by ₹{d}. They must be equal." |
| AMOUNT_PRECISION | 422 | "Use at most 2 decimals." |
| ACCOUNT_NOT_POSTABLE | 422 | "{code} is a group or inactive account; pick a ledger under it." |
| PARTY_REQUIRED | 422 | "Choose the {customer/supplier} for {account}." |
| COST_CENTER_REQUIRED | 422 | "This expense needs a cost centre." |
| CONTROL_ACCOUNT_MANUAL | 422 | "Stock accounts change only through stock documents." |
| PERIOD_CLOSED | 409 | "{Month} is closed; date the entry in an open month." |
| PERIOD_SOFT_CLOSED | 409 | "{Month} is soft-closed; only the finance controller may post, with a reason." |
| NO_PERIOD | 422 | "No financial period exists for {date}." |
| UNMAPPED_ACCOUNT_KEY | 422 | "No account is set for {key} in unit {unit}. Ask Finance to set it in Chart of Accounts › Posting Controls." |
| NEGATIVE_CASH | 409 | "Cash would go below zero." |
| EVENT_PAYLOAD_CHANGED / ALREADY_REVERSED / SETTLED_DOCUMENT / RECONCILED_ENTRY | 409 | plain-English message naming the document |
| ORIGINAL_NOT_FOUND / REVERSAL_DATE_INVALID / REASON_REQUIRED | 422 | plain-English message |
| ROUND_OFF_TOO_LARGE | 422 | "Round-off over ₹1. Check line amounts." |
| YEAR_NOT_READY | 409 | lists the blocking items |
| BUDGET_EXCEEDED | 422 (Stop mode) / warning (Warn mode) | "Budget left ₹x; this entry is ₹y." |
| VERSION_CONFLICT | 412 | "Someone else changed this. Reload and try again." |

#Audit & notifications
- **Audit:**
  - ACCOUNT_CREATED / UPDATED / DEACTIVATED
  - POSTING_RULE_CHANGED (before/after)
  - JOURNAL_CREATED / SUBMITTED / APPROVED / REJECTED / POSTED / CANCELLED
  - LOCK_OVERRIDDEN
  - PERIOD_SOFT_CLOSED / CLOSED / REOPENED, FY_CLOSED / REOPENED
  - BANK_RECONCILED, BUDGET_APPROVED
- **Notifications:**
  - approval request and decision;
  - UNMAPPED_ACCOUNT_KEY → Finance admins.
- **Jobs:**
  - fin.auto-reverse (daily);
  - fin.snapshot-check (nightly; a mismatch alerts admins);
  - fin.period-reminder (3 days after month end; lists open drafts).

## 10. Tests (packages/calc unit tests + API on real Postgres; a test producer calls PostingService)
1. **Purchase** (TAL, intra-state):
   - GRN: Dr 1301 RM 50,000.00 / Cr 2150 GRIR 50,000.00.
   - Invoice: Dr GRIR 50,000.00, Dr Input CGST-TAL 4,500.00, Dr Input SGST-TAL 4,500.00 /
     Cr AP (supplier S1) 59,000.00. Open item +59,000 created.
2. **Service with TDS 194C, inter-state:** Dr 5105 20,000.00, Dr Input IGST 3,600.00 /
   Cr AP 23,200.00, Cr TDS 400.00.
3. **Sale:**
   - Taxable 12,345.50 at 18 % intra: CGST 1,111.10 and SGST 1,111.10 (1,111.095 rounded half-up);
     total 14,567.70 → 14,568.00.
   - Journal: Dr AR 14,568.00 / Cr Sales 12,345.50, Cr Output CGST 1,111.10, Cr Output SGST 1,111.10,
     Cr Round-off 0.30.
   - The inter-state variant posts Output IGST 2,222.20.
   - Delivery: Dr COGS 9,000.00 / Cr FG 9,000.00.
4. **Payment:** Dr AP 23,200.00 / Cr Bank 23,200.00. S1's open item = 0 = its GL balance.
5. **Cross-unit:** TAL's bank pays SAW's rent of 10,000.00 → automatic lines SAW Cr 2800 10,000.00 and
   TAL Dr 2800 10,000.00. Each unit's trial balance balances; 2800 = 0 consolidated.
6. **Year-end close** (TAL, FY 2027-28):
   - Balances: 4101 Cr 10,00,000; 4201 Cr 20,000; 5101 Dr 6,00,000; 6101 Dr 2,50,000.
   - Closing journal: Dr 4101 10,00,000, Dr 4201 20,000 / Cr 5101 6,00,000, Cr 6101 2,50,000,
     Cr 3004 1,70,000.
   - The FY 2027-28 P&L still shows 1,70,000; the BS shows 3004 +1,70,000; FY 2028-29 P&L opens at 0.
7. **Reversal:** cancelling GRN_POSTED restores RM exactly; a second cancel → ALREADY_REVERSED.
8. **Property test** (fast-check, 1,000 runs, random manual / event / cross-unit / reversal / closing
   journals over 3 units and 24 periods). Each run asserts:
   - balanced consolidated, per unit and per period;
   - snapshot + live = raw;
   - Schedule III profit = management profit;
   - cash-flow net = change in cash;
   - open items = control-account GL per party.
9. **Concurrency:**
   - 50 parallel posts of one event → 1 journal + 49 replays;
   - post vs soft-close race;
   - 20 parallel journals → no gaps in numbering;
   - 2 cash payments exceeding the balance → one NEGATIVE_CASH;
   - approve vs cancel race → 412.
10. **Database triggers:**
    - UPDATE / DELETE on gl_entries fails;
    - editing the lines of a posted journal fails;
    - an unbalanced insert fails at COMMIT.
11. **Schema:** fields and tabs of the 13 pages equal the registry.
- 3 clean runs.

## 11. Acceptance
- [ ] All 13 pages work with real units, banks and FY. COA Validation is green.
- [ ] Per-GSTIN GST ledgers exist. Every key resolves for every unit (or is a listed deliberate gap).
- [ ] The posting contract is copied into docs/phases/PHASE-07-POSTING-CONTRACT.md. DECISIONS records
      P7-D1 and the 5 fixes.
- [ ] Trial balance balances per unit and consolidated. Assets = Equity + Liabilities (incl. current profit).
- [ ] Reversal, approval and year-end close work. Exports work. 3 clean runs.

## 12. Out of scope
| Item | Owner |
|---|---|
| AP, supplier invoices, debit notes | Phase 9 |
| AR, receipts, credit notes, ageing | Phase 10 |
| GST returns, TDS register, e-invoice | Phase 11 |
| Expense claims | Phase 15 |
| Depreciation | Phase 14 |
| Payroll journal | Phase 16 |
| Opening balance import | Phase 20 |
| Multi-currency (INR only; others → CURRENCY_NOT_SUPPORTED), Ind AS, recurring journals | Not in v1 |

## 13. Owner manual check
1. Chart of Accounts → Account Tree: do Assets / Liabilities / Equity / Income / Expenses appear, with
   one Output CGST ledger per GSTIN?
2. Create a journal with "I paid money": Rent ₹10,000 from bank, cost centre Admin. Does Difference
   show ₹0.00 before Post is enabled?
3. A journal above the threshold: does it show Pending Approval, and can a second user approve it?
4. Cancel it with a reason: do two vouchers show in the GL, and is Rent back to its old figure?
5. Trial Balance for TAL, then All: is Debit = Credit in both?
6. Click a P&L figure: does it open the ledger lines and then the voucher?
7. Soft-close last month and post into it as a normal user: is it refused with a plain message?
8. **Have your accountant check** the Schedule III layout of the P&L and Balance Sheet.

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md, ERRATA.md, PHASE-07.md, then
docs/archive/plans/05b-FINANCE-TAX-DATABASE.md §5.0–5.8, 5.15–5.17; 05c §6.1, 7.1.1, 7.7; 05a §4.1.3;
docs/archive/plans/DECISIONS.md D-08, D-09, D-11, D-13; and the Phase 3 period/FY/numbering code and
Phase 5 ApprovalService AS ACTUALLY BUILT (read real names; never assume).
Order: migrations (hand-written, with the five 05b fixes) → packages/calc/finance + unit tests →
CoA / cost centre / profit centre services → PostingService (contract §5 exactly) + JournalService
with approval → cash/bank → budget → reports → close → bank reco → UI pages (index.html look) →
tests §10.
Rules: routes→controller→service→repository; Decimal only; posted rows never updated (triggers);
cancel = reversal; every journal balances per unit; GST ledgers only from real GSTINs; no demo data.
STOP and ask before: applying any migration; setting fin.journal_approval_threshold; or if a Phase
3/5/6 table or service is missing.
Write PHASE-07-REPORT.md: migrations, endpoints, test counts for 3 runs, the property-test seed,
open questions. Never push; commit only if asked.
                                