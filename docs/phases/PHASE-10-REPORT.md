# PHASE-10 REPORT — CRM & Sales

Built 2026-11-08. Local only: nothing pushed, nothing deployed, nothing committed. Migrations applied to `rhai_erp` (dev) and `rhai_erp_test`.

## 0. How the spec was defined (read this first)
`docs/phases/PHASE-10.md` holds only the 5 client requirements. You chose: **follow archive plan 04 (CRM & Sales) adapted to today's rules, plus the 5 client requirements**, and review Phase 9 first. What was taken from the archive plan and what was changed is in §3. Anything the archive plan wanted that today's code already has (price lists, customers, receivables, reservations) is reused, not rebuilt.

## 1. What was built
| Area | Result |
|---|---|
| CRM | `crm-sources` (master), `crm-leads` (New → Contacted → Qualified → Converted / Unqualified, convert makes the opportunity), `crm-opportunities` + `crm-pipeline` (board, stage history, **stage gates**: Proposal needs a value, Negotiation needs a quotation, Won needs an accepted quotation, Lost needs a reason), `crm-followups` (close with an outcome), `crm-meetings` (held with an outcome), `crm-feedback` (score 0-10, NPS report, low scores need an action to close), `crm-customer360` data (`GET /crm/customers/:id/360`: credit, open orders, invoices, opportunities, feedback). |
| Client req. 1 | **Customer RFQ → internal review → quotation**: engineering says can / cannot be made, finance records the margin, only a *Reviewed* RFQ becomes a quotation; the quotation's price approval goes through the Phase 5 engine (submit → approve). |
| Client req. 2 | **Customer-wise quotation**: price from the Phase 6 price lists (customer list → customer's list → group → company default) or typed; the quotation stores a `format_code` and per-line `cost_breakup`; margin is computed from the cost the sales person enters. The cost formulas themselves belong to the Phase 6B rule sets and are **not** in code. |
| Quotation / order | revisions (snapshot kept), customer decision (accepted / rejected), expiry check, one live order per quotation; **credit limit check on submit** (unpaid invoices net of advances and credit notes + undelivered open orders + this order; message with the amounts); manager `credit-override` with a reason (cleared when the order is edited); duplicate customer PO number refused; short-close (also releases the reservations). |
| Reservation | `POST /sales/orders/:id/reserve` uses the Phase 8 reservation service (priority, warehouse); dispatch consumes it. |
| Client req. 3 | **Dispatch** with vehicle / transporter / LR no / inspection serial per line; posting takes stock out (FEFO, batch, serial through StockService) and books **Dr COGS / Cr Inventory** at the average cost; **delivery challan PDF** (`GET /sales/dispatch/:id/challan.pdf`, numbered `DC/<unit>/<fy>/n`); **daily dispatch list** (`GET /sales/dispatch-list?date=`: PO no, part no, description, colour, qty, remark / inspection serial). Cancel = reversal of stock and journal (refused once invoiced or returned). |
| Invoice | from a posted dispatch (partial invoicing allowed): **Dr AR / Cr Sales / Cr Output CGST+SGST or IGST / round-off**, due date from the customer's credit days. |
| Collections | `sales_receipts` (D-04: customer receipts are built here; Phase 7 had none): **Dr bank or cash / Cr AR**, allocated to invoices through the Phase 7 open-item service; worklist with days overdue and age bucket. |
| Returns | against a posted invoice: restock **at the original dispatch cost** (D-07; Quality-Inspection items go to Quality Inspection), **Dr Inventory / Cr COGS** and the **credit note** (Dr Sales returns + output GST / Cr AR), settled against the invoice. |
| Client req. 4 | Pre-dispatch inspection is a Phase 12 form: `sales_dispatch_lines.inspection_serial` is the link column (typed on the dispatch, shown on the dispatch list). |
| Client req. 5 | **Demand planning**: `GET /sales/demand-plan` = confirmed order balance by delivery month + independent `demand_forecasts` (`GET/POST /sales/forecasts`): the feed for MRP in Phase 13. |
| Credit view | `GET /sales/credit/overview` (limit, unpaid, on order, exposure, available, over-limit flag). |
| Web | all 18 pages: leads, opportunities, pipeline board, follow-ups, meetings, feedback, sources, quotations (+ Customer RFQ tab), orders, reservations (Phase 8 screen), delivery scheduling (demand plan), dispatch (with Print challan), invoices, collections (Receive payment with mode), credit limits, returns; `crm-customer360` keeps the Phase 6 customer master. |

## 2. Migrations and DB changes
`20261120000000_phase10_a_crm` (lead_sources, leads, opportunities, opportunity_stage_history, crm_followups, crm_meetings, crm_feedback, demand_forecasts), `…020000_phase10_c_presales_orders` (customer_rfqs + lines, sales_quotations + lines + revisions, sales_orders + lines), `…030000_phase10_d_fulfilment_billing` (sales_dispatches + lines, sales_invoices + lines, sales_receipts + allocations, sales_returns + lines; stock voucher types DISPATCH and SALES_RETURN). Hand-written, forward-only. **There is no "B" migration on purpose**: the archive plan's price-list tables already exist from Phase 6 (`price_lists`, `price_list_items`, customer lists, `PriceService.lookup`), so they were reused. Other code touched: `LedgerVoucherType` (+2), `DOC_PREFIX` (+12 series), `ErrorCode` (+2), shared `procurement/crud.ts` and `core.ts` (non-approval records: `draftStatus`, `canEdit`, customer join, unique violations answer 409).

## 3. Deviations and things you must decide
1. **E-invoice / e-way bill / IRN** are Phase 11. The invoice has an `irn` column that stays empty; the archive plan's gateway is not built.
2. **Invoice numbers are given when the draft is created**, not at posting (archive D-02 says at post).
3. **Credit exposure is company-wide** (all units), as archive Q-09 proposed; the unit's open orders and all unpaid invoices of the customer count. There is no separate "credit hold" document: an over-limit order is refused at submit and a manager can override it with a reason (`approve` on `sales-credit`).
4. **TDS deducted by customers** (archive Q-08) is not modelled.
5. **Sales UOM**: order lines convert to the stock base unit when dispatched (`UomService`); counters on the order stay in the order unit.
6. **Pricing**: if no price list price exists, the person types the rate (an order line without a rate is refused). **GST %**: from the line, else from the HSN rate table; if neither exists the screen asks (never guessed). A quotation made from an RFQ asks for the GST % once.
7. **Customer-wise quotation format** (Phase 6B formats) is stored as a code; the format *engine* is not called from the quotation yet. The cost breakup of a quotation line is stored as typed.
8. **Not built** (archive items outside this session's agreed scope): marketing consent / campaigns, lead scoring rules, duplicate-lead detection, price-approval matrices by discount / margin (the standard Phase 5 amount-based approval is used), pick / pack, delivery plans with load planning, collection promises and dunning actions, customer portal. `sales-pricelist` keeps its Phase 6 master screen. The Customer 360 web tabs are the Phase 6 customer master; the 360 numbers are available through the API.
9. **Old tests** that used the then-generic page `crm-leads` as their sample now use the still-generic page `service-tickets` (`App`, `GenericModulePage`, kit, `ContextSelectors`, `Settings` tests and the shared fixture). The logic they test is unchanged.
10. **Code review (`/code-review medium`) found 10 problems, all fixed**: the credit-note round-off sign (a return with round-off could not post), `rating` / `probability` sent as text, dispatch ignoring the order-line unit, an invoice or return posting after its parent was cancelled, duplicate or over-allocated receipt lines, a credit note not reducing the invoice's open amount, a double click on *Make quotation*, short-close leaving stock reserved and the credit override surviving an edit, the cash/cheque/UPI receipt mode, lead conversion in two transactions.

## 4. Test results
| Suite | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| API `npx vitest run` (clean test DB each run, 70 files + 2 skipped) | 995 pass / 45 skipped | 995 / 45 | 995 / 45 |
| Phase 10 API file `phase10-sales.test.ts` (5 tests: CRM gates, full quote-to-cash with ledger numbers, rounding return, double click, 401 on 19 read routes) | pass | pass | pass |
| Web `npx vitest run` (45 files; +7 Phase 10 tests) | 379 pass / 29 skipped | 379 / 29 | 379 / 29 |
| e2e `auth.spec` + `phase9.spec` + `phase10.spec` (Phase 10: 2 stories covering 15 pages) | 2 / 2 | 2 / 2 | 2 / 2 |

The ledger numbers proved by the API test: order 10 × 100 + 18 % → invoice 1,180 (Receivable 1,180, Sales 1,000, Output CGST 90, SGST 90); dispatch cost 10 × 60 = 600 (COGS 600); receipt 1,000 → invoice PARTIAL, 180 outstanding; return of 2 → credit note 236, stock back at cost 60, COGS 480, Sales returns 200, the invoice PAID (1,000 received + 180 credit), the unit's debits equal credits; a rupee-rounded return (39.33 → 39) posts a balanced credit note. Also: RFQ cannot be quoted before both reviews; credit limit 1,00,000 refused a 2,00,000 order until a manager override; dispatch of more than the open quantity is refused; an already invoiced dispatch cannot be cancelled; a second invoice of a fully invoiced dispatch is refused; opportunity stage gates.


## 5. Known issues
* e2e `auth.spec.ts` test 6 fails exactly as in the Phase 8 and 9 reports (old role label); Phase 10 stories run after it and pass.
* The browser (Playwright) test is a smoke test of the 15 pages and two dialogs. The money / stock / ledger chain is proved by the API test `phase10-sales.test.ts`.
* Repo-wide `npm run lint` still reports the old errors outside Phases 9-10; every Phase 10 file is eslint / prettier clean.
* `scm-*` and `crm-*`/`sales-*` generic record APIs (`/pages/<id>/records`) still exist but the web no longer uses them for these pages.

## 6. Manual check list for the owner (5–15 clicks)
1. **Lead Management › New Lead** → open it → *Mark Qualified* → *Convert to opportunity*. **Sales Pipeline** shows the card in Prospecting; try moving it to *Won*: it refuses (no accepted quotation).
2. **Sales Quotations › Customer RFQs › New Customer RFQ** (customer, an item, qty, target rate) → *Engineering: can be made* → *Finance: check margin* → *Make quotation* (enter GST %). The RFQ becomes *Quoted*.
3. Open the quotation → Submit → (approver) → *Customer accepted* → *Make sales order* (type the customer PO number) → Submit. Does it say *Approved*?
4. Give the customer a small credit limit in Customer 360 and submit a bigger order: the message names the limit and the amounts; *Credit override* with a reason lets it through.
5. Order → *Reserve stock*. **Dispatch › New Dispatch** → pick the order → Save → Submit. Open it → **Print challan**. **Trial Balance**: COGS and stock moved by the cost.
6. **Sales Invoices › Invoice this dispatch** → Submit. Receivable = taxable + GST (round-off to the rupee).
7. **Collections › Receive payment** (mode and bank) → the invoice shows PARTIAL / PAID.
8. **Sales Returns**: pick the invoice, a warehouse, a quantity → Save → Submit. Stock comes back at the dispatch cost; the invoice's open amount drops by the credit note.
9. **Credit Limits** shows exposure against the limit. **Delivery Scheduling** shows the open order balance by month.
10. API: `GET /sales/dispatch-list?date=…` for the daily dispatch list.
