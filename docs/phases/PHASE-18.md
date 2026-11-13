# PHASE 18

# PHASE 18 — Logistics, Fleet, Gate & DMS
(ERRATA E-19: gate passes use the Phase 3 GST doc types gate-out / gate-return.)

## 1. Goal
Control three things:
- **the gate:** nothing leaves without a posted dispatch or an approved pass; nothing enters without a
  register entry linked to the PO/GRN;
- **the trucks:** own fleet and hired transporters;
- **the documents behind them.**

Fleet and freight costs post to the GL. Vehicle, driver and transporter documents alert before expiry.
DMS adds folders, ACLs, tags, retention and full-text search on top of the Phase 4 DocumentService —
**no second file store.**

## 2. Pages
| Group | Pages |
|---|---|
| Logistics | log-transporters, log-routes, log-freight, log-shipments, log-tracking, log-pod, container-track |
| Fleet | fleet-vehicles, fleet-drivers, fleet-fuel, fleet-service, fleet-documents |
| Gate | gate-in, gate-out, gate-return, gate-nonreturn |
| DMS | dms-folders, dms-docs, dms-versions, dms-permissions, dms-tags, dms-search |

KPI tabs (performance, OTIF, risk, fuel trend, tag/search analytics) are read-only views, not tables.

## 3. Rules
- **Delivery challan (CGST Rule 55):** for job work and movements that are not supplies (repair,
  approval, exhibition).
  - Serial ≤ 16 characters, unique per FY; consignor / consignee GSTINs, HSN, qty, value, tax, POS.
  - Printed in triplicate (Original consignee / Duplicate transporter / Triplicate consignor).
  - Returnable passes and non-returnable passes without an invoice use doc types gate-out / gate-return,
    e.g. RGP/SAW/26/00012.
- **Job work (s.143, Rule 45):**
  - inputs back within 1 year, capital goods within 3 years; moulds / dies / jigs / tools have no limit;
  - late = deemed supply;
  - each line stores jobwork_category (input / capital_good / tool_exempt) and statutory_due_date;
  - alerts 60 / 30 / 7 days before; after the date the line is flagged deemed_supply_risk for Finance;
  - ITC-04 data is prepared here; filing is out of scope.
- **E-way bill (Rule 138):** above ₹50,000, and always for inter-state job work. Numbers are typed in
  (12 digits). The Part B vehicle must match the gate vehicle.
- **Motor Vehicles Act / CMVR:** RC (all), fitness (transport vehicles), permit (transport), insurance
  (all), PUC (all), driving licence (transport endorsement for goods vehicles). DigiLocker copies are
  valid.
  - A vehicle with an expired required document can't be put on a trip.
  - A driver with an expired licence can't be assigned.
- **LR (Carriage by Road Act 2007):** shipments store LR number and date. GTA freight RCM 5 % is
  handled in Phases 9/11.
- **Designs adopted from ERPNext / Odoo:** trip = shipment with stops; fuel and odometer log;
  folder + tag facets.
- **Postgres FTS:**
  - stored tsvector with weights A (title / code), B (tags), C (description / metadata), D (extracted text);
  - GIN index; websearch_to_tsquery with the 'simple' config (Indian names and part codes don't stem);
  - ts_rank_cd ranking; pg_trgm for fuzzy titles;
  - extracted text capped at 500 KB per version.
- **ISO 15489 retention:** retention schedule + disposition authority; legal hold suspends disposal.
  - Floors: CGST s.36 = 72 months; Companies Act s.128 = 8 years.
  - Default retention **8 years**. Destruction needs approval and produces a destruction certificate.

## 4. Database (<ts>_phase18_logistics / _fleet / _gate / _dms)
**Logistics:**
- Transporters = Phase 6 suppliers with is_transporter. supplier_transporter_profile(supplier PK,
  transin, pan, vehicle_types, gta_rcm, insurance_valid_till, rating)
- transporter_lanes(supplier, route, vehicle_type)
- routes(code, name, origin unit/place, destination, distance_km, std_transit_hrs, toll_cost,
  restriction_text, primary_transporter) + route_stops(seq, place, km_from_origin, std_halt_min)
- freight_rate_cards(supplier, route, vehicle_type, basis per_kg_slab/per_km/per_trip/per_cbm,
  min_charge, fuel_surcharge_pct, validity, status draft/approved) + freight_rate_slabs(from, to, rate)
- freight_calculations(number, shipment, card, weight, volume, distance, base, fuel_surcharge, toll,
  other, total, purchase_invoice, variance)
- shipments(number, unit, customer, transporter, vehicle or hired_vehicle_no, driver, route, planned
  dispatch/delivery, lr_no, lr_date, eway_bill_no, eway_valid_till, weight, volume,
  status planned/loading/dispatched/in_transit/delivered/pod_received/closed/cancelled)
  + shipment_lines(delivery, sales_order)
- tracking_events (append-only: milestone, location, eta, delay, note, source manual/api)
- pods(shipment, delivered_at, receiver, mobile, document, billing_release) + pod_lines(short, damage, remark)
- containers(container_no (ISO 6346 check digit), type, owner, free_days) + container_movements

**Fleet:**
- vehicles(reg_no unique, type, ownership own/leased, is_transport, unit, make/model, fuel, tank
  capacity, std_kmpl, current_odometer, asset_id (Phase 14), cost_centre, status)
- drivers(employee_id, name, mobile, licence_no, class, expiry, hazardous_endorsement, status)
- vehicle_assignments(vehicle, driver, from, to)
- vehicle_document_types(code RC/INS/PUC/FIT/PERMIT, required_for all/transport, alert_days {30,15,7})
- vehicle_documents(vehicle, type, doc_no, issue, expiry, authority, document_id)
- fuel_logs(number, vehicle, driver, filled_at, odometer, litres, rate, amount, full_tank, vendor, kmpl,
  variance_pct, anomaly_codes, journal, status)
- vehicle_services(type, due km/date, service date, odometer, vendor, downtime_hrs, next due, status)
  + lines(part/labour, item, qty, rate, amount)

**Gate:**
- gate_passes(number, unit, gate, direction in/out, pass_type inward_po/inward_return/inward_other/
  outward_dispatch/returnable/non_returnable, party, vehicle_no, vehicle_id, driver name/mobile, photo,
  entry_at, exit_at, weigh_in/out, net_kg, purpose, expected_return_date, is_challan, eway_bill_no,
  approval_status, status draft/at_gate/inside/exited/closed/cancelled)
- gate_pass_lines(item, description, uom, qty, value, hsn, po_line, grn, delivery, jobwork_category,
  statutory_due_date, returned_qty, balance_qty (generated), out_warehouse)
- gate_return_receipts(out_line, in_pass, qty, received_at, condition) — partial returns
- Visitor management is out; a "visitor note" text only.

**DMS (extends Phase 4):**
- dms_folders(parent, path ltree, name, unit, department, owner, confidentiality public/internal/restricted,
  retention_years, retention_trigger created/expiry/closed, inherit_acl default true, status)
- dms_folder_acl(folder, principal role/user/department, can_view/upload/edit/delete/download/share/approve,
  valid_till, granted_via_approval_id)
- documents ADD folder_id, confidentiality, effective_date, checked_out_by/at, legal_hold,
  disposition_due, search_tsv (trigger) + GIN index + trigram on title
- dms_tags(code, name, group, auto_rule, owner) + document_tags
- document_text(version PK, extracted, extracted_at)
- dms_share_links(token_hash, document, expires_at, max_downloads)
- dms_saved_searches, dms_search_log, dms_dispositions(action review/destroy/extend, approval, certificate_doc)
- Access log = the Phase 4 audit log with actions dms.view / download / share.

## 5. Algorithms (packages/calc)
**Gate-in → GRN:**
1. The guard picks the supplier and vehicle, takes a photo, and sees the supplier's open POs at this unit.
2. Pick the PO, type the challan number → pass "inside" (weigh-in recorded).
3. Stores sees "Pending at gate" → a Phase 9 GRN draft is pre-filled; grn_id is written back.
4. Weigh-out → net kg; a difference > 1 % of the challan weight is a warning.
5. Exit closes the pass. A pass inside for > 12 h appears in exceptions.
- inward_return lines must reference an open returnable line, qty ≤ balance; stock moves from the
  returnable warehouse back to the origin.

**Gate-out** (one transaction, source lines locked):
1. Each line references a posted delivery or an approved pass.
2. qty ≤ source − already gated.
3. Above ₹50,000 or inter-state job work → a 12-digit e-way bill whose vehicle matches.
4. Own vehicle: no expired document, and a driver with a valid licence.
5. On exit:
   - shipment → dispatched (+ tracking event);
   - returnable → StockService transfer to the returnable warehouse;
   - non-returnable → issue via Phase 8.

**Returnable overdue job** (daily 07:00):
- overdue days = today − expected return while balance > 0; alerts at 1 / 7 / 30 days.
- Statutory alerts at 60 / 30 / 7 days before the due date; after it → deemed_supply_risk.
- Example: input sent 10-11-2025 → statutory due 10-11-2026 → on 04-11-2026 the 7-day alert fires.

**Freight:**
- Slab: base = max(weight × rate, minimum).
- Example: 2,350 kg at ₹6.50 (slab 1,001–5,000, minimum 5,000) → 15,275.00 + fuel 8 % 1,222.00 + toll
  1,450.00 + loading 500.00 = **₹18,447.00** (RCM 5 % = 922.35, shown only; Phase 9 posts it).
- Per km: 32 ft MXL ₹48 × 410 km = 19,680.00 (minimum-km rule applies).
- Bill > calculated + 2 % → approval before the Phase 9 invoice posts.

**Fuel (full-tank method):**
- km/l = km since the last full fill / litres since then.
- Example: full at 120,000; 40 L partial at 120,180; 60 L full at 120,400 → 400 / 100 = **4.00 km/l**;
  standard 4.50 → **−11.11 %**.
- Anomalies:
  | Code | Rule | Effect |
  |---|---|---|
  | ODO_BACKWARD | odometer lower than last | blocks |
  | OVER_TANK | litres > capacity × 1.05 | blocks |
  | RAPID_REFILL | two fills within 2 h | warning |
  | LOW_EFFICIENCY | variance < −15 % | warning |
  | HIGH_KM | > 1,200 km in a day | warning |
- Posting: fuel Dr Fuel Expense (vehicle cost centre) / Cr vendor or cash; service Dr Vehicle R&M / Cr vendor.

**Expiry alerts** (daily): vehicle documents, licences, transporter insurance and DMS documents at
exactly 30 / 15 / 7 / 0 days, deduplicated per document + threshold. Status valid / expiring / expired.

**DMS permission** — can(user, action, doc), one SQL predicate:
1. The page permission (Phase 2) is required.
2. Unit scope.
3. The owner gets everything; otherwise an ACL row on the nearest non-inheriting folder or an ancestor
   (ltree path) matching the user / role / department and still valid; or the document is linked to a
   record the user can see.
4. **Restricted folders:** only an explicit ACL, granted via a Phase 5 "DMS access request" that writes
   a time-bound row.
5. Check-out: only the holder can edit or upload a version.
- No deny rows; the default is no access.

**Search:**
- websearch_to_tsquery('simple', q); filters first, then the permission predicate.
- Score = ts_rank_cd × 1.0 + similarity(title) × 0.5 + 0.1 if updated in the last 90 days.
- ts_headline snippets; 25 per page; searches logged; never shows a forbidden title.
- Text extraction job dms.extract (pdftotext, DOCX/XLSX XML; no OCR).

**Retention** (monthly job dms.retention): disposition_due = trigger date + retention years → review
task → approval → files purged, metadata tombstone + certificate PDF kept. Legal hold blocks it.

## 6. API (/api/v1; {data,meta}; ETag; Idempotency-Key)
- **Logistics:**
  - /transporters/:supplierId/profile, /transporters/:id/lanes
  - /routes (+ /stops)
  - /freight-rate-cards (+ submit | approve)
  - POST /freight/calculate; /freight-calculations
  - /shipments (+ allocate | dispatch | cancel, /events); /pods (+ release-billing)
  - /containers (+ /movements)
- **Fleet:** /vehicles (+ /documents), /drivers, /fuel-logs (+ post), /vehicle-services (+ complete | post)
- **Gate:**
  - /gate-passes (+ enter | weigh | exit | cancel | submit, /print, /returns)
  - /gate/open-pos?supplier=, /gate/pending-dispatch, /gate/overdue-returnables
- **DMS:**
  - /dms/folders (+ /acl, request-access)
  - /dms/documents (+ checkout | checkin | rollback | share | hold, /versions, /versions/:vid/download)
  - /dms/tags, /dms/search, /dms/saved-searches

## 7. UI
- **Gate kiosk /gate/kiosk** (tablet, two columns, buttons ≥ 64 px):
  - three big buttons: Vehicle IN / Vehicle OUT / Material RETURN;
  - large uppercase vehicle field with recent vehicles; one-tap photo;
  - party / PO / dispatch cards with qty steppers;
  - big green "Allow & Print" or a red reason banner;
  - no money values shown to the guard.
- **Other screens:**
  - shipments Kanban by status with a tracking drawer;
  - vehicle cards with coloured document chips;
  - DMS three panes (folder tree | grid with facets | preview with versions, ACL, activity);
  - search with highlighted snippets.

## 8. Messages
| Message |
|---|
| "Vehicle MH12AB1234 has expired Insurance (03-11-2026). Trip allocation blocked." |
| "Driver licence expired on 01-10-2026." |
| "Quantity 120 exceeds pending dispatch quantity 100 for DN/SAW/26/00045." |
| "E-way bill required (value ₹1,24,500 > ₹50,000)." |
| "E-way bill vehicle MH12AB1234 does not match gate vehicle MH12AB1243." |
| "Return quantity exceeds balance 4." |
| "Pass not approved — cannot exit." |
| "Odometer 119,950 is lower than last reading 120,400." |
| "Fuel 260 L exceeds tank capacity 220 L." |
| "Document is checked out by R. Patil." |
| "You do not have access to folder 'HR/Restricted'. Request access?" |
| "Folder has documents under legal hold; cannot delete." |
| "Container number check digit invalid." |

## 9. Audit & notifications
- **Audit:** every change, state change and print (with the copy name); DMS views / downloads / shares /
  ACL changes / check-outs / rollbacks / holds / destructions.
- **Approvals:** non-returnable pass, returnable pass above a value, freight rate card, freight variance
  > 2 %, restricted folder access, disposition.
- **Notifications:**
  - expiry at 30 / 15 / 7 / 0 days;
  - returnable overdue and statutory 60 / 30 / 7;
  - vehicle inside > 12 h;
  - shipment delayed beyond SLA;
  - POD pending > 7 days;
  - fuel anomaly;
  - service due within 500 km / 7 days.

## 10. Tests
- **Unit:** freight (slab, minimum, per-km, min-km); fuel across partial fills + every anomaly;
  overdue / statutory dates incl. 29-Feb-2028; days remaining; ISO 6346; challan ≤ 16 characters.
- **Integration:**
  - gate-out rejects unlinked / over-quantity / expired-vehicle lines;
  - partial returns update balance and stock;
  - concurrent exits on one dispatch → one wins;
  - gate-in creates the GRN draft;
  - journals balance; edit after post → 409; idempotent replay; 412.
- **DMS:** ACL matrix (user × folder tree × role × unit × link × restricted); search never leaks;
  ranking fixture; check-out lock; retention with legal hold.
- **Jobs:** fake clock + dedupe.
- **E2E:** kiosk at tablet size.
- 3 clean runs.

## 11. Acceptance
- [ ] Goods leave only against a posted dispatch or an approved pass.
- [ ] Gate-in creates the GRN draft; partial returns tie back to the original pass.
- [ ] The 3-copy Rule 55 challan prints correctly.
- [ ] Alerts fire on the right days.
- [ ] Freight and fuel match the worked examples to the paisa and post with cost centres.
- [ ] Expired vehicle or driver documents block allocation.
- [ ] DMS uses only the Phase 4 tables; the permission matrix passes.
- [ ] Search returns results in < 500 ms on 50k documents.

## 12. Out of scope
VAHAN / Sarathi / e-way / FASTag / GPS integrations, visitor management, weighbridge devices, OCR,
ITC-04 filing, route optimisation, driver app, customer tracking portal, tyre management.

## 13. Owner check
1. SAW kiosk Vehicle IN: does it show only that supplier's open POs at SAW, and does the pass print with photo and time?
2. Vehicle OUT with an e-way bill for a different vehicle → red banner?
3. Returnable pass with a partial return → Balance shows the rest?
4. Freight for 2,350 kg = ₹18,447.00?
5. A user without access searches a restricted title → empty?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md (R-01..R-24), ERRATA.md (E-19), PHASE-18.md,
Phase 3–17 code as built. Migrations <ts>_phase18_{logistics,fleet,gate,dms}; extend Phase 4 documents —
never duplicate; transporters = suppliers + profile; gate passes/challans numbered via NumberingService
(gate-out / gate-return, ≤16 chars). packages/calc freight, fuel, overdue, days-remaining, ISO 6346 with
worked-example tests. Use StockService, PostingService, ApprovalService, NotificationService,
DocumentService, PdfService — never re-implement. pg-boss gate.returnable.overdue, fleet.docs.expiry,
dms.extract, dms.retention (idempotent). DMS permission resolver = one SQL predicate reused by list,
search and download; weighted 'simple' tsvector + GIN + websearch_to_tsquery + ts_rank_cd + pg_trgm +
ts_headline. Tablet kiosk /gate/kiosk; other pages in index.html look. Audit every DMS view/download.
No portal calls, no demo data. Tests §10, 3 clean runs. Migrations local dev/test only (R-16). Never
push; commit only if asked. Write PHASE-18-REPORT.md.
