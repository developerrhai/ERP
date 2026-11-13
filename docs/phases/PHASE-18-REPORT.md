# Phase 18 Implementation Report: Logistics, Fleet, Gate & DMS

**Status:** Completed & Verified  
**Date:** 2026-11-10  
**Scope:** Logistics (Transporters, Routes, Rate Cards, Freight Calculations, Shipments Kanban, Tracking Events, PODs, ISO 6346 Containers), Fleet (Vehicles, Drivers, CMVR Document Expiry, Full-Tank Fuel Logs & Anomalies, R&M Services), Gate Control (Tablet Kiosk `/gate/kiosk`, PO-linked Inward/GRN Draft, Returnable/Non-Returnable CGST Rule 55 Delivery Challans, s.143 Rule 45 Job Work Alerts, E-Way Bill Part B Matching), and DMS (Folders with `ltree`, ACL Matrix, Check-out Locks, ISO 15489 Retention & Legal Hold, Postgres `'simple'` Weighted Full-Text Search).

---

## 1. Verification Summary
1. **`packages/calc` Unit Tests:**
   - **8 test files, 78 tests passed** (`tests/logistics.test.ts`: 9 tests covering slab freight worked example ₹18,447.00, min charge & per-km min-km rules, > 2% variance check, full-tank fuel worked example 4.00 km/l & -11.11% variance, all 5 fuel anomaly detectors, s.143 statutory due dates including 29-Feb-2028 leap year boundary, ISO 6346 container check digits, Rule 55 challan <= 16 chars & e-way vehicle validation).
2. **`apps/api` Integration Tests:**
   - `tests/phase18-logistics.test.ts`: **7 integration tests passed** against live local PostgreSQL test database `rhai_erp_test`.
3. **Compilation & Typechecking:**
   - `apps/api` (`tsc -p tsconfig.build.json`): **exited with code 0**.
   - `apps/web` (`tsc -p tsconfig.json --noEmit`): **exited with code 0**.
4. **Database Migrations:**
   - All 4 Phase 18 migrations applied cleanly to local `rhai_erp` and `rhai_erp_test`.

---

## 2. Owner Checks Verification Matrix

| # | Owner Check | Implementation & Verification |
|---|---|---|
| **1** | **SAW kiosk Vehicle IN:** Shows only that supplier's open POs at caller's unit; pass prints with photo & entry time | Enforced in `gateService.getOpenPosForSupplier` (`WHERE po.supplier_id = $1 AND po.unit_id = $2`), `gateService.enterPass` records `entry_at` + `photo_file_id` + pre-fills `goods_receipts` draft (`DRAFT`). |
| **2** | **Vehicle OUT with e-way bill mismatch:** Shows red error banner and blocks exit | Enforced in `gateService.exitPass`: throws 422 `"E-way bill vehicle MH12AB1234 does not match gate vehicle MH12AB1243."` Verified in `phase18-logistics.test.ts` and displayed as red banner in `GateKioskPage.tsx`. |
| **3** | **Returnable pass partial return:** Updates `returned_qty` and computed `balance_qty` | Verified in `gateService.recordReturn`: partial return of 6 out of 10 sets `returnedQty = 6`, generated column `balanceQty = 4`, over-return rejected (`"Return quantity exceeds balance..."`), and stock transferred back via `StockService`. |
| **4** | **Freight for 2,350 kg = ₹18,447.00 (RCM 5% = 922.35)** | Verified to the paisa in `freight.ts` and `phase18-logistics.test.ts` (`base 15,275.00 + fuel 8% 1,222.00 + toll 1,450.00 + loading 500.00 = 18,447.00`). |
| **5** | **Unauthorized user searching restricted title returns empty** | Enforced via single SQL permission predicate in `dmsService.searchDocuments`: restricted folders require explicit non-expired ACL row; `viewer` search for `"Executive Compensation"` returns 0 rows (`phase18-logistics.test.ts`). |

---

## 3. Architecture & Errata Compliance

### Migrations (`apps/api/prisma/migrations/`)
1. **`20261130000000_phase18_a_fleet`**:
   - Accounts seeded: `6219` (`FLEET_FUEL_EXPENSE`), `6220` (`VEHICLE_RM_EXPENSE`), `6221` (`FREIGHT_EXPENSE`).
   - Tables: `vehicles` (linked to Phase 14 `assets` and `cost_centers`), `drivers`, `vehicle_assignments`, `vehicle_document_types` (`RC`, `INS`, `PUC`, `FIT`, `PERMIT` pre-seeded), `vehicle_documents`, `fuel_logs`, `vehicle_services`, `vehicle_service_lines`.
2. **`20261130010000_phase18_b_logistics`**:
   - Adds `is_transporter` on `suppliers`.
   - Tables: `supplier_transporter_profiles`, `routes`, `route_stops`, `transporter_lanes`, `freight_rate_cards`, `freight_rate_slabs`, `shipments`, `shipment_lines`, `freight_calculations`, `tracking_events` (immutable append-only trigger), `pods`, `pod_lines`, `containers`, `container_movements`.
3. **`20261130020000_phase18_c_gate`**:
   - Adds `is_returnable` on `warehouses`.
   - Tables: `gate_passes` (`pass_no VARCHAR(16)` with check `char_length(pass_no) <= 16`, generated `net_kg`), `gate_pass_lines` (generated `balance_qty`), `gate_return_receipts`.
   - Uses ERRATA E-19 doc types (`gate-out`, `gate-return`) via `NumberingService`.
4. **`20261130030000_phase18_d_dms`**:
   - Enables PostgreSQL extensions `ltree` and `pg_trgm`.
   - Tables: `dms_folders` (`ltree` path + GIST index), `dms_folder_acl`, `dms_documents` (`search_tsv` weighted `'simple'` tsvector + GIN index + trigram index on `title`), `dms_document_versions` referencing Phase 4 `stored_files(id)` (no duplicate physical file store), `dms_document_text`, `dms_tags`, `dms_document_tags`, `dms_share_links`, `dms_saved_searches`, `dms_search_log`, `dms_dispositions`.

### Background Jobs (`pg-boss` in `apps/api/src/core/jobs/index.ts`)
- `gate.returnable.overdue` (`0 7 * * *`): Flags returnable overdue (1/7/30d) and job-work s.143 statutory alerts (60/30/7d) & `deemed_supply_risk`.
- `fleet.docs.expiry` (`15 7 * * *`): Evaluates vehicle doc / licence / insurance expiry at 30/15/7/0d thresholds.
- `dms.extract`: Updates `dms_document_text` & weighted `search_tsv`.
- `dms.retention` (`0 1 1 * *`): Queues ISO 15489 retention disposition tasks, skipping documents under legal hold.

### Frontend Screens (`apps/web/src/pages/logistics/`)
- `GateKioskPage.tsx`: Tablet two-column kiosk (`/gate/kiosk` and `/m/gate-*`), buttons `>= 64px`, Vehicle IN / OUT / Material RETURN, large uppercase vehicle input with recent vehicles, line qty steppers, no money values shown to the guard, triplicate CGST Rule 55 challan print link.
- `FleetPage.tsx`: Vehicle cards with coloured statutory doc status chips, drivers table, fuel log form with anomaly blocking, services R&M.
- `LogisticsPage.tsx`: Shipments Kanban by status with tracking timeline drawer, Freight calculator & rate cards, routes, transporters, POD billing release, ISO 6346 containers.
- `DmsPage.tsx`: 3-pane DMS explorer (`folder tree` | `document grid` with `ts_headline` snippets | `preview drawer` with checkout/checkin, legal hold, rollback, share links, and retention queue).
- Registered all 22 page IDs in `apps/web/src/pages/ModulePage.tsx` and `/gate/kiosk` in `apps/web/src/App.tsx`.

