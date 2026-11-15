# 02 - Inventory (14 pages) and Warehouse / WMS (13 pages): build plan (index)

Written by the architect on 2026-11-03 for the builder. This file is the **index**: it carries sections 0, 14 and 15 in full and points to the part files for sections 1-13 (the plan exceeds 3,000 lines, so it is split the same way as `03-SCM-PROCUREMENT.md`). Read `00-BUILDER-RULES.md` and `01-SHARED-FOUNDATION.md` first.

| Part file | Sections |
|---|---|
| `02a-INVENTORY-UI-AND-MARKET.md` | 1 Scope and status, 2 The frozen UI page by page, 3 How the market does it |
| `02b-INVENTORY-PROCESSES.md` | 4 End-to-end processes (10 flows with mermaid) |
| `02c-INVENTORY-DATABASE.md` and `02c2-INVENTORY-DATABASE-TABLES-M4-M6.md` | 5 Database design: layers, conventions, ERD, migrations M1-M6, hand-written SQL, the 45 new tables (DDL + Prisma), volumes, seeds, accounting mapping |
| `02d-INVENTORY-RULES-API.md` | 6 Business rules (BR-INV-01..72), 7 API design, 8 Reports and KPIs, 9 Extra functions |
| `02e-INVENTORY-TESTS-REVIEW.md` | 10 Edge cases (50), 11 Test plan, 13 Reviewer checklist |
| `02f-INVENTORY-TICKETS.md` | 12 Build tickets T-INV-01..41 |

---

## 0. Header

**Purpose.** Rebuild the Sawant Group ERP's **Inventory** family (14 pages: `inv-items, inv-stock, inv-transactions, inv-opening, inv-adjustment, inv-transfer, inv-reservation, inv-reconciliation, inv-ageing, inv-valuation, inv-reorder, inv-batch, inv-serial, inv-expiry`) and **Warehouse / WMS** family (13 pages: `wms-warehouses, wms-zones, wms-racks, wms-shelves, wms-bins, wms-putaway, wms-pick, wms-packing, wms-cycle, wms-physical, wms-transfer, wms-barcode, wms-rfid`) so that every page of the frozen prototype UI is backed by real data. Seven pages are already built (`inv-items, inv-stock, inv-transactions, inv-opening, inv-adjustment, inv-transfer, wms-warehouses`); this plan completes their missing tabs and fields (gaps G-01..G-09 in 02a section 1.2) and builds the other twenty. It also converts `admin-uom` into a typed page because the UOM tables belong to this plan (foundation 3.3).

**Who it serves.** Store keepers, warehouse operators, pickers, packers and supervisors in the three units (Talwade, Sawardari, Varale); QC for batch release; buyers (reorder suggestions); accountants (valuation, GL bridge, accounting events); auditors (physical verification, CARO flag); later Sales (reservations, availability, dispatch), SCM (GRN, landed cost, open PO), Manufacturing (issues, reservations) and Finance (event queue).

**What it builds (headline design).**
* Stock is a stack of **layers that must add up** to the existing item x warehouse balance: batch, serial, bin and FIFO cost layers are optional side tables (02c 5.1), so the 645 earlier tests are untouched.
* One entry point `StockService.postMovement` (valuation core stays `postMovement` in `posting.ts`, renamed `postCoreMovement` with a re-export), plus `reserve/release/hold/applyLandedCost`.
* `AccountingService.post` **stub** + `accounting_event_queue`; every posting writes its event in the same transaction; `GlBridge` interface for the Finance plan.
* 45 new tables in 6 migrations, a reusable typed-page **kit**, a **tab-view** contract so every profile tab shows real data, 41 tickets.

**Dependencies.** Existing: phases 1-5 (users, permissions, units, FY, generic engine, items, warehouses, vouchers, ledger). Later plans consume: SCM (03) calls `StockService.postMovement` for GRN and registers `OpenSupplyProvider`, `PurchaseRequestGateway`; Sales (04) calls `reserve/release` and `dispatchPack`; Finance (05) drains `accounting_event_queue` and registers `GlBridge`.

**Foundation items used.** Foundation 2 (DB conventions; one naming deviation below), 3.3 (`uoms`, `uom_conversions`), 5 (`NumberingService`, `StockService.postMovement/reserve/release`, `AccountingService` stub, `accounting_event_queue`), 6 (status vocabulary: documents use their own workflow statuses where the frozen UI needs them), 7 (cross-module contracts: GRN, Delivery, Stock adjustment, Reserve stock), 8 (this plan is first in the build order).

**FOUNDATION-CHANGE items (decided here, the architect confirms):**
1. `FOUNDATION-CHANGE:` standard audit columns are named `created_by_id / updated_by_id / deleted_by_id` (as all six built tables), not `created_by` etc. - naming only (02c 5.2).
2. `FOUNDATION-CHANGE:` the generic page machinery gets three additive extensions that later plans may also use: `tabViews` (live profile tabs), `commands` (header-level buttons) and `SchemaAction.requires = 'approve'` (02d 7.2, ticket T-INV-04/05).
3. `FOUNDATION-CHANGE:` `admin-uom` leaves `GENERIC_ADMIN_PAGES` and becomes a typed page backed by `uoms`/`uom_conversions` (T-INV-06). The foundation said Finance or Inventory would do this; Inventory does it.
4. `FOUNDATION-CHANGE:` accounting events and their account **roles** are defined in 02c 5.8 for the Finance plan to map in `posting_rules`.

---

## 1. Scope and status
Full text in `02a-INVENTORY-UI-AND-MARKET.md` section 1: the 27-page table (id, title, owner dept, kind BUILT / TO BUILD typed, what exists, what is added) and the gap table G-01..G-09.

## 2. The frozen UI, page by page
`02a` section 2: for each of the 27 pages the six profile tabs (name, prototype renderer, view key, kind, data source), list columns, the complete field table copied from `field-types.json` with keys/types/required marks, statuses, row actions, header buttons, filters, totals, empty states and `[ADD]` items.

## 3. How the market does it
`02a` section 3: comparison table (Odoo, ERPNext, Zoho, SAP B1, Tally, Dynamics 365/BC, Dolibarr), standards (Ind AS 2, CARO 2020, GST dates, GS1), pitfalls, what we adopt and skip.

## 4. End-to-end processes
`02b`: receive/QC/putaway, reservation, outbound wave-pick-pack-dispatch, transfers, cycle count and reconciliation, physical verification, valuation and GL bridge, reorder, expiry and recall, scan and RFID import - each with numbered steps, statuses, actors and a mermaid diagram.

## 5. Database design
`02c` + `02c2`: layer model, conventions, ERD, migration order M1-M6 and how the 645 tests stay green, all ALTERs of existing tables, backfills, the 45 new tables with DDL and Prisma models, volumes, seeds, accounting event mapping.

## 6. Business rules and formulas
`02d` section 6: BR-INV-01..72, each with formula, worked example, error code and ticket.

## 7. API design
`02d` section 7: reused endpoints, extensions, tab views, commands, standalone endpoints, TypeScript integration interfaces, page definitions (actions/filters/totals), examples.

## 8. Reports and KPIs
`02d` section 8: RPT-INV-01..54, SQL sketches (ageing, valuation buckets, blocked stock), KPI definitions.

## 9. Extra functions beyond the prototype `[ADD]`
`02d` section 9: X-01..X-48 with priority, source and ticket (MUST/SHOULD in tickets, COULD in backlog).

## 10. Edge cases and careless-user scenarios
`02e`: EC-01..EC-50, each with expected behaviour and the proving test.

## 11. Test plan
`02e`: unit, API, invariants INV-1..8, simulation, 10 e2e scenarios with numbers, performance notes.

## 12. Build tickets
`02f`: T-INV-01..41 in dependency order, with files, steps, acceptance, tests, do-not lists and sizes, plus the summary table.

## 13. Reviewer checklist
`02e` section 13: data, rules, UI freeze, security checks and the most likely builder mistakes.

---

## 14. Open questions and decisions taken

| Id | Question / decision | Default chosen |
|---|---|---|
| DEC-01 | Plan split into part files (more than 3,000 lines) | index + 02a..02f as listed above |
| DEC-02 | Fixture types `Variance` of `inv-reconciliation` as `money` although it is a quantity | keep type `money` (fixture is binding), store a signed quantity (3 dp); `[ADD]` nothing; the Value Variance field carries the value. Ask the owner whether the fixture should change to `qty`. |
| DEC-03 | `Reason Code` of `inv-adjustment` is built as a select, fixture says longtext | keep the select (better control), add `reasonNote` longtext |
| DEC-04 | `Category` of `inv-items` is text, fixture enum | keep text (categories are open-ended) |
| DEC-05 | `Operating Hours` of `wms-warehouses` is text, fixture qty | keep text |
| DEC-06 | Negative stock | OFF by default; ON only by SUPER_ADMIN, never for batch/serial/FIFO items (BR-INV-04) |
| DEC-07 | Backdated postings | no recompute of history; valued at posting time (BR-INV-02) - differs from ERPNext's repost; owner to confirm |
| DEC-08 | Batch OR serial, not both | enforced (Zoho does the same) |
| DEC-09 | Valuation methods offered | Moving Average, FIFO, Standard Cost; no LIFO (Ind AS 2) |
| DEC-10 | Count tolerance / approval thresholds | 2 % and Rs 500 for recount; Rs 10,000 for maker-checker; all editable in `inventory.policy` |
| DEC-11 | ABC cutoffs and frequencies | 80/95 % cumulative; A 30 d, B 90 d, C 365 d (sources disagree; settings) |
| DEC-12 | Dispatch: who posts the issue | `wms-packing` `dispatch` posts it today through `dispatchPack`; Sales' delivery will call the same function later |
| DEC-13 | Preferred vendor on reorder policy | text + nullable `preferred_vendor_id` until `parties` exists (SCM plan) |
| DEC-14 | Customer on pack order | text `customer_name` until `parties` exists |
| DEC-15 | Capacity unit | "capacity units" (CU) = qty x `items.storage_units` (default 1 per base UOM); no volume modelling in v1 |
| DEC-16 | Scheduling of daily jobs | no scheduler in the app; the owner runs `npm run job:inventory` (cron/pm2) at 02:00 IST |
| DEC-17 | Barcode printing | API returns ZPL/text/json; the browser prints; no printer drivers |
| DEC-18 | Camera scanning in the browser | not in v1 (hardware keyboard-wedge scanners only) |
| DEC-19 | GST consequence of write-offs | events carry `gstItcReversal`; Finance/Tax plan decides the entries (commentary on 17(5)(h) is not authoritative) |
| DEC-20 | Cross-unit transfers | allowed as built; two accounting events through INTER_UNIT_CLEARING |
| DEC-21 | Serial items and stock not whole numbers at migration | skipped by the backfill and listed by the integrity check |
| Q-01 | Does the client want the 10 % CARO net-basis flag per item class or per total? | per item type (class), net basis |
| Q-02 | Should reservations also be possible per serial number? | not in v1 (qty only) |
| Q-03 | Shelf-life customer rule at pick (minimum remaining life)? | backlog X-42 |
| Q-04 | Exact numeric `Reorder Soon` margin | 25 % above the trigger level |

---

## 15. Sources

Used on 2026-11-02/03 (search results and pages read; "(unverified)" marks claims not confirmed against an official page).

**ERP products**
* ERPNext FIFO and Moving Average (fetched): https://docs.frappe.io/erpnext/fifo-and-moving-average
* ERPNext Stock Reconciliation: https://docs.frappe.io/erpnext/stock-reconciliation ; Opening stock: https://docs.frappe.io/erpnext/opening-stock
* ERPNext Repost Item Valuation: https://docs.frappe.io/erpnext/repost-item-valuation ; negative/abnormal valuation: https://docs.frappe.io/erpnext/why-is-my-valuation-rate-or-stock-value-negative-or-abnormally-high ; stock value comparison: https://docs.frappe.io/erpnext/stock-value-comparison ; serial-wise valuation: https://docs.frappe.io/erpnext/use-serial-no-wise-valuation
* Odoo putaway/removal strategies (vendor blog, Odoo 19, partly unverified for 17): https://ecosire.com/blog/odoo-19-inventory-putaway-removal-strategies
* Odoo cycle counts (documentation pull request): https://github.com/odoo/documentation/pull/16974/files
* Odoo reordering rules (documentation pull requests): https://github.com/odoo/documentation/pull/11964/files , https://github.com/odoo/documentation/pull/14853
* Zoho Inventory bin locations: https://www.zoho.com/ae/inventory/help/bin-locations/ ; composite items and tracking: https://zstatic.zohostatic.com/inventory/help/items/composite-items.html
* SAP Business One valuation methods: https://learning.sap.com/courses/managing-logistics-in-sap-business-one/exploring-the-inventory-valuation-methods-in-sap-business-one ; revaluation (FIFO revaluation claim disputed, unverified): https://sap-b1-blog.com/en/glossary/revaluation-of-the-stock-sap-business-one
* Dynamics 365 location directives and work templates: https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/control-warehouse-location-directives ; warehouse management overview: https://learn.microsoft.com/en-au/dynamics365/supply-chain/warehousing/warehouse-management-overview ; Business Central counts/adjust: https://learn.microsoft.com/dynamics365/business-central/inventory-how-count-adjust-reclassify ; item tracking setup: https://learn.microsoft.com/en-ca/dynamics365/business-central/inventory-how-setup-item-tracking ; negative inventory (blog, unverified): https://stoneridgesoftware.com/?p=234892
* Tally Prime inventory (valuation methods, batches): https://tallysolutions.com/us/blogs/inventory ; FIFO caveat: https://tallyatcloud.com/articles/improve-inventory-accuracy-with-tallyprimes-stock-valuation-batch-tracking-and-warehouse-management
* Dolibarr stocks and lot/serial: https://wiki.dolibarr.org/index.php/Module_Stocks_En , https://wiki.dolibarr.org/index.php/Module_Lot/Serial

**Standards, law, formulas**
* Ind AS 2 (secondary guides; confirm paragraphs against ICAI/MCA text): https://cleartax.in/s/indian-accounting-standards-ind-as-inventories-2 , https://taxguru.in/chartered-accountant/ind-2-inventories.html
* CARO 2020 clause 3(ii) (ICAI chapter presentation and BCAJ): https://navimumbai.icai.org/resource/Image/PPT_17-05-2025_Recent-Amendments-to-CARO-2020_CA-Shriniwas-Joshi.pdf , https://bcajonline.org/journal/caro-2020-series-new-clauses-and-modifications-inventories-and-other-current-assets/ (net basis of the 10 % test unverified)
* GST 2.0 slabs effective 22 Sep 2025 (56th Council, 3 Sep 2025) (fetched): https://tallysolutions.com/gst/gst-council-meeting-september-2025-two-rate-gst-reforms/ ; EY alert: https://www.ey.com/content/dam/ey-unified-site/ey-com/en-in/alerts-hub/2025/09/gst-council-announces-major-rate-rationalization-and-trade-facilitation-measures.pdf (official PIB release not retrieved)
* CGST Section 17(5)(h) commentary (not authoritative): https://www.taxmann.com/post/blog/analysis-itc-reversal-for-time-expired-goods-under-the-cgst-act
* GS1 application identifiers (GS1 UK guide): https://www.gs1uk.org/knowledge-hub/barcodes/how-can-i-encode-production-data-eg-batch-dates-in-a-barcode ; GS1 AI list: https://gs1.org/gs1-application-identifiers ; EPC/RFID overview (SGTIN-96 detail unverified): https://gs1.se/en/standards-and-services/epc-rfid/ ; the date rule `DD = 00` is from memory of the General Specifications (unverified here)
* Safety stock, ROP, EOQ (vendor guide, textbook formulas): https://ecosire.com/blog/eoq-safety-stock-reorder-point-guide
* ABC and cycle counting: https://www.getonecart.com/cycle-counting-inventory/ , https://www.rfsmart.com/blog/how-to-develop-a-cycle-count-process
* Inventory to GL reconciliation: https://www.cleverence.com/amp/articles/for-business/how-to-reconcile-inventory-to-general-ledger-4827/

**Repository files read:** `docs/plans/00-BUILDER-RULES.md`, `01-SHARED-FOUNDATION.md`, `docs/REGISTRY.csv`, `apps/api/tests/fixtures/field-types.json`, `apps/api/README-PHASE5.md`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261105000000_phase5_inventory/migration.sql`, `apps/api/src/modules/inventory/**`, `apps/api/src/engine/**`, `apps/api/src/modules/records/**`, `apps/web/src/pages/generic/**`, `reference/index.html` (renderers `v9*`, `registerTab`, `analyticsTab`).

**Not verified:** official Odoo 17 docs pages (only PR drafts and a vendor blog were reachable), Zoho valuation settings, the Microsoft negative-inventory rule, SAP FIFO revaluation, the exact GS1 date rule, SGTIN-96 decoding, the CARO net-basis reading, and official CBIC text on Section 17(5)(h).
