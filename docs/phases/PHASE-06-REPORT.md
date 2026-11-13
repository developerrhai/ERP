# Phase 06 Completion Report — Shared business masters (BACKEND COMPLETE, UI PENDING)

**Date**: 06-11-2026 (IST)
**Status**: Backend built and tested locally. **Web pages, the 3 new pages and the engine-kit typed pages are NOT built yet** (see §6). Not committed, not deployed.
**Spec**: `docs/phases/PHASE-06.md` + "Client requirements (added 2026-11-06)" in that file. Owner approvals recorded 06-11-2026: the 3 new pages and the Customer 360 reuse (E-13) approved; approval policy confirmed (supplier create = approval, customer create = none, credit increase = approval); GST data seeded from the spec's published values with `needs_review = true`.

## 1. What was built
| Area | Result |
|---|---|
| Migrations (7, hand-written, applied to `rhai_erp_test`) | `20261112000000_phase06_tax_masters`, `..010000_terms_banks_groups`, `..020000_customers`, `..030000_suppliers`, `..040000_item_masters`, `..050000_price_lists`, `..060000_item_data_migration` |
| Rules (pure) | `modules/masters/party-rules.ts`: GSTIN (length → format → state → PAN → checksum) and PAN with the exact §8 messages, Udyam / IFSC / HSN formats, party identity consistency (PAN + state from GSTIN), `normaliseName`, `placeOfSupply`, payment schedule (remainder to last instalment), price-slab picker |
| Services | tax rate (`rateFor`, dated HSN rates, overlap check, "adding a rate ends the open one the day before"), duplicate check (BLOCK / WARN / INFO), price lookup (customer list → customer's list → group default → company default → item price, UOM conversion), parties (customers, suppliers, credit changes, bank accounts), bank crypto (AES-256-GCM + HMAC) |
| Approvals | Suppliers (`scm-suppliers`) and credit increases (`crm-customer360`, amount = new limit) go through the Phase 5 engine via `registerApprovalHandler`; a credit decrease applies at once; one open credit request per customer |
| API | `/statutory/gstin/:g`, `/statutory/pan/:p`, `/parties/check-duplicates`, `/tax/rate`, `/pricing/lookup`, `/customers` (+ credit requests), `/suppliers` (+ submit, bank accounts, verify), `/hsn-sac` (+ `/:id/rates`), `/gst-rates`, `/gst-registrations`, `/payment-terms`, `/banks`, `/territories`, `/party-groups`, `/item-groups`, `/price-lists`, `/items/:id/uom-conversions` |
| Items | HSN is required: creating or editing an item without an HSN is refused (`HSN_REQUIRED`), an HSN shorter than the registration's minimum is refused (`HSN_DIGITS`, default 6); the item stores `hsn_id` next to the text code |
| Audit | 50 new actions added to the action catalogue; bank numbers are always masked |

## 2. DATABASE CHANGES (all of them)
* **New extensions:** `pg_trgm` (name similarity; contrib package already installed on the server for Phase 5 `btree_gist`).
* **New tables:** `gst_states` (39 rows, from `packages/statutory`; 25 retired, 96 added), `gst_registrations`, `gst_rates` (generated CGST/SGST = IGST / 2), `hsn_sac_codes` (generated `is_service`), `hsn_sac_rates`, `payment_terms`, `payment_term_lines`, `banks`, `territories`, `party_groups`, `customers`, `customer_addresses`, `customer_contacts`, `customer_credit_requests`, `suppliers` (generated `msme_45day_applies`), `supplier_addresses`, `supplier_contacts`, `supplier_bank_accounts`, `supplier_documents`, `item_groups`, `item_uom_conversions`, `price_lists`, `price_list_items`.
* **Constraints worth knowing:** UNIQUE GSTIN per table (partial, not deleted); `CHECK` GSTIN present ⇔ type is not UNREGISTERED/OVERSEAS; `CHECK` PAN = characters 3–12 of the GSTIN; `CHECK verified_by_id <> changed_by_id` on supplier bank accounts (database refuses self-verification); one PENDING credit request per customer (partial unique); one default price list per kind and currency.
* **Sequences:** `customer_code_seq`, `supplier_code_seq` (codes `CUS/00001`, `SUP/00001`; no gap-free guarantee needed for masters).
* **Altered table `items`:** + `item_group_id`, `hsn_id`, `gst_rate_override_id`, `gst_override_reason`; **`CHECK items_hsn_required (hsn_id IS NOT NULL) NOT VALID`** and `items_override_reason_chk` (NOT VALID). **Not validated** (VALIDATE runs in Phase 8, when the "Missing HSN" count is 0). Because the check is enforced on new and updated rows, every code path that creates an item must now supply an HSN.
* **Data:** HSN rows (needs_review) and item groups created from existing items; alternate UOM copied into `item_uom_conversions`; starter payment terms IMMEDIATE / NET30 / NET45; 15 starter banks; **10 GST slabs** (0, exempt, non-GST, 0.25, 3, 5, 12 until 21-09-2025, 18, 28 until 21-09-2025, 40 from 22-09-2025), all `needs_review = true`. **No HSN → slab mapping is seeded** (the builder never decides a rate; the accountant adds them). **No demo parties.**

## 3. Deviations from the spec (and why)
* `gst_states` did not exist as a table (Phase 3 kept the list in code only); it is created here and filled from the Phase 3 package list. Code 28 is not in that list (kept as is; the CA verifies the list).
* `item_uom_conversions.uom_code` has no foreign key (`uoms.code` is not unique in the old schema); the API checks it against `uoms`.
* The three NEW pages (payment terms, banks, party groups) and the territories master use `admin-settings` "controls" for permissions until their page ids are added to the registry (the registry is generated from the prototype and guarded by a staleness test; adding pages needs an additions file, a small design decision for the owner).
* Bank-number keys are derived from `MFA_ENCRYPTION_KEY` (separately for encryption and HMAC), so no new environment variable is needed on the server.
* Customers and suppliers are plain list/get/create APIs; PATCH / DELETE / status / address / contact endpoints for them are still to do (see §6).

## 4. Tests (local, `rhai_erp_test`)
New: `phase06-rules` (28), `phase06-masters` (13), `phase06-simple-masters` (7). Covers: GSTIN worked example (sum 221 → V), checksum failure, 14th char, length, retired state 25, normalisation, PAN, Udyam, IFSC, name normalisation, place of supply (intra, inter, SEZ, export, bill-to/ship-to), payment schedule rounding, price slabs 0/100/500, expired row, customer list beating the default, Box = 12 Nos, item-price fallback, dated GST rate across 21/22-Sep-2025, overlapping HSN rates, duplicate BLOCK / WARN, supplier PENDING → approved through the engine, `SUPPLIER_NOT_APPROVED`, credit increase vs decrease, two-person bank verification (service and database), bank duplicate BLOCK, MSME flag, item without HSN refused, item data migration on legacy rows (rolled back), If-Match 400/409, Idempotency replay, 401 / 403.
Existing tests changed because items now need an HSN: global setup seeds one test HSN; `phase5-helpers`, `phase5-masters`, `unit/inv-uom` pass it.

## 5. Clean runs (API, from a freshly reset rhai_erp_test, 07-11-2026)
| Run | Result |
|---|---|
| 1 | 56 of 57 files passed; 2 failures in `phase05-approvals` caused by a **test bug** (the tests used the UTC date for "today"; the system uses the IST business date, so after midnight IST they differ). Fixed afterwards in the test. |
| 2 | **57 / 57 files, 884 / 884 tests passed** |
| 3 | **57 / 57 files, 884 / 884 tests passed** |
| 4 | 883 / 884: one failure in `phase01-identity` "enforces challenge flow when MFA is enabled" (500 instead of 401). **Flaky and unrelated to Phase 5 / 6:** run alone it passed twice and failed once in 3 tries (a Phase 1 MFA timing issue; to be fixed in its own clean-up). |

Notes: the 58 failures that existed before Phase 5 are no longer present in these runs (the owner fixed the old tests in the meantime). Several earlier "runs" in the log were invalid because three run chains overlapped on the same test database; only sequential foreground runs are counted above. Web: 40 files, 369 tests, all passing, build passes.

## 6. Not done yet (needs another session)
1. **Web:** Customer Master, Supplier Master (tabs, GSTIN decode chip, inline duplicate warning, MSME banner, bank tab, documents tab), HSN page with rate timeline, GST rate / registration pages, price list page with "Test price", item form changes (HSN lookup, rate shown, override with reason, group, UOM grid, "Missing HSN" filter). A typed client already exists: `apps/web/src/lib/mastersApi.ts`.
2. **Registry additions** for `admin-payment-terms`, `admin-banks`, `admin-party-groups` (owner approved; mechanism needs a decision) and engine-kit typed registration of `crm-customer360`, `scm-suppliers`, `tax-hsn`, `admin-taxes`, `tax-gst`, `sales-pricelist`.
3. Customer / supplier PATCH, delete / restore, activate / deactivate, address and contact endpoints, supplier documents endpoints, "Verified on GST portal" tick endpoint (`GSTIN_PORTAL_VERIFIED`), lookups `/lookups/customers|suppliers|hsn|gst-rates|payment-terms|price-lists|item-groups|banks`.
4. `npm run e2e` and the owner's manual check list (§13 of the spec).

## 7. Known issues
* The 58 pre-existing API test failures (see the Phase 4 and Phase 5 reports) are unchanged.
* `rhai_erp` and `rhai_erp_e2e` do NOT have the Phase 6 migrations yet (apply with `prisma migrate deploy`); the AWS server must not receive them until the web side is ready.
* `needs_review` rows (states, slabs, starter HSN codes) must be signed off by the accountant before go-live.
