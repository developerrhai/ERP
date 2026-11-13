# PHASE 06

# PHASE 06 — Shared business masters
(Read ERRATA.md first: E-05 validators and gst_states come from Phase 3, E-06 UOM, E-13 owner decisions.)

## 1. Goal & why
Build the company-wide masters that every later phase reads:
- customers and suppliers;
- HSN/SAC codes and GST rates;
- payment terms, banks and price lists;
- item groups and item UOM conversions.

The existing Item master moves onto them: HSN becomes required and the GST rate comes from the HSN.
Phases 7, 9, 10, 11 and 13 cannot post a single document until these exist with valid GSTINs, state
codes, and a tax rate and price for any date. All statutory numbers are dated rows (R-11), checked
offline only (R-12).

**Ruling D-26 (approved by the architect):** customers and suppliers are two separate tables, not one
"parties" table. Reasons:
- different approval rules (supplier creation needs approval; for customers only a credit-limit
  increase does);
- different departments edit them;
- each table can enforce its own rules strictly.

If one firm is both a customer and a supplier, the rows are linked through customers.linked_supplier_id.

## 2. Pages in scope
| Page id | Title | Decision |
|---|---|---|
| crm-customer360 | Customer 360° → **Customer Master** | Becomes the typed Customer Master, keeping the approved page id and menu. Field mapping: Record No → Customer Code, Name → Customer Name, Customer Company → Legal Name, Owner → Sales Person, Priority → Tier. Stage, Next Action, Expected Value and Due Date are read-only and filled in Phase 10. **Owner must approve (E-13).** |
| scm-suppliers | Supplier Master | Typed. Tabs: Directory, Compliance Documents, Bank & Tax Details, Category. Performance and Risk stay read-only until Phases 9/12. |
| inv-items | Item / SKU Master | HSN becomes a required lookup; GST rate shown from the HSN; Item Group and a UOM Conversions grid added. |
| tax-hsn | HSN / SAC | Typed, with a "Rate Mapping" tab of dated rates. |
| admin-taxes | Taxes | Becomes the **GST rate (slab) master**. Its prototype fields already match: Tax Code, Name, Component, Rate %, Jurisdiction, HSN Scope, Effective From/To. |
| tax-gst | GST Setup | GST registrations of the units: GSTIN, legal name, state, type, e-invoice/e-way flags, minimum HSN digits. The Tax Rates tab is a read-only view. |
| sales-pricelist | Price Lists | Base only: header, rows, quantity slabs, dates. Promotions come in Phase 10. |
| sales-credit | Credit Limits | **Not built here.** Limit and credit days live on the customer; this page comes in Phase 10. |
| **NEW** admin-payment-terms | Payment Terms | **Owner must approve.** |
| **NEW** admin-banks | Banks | **Owner must approve.** |
| **NEW** admin-party-groups | Customer/Supplier Groups & Territories | One page, two tabs. **Owner must approve.** |

## 3. Business logic & research (rules adopted)
1. **GSTIN** has 15 characters:
   - positions 1–2: state code;
   - 3–12: the PAN;
   - 13: entity number (1–9 then A–Z);
   - 14: normally "Z";
   - 15: check character (Luhn mod 36 over 0–9A–Z).
   The algorithm is the GSTN system specification; reference implementation: python-stdnum gstin.py.
   We check format, checksum, a known state code, and the embedded PAN.
2. **PAN** is `^[A-Z]{5}[0-9]{4}[A-Z]$`. The 4th character is the holder type:
   P individual, C company, H HUF, F firm/LLP, A AOP, T trust, B BOI, L local authority,
   J artificial juridical person, G government. PAN's own check letter is not public, so it is not checked.
3. **State codes** come from the gst_states table built in Phase 3:
   - 01–38 (26 = merged DNH & DD; 25 retired; 38 Ladakh);
   - 96 other country, 97 other territory, 99 centre jurisdiction.
   Verify against the GST portal before go-live.
4. **Registration types:**
   - REGULAR, COMPOSITION and SEZ need a GSTIN.
   - UNREGISTERED and OVERSEAS have none. OVERSEAS uses state 96 and a non-India country.
   - A COMPOSITION supplier gives no ITC (flag used in Phase 9).
   - Supplies to an SEZ are always inter-state.
5. **HSN digits** (Notification 78/2020-CT):
   - turnover up to ₹5 cr → 4 digits on B2B invoices;
   - above ₹5 cr → 6 digits; e-invoices need 6.
   - gst_registrations.min_hsn_digits defaults to **6**, and an item's HSN must have at least that many.
6. **GST rates after the 56th GST Council meeting** (effective 22-Sep-2025, Notification 9/2025-CT(Rate)):
   - main slabs 0 / 5 / 18 %, plus 40 % for demerit goods; 0.25 % and 3 % remain;
   - the 12 % and 28 % slabs mostly end on 21-09-2025.
   - All slab rows are seeded with needs_review=true. **The CA verifies every slab and HSN mapping;
     the builder never decides a rate.**
7. **MSME suppliers:**
   - MSMED Act s.15: pay by the agreed day, at most 45 days (15 days with no written agreement).
   - s.16: compound interest at 3× the RBI bank rate on late payment.
   - The tax disallowance until paid (old s.43B(h), new Act s.37(2)(g)) applies to Micro and Small,
     not Medium, and not traders. Verify.
   - The supplier stores the Udyam number (`UDYAM-<2 letters>-<2 digits>-<7 digits>`), category,
     activity and agreed days (1–45).
   - Computed flag msme_45day_applies = (Micro or Small) and not Trading.
8. **Designs copied from other ERPs:**
   - ERPNext: separate Customer and Supplier, Group, Territory, Payment Terms Template whose rows
     must total 100 %.
   - Odoo: price-list rules with minimum quantity and date range.
   - Tally: credit period and MSME details on the ledger.
9. **Place of supply:**
   - Goods (IGST Act s.10): where the movement ends (the ship-to). In a bill-to/ship-to case, the
     bill-to party's place.
   - B2B services (s.12(2)): the recipient's location.
   - Same state as the supplier unit → CGST + SGST; otherwise IGST.
10. **Approvals (R-06):**
    - A **new supplier needs approval.**
    - **Raising a customer credit limit needs approval**; lowering it applies at once.
    - A new customer needs no approval by default (setting customer_create_needs_approval = false).
    - A changed supplier bank account must be verified by a **second person** before it is used for payment.

## 4. Database design
Every table has the standard columns: uuid, audit columns, version, deleted_at. No company_id.
Migrations, in this order:
1. `_phase06_tax_masters`: gst_registrations, gst_rates, hsn_sac_codes, hsn_sac_rates.
2. `_phase06_terms_banks_groups`: payment_terms, payment_term_lines, banks, party_groups, territories.
3. `_phase06_customers`: customers, customer_addresses, customer_contacts, customer_credit_requests.
4. `_phase06_suppliers`: suppliers, supplier_addresses, supplier_contacts, supplier_bank_accounts,
   supplier_documents.
5. `_phase06_item_masters`: item_groups, item_uom_conversions, changes to items.
6. `_phase06_price_lists`: price_lists, price_list_items.
7. `_phase06_item_data_migration`: data only.

~~~sql
gst_registrations(unit_id fk, gstin varchar(15) unique, legal_name, trade_name, state_code fk gst_states,
  registration_type CHECK IN('REGULAR','COMPOSITION','SEZ'), effective_from, einvoice_enabled,
  eway_enabled, min_hsn_digits smallint default 6 CHECK IN(4,6,8), status)
gst_rates(code unique, name, kind CHECK IN('TAXABLE','NIL','EXEMPT','NON_GST'), igst_pct numeric(7,4),
  cgst_pct GENERATED (igst_pct/2) STORED, sgst_pct same, effective_from, effective_to,
  needs_review default true, status)
hsn_sac_codes(code varchar(8) unique CHECK ~'^([0-9]{4}|[0-9]{6}|[0-9]{8})$', description,
  is_service GENERATED (code LIKE '99%') STORED, default_uqc, needs_review, status)
hsn_sac_rates(hsn_id, gst_rate_id, cess_pct default 0, condition_note null, effective_from,
  effective_to null, unique(hsn_id, effective_from, condition_note))   -- no-overlap checked in service
payment_terms(code unique, name, description, status)
payment_term_lines(payment_term_id cascade, line_no, portion_pct >0,
  due_basis CHECK IN('ADVANCE','INVOICE_DATE','END_OF_INVOICE_MONTH','RECEIPT_OF_GOODS'),
  days 0..365, discount_pct default 0, discount_days default 0)          -- Σ portion = 100 in service
banks(code char(4) unique /* IFSC first 4 */, name, status)
party_groups(kind CHECK IN('CUSTOMER','SUPPLIER'), code, name, parent_id, default_payment_term_id,
  default_price_list_id, control_account_key null, unique(kind,code))
territories(code unique, name, parent_id, state_code null)
customers(code CUS/00001 or ^[A-Z0-9/_-]{2,30}$, name, legal_name, name_key (normalised, gin trgm),
  customer_group_id, territory_id, sales_person_id, gst_registration_type
  CHECK IN('REGULAR','COMPOSITION','UNREGISTERED','SEZ','OVERSEAS'), gstin null, pan null,
  state_code fk, gstin_verified_on_portal default false, gstin_verified_by_id, gstin_verified_at,
  currency_code default 'INR', payment_term_id, price_list_id null, credit_limit numeric(18,2) null >=0
  (null = no limit, 0 = cash only), credit_days null, tier char(1) default 'C', linked_supplier_id,
  ar_account_id null (Phase 7 hook), approval_status default 'APPROVED', status)
  UNIQUE(gstin) WHERE gstin IS NOT NULL AND deleted_at IS NULL; INDEX(pan)
  CHECK (gst_registration_type IN('UNREGISTERED','OVERSEAS') = (gstin IS NULL))
  CHECK (gstin IS NULL OR pan IS NULL OR substr(gstin,3,10)=pan)
customer_addresses(customer_id, type BILLING|SHIPPING, label, line1, line2, city, district, pincode,
  state_code, country default 'India', gstin null, is_default)
customer_contacts(customer_id, name, designation, mobile, email, is_primary)
customer_credit_requests(customer_id, old/new limit, old/new days, reason, approval_request_id, status)
suppliers(code SUP/00001, name, legal_name, name_key, supplier_group_id, gst_registration_type, gstin,
  pan, state_code, portal-verified fields, currency_code, payment_term_id,
  msme_udyam_no CHECK ~'^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$', msme_category MICRO|SMALL|MEDIUM,
  msme_activity MANUFACTURING|SERVICES|TRADING, msme_agreed_days 1..45, msme_45day_applies GENERATED,
  CHECK((msme_udyam_no IS NULL)=(msme_category IS NULL)), tds_section_code null (Phase 9),
  lower_tds_cert_no, lower_tds_rate, lower_tds_valid_to, purchase_hold default false, hold_reason,
  ap_account_id null (Phase 7 hook), approval_status default 'PENDING', status)
  + same GSTIN/PAN checks and indexes as customers
supplier_addresses, supplier_contacts   -- same shape as customers
supplier_bank_accounts(supplier_id, bank_id, ifsc CHECK ~'^[A-Z]{4}0[A-Z0-9]{6}$', holder_name,
  account_no_enc (AES-GCM), account_last4, account_hash (HMAC), is_default, changed_by_id, changed_at,
  verified_by_id null, verified_at, CHECK (verified_by_id IS NULL OR verified_by_id <> changed_by_id))
supplier_documents(supplier_id, doc_kind GST_CERT|PAN|UDYAM|CANCELLED_CHEQUE|LOWER_TDS|ISO|OTHER,
  doc_no, valid_from, valid_to, document_id → Phase 4)
item_groups(code unique, name, parent_id, default_hsn_id, status)
item_uom_conversions(item_id, uom_code fk uoms(code), factor numeric(18,6) >0, unique(item_id,uom_code))
ALTER items ADD item_group_id, hsn_id fk hsn_sac_codes, gst_rate_override_id, gst_override_reason,
  CONSTRAINT items_hsn_required CHECK (hsn_id IS NOT NULL) NOT VALID;
price_lists(code unique, name, kind SELLING|BUYING, currency_code default 'INR', customer_id null,
  supplier_id null, customer_group_id null, price_includes_tax default false, valid_from, valid_to,
  is_default, status, UNIQUE(kind,currency_code) WHERE is_default AND ACTIVE)
price_list_items(price_list_id cascade, item_id, uom_code, min_qty default 0, rate numeric(18,6) >=0,
  discount_pct default 0, valid_from, valid_to, unique(price_list_id,item_id,uom_code,min_qty,valid_from))
~~~

**Item data migration:**
1. For each distinct items.hsn_sac, insert an HSN row if missing (description "Imported from item
   master — please describe", needs_review) and set hsn_id.
2. For each distinct category, create an item group and set item_group_id. Keep category as a
   deprecated mirror.
3. Copy alt_uom/alt_uom_factor into item_uom_conversions. The old columns are dropped in Phase 8.
4. Items without an HSN appear in a "Missing HSN" filter. **VALIDATE CONSTRAINT runs in Phase 8, once
   that count is 0.** From now on, creating or editing an item without an HSN is refused.
5. **Seeds:** states (from Phase 3), slabs, a starter HSN list (needs_review), payment terms IMMEDIATE /
   NET30 / NET45, and bank codes. No demo parties.

## 5. Services & algorithms
**gstinCheckChar(first14):**
- Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".
- For i = 0..13: v = index of the character; factor = 1 when i is even, 2 when odd;
  p = v × factor; add floor(p/36) + p%36 to the sum.
- Check character = alphabet[(36 − sum%36) % 36].
- Worked example, "27AAPFU0939F1Z": the terms are 2,14,10,20,25,30,30,0,9,6,9,30,1,35; sum = 221;
  221 mod 36 = 5; 36 − 5 = 31 → **V**. So 27AAPFU0939F1ZV is valid.

**validateGstin:**
- Remove spaces and uppercase.
- Check in order: length 15 → regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` → state code
  exists → embedded PAN valid → checksum.
- Returns {ok, code, stateCode, pan}.

**Consistency rules:**
- pan = gstin[2..11].
- Header state = gstin[0..1].
- An address GSTIN must have the same PAN and its own state.
- When a GSTIN is entered and the PAN is blank, fill the PAN from the GSTIN.

**normaliseName:** lowercase, then drop m/s, messrs, pvt, private, ltd, limited, llp, &, and, co,
punctuation, and repeated spaces.

**DuplicateService.check → [{level, field, message, matchId}]:**
| Match | Level |
|---|---|
| Same GSTIN in the same table | BLOCK |
| Same GSTIN in the other table | INFO (offer link) |
| Same PAN | WARN |
| Name similarity ≥ 0.8 and same city | WARN |
| Same mobile or email | WARN |
| Bank account hash already used by another supplier | BLOCK (unless the user has approve) |

The UI asks the user to tick "This is a different party" for WARN items.

**placeOfSupply({kind, supplierState, shipToState, billToState, billToRegType}) → {posState, regime}:**
- SEZ → INTER.
- OVERSEAS → EXPORT.
- Goods → ship-to state (bill-to state in bill-to/ship-to cases).
- Services → bill-to state.

**GstRateService.rateFor(itemId, date):**
- The item's override first, otherwise the HSN rate row valid on that date.
- If several rows match by condition, return all and the caller chooses. None → NO_GST_RATE.

**PriceService.lookup({customerId, itemId, qty, uomCode, date}):**
1. Lists to try, in order: the customer-specific list → the customer's list → the group's default →
   the company default SELLING list. Only ACTIVE lists valid on the date count.
2. In the first list with rows for the item, take the row with the **largest min_qty ≤ qty** (qty
   converted through item_uom_conversions). A tie goes to the latest valid_from.
3. Net = rate × (1 − discount/100).
4. Otherwise fall back to items.selling_price (source ITEM_DEFAULT).
5. Returns {rate, discountPct, net, source, priceListId, rowId}. BUYING lists work the same way by supplier.

**PaymentTermService.schedule(termId, invoiceDate, receiptDate?):** returns the instalments; the
rounding remainder goes to the last one.

## 6. API (/api/v1, {data,meta}, ETag/If-Match, Idempotency-Key on POST; modules/masters/<entity>/)
- **Customers:**
  - GET|POST /customers; GET|PATCH|DELETE /customers/:id; POST /customers/:id/activate|deactivate
  - /customers/:id/addresses, /customers/:id/contacts
  - POST /customers/:id/credit-requests
- **Suppliers:**
  - The same set as customers.
  - /suppliers/:id/bank-accounts; POST …/bank-accounts/:bid/verify
  - /suppliers/:id/documents
  - POST /suppliers/:id/submit (sends it to approval)
- **Duplicates:** POST /parties/check-duplicates {kind, gstin, pan, name, city, mobile, email, excludeId}
- **Offline decode:** GET /statutory/gstin/:gstin; GET /statutory/pan/:pan
- **Other masters:** /hsn-sac, /hsn-sac/:id/rates, /gst-rates, /gst-registrations, /payment-terms,
  /banks, /party-groups, /territories, /item-groups, /items/:id/uom-conversions, /price-lists,
  /price-lists/:id/items
- **Lookups for forms:**
  - GET /pricing/lookup?customerId&itemId&qty&uom&date
  - GET /tax/rate?itemId&date
  - GET /lookups/customers|suppliers|hsn|gst-rates|payment-terms|price-lists|item-groups|banks?q=
    → each returns id, code, name and a hint.

## 7. UI & user flow (index.html look)
**Customer:**
1. Type the name, then the GSTIN.
2. When you leave the GSTIN field it is decoded: State, PAN and type REGULAR fill in, with the chip
   "GSTIN format OK — not checked on portal".
3. Possible duplicates show inline.
4. Choosing the Group fills in the payment terms and price list.
5. Grids: Addresses (Billing/Shipping, state picked by name) and Contacts.
6. Credit tab: shows the current limit, with a "Request change" dialog that creates an approval.
7. A manual "Verified on GST portal" tick records who and when.

**Supplier:** the same, plus:
- Udyam number with category and activity. An amber banner says
  "MSME Micro/Small — must be paid within N days (max 45)".
- Bank tab: the account number is typed twice, only the last 4 digits show, and the badge
  "Awaiting second-person verification" stays until verified.
- Documents tab with expiry dates.
- A new supplier is "Pending approval" with a Submit button, and cannot be used on purchase documents
  until approved.

**Item:**
- HSN is a searchable lookup.
- The GST rate shows read-only, e.g. "18 % from 22-09-2025".
- "Rate override" requires a reason.
- Item Group and UOM Conversions grids; a "Missing HSN" filter.

**HSN page:** rate history timeline. Adding a new rate ends the open one the day before.

**Price list:** item grid with quantity slabs, plus a "Test price" box (customer, item, qty, date) that
shows the result and its source.

Users never type state, bank or UOM codes; they pick them by name.

## 8. Exact messages
| Code | Field | Message |
|---|---|---|
| GSTIN_LENGTH | gstin | "GSTIN must be exactly 15 characters." |
| GSTIN_FORMAT | gstin | "GSTIN format is wrong. Example: 27AAPFU0939F1ZV." |
| GSTIN_STATE | gstin | "The first two digits are not a valid GST state code." |
| GSTIN_CHECKSUM | gstin | "This GSTIN has a typing mistake (last character does not match). Please re-check." |
| GSTIN_PAN_MISMATCH | pan | "PAN must match characters 3–12 of the GSTIN ({pan})." |
| GSTIN_STATE_MISMATCH | stateCode | "State must be {state} because the GSTIN starts with {code}." |
| GSTIN_REQUIRED | gstin | "Enter the GSTIN for a Regular, Composition or SEZ party." |
| GSTIN_NOT_ALLOWED | gstin | "Remove the GSTIN or change the registration type — Unregistered/Overseas parties have none." |
| GSTIN_DUPLICATE | gstin | "Customer {code} – {name} already has this GSTIN." |
| PAN_FORMAT | pan | "PAN must be 5 letters, 4 digits, 1 letter (e.g. AAPFU0939F)." |
| UDYAM_FORMAT | msmeUdyamNo | "Udyam number looks like UDYAM-MH-26-0012345." |
| MSME_DAYS | msmeAgreedDays | "Agreed days for an MSME supplier must be between 1 and 45." |
| IFSC_FORMAT | ifsc | "IFSC is 11 characters: 4 letters, 0, then 6 letters/digits." |
| ACCOUNT_CONFIRM | accountNo | "The two account numbers do not match." |
| BANK_SELF_VERIFY | — | "Another user must verify a bank account you changed." |
| BANK_DUPLICATE | accountNo | "This bank account belongs to supplier {code}. Ask an approver." |
| HSN_REQUIRED | hsn | "Choose the HSN/SAC code for this item." |
| HSN_DIGITS | hsn | "Use at least {n} digits of HSN (your turnover rule)." |
| NO_GST_RATE | hsn | "No GST rate is set for HSN {code} on {date}. Ask accounts to add one." |
| RATE_OVERLAP | effectiveFrom | "This date overlaps the rate valid {from}–{to}." |
| TERMS_SUM | lines | "Instalment percentages must add up to 100 % (now {sum} %)." |
| PRICE_DATES | validTo | "Valid To must be on or after Valid From." |
| CREDIT_PENDING | creditLimit | "A credit-limit change is already waiting for approval." |
| SUPPLIER_NOT_APPROVED | supplier | "Supplier {code} is not approved yet." |
| DUP_WARN | — | "Possible duplicate: {list}. Tick 'This is a different party' to continue." |

## 9. Audit
Every write records before/after, with bank numbers masked:
- CUSTOMER_CREATED / UPDATED / STATUS_CHANGED / DELETED / RESTORED
- CUSTOMER_CREDIT_REQUESTED, CUSTOMER_CREDIT_CHANGED
- SUPPLIER_* (the same set) plus SUPPLIER_SUBMITTED / APPROVED / REJECTED
- SUPPLIER_BANK_CHANGED, SUPPLIER_BANK_VERIFIED
- GSTIN_PORTAL_VERIFIED
- HSN_*, HSN_RATE_ADDED / ENDED, GST_RATE_*
- PAYMENT_TERM_*, BANK_*, PARTY_GROUP_*, ITEM_GROUP_*, ITEM_UOM_CONVERSION_*
- PRICE_LIST_*, PRICE_ROW_*
- DUPLICATE_OVERRIDDEN

## 10. Tests
- **GSTIN and PAN:**
  - valid 27AAPFU0939F1ZV;
  - checksum failure 27AAPFU0939F1ZO;
  - 14th character not Z;
  - length 14;
  - retired state 25;
  - lowercase input with spaces is normalised;
  - the sum of 221 checked step by step;
  - PAN valid AAPFU0939F; invalid AAPXU0939F and AAPF0939F1;
  - PAN/GSTIN mismatch.
- **Formats:** Udyam and IFSC.
- **normaliseName:** "M/s. Sawant Engg. Pvt. Ltd." → "sawant engg".
- **Place of supply:** intra, inter, SEZ, export, bill-to/ship-to.
- **Price lookup:**
  - slabs 0/100/500 with qty 99 / 100 / 1000;
  - an expired row is ignored;
  - the customer list beats the group list;
  - Box = 12 Nos conversion;
  - fallback to the item price.
- **Payment schedule:** 30/70 split with rounding.
- **GST rate:** 21-09-2025 vs 22-09-2025 across the slab change.
- **Integration:**
  - duplicate BLOCK and WARN;
  - verifying your own bank change is refused by the database;
  - a supplier cannot be used until approved;
  - a credit increase creates an approval and the limit is unchanged until approved; a decrease
    applies at once;
  - overlapping HSN rates refused;
  - an item without HSN refused;
  - item data migration on a copy of the old schema;
  - ETag 412; idempotent replay; department permissions.
- 3 clean runs.

## 11. Acceptance
- [ ] A non-expert can create a customer and a supplier using lookups only.
- [ ] 27AAPFU0939F1ZV decodes to Maharashtra and PAN AAPFU0939F.
- [ ] Every item has an HSN or appears under "Missing HSN".
- [ ] /tax/rate gives the correct dated rate; /pricing/lookup gives the right slab and source.
- [ ] Supplier approval and the two-person bank check work.
- [ ] The audit trail is complete. No demo parties are seeded. 3 clean runs.

## 12. Out of scope
| Item | Owner |
|---|---|
| Portal / live GSTIN search | Never (R-12) |
| e-invoice / e-way | Phase 11 |
| TDS sections and ledger | Phase 9 |
| GL accounts | Phase 7 |
| Credit exposure, sales-credit page, promotions | Phase 10 |
| Supplier scorecards | Phases 9 / 12 |
| Company bank accounts | Phase 7 |

## 13. Owner manual check
1. Approve the 3 new pages and the reuse of crm-customer360 (E-13).
2. **Ask your accountant to confirm:**
   - the GST slabs and HSN rates;
   - the state list;
   - minimum HSN digits = 6;
   - the MSME 45-day wording.
3. Confirm the approval policy: supplier creation needs approval; customer creation does not;
   credit increases do.
4. On screen: enter a real customer GSTIN. Does the page show the right state and PAN? Change one
   character. Does it say "typing mistake"?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md, ERRATA.md, PHASE-06.md, then
apps/api/prisma/schema.prisma, modules/inventory/items/*, packages/statutory (from Phase 3).
No company_id. Hand-written SQL migrations <ts>_phase06_* in the order of §4; Prisma models;
prisma generate; db:reset:test. routes→controller→service→repository. Statutory numbers only as
seeded rows with needs_review=true — never constants; never call a government portal. Reuse the
Phase 3 validators; add the §5 worked examples as tests. Exact §8 messages, §9 audit actions,
approvals via the Phase 5 ApprovalService (supplier create, credit raise). Bank numbers AES-GCM +
HMAC. Migrate items per §4.6 (CHECK NOT VALID; do not VALIDATE). Typed pages with the engine kit,
lookups everywhere, inline duplicate warnings. No demo data. Stop and ask if any statutory value,
page id or approval rule is unclear. 3 clean runs. Write PHASE-06-REPORT.md with DB changes.
Never push; commit only if asked.
~~~

---


---

## Client requirements (added 2026-11-06, from the client documents)
Structure only (R-14). Build these inside this phase's scope.
1. **Supplier type.** The supplier master has a type: MATERIAL (raw material, powder, hardware) or CONTRACTOR
   (service, outsourced labour / engineering). Lists, lookups and approvals can filter by type. (E-13 keeps
   customers and suppliers as two tables.)
2. **Customer profile extras.** Per customer: assigned price template, preferred document format reference
   (used by Phase 6B / 10), historical activity link (Customer 360 later).
3. **Item alternate codes.** An item can carry several codes (system code, alias, alternate), searchable in
   every lookup; plus base rate, part / batch reference. Powder colours are items of type "Powder".
   Base rates are data the client confirms, never seeded by us (R-13). **Ask the client to confirm the
   powder list before loading it** (duplicates and spelling variants exist in their sheets; two items have no rate).
4. **Supplier bank accounts** use the AES-GCM + HMAC rule already in §4; a vendor invoice sample shows the
   fields needed (bank, account, IFSC, branch).
5. Seed nothing from the client files. Provide an **Excel import** (Phase 4 wizard) for customers, suppliers, items.
