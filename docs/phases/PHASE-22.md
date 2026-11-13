# PHASE 22 — Strong base: pagination, last generic pages, ActionBar, speed, zero-error gate, registry v2, test framework

## 1. Goal
Before adding V40 features, make the existing ERP solid:
1. every list is paginated and fast;
2. all 246 current pages have real screens (31 still generic today; the 9 admin ones go to Phase 31);
3. every page has the same V40 button bar;
4. registry v2 lists every V40 page, tab, field and button;
5. a crawler proves no page has an error;
6. the "feed through the screens" test framework exists and is used from now on.

## 2. Pages
**A. 31 pages from generic to real screens** (their tables already exist; tabs exactly as V40):
| Page | Tabs | Built on |
|---|---|---|
| wms-warehouses | Warehouse Master | Phase 8 warehouses |
| wms-zones | | Phase 8 locations type ZONE |
| wms-racks | | Phase 8 locations type RACK |
| wms-shelves | | Phase 8 locations type SHELF |
| wms-rfid | | RFID/barcode tags of bins, label print |
| wms-transfer | | Phase 8 transfer vouchers |
| wms-pick | | Phase 10 pick tasks |
| wms-packing | | Phase 10 pack units |
| inv-items | (remaining tabs) | |
| inv-stock | (remaining tabs) | |
| hr-recruitment, hr-onboarding, hr-training, hr-performance, hr-exit | | Phase 15 tables |
| pay-loan, pay-overtime, pay-incentive | | Phase 16 tables |
| proj-budget, proj-expenses, proj-milestones, proj-subtasks, proj-team | | Phase 17 tables |
| qms-5why | | Phase 12 five_why_cases |
| sales-pricelist | (incl. Margin Simulation tab) | Phase 6/10 |
| scm-approval | | Approval Center filtered to SCM docs |
| service-history | | Phase 17 view |
| service-requests, service-spares | | Phase 17 tables |
| tax-gst, tax-hsn | | Phase 6 masters + Phase 11 settings |

**B. New admin pages:**
- admin-page-health — crawler results;
- admin-registry — registry v2 viewer with a status per page (Built / Planned / Changed on purpose).

## 3. Rules
- STANDARDS "API pagination" + R2-2 ActionBar + R2-3 speed + R2-4 zero-error + R2-7 feeders.
- V40 ids, tab names and field labels are kept letter for letter (R-29).
- A screen never shows a made-up number. With no data it shows the R2-5 empty state.

## 4. Database (<ts>_phase22_indexes, <ts>_phase22_page_health)
- **Indexes** (CREATE INDEX CONCURRENTLY, own migration), for each document header table:
  - (unit_id, doc_date DESC, id DESC);
  - (unit_id, status, id DESC);
  - (unit_id, party_id, doc_date DESC) where a party exists.
  - For masters: (lower(name) text_pattern_ops), plus trigram on name and code.
  - The final list = the default sorts/filters of every list + the slow-query log of the first crawler run.
- page_health(page_id, role_code, unit_combo, run_id, status OK/ERROR, error_kind, error_text,
  p95_ms, checked_at); PK (page_id, role_code, unit_combo, run_id)
- registry_snapshots(version, sha256, generated_at, pages_count, json) — the history of registry v2
- No business table changes.

## 5. Work, logic and examples
**A. Pagination retrofit**
- **Shared helpers** (apps/api/src/core/pagination.ts):
  - `paginateKeyset(query, {sortKey, limit, cursor})`: encodes `{k: sortKey, v: lastValue, id: lastId}`
    in base64url and rejects a cursor whose k ≠ the current sort (CURSOR_INVALID → the client restarts).
    It fetches limit + 1 rows to know hasMore.
  - `paginatePage(query, {page, size})` for masters < 10k rows; returns total.
  - total for keyset lists: exact if ≤ 10,000 (count with the same WHERE), else
    `pg_class.reltuples`-based estimate + totalIsEstimate = true (the UI shows "10,000+").
- **Which lists to fix:** the 129 queries found on 11-Nov:
  | Module | Count |
  |---|---|
  | inventory | 28 |
  | finance | 24 |
  | approvals | 20 |
  | format-settings | 10 |
  | masters | 10 |
  | notifications | 4 |
  | departments, designations, documents, procurement, units, uoms | 3 each |
  | audit-logs, currencies, department-access, permissions, roles, users | 2 each |
  | financial-years, module-controls, sales | 1 each |

  Every $queryRaw list in mfg, hr, payroll, projects, service, logistics, bi and qms is included too.
- **Small lookups** are marked `unpaginated:true, max:500` (units, roles, departments, designations,
  UOMs, currencies, FYs).
- **Check:** tools/check-unbounded.ts parses modules/**/*.ts. It fails on `findMany(` with no `take`,
  or `$queryRaw` SELECT with no LIMIT, unless the line before has `// unpaginated: <reason>`.
- **Example:** GET /inventory/transactions?limit=25&sort=-doc_date →
  ~~~json
  {data:[25 rows], meta:{limit:25, nextCursor:"eyJrIjoiLWRvY19kYXRlIiwidiI6IjIwMjYtMTEtMDkiLCJpZCI6IjhmLi4uIn0",
   hasMore:true, total:48211}}
  ~~~
  Next page: ?cursor=… → rows 26–50. Walking all pages returns each of the 48,211 rows exactly once
  (property test).

**B. Registry v2**
- extract.ts reads the V40 HTML:
  - MENU (22 families, 247 items);
  - the 12 AddMenu insertions (ops-mfg-dashboard, process-exceptions, master-customers,
    sales-enquiries, ops-order-360, master-products, master-materials, mfg-material-issue,
    customer-receipts, my-approvals, plant-unit-routing…);
  - the dynamic families (Work Management, Workplace Management, Integrated Plant Flow,
    Business Documents, Contract Labour Management);
  - PROFILES (tabs, fields);
  - button labels per page from the V40 templates.
- **Output** (registry.json v2): `{families[], pages[{id, title, family, tabs[], fields[], buttons[],
  dynamic:false, status:'built'|'planned', ownerPhase}]}`.
- **Tests:**
  - all 246 old ids are present with the same title;
  - every new V40 id is planned with an ownerPhase (23–31).

**C. ActionBar**
- **Server:**
  - every module exports `actionsFor(ctx, record)` → `{allowed:Action[], blocked:{[a]: reason}}`;
  - lists add `_a` (bitmask) per row, computed in SQL from status + permission (no per-row call).
- **Reasons** (examples):
  - "Posted documents can't be edited — use Cancel/Reverse.";
  - "Pending approval L1/2 — wait for the decision.";
  - "With Production — only they can edit." (from Phase 25).
- **Web:** ActionBar, RowActions and SelectionBar replace page-specific buttons on all 246 pages.
  Word and Move Forward show greyed with "Arrives in Phase 27 / Phase 25" until their phase.

**D. Speed**
- compression middleware (skips text/event-stream);
- weak ETags on GET;
- React Query everywhere (staleTime 30 s);
- SSE gets `record.changed {page, id, unitId}` → invalidates that page's queries for users viewing
  that plant;
- lazy routes per family;
- @tanstack/react-virtual above 200 rows;
- Prisma `select` only the needed columns on lists;
- the N+1 guard on in every API test.

**E. Crawler** (tests/e2e/crawl.spec.ts)
- For roles Super User, Administrator, Director, CFO, GM, Dept Head, Dept Manager, Supervisor,
  Employee × plant combos {own default} and, for multi-plant roles, {TAL+SAW} and {all}:
  - log in through the login screen;
  - open /m/<id> and every ?tab=;
  - wait for network idle; collect console errors, page errors, failed responses and forbidden text;
  - check the ActionBar is present; measure load ms.
- JSON → tools/import-page-health.ts → page_health. The gate requires 0 errors.

**F. Test framework (R2-7)**
- tests/feed/lib: `loginAs(role, plants)`, `openPage(id)`, `fillForm({label: value})` (finds inputs by
  label text, so it survives layout changes), `addLine()`, `pick(lookupLabel, text)`,
  `clickAction('Send for Approval')`, `approveAs(role, docNo)`, `expectToast()`, `readDocNo()`.
- A dataset file: tests/feed/data/company.ts — a fictitious "Demo Engineering Pvt Ltd" style dataset
  with customers, suppliers, items, employees. Never real client names.
- Phase 22 feeders: masters for the 31 new screens (e.g. 3 warehouses with zones, racks and shelves;
  2 loans; 1 incentive scheme; 1 project with a budget).
- Flows: "create rack → shelf → see it in the bin picker on a GRN put-away".

**G. STATUS.md generator** reads registry v2 + page_health + migrations (E-36).

## 6. API
- GET /meta/registry
- GET /admin/page-health?status=&role=
- GET …/:id/actions on every record route
- List routes unchanged in path; new `meta` and `limit/cursor` params

## 7. Screens
- The 31 typed pages use the shared kit: list (DataTable + Pager) → row click opens a drawer → Edit
  opens a form; tabs exactly as V40.
- admin-page-health: filter "Only errors"; each row links to the page; the p95 column turns red above
  the budget.
- admin-registry: search; family tree; page card (tabs, fields, buttons, status, owner phase).

## 8. Messages
| Code | Message |
|---|---|
| PAGE_LIMIT_TOO_LARGE | "Maximum 100 rows per page." |
| CURSOR_INVALID | silent restart + toast "The list changed, showing the latest." |
| ACTION_NOT_ALLOWED | "You can't {action} this record: {reason}." |
| EMPTY_LIST | "No {things} yet. Press ＋ Add to create the first one." |

## 9. Audit & notifications
- Crawler failures in CI → Administrator notification `system.page_health` (deduped per day).
- Registry version changes are audited.

## 10. Tests
- **Unit:** cursor encode/decode/tamper; page helpers.
- **API:** every list limit=1000 → 400; no limit → ≤ 25; keyset walk exact (property test, 1,000
  random rows with duplicate dates).
- **Registry:** diff test.
- **ActionBar:** matrix 9 roles × 6 sample pages × 4 states.
- **Crawler:** 0 errors.
- **k6:** 10 hot lists within R2-3.
- **Feeders + flows:** §5F, run 3×.

## 11. Acceptance
- [ ] Unbounded-list check green (0 findings).
- [ ] 237 of 246 pages real; only the 9 admin pages are left (Phase 31).
- [ ] ActionBar on every page.
- [ ] Registry v2 complete.
- [ ] Crawler 0 errors.
- [ ] Speed budget met.
- [ ] Feeder framework used by 3 feeders and 2 flows.
- [ ] STATUS.md regenerated.
- [ ] Client documents updated.

## 12. Out of scope
New V40 modules (Phases 23–31), admin builders (31), pixel-exact look (32).

## 13. Owner check
1. Inventory → Inventory Transactions. Do 25 rows load in about 1 s, and does Next work?
2. Open any record. Are the buttons in one row, with greyed ones explaining why on hover?
3. Warehouse → Racks. Can you add a rack, see it in Shelves, then in GRN put-away?
4. Admin → Page Health. Is all green?

## 14. Build prompt
~~~
Read CLAUDE.md, STANDARDS (incl. R2-1..R2-9), ROADMAP (R-01..R-41), ERRATA (E-01..E-41),
PHASE-22.md, STATUS.md, and the V40 HTML (read-only). Do §5 A→G in order; A is done only when
tools/check-unbounded.ts reports 0. Never rename a page id. Zero-error gate ×3. Migrations local/test
only. One local commit. Write PHASE-22-REPORT.md with the Deploy sheet, update docs/clicntmassage.md
and docs/client-test-guide.md (§15).
~~~

## 15. Client documents
**clicntmassage.md — NEW in this update:**
- Every list now opens quickly and shows 25 rows per page with Next/Previous.
- Every screen has the same button bar (Open, Edit, PDF, Approve…); a grey button tells you why it's
  not available.
- 31 more screens are complete: Warehouse Zones/Racks/Shelves/RFID, Picking, Packing, Stock Transfer,
  Recruitment, Onboarding, Training, Performance, Exit, Loans, Overtime, Incentives, Project Budget,
  Expenses, Milestones, Sub-tasks, Team, 5-Why, Price Lists, Purchase Approval, Service History,
  Requests, Spares, GST setup, HSN master.

**client-test-guide.md — add:**
- **Employee:**
  1. Inventory → Transactions → Next page. ✔️ Opens in about 1 second.
  2. Open a record → hover a grey button. ✔️ It explains why.
- **Store/Warehouse:** Warehouse → Racks → ＋ Add rack R-01 in Zone A. ✔️ Appears in Shelves → Rack list.
- **HR:** Payroll → Loans → ＋ Add ₹20,000, 10 EMIs. ✔️ The EMI schedule shows 10 rows of ₹2,000.
- **Administrator:** Administration → Page Health. ✔️ All pages green.
