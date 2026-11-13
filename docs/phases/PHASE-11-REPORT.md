# PHASE-11 REPORT — Indian Taxation

Built 2026-11-08. Local only: nothing pushed, nothing deployed, nothing committed. Migrations applied to `rhai_erp` (dev) and `rhai_erp_test`.

## 0. How the spec was defined (read this first)
`docs/phases/PHASE-11.md` is a hand-over list (A1–A10) from Phase 7. You chose: **all 10 items**, **monthly filing**, and for the open question "do the three units share one GSTIN?" you answered **not sure**. So the code does not assume: every return is prepared **per unit, from that unit's own GSTIN** (Unit Master). If two units later share one GSTIN, they still file separately here until you tell me otherwise (see §3, item 1).

R-12 holds everywhere: the app never calls GSTN, the e-invoice portal (IRP), the e-way bill portal or TRACES. It writes files for a person to upload and records the numbers the person types back.

## 1. What was built
| # | Item | Result |
|---|---|---|
| A1 | GST setup `tax-gst` | The Phase 6 master now has **filing frequency** (MONTHLY / QRMP) per registration. Statutory numbers live in **Tax Rules** (`tax_rules`, dated, all `needs_review`): due days, interest, late fee, 180 days, e-invoice 30 days / 24 hours, e-way km per day, extension window, TDS deposit day and interest, GSTR-1 JSON version. API `GET/PATCH /tax/rules`. |
| feed | Sales and purchase documents → tax register | Posting a **sales invoice, credit note, purchase invoice or supplier debit note** now also writes `tax_documents` and lines (with the unit's GSTIN, the original invoice of a note, and the supplier's own invoice number). Cancelling a document cancels its rows. Nothing is computed: the posted figures are copied. |
| A2 | GSTR-1 `tax-gstr1` | B2B, B2CL, B2CS (by place of supply and rate), CDNR/CDNUR, exports, HSN summary (credit notes subtract), document summary with cancelled counts. Checks: HSN missing or shorter than the registration asks, number longer than 16 characters, bad characters, wrong customer GSTIN, CGST/SGST on an inter-state supply or IGST on an intra-state one, a note with no original invoice, B2B without IRN when the registration is e-invoice enabled. **Download JSON** for the offline tool (blocked while any error remains). |
| A3 | GSTR-3B `tax-gstr3b` | 3.1(a) taxable (invoices less notes), 3.1(c) nil, 3.1(d) reverse charge, 3.2 inter-state to unregistered, 4A(3) and 4A(5) ITC, 4B reversals, 4C net, 4D ineligible 17(5), 5.1 interest and late fee, 6.1 tax payable with the **ITC set-off** and cash. Checks the output tax against the GL accounts 2301–2303. |
| A4 | GSTR-2B import and ITC | Upload the portal JSON (or a flat list). Each line is **matched / different amount / in 2B but not in books**; books invoices not in 2B are listed and marked MISSING. ITC the portal marks "not available" is shown. The return warns when ITC is claimed on invoices that are not in 2B. **Manual ITC reversal** (rule 37A, section 17(5), other) posts Dr 6272 or 6269 / Cr Input GST. The 180-day list shows invoices near the line. `itc_reversals` was only ALTERed (E-23). |
| A5 | E-invoice `tax-einvoice` | Pending list (B2B, posted, no IRN) with the late flag; **request JSON (IRP schema 1.1)** that lists what is missing instead of inventing it (buyer address, HSN, pincode); type-in of IRN, Ack no., Ack date; late-reporting warning; **cancel only inside the 24-hour window**; the IRN is stored on the invoice. |
| A6 | E-way bill `tax-eway` | Invoices above the value limit without a bill; request JSON (Part A/B); type-in of the 12-digit number; **validity by distance** (one day per started 200 km, to midnight India time); extension only in the window around expiry; cancel. |
| A7 | TDS / TCS returns | Quarter data (26Q / 27EQ style): deductee, PAN, section, challan, **interest on late deposit**, errors for a missing PAN or TAN; challan-to-entry map with the difference; deductee / section / quarter summaries; **lower-deduction certificates** (the rate at deduction now honours a valid certificate); the **deductor TAN** is entered by you in Tax Rules. |
| A8 | Registers | Excel export of the sales, purchase, TDS and TCS registers. |
| A9 | GST settlement | `Tax Settlement` journal: Dr output tax, Cr input credit per the set-off order, Cr bank for the cash part, Dr "GST Interest and Late Fee" (6254) for interest and late fee. One settlement per GSTIN and month; cancel reverses it (refused once the 3B is filed). |
| A10 | GST-period lock | **Marking a return filed locks the month**: a taxable document of that GSTIN and month cannot be posted or cancelled (`GST_PERIOD_FILED`). GSTR-1 locks outward documents, GSTR-3B locks everything. |

## 2. Migrations and other changes
`20261121000000_phase11_a_gst_returns` (filing frequency; `tax_rules` + seeds; `gst_returns`; `tax_documents` extra columns; `gstr2b_imports/lines`; `itc_reversals` kinds; `einvoice_records`; `eway_bills`; `lower_deduction_certs`; `gst_settlements`), `…010000_phase11_b_taxdoc_ref`, `…020000_phase11_c_tan`. New code: `apps/api/src/modules/tax/*` (feed, period-lock, returns, 2B/ITC, e-invoice and e-way, settlement, TDS and exports, routes `/api/v1/tax`). Web: `pages/tax/GstPages.tsx`, wired in `ModulePage.tsx`.

**Changed on purpose, outside the tax folder**
* **Invoice and credit-note numbers are shorter now.** GST rule 46 allows 16 characters. Phase 10 numbered invoices `INV/TAL/26-27/0001` (18) and credit notes `CN-SRT/TAL/26-27/0001` (21): GSTR-1 would have refused every one. Now: invoice `TAL/26-27/0001` (14), credit note `CNTAL/26-27/0001` (16). A unit code longer than 3 characters would break this again; GSTR-1 reports it as an error. Invoices already created in a test or dev database keep their old number.
* Phase 9 TDS rate selection also looks at the new lower-deduction certificates.
* `PostingService` is untouched; `taxService.cancelForJournal` now checks the filing lock.

## 3. Deviations and things you must decide
1. **Shared GSTIN (E-31) is still open.** Everything is per unit. If the three units share one GSTIN you want a single return across units; tell me and I will merge by GSTIN (the data already carries the GSTIN on every document).
2. **Statutory numbers are data, none are signed off.** The seeded values (due day 11 and 20, interest 18 % a year, late fee 50 / 20 a day, 180 days, e-invoice 30 days, e-way 200 km a day, TDS interest 1 % / 1.5 %, deposit day 7, B2CL limit 1,00,000) are what I know from the law; your accountant must confirm each and untick *needs review*. Late fee caps and the March TDS deposit exception are **not coded**.
3. **GSTR-1 file format.** I searched for the current offline-tool schema; no official schema page was found, so the JSON follows the field names the tool uses (b2b / inv / itms / itm_det, DD-MM-YYYY, period MMYYYY). The version string is a Tax Rule. **Try one real file in the offline tool before relying on it.**
4. **ITC claim basis.** The 3B takes ITC from the books. When a GSTR-2B is imported it warns about invoices not in 2B but does not remove them; whether to claim them is the accountant's call.
5. **Credit ledger = the balance of accounts 1401–1403** at month end (earlier unused credit carries forward). The set-off order is the standard one (IGST first). Negative net output (notes bigger than sales) is treated as zero liability in the settlement.
6. **Settlement posts one journal** (no separate Cash Ledger step through account 1415).
7. **TDS late-deduction interest is not computed**: the register stores the deduction date only, not the date the tax became deductible. Late deposit interest is computed.
8. **Not built:** PDF export of the registers (Excel only), FVU / TRACES file format for TDS (the app produces return data, not the FVU), SEZ / export invoices on GSTR-1 beyond a basic section, amendments (B2BA), GSTR-9, QRMP monthly PMT-06 helper (frequency is stored; the screens work month by month), reopening a filed return.
9. **Old tests** are unchanged except the web `Sales` and API Phase 10 expectations about number shape: none relied on it.

## 4. Test results
RESULTS_PLACEHOLDER

## 5. Known issues
* e2e `auth.spec.ts` test 6 fails exactly as in the Phase 8–10 reports (old role label); Phase 11 runs after it and passes.
* The browser test only opens the pages. The money, lock and return figures are proved by `apps/api/tests/phase11-tax.test.ts` (settlement: output 117 + 117, ITC 90 + 90, bank 54; GSTR-1 file values; filing lock; 2B match; IRN and e-way recording; TDS return).
* Repo-wide `npm run lint` still reports the old errors outside Phases 9–11.

## 6. Manual check list for the owner
1. **Unit Master**: the unit has its GSTIN, city and pincode. **GST Setup**: filing frequency Monthly.
2. **Tax Rules** (API `GET /tax/rules`; screen not built): your accountant confirms each row; enter the **TAN** (`DEDUCTOR_TAN`).
3. Post a sales invoice to a registered customer and one to an unregistered one, a credit note, a purchase invoice. **Sales Register** and **Purchase Register** show them; *Export to Excel* works.
4. **GSTR-1**: pick the month. Read the checks. Download the JSON and open it in the GST offline tool.
5. **GSTR-3B**: compare 3.1, 4 and 6.1 with your own working. Open *GSTR-2B & ITC*, upload the portal's 2B file, read the matches.
6. *Settlement* tab: choose the bank and the challan number, post. Check **Trial Balance**: output GST accounts clear, input credit used, bank paid.
7. Mark the GSTR-1 filed with a test ARN, then try to cancel an invoice of that month: it must refuse.
8. **E-Invoice**: *Download request JSON*, then *Enter IRN* with a 64-character value. **E-Way Bill**: same with a 12-digit number and a distance.
9. **TDS**: the quarter data, the challan map, a lower-deduction certificate.
