# PHASE 25 — Department Work Movement engine (V40 core): Inbox, Received → Accepted → Work → Move Forward / Return, Workflow Matrix, plant routing, transfer notes

## 1. Goal
V40's heart, made real and safe:
- a record travels between departments with a full handover trail (who, which department, when);
- only the department holding it can edit it;
- the Workflow Matrix suggests the next department;
- material that moves between plants also moves stock;
- everything feeds Home, the dashboards, project history and mail automation.

## 2. Pages (V40 ids)
| Page | What it is |
|---|---|
| dept-inbox-<dept> | Department Inbox, one per department (from the departments table) |
| dept-work-<dept> | Department Work Center |
| dept-movement-inbox | all departments; Director/Admin/Owner |
| my-approvals | exists; gets movement-linked approvals |
| admin-workflow | Workflow Matrix tab (the Rules tab comes in Phase 27) |
| plant-process-movement | |
| plant-department-movement | |
| plant-interplant-movement | Plant-to-Plant |
| plant-unit-routing | Plant / Unit Routing + route builder |
| mfg-unit-route | Multi-Unit Part Routing; tabs Live Job Cards / one tab per plant / Quality Release / Dispatch Readiness |
| mfg-transfer-note | Material Transfer Note |
| flow-bom-approval | BOM & Material Approval |
| maint-part-movement | |
| customer-receipts | Customer Material Receipt |

Plus on every routable page: the **Move Forward** popup, the **Return** dialog, the **History** drawer,
and the **360° trace** drawer.

## 3. Rules
- **States:** SENT → RECEIVED → ACCEPTED → IN_WORK → (WAITING_APPROVAL) → COMPLETED | FORWARDED |
  RETURNED, plus RECALLED (sender, before Received) and CANCELLED.
- **Who does what:**
  | Action | Who |
  |---|---|
  | Move Forward | holding department members with Edit permission (or elevated: Director/Admin/Owner) |
  | Received / Accepted | target department members only |
  | Return | the target department after Received; reason ≥ 10 characters |
  | Recall | the sender, while SENT |
- **The V40 cycle text is shown in the popup:** "Move Forward → next department marks Received →
  Accepted → works on the record → Send for Approval to a selected department → approval Accepted →
  Move Forward becomes available again."
- **Edit lock (routed_edit):** while a movement is open, only the holding department edits; others see
  "Currently with {dept} since {time}".
- **One open movement per document.**
- **Plants:** a movement belongs to the document's plant. The target department users must have that
  plant ticked (R-37); the Responsible Manager list only shows users who have it.
  Plant-to-plant = from_unit ≠ to_unit (physical lines required).
- **Default chain** (V33, seeded, editable):
  | Step | Document | Owner |
  |---|---|---|
  | 1 | Quotation | Sales |
  | 2 | Sales Order | Sales |
  | 3 | Project | Projects |
  | 4 | BOM | Engineering |
  | 5 | PR | Purchase |
  | 6 | PO | Purchase |
  | 7 | GRN | Warehouse |
  | 8 | Incoming QC | Quality |
  | 9 | Manufacturing Order | Production |
  | 10 | Final QC | Quality |
  | 11 | FG | Warehouse |
  | 12 | Delivery Challan | Warehouse |
  | 13 | GST Invoice | Finance |
  | 14 | Collection | Finance |
- **Default next department when no rule** (V18 map): sales-orders → Production; scm-po → Warehouse;
  scm-grn → Quality; qms-incoming → Warehouse; mfg-orders → Quality; qms-final → Warehouse;
  dispatch-dc → Finance; ops-shift-roster → HR; … After that, the V18 sequence order.

## 4. Database (<ts>_phase25_movements)
- workflow_rules(module_id PK, owner_department_id, next_department_id, approval_department_id,
  route_mode MANUAL/SUGGEST, sla_days numeric default 2, routed_edit default true, active default true,
  required_attachment_types text[], required_fields text[], next_process_module_id, updated_by/at)
- work_movements:
  - id, number MOV/<PLANT>/<FY>/00001 (NumberingService), unit_id, to_unit_id (inter-plant),
    doc_type, doc_id, doc_no;
  - trace: project_id, so_id, po_id, mo_id, job_card_id;
  - parent_movement_id, from_department_id, to_department_id, assigned_manager_id;
  - route_type: Department Work Handover / Technical Work / Purchase / Material Action /
    Manufacturing Action / Quality Action / Finance / Commercial Action / Project Action /
    Correction / Rework;
  - priority Normal/High/Critical, required_by;
  - work_status: Work Required / Review Required / Material Action Required / Manufacturing Required /
    Quality Check Required / Dispatch Action Required / Finance Action Required / Correction Required;
  - handover_note ≤ 500;
  - state; sent/received/accepted/completed/returned/recalled (by, at); return_reason;
  - sla_due_at, late boolean, is_physical, version.
  - **Unique:** one open movement per (doc_type, doc_id) (partial index on open states).
- movement_lines(movement, item, description, qty, uom, batch, from_location, to_location,
  received_qty, accepted_qty, short_qty, short_reason, stock_txn_ids)
- movement_attachments(movement, document_id); movement_events (append-only)
- plant_routes(code, name, item_or_family, active) + route_steps(seq, unit_id, process_name,
  department_id, work_centre_id, std_hours, qc_required)
- job_card_routes(job_card, route, current_step, planned, good, rejected, scrap, transferred, balance
  (generated), route_status, quality_approval, dc_status, payment_status, updated_at) — the V40 fields
- transfer_notes (the V40 fields: Transfer Note No, Job Card No, Part Code, Part Name, From Unit,
  From Process, To Unit, To Process, Transfer Date, Quantity, Vehicle/Person, Sent By, Received By,
  Receipt Status, Remarks)
- bom_material_flows (V40: Flow No, Sales Order, Part Code, Part Name, BOM Revision, Material Required,
  Stock Available, Shortage, Sales Approval, Purchase Status, Manufacturing Release, Status)
- Counters: triggers update dept_work_counters (per department × plant) and user_work_counters.

## 5. Logic and examples
**Move Forward** (one transaction):
1. Lock the document and its open movement.
2. Checks:
   - holder rights; current state ACCEPTED/IN_WORK, or no movement and the user's department owns the
     document;
   - no approval pending; the approval_department approval is Approved if the rule has one;
   - required fields and attachments present;
   - target ≠ source;
   - the target has at least one active user with this plant.
3. Close the current movement as FORWARDED; insert the new SENT movement.
4. sla_due_at = add working days (Phase 15 calendar of the plant).
5. Counters; SSE + push + email (Phase 27 rules) to the target managers.
6. Physical inter-plant → StockService.transfer to STOCK_IN_TRANSIT (Phase 8); completed on Received
   with the received qty.

**SLA example:** plant works Mon–Sat; sent Friday 16:00 with SLA 2 days → day 1 = Saturday 16:00,
day 2 = Monday 16:00 (Sunday off) → **due Monday 16:00**. At Monday 16:01 it is late → notify the target
manager; at 2× SLA (Wednesday 16:00) → notify the department head.

**Short receipt example:** 100 shafts sent TAL → SAW; SAW receives 96 with the reason "4 damaged in
transit" →
- 96 move into SAW stock;
- 4 stay in transit with an exception "Short receipt 4 – MOV/TAL/2627/00031";
- Warehouse TAL decides: return to TAL, or write off (Phase 8 adjustment with approval).

**Return:** RECEIVED/ACCEPTED → a new SENT movement back to the sender, the reason recorded, the lock
back to the sender; physical stock reverses.

**Plant route (V34):**
- steps e.g. TAL Machining (Production) → SAW Heat treatment (Production) → TAL Grinding (Production)
  → TAL Final QC (Quality);
- "Continue route" creates the next movement (Manufacturing Action) and a transfer note when the plant
  changes;
- job_card_routes is updated from job-card completions (Phase 13).
- **Balance example:** planned 500, good 470, scrap 10 → balance 20.

**BOM & Material approval (flow-bom-approval):**
- from an SO line: explode the BOM (Phase 13) → required vs available (Phase 8 availability in the
  document's plant) → shortage → "Raise PR for shortage" (Phase 9) → Sales approval → Manufacturing
  release.
- **Example:** required 82.000 kg copper, available 60.000 → shortage 22.000 → PR draft 22 kg.

**360° trace:** the movement chain + approvals + documents + the PO/SO/MO numbers block as in V40.

## 6. API (/api/v1/work)
- GET /inbox?dept=&state=&docType=&project=&late=&q=&cursor=
- GET /work-center?dept=
- POST /movements; POST /movements/:id/receive {lines?} | accept | return {reason} | recall | complete
- GET /movements/:id/trace; GET /docs/:docType/:docId/movement
- GET /workflow-rules; PUT /workflow-rules/:moduleId; GET /workflow-rules/suggest?docType=&docId=
- CRUD /plant-routes; POST /job-card-routes/:id/continue
- CRUD /transfer-notes; CRUD /bom-material-flows (+ /:id/raise-pr | sales-approve | release)

## 7. Screens
**Move Forward popup (V40 fields, same order):**
1. From Department (locked)
2. Next Working Department (suggested, preselected)
3. Responsible Manager
4. Work Type
5. Priority
6. Required By
7. Work Status
8. Short Handover Note
9. the trace block
10. the cycle text
11. [Move Forward]

For physical moves, a lines grid (item, qty, batch) appears.

**Department Inbox:**
- tabs To Receive / To Accept / In Work / Returned / Sent by us / All;
- filters (document type, project, plant, priority, late, date) + Apply Filters / Reset;
- each row: number, document, from, sent at, SLA chip, priority; buttons **Received**, **Accepted**,
  **Open**, **Return**, **History**, **360°**;
- bulk Receive / Accept.

**Work Center:** accepted items grouped by document type, each with **Open Work**,
**Send for Approval**, **Move Forward**.

**Workflow Matrix:** a grid of pages × owner / next / approval department, mode, SLA days, routed edit,
active, required attachments; **＋ Add Rule** and **Save Matrix**; and "Test": pick a document →
shows what would be suggested.

**mfg-unit-route:** one tab per plant listing the job cards at that plant, with a progress bar
good/planned and Next unit/process.

## 8. Messages
| Case | Message |
|---|---|
| same department | "Select a different next department" |
| not holding | "This record is with {dept}. Only they can move it." |
| approval pending | "Waiting for approval by {dept}. Move Forward opens after approval." |
| missing attachment | "Attach {type} before moving forward." |
| no target user | "{dept} has no active user in {plant}. Ask Admin." |
| receive by wrong department | "Only {dept} can mark this Received." |
| already received | "Already received by {name} at {time}." |
| return reason short | "Write at least 10 characters for the reason." |
| short receipt | "Enter a reason for the short quantity ({n})." |

## 9. Audit & notifications
- Every state change is audited and becomes a project_events row (Phase 26 reads it).
- **Notifications** (Phase 21 types): work.sent → target department managers; work.returned → sender;
  work.late → target manager, then the head; work.accepted → sender (info).
- **Email** via the Phase 27 automation library (default on for sent/late/returned).

## 10. Tests
- state machine table (every legal and illegal move);
- concurrency: two Move Forwards → one wins, the other gets 409;
- edit lock;
- inter-plant stock in transit → received / short → exception;
- return reverses stock;
- SLA with a Sunday and a holiday;
- counters = live counts;
- plant rule (target has no user in the plant);
- inbox p95 < 300 ms with 200k movements.
- **Feeders** (through the screens): the full chain for 3 SOs —
  1. Sales creates a quotation → SO → Move Forward to Projects.
  2. Projects Receive/Accept → Move to Engineering.
  3. Engineering BOM → Purchase.
  4. Purchase PR/PO → Warehouse.
  5. Warehouse GRN → Quality.
  6. Quality IQC → Production.
  7. Production MO → Quality FQC → Warehouse FG → DC → Finance invoice → collection.
  Each step uses the inbox buttons as the real role.
- **Flows:** the chain completes; every History shows 14 handovers with times; one Return path; one
  short-receipt path; the Workflow Matrix change alters the suggestion.

## 11. Acceptance
- [ ] The full 14-step chain runs through the screens.
- [ ] Inbox, Home and dashboard counts agree.
- [ ] Inter-plant stock is correct.
- [ ] The Matrix controls suggestions.
- [ ] Zero-error gate. Client documents updated.

## 12. Out of scope
Automatic forwarding — never (R-31).

## 13. Owner check
1. Sales: SO → Move Forward → Production. Is it under Production's "To Receive"?
2. Production: Received, then Accepted. Does the SO's History show both times?
3. Sales tries to edit the SO. Does it say "with Production"?
4. Send 100 pieces TAL → SAW and receive 96. Is there a short-receipt exception?

## 14. Build prompt
~~~
Read …, PHASE-25.md, V40 v18*/v19*/v22*/v25*/v26*/v31*/v32*/v34* (reference only; server rules per
R-31/R-37). Migrations §4, services §5 (each action one transaction), API §6, UI §7 with V40 labels.
Wire Phase 8 StockService, Phase 13 job cards, Phase 5 approvals, counters, SSE. Feeders/flows §10.
Zero-error gate ×3. Local commit. Report + Deploy sheet + client documents.
~~~

## 15. Client documents
**NEW:** Department Inbox — work moves between departments with Received / Accepted / Move Forward /
Return; every step stamped with name and time; only the department holding a record can change it;
Workflow Matrix (Admin); plant-to-plant transfers with short-receipt control; multi-plant part routing.

**Test book:**
- **Sales:** open an SO → Move Forward → Production. ✔️ "Sent to Production".
- **Production Manager:**
  1. Inbox → To Receive → Received. ✔️ It moves to "To Accept".
  2. Accepted. ✔️ It moves to "In Work".
- **Sales:** try Edit. ✔️ "With Production".
- **Warehouse:** Plant-to-Plant 100 → receive 96 with a reason. ✔️ Exception shown.
- **Administrator:** Workflow Matrix → change the SO's next department to Projects. ✔️ The next Move
  Forward suggests Projects.
