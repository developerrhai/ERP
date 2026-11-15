# PAGE-BY-PAGE V40 BUILD — owner priority from now (overrides the phase order in a_master_builder.md)

Owner instruction: the focus now is the UI, page by page, with every page wired to real data in the database.
Do not move on to backend-only work (rules, integrations, k6, DPDP) until all 327 V40 pages pass the checks below.
Part A (journal, STATE.json, crash recovery, at most 3 sub-agents, one local commit per step) and Part B (rules) of
a_master_builder.md still apply. Think like the plant's own ERP engineer: V40 shows WHAT the client approved; you make it
REALLY WORK with our database. If V40 shows demo numbers, build the real query behind them.

## 0. Setup (once)
1. Finish the Phase 38 frame first, because every page uses it: sidebar (30 families), top bar, page head with the
   standard button row, ONE Register engine (views, filters, table, selection bar, pager, split view), tabs-map.json,
   the V40 look (V35/V36/V37/V39 CSS layers + tokens). Commit.
2. Write tools/parity/compare-page.mjs (ONE Chromium, two tabs):
   a) V40 side: open the V40 HTML file (the same file extract-v2.mjs used), call its nav('<pageId>'), click each
      tab in turn; for every tab save a screenshot + the list of: tab names, table column headers, form field labels,
      buttons, KPI cards, filters, badges, drawers/popups opened by buttons.
   b) ERP side: log in to the local web app as the chosen role, open the matching route, do the same for every tab.
   c) Write docs/ui-audit/pages/<pageId>/v40-<tab>.png, erp-<tab>.png and diff.md (missing / extra / different-name /
      empty-data lists per tab), and update one row in docs/build/PAGES.md.
3. docs/build/PAGES.md = one row per page (327 + dept-movement-inbox):
   | page id | family | V40 tabs | ERP tabs ok | columns ok | fields ok | buttons ok | real data | roles checked | status |
   Status: TODO → BUILDING → CHECK → DONE. This file is the progress list; journal each change to it.

## 1. Order of pages
 1. Inbox and movement: my-approvals, document-movement-center, 12 × dept-inbox-<dept> (11 V40 views each),
    12 × dept-work-<dept>, dept-movement-inbox (Received / Accepted), notifications.
 2. 360 and tracking: ops-order-360, project-global-history, process-exceptions, plant-flow-command and the other
    9 Integrated Plant Flow pages.
 3. Home and executive: dashboard (8 V39 cards live), command-center, ops-mfg-dashboard, global-search.
 4. Every other family in V40 menu order: ERP Process Control → CRM → Sales → Procurement → Inventory → WMS →
    Manufacturing → QMS → Maintenance → Finance → Tax → HRMS → Payroll → Projects → Assets → Service → Logistics →
    Business Documents → DMS → BI → AI → Communication → Administration → Contract Labour → Work → Workplace.
 Where a page needs backend that a_master_builder.md puts in a later phase (e.g. movement engine = Phase 41, GST
 sandbox = Phase 45), build the backend NOW for that page, using that phase's section in a_master_builder.md as the
 spec (worked examples become tests). Only outside connections (GSP, bank, SMS, devices) stay as sandbox/mock +
 OWNER-ACTIONS.

## 2. The loop for EACH page (one page at a time; finish it before the next)
 1. COMPARE: run compare-page.mjs as Super User. Read v40-*.png next to erp-*.png yourself, then diff.md.
 2. LIST what is missing: tabs, table columns, form fields (V40 label + order), buttons and what each one does,
    KPI cards, filters, popups/drawers, status badges, the empty state, phone layout.
 3. DATA FIRST: for every column, field, card and counter, name its source = table.column or a calculation in the API.
    - If the table or column does not exist: write a forward migration (raw SQL like the existing ones; list it in the
      commit). Check FKs, indexes, unit_id (plant), created_by, timestamps, audit like neighbouring tables.
    - API: same module layout, zod schemas, ScopeFilter.units for reads, ctx.unitId only for new records, keyset paging,
      domain_events on status changes, permission check per action.
    - Link the page to its neighbours in the business flow (SO → MO / DC / invoice; PO → GRN → purchase invoice; movement
      → inbox counts → Home cards → 360 timeline). Trace fields (PO / SO / MO / Project Number / Customer PO /
      Part Number) are filled automatically.
 4. BUILD the UI with the shared ui kit, Register engine, words dictionary (V40 labels), status-word map, DateField,
    money format. Every V40 tab gets real content of its kind (REGISTER, FILTERED VIEW, SUB-REGISTER, FORM SECTION,
    REPORT, DASHBOARD, ACTION QUEUE). Every V40 button works (or is greyed with a reason and a phase). Improve the look
    (Zoho-like: views dropdown, bulk bar, split view, full-page form, totals box) but never remove a V40 element.
 5. FEED: add 5–20 realistic rows THROUGH THE SCREENS (Playwright feeder for this page, the department's own user,
    rhai_erp_ui, re-runnable). No seeding by SQL, no fake numbers.
 6. RE-COMPARE: run compare-page.mjs again. Missing list must be empty, or each leftover written in PAGES.md with its reason.
 7. ROLES: open the page as each role below. Check menu visibility, which buttons are enabled or greyed, and that each
    role sees only its own plants and data:
    Owner/Director (all plants) · Admin · Sales user · Purchase user · Stores/Warehouse · Production supervisor ·
    Quality inspector · Finance/Accounts · HR · Department Head · plain Employee (ESS) · user with ONE plant ticked.
    Save erp-<role>.png for the first tab. Any wrong access is a bug: fix it now.
 8. PHONE: check at 390 px wide: no sideways scroll, cards instead of the table, the button row scrolls on one line.
 9. TESTS (Tier 1): typecheck API + web, unit tests of the module, an API test for the new endpoints (plant isolation
    included), a web test for the page. Never more than one browser at a time.
10. CLOSE THE PAGE: PAGES.md row → DONE, one journal line, then commit every 5–10 pages or at the end of a family:
    "feat(ui-parity): <family> pages <ids>" + migrations or "No DB changes".
    Update docs/client-test-guide.md with the page's steps (role, what to click, expected result ✔️).

## 3. After each family
 - Tier 2: ui:audit for the family (each page ≥ 27/30, 0 P0/P1), button click test (0 dead), crawler for the 5 audit roles.
 - A read-only reviewer sub-agent checks 3 random pages of the family against the V40 screenshots and PAGES.md.
 - Update docs/clicntmassage.md: which pages are now finished and how to try them.
 - 5-line chat update: family · pages DONE x/y · new migrations · tests · next family.

## 4. Coding style (same as the existing files)
 - Before writing a new file, open the two closest existing files of the same kind (API module, service, route, web
   page, ui kit component, test, migration, feeder) and copy their structure, naming, imports, error handling and
   test style.
 - No new libraries or new patterns unless the master file allows them (Chart.js in Phase 49).
 - No inline styles (use kit classes). No hard-coded button text (words dictionary). No ctx.unitId in reads.
 - Delete the old page body once its page runs on the Register engine; no dead code left behind.

## 5. Sub-agents (at most 3)
 - Screenshots and compare runs happen ONLY in the main session (one Chromium).
 - A sub-agent gets one page's diff.md + data-source list and builds the API + web code for it in its own module folder.
   It never touches shared files (router, registry, sidebar, ui kit, words, migrations order, package.json). It runs only
   typecheck + unit tests and never commits. You re-compare its page before marking it DONE.

## 6. Done means
 All 327 pages + dept-movement-inbox are DONE in PAGES.md: tabs, columns, fields and buttons match V40 (or carry a
 written reason); every number comes from the database; every role sees the right things; 0 sideways scroll at 390 px;
 the inbox → movement → approval → 360 chain works end to end through the screens. Then continue with the remaining
 backend-only items of a_master_builder.md (Phases 42 → 54) and finish with Phase 54.

START: write "PAGE-PARITY START" in the journal, finish the Phase 38 frame, build compare-page.mjs, then page 1 = my-approvals.


