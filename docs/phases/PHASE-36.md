# PHASE 36 — UI Phase: (A) feed data through the screens, (B) full audit with pictures of every page vs V40,
# (C) redesign and fix the UI to V40 standard and better

## 0. Why this phase
- The client was shown the V40 HTML (`RHAI_ERP_V40_Edit_Update_Fixed.html`) and approved its screens,
  buttons and user flow. That file was front end only, with no real backend.
- The real ERP (React + API) has the backend but **does not look or work like V40**. The client reported:
  - "the UI breaks";
  - "the buttons are not there".
- **The rule for this phase:** V40 is the UI reference. Every V40 page, tab, field and button must
  exist in the ERP, in the same place, doing the same job, and look as good as V40 or better.
  - We may **improve** on V40: cleaner spacing, better tables and forms, phone layout, Zoho-style
    polish where V40 has no answer.
  - We never **remove** a V40 page, tab, field or button, and never change the flow the client saw.
- This phase is **UI only**. Problems in the API or the business flow are recorded for Phase 37,
  except small web-side bugs (wrong URL, wrong field name) which are fixed here.
- **You act as a senior UI/UX designer and front-end developer.** Use your judgement to make it
  look premium ("wow"), within these rules.

## 1. Goal
1. **Part A:** a local database full of realistic data, entered **through the ERP screens** as real
   users would, so every page has something to show.
2. **Part B:** a complete picture of the current ERP: every page and tab shown next to the same page in
   V40, with its data status, the API calls it makes, its buttons, and its problems.
3. **Part C:** every page redesigned and fixed so it matches V40 (or better):
   - no broken layout;
   - no missing button;
   - no dead button;
   - the same look on every page;
   - working on phone and tablet.

## 2. Pages in scope
- All **327 V40 pages** (from `packages/registry/registry.v2.json`), with **every tab**, the **record
  view** (first row) and the **add/edit form**.
- Plus the ERP's own routes that V40 doesn't have: Home, Menu, plant picker, My Dashboard, Owner
  Console, Department Inbox/Work Center, TV, admin pages, account pages.
- The login page is checked but **not redesigned** (R-30).

## 3. Rules
- **Local only.** Use a new local database `rhai_erp_ui` (or `rhai_erp_e2e`). Never the production
  database, never the test server. Nothing is pushed or deployed.
- **Data entry (Part A):**
  - **Only the first Super User may be created directly in the database**, using the project's existing
    seed/bootstrap script (or one SQL insert with an argon2 hash, if no script exists).
  - **Everything else is created through the screens with Playwright**, logged in as the right user:
    company details, plants, departments, users, masters and transactions.
  - When a screen can't save, that is a finding. Write it down; never work around it with SQL.
- **Content follows V40:**
  - the same page ids, menu order, tab names and order, field labels, table columns, button labels
    and button places;
  - colours are the V40 tokens;
  - the V40 layers V35 (Clean Advanced), V36 (Blue Table-First), V37 (Data Exchange) and V39 (Simple
    Dashboard + Horizontal Actions) are the target look.
- **Buttons:**
  - every button V40 shows on a page must be on the ERP page, in the same area;
  - if the backend for it exists, wire it;
  - if not, show it **greyed with a clear reason** and list it for Phase 37;
  - never hide a V40 button; never leave a button that does nothing.
- **The login screen stays as it is.**
- **Never** read `.env*`, `deploy_to_ec2*.ps1`, `.git/` internals or `doc from clint/`. **Never** push.
  One local commit per part.
- **This PC has little free memory:**
  - stop old servers on ports 4100/5180 first;
  - one Chromium browser only;
  - batches of 20 pages; close the browser context between batches;
  - resumable checkpoints; never two test runs at once;
  - pause if free memory drops below 1.5 GB.
- Run the app in production build mode (`vite build` + `preview`) for Parts B and C, so screens and
  speed are real.

---

## PART A — Feed the data through the screens

### A1. Prepare
1. Stop leftover ERP node processes on 4100/5180. List them first and stop only the ERP's own processes.
2. Create the local database `rhai_erp_ui`, run all migrations up to the latest (`20261221000000`),
   and start the API and web.
3. Create the **first Super User only** with the bootstrap script. Write the login id in
   `tests/feed/ui/state.json` (git-ignored). Never write a real password in any file; generate one at
   run time and keep it only in that git-ignored state file.

### A2. What to enter (Playwright, through the real forms, as the right role)
Use fictitious names only (no real client or company names). Indian formats: valid GSTIN/PAN check
digits, IFSC, mobile numbers, dd-mm-yyyy dates. One fixed seed, so every run makes the same data.

| # | Done as | Enter through the screens | Quantity |
|---|---|---|---|
| 1 | Super User | Company profile, plants TAL Talwade / SAW Sawardari / VAR Varale, financial year, 12 departments (Administration, Sales, Projects, Engineering, Purchase, Warehouse, Production, Quality, Finance, Service, Maintenance, HR), designations, letterheads, numbering | — |
| 2 | Super User | Administrator user | 1 |
| 3 | Administrator | Users for every role (Director, CFO, GM, Department Head, Department Manager, Supervisor, Employee) across departments; **plant checkboxes**: 1-plant, 2-plant and 3-plant users | ~30 |
| 4 | Administrator | Approval matrix (₹50k / ₹2L / ₹10L), Workflow Matrix, mail automation switches, attendance policies, a few devices | — |
| 5 | Purchase / Sales / Stores / HR | Customers 20, suppliers 20, items 60 (raw material, finished goods, spares, consumables), HSN, UOM, price list, warehouses with zones/racks/bins, 5 BOMs, 5 routings, work centres | — |
| 6 | HR | Employees 40, shifts, rosters, leave policies; a few contractors and contract workers | — |
| 7 | Sales | 10 enquiries → 8 quotations → 6 sales orders (multi-line) across plants | — |
| 8 | Each department | Move 3 sales orders through the department chain with **Move Forward → Received → Accepted**; 1 Return | — |
| 9 | Purchase / Stores / Quality | PRs, 6 POs (with approvals by the right approvers), GRNs, incoming QC, put-away | — |
| 10 | Production / Quality / Warehouse | Production orders, job cards, material issue, FG receipt, final QC, delivery challans | — |
| 11 | Finance | Sales invoices, receipts, purchase invoices, payments, a journal, bank entries | — |
| 12 | HR / Employees | A month of attendance (device-simulator punches through the push endpoint), leave, regularisation, overtime approval, one payroll run | — |
| 13 | Others | Tasks, shift handovers, visitors, canteen scans, maintenance breakdown, asset, service ticket, project with gates, gate pass | a few each |

- Each step checks first whether the record already exists (by business key), so the feed can be re-run.
- **Volume is deliberately small:** enough to fill every page, not a load test.

### A3. Part A output
`docs/ui-audit/DATA-FEED-LOG.md`:
- per step: done / failed;
- records created per module;
- **every form that failed**, with page, field, error text, screenshot and the API call and status;
- every place where the screen made data entry hard: no search in a dropdown, no totals, confusing
  button, field not in V40 order.

These are findings for Part B. Commit locally: "chore(phase-36a): local data feed".

---

## PART B — Audit report with pictures of every page

### B1. Inventory
For every page:
- id, title, V40 menu place;
- ERP route;
- the component that renders it (ScreenPage / GenericModulePage / DocPage / own page / missing);
- the tabs in V40;
- the tabs in the ERP.

### B2. Pictures (the heart of this part)
- For **every page and every tab**:
  - V40 at 1440×900;
  - ERP at 1440×900;
  - ERP at 390×844 (phone);
  - ERP at 1024×768 (tablet).
- Also for the **record view** and the **add/edit form** of each page.
- **How to open V40 pages:** load `RHAI_ERP_V40_Edit_Update_Fixed.html` in the same browser, find its
  own function that opens a page by id (search the HTML for the menu click handler), and call it.
  Log in to V40 with its built-in demo account only inside the audit browser. Never copy V40's demo
  passwords into ERP code or docs.
- **Where:** `docs/ui-audit/shots/<family>/<pageId>__<tab>__<v40|erp>__<width>.png` (git-ignored).

### B3. What to record per page / tab (Super User, then 4 more roles: Administrator, Department Manager Purchase TAL, Employee Stores TAL, Sales user TAL+SAW)
1. **Opens?** HTTP status, time to content, page errors, console errors.
2. **API calls:** method, URL, status, time (ms), rows returned, bytes.
3. **Data verdict**, one of:
   | Verdict | Meaning |
   |---|---|
   | OK | data shows |
   | EMPTY-OK | no data exists for this scope |
   | **NO-DATA-BUG** | the API returns rows but the screen shows nothing or "—"/0 |
   | **API-EMPTY** | the API returns nothing but the database has rows; check with a read-only count |
   | **API-ERROR** | 4xx/5xx |
   | **NO-API** | the screen shows fixed or fake numbers |
   | **WRONG-SCOPE** | rows from a plant not selected, or another person's own-only data |
4. **Breaks:**
   - layout overflow (page-wide sideways scroll);
   - overlapping elements;
   - dialogs not centred or shown at the bottom;
   - cut-off text or buttons;
   - tables wider than the screen with no scroll box;
   - wrapped button rows;
   - an empty white area;
   - text problems: "undefined", "NaN", "null", "[object Object]", "Invalid Date", "Arrives in Phase",
     raw status codes, missing translation keys, wrong date or money format.
5. **Buttons — V40 vs ERP** (from the DOM, not by eye):
   - list every V40 button on that page/tab (label and area: head row, record bar, row action cell,
     form footer, tab);
   - list every ERP button;
   - then mark each one: **PRESENT-WORKS / PRESENT-DEAD / PRESENT-PLACEHOLDER / MISSING / EXTRA /
     WRONG-PLACE / DUPLICATE**.
   - To test, click only safe buttons: open, view, tabs, filters, PDF/print/Excel/Word, ＋ New then
     Cancel, Edit then Cancel, History, 360°, Move Forward then Cancel, Email then Cancel.
   - Never click Save, Submit, Approve, Post, Delete or Send in Part B.
6. **Tabs, fields and columns vs V40:** missing / extra / renamed / different order.
7. **UI score**, 0–3 per area, total out of 30:
   1. page header and title area
   2. button placement
   3. table
   4. filters and search
   5. record view
   6. form
   7. empty, loading and error states
   8. consistency with the rest of the app
   9. phone and tablet
   10. V40 parity
8. Inline `style={{` count in the page's source.

### B4. Shell checks
- Sidebar: groups, desktop collapse, mobile drawer with backdrop, active item, favourites, recent.
- Top bar: does search work; is there a duplicate Menu button; plant/FY selector; bell; help; profile.
- Overlap between Home, Menu, My Dashboard, Owner Console and the department dashboard vs V40's single
  V39 department dashboard.
- Keyboard focus. axe on 30 pages. Lighthouse on Home, Sales Orders list, SO form, Department Inbox,
  Owner Console.

### B5. Issue list
- One row per problem, **UI-0001…**:
  - page, tab, role, width;
  - category: BREAK / BUTTON-MISSING / BUTTON-DEAD / LAYOUT / TABLE / FORM / DATA / API / TEXT /
    RESPONSIVE / PARITY / A11Y / SPEED / ACCESS;
  - severity:
    - **P0** = broken (crash, 5xx, blank, data missing while it exists, a role sees a page it must not);
    - **P1** = a V40 button missing or dead, or the layout broken;
    - **P2** = ugly or inconsistent;
    - **P3** = polish;
  - evidence: screenshot names, API URL and status, console text;
  - **owner WEB (Part C fixes it) or API (Phase 37).**
- Group repeats into root issues (e.g. "Move Forward missing on 41 pages").

### B6. Part B output
1. **`docs/ui-audit/UI-AUDIT-REPORT.md`** — the main document:
   - **Summary:**
     - pages total / opened OK;
     - P0 / P1 / P2 / P3;
     - data verdict counts;
     - V40 buttons missing / dead / placeholder / present;
     - average score;
     - pages by renderer.
   - **Top 25 root causes**, with pages affected and the fix approach.
   - **Per family:** pages, average score, P0, P1, missing buttons, worst 3 pages.
   - **The 30 slowest APIs and pages.**
   - **Shell findings.**
   - **"Needs Phase 37 (API / flow)" list.**
   - **The Part C plan:** the order of fixes.
2. CSV files:
   - `pages.csv`
   - `api-calls.csv`
   - `buttons.csv` (V40 vs ERP per button)
   - `issues.csv`
   - `parity.csv` (tabs/fields/columns)
3. **`docs/ui-audit/gallery.html`** (git-ignored, opens in a browser):
   - every page as one row with **V40 | ERP desktop | ERP tablet | ERP phone** pictures side by side;
   - its score, data verdict, missing-button chips and issue chips;
   - filters by family, severity and "missing buttons only".
4. Reusable tools: `npm run ui:audit` (options `--family=`, `--page=`, `--role=`, `--width=`), so the same
   audit can be re-run after every fix.

**Then post a short summary in `PHASE-36-REPORT.md`, commit locally** "chore(phase-36b): UI audit with
pictures", **and continue to Part C.** (If the owner has written `STOP AFTER B`, stop here instead.)

---

## PART C — Design and fix the UI (V40 standard, then better)
Fix in this order. After each step, re-run `ui:audit` on the pages touched and fix anything that got
worse.

### C1. Design system: the V40 look, made consistent
- **Port the V40 style layers V35, V36, V37 and V39** into the app's CSS. Today's CSS was copied from
  V9.2 (`reference/index.html`), which is why the ERP looks older than what the client saw.
- **Keep the V40 tokens:**
  | Token | Value |
  |---|---|
  | --bg | #f4f7fb |
  | --card | #fff |
  | --text | #172033 |
  | --muted | #64748b |
  | --line | #e2e8f0 |
  | --primary | #1d4ed8 |
  | --success | #16a34a |
  | --warn | #d97706 |
  | --danger | #dc2626 |
  | --side | #0f172a |
- **Type and sizes:**
  - Inter; 13px body and table text; 22–24px page titles;
  - card radius 15; buttons 34px with radius 9; inputs 34px;
  - the V36 table header (#f8fafc, sticky, uppercase); row hover;
  - the V40 sidebar gradient #0f172a → #111827; the V40 hero gradient on Home and dashboards only.
- **Improvements over V40 (the "wow"):**
  - spacing scale 4/8/12/16/24;
  - soft tinted status badges;
  - animated skeleton loading;
  - line-art empty states with one button;
  - count-up KPI numbers;
  - smooth slide-in for drawers;
  - 150 ms hover and press feedback;
  - a 3px focus ring;
  - Lucide icons used the same way everywhere;
  - the top bar gets a subtle shadow on scroll.
- **Shared components in `apps/web/src/ui/`:**
  - PageHeader; ActionRow; Button; SplitButton ▾; MoreMenu ⋯; StatusBadge (one status → word → colour
    map for all modules);
  - Field, TextInput, NumberInput, MoneyInput (₹ Indian commas), DateInput (dd-mm-yyyy);
  - **Combobox** (type-ahead with server search, replacing full-list dropdowns);
  - Tabs with ‹ › arrows (V36); DataTable (sticky header and first column, row action column, selection
    and bulk bar, pager "1–25 of N");
  - FilterBar, EmptyState, Skeleton, Drawer, Modal, Toast, ConfirmDialog, KpiCard, ChartCard.
- **`/admin/ui-kit`** page shows every component and state, for client approval.
- **Inline styles** reduced from 914 to fewer than 50. A lint rule blocks new ones.

### C2. Shell, as in V40 and better
- **Sidebar:**
  - V40 menu order and families;
  - **☰ collapses it on desktop** (V40 `menu-collapsed`);
  - accordion groups remembered; active item with a left bar;
  - ⭐ favourites and 🕘 recent at the top; pending badges;
  - on phones a drawer with a dark backdrop that closes on tap.
- **Top bar, as in V40:**
  - a **working** search box ("Search PO, SO, MO, DC, invoice or customer…") with type-ahead results;
  - plant and FY selectors, 🔔, help, profile;
  - **remove the duplicate "⊞ Menu" button**; "All modules" moves into the sidebar and Ctrl+K.
- **Phone:** a bottom bar with Home · Inbox · ＋ · Approvals · Menu.

### C3. Every V40 button, in the V40 place
- Remove the extra action bar that sits **above** the page title today.
- **Page head (V39 horizontal action row):** ← Return (V36), title, then the V40 head buttons in V40
  order: Excel, Industry PDF, Word, Print, ＋ Add, Edit, Delete, Documents, Submit Approval,
  Approval Queue, Move Forward, plus the V37 ⇧ Import / ⇩ Export / Duplicates.
  - **Improvement:** on screens narrower than 1280px, the less-used buttons fold into "⋯ More" in the
    same order, and nothing wraps onto two lines.
  - On phones the row scrolls sideways on one line (V39 rule).
- **Row action cell (V39 `v39-action-cell`) on every register:** the V40 row buttons (Open/Edit/PDF/
  Move Forward…, as V40 shows for that page).
- **Record view:** the V40 record bar: Edit, Submit/Approve/Reject, **Move Forward / Received /
  Accepted** (the existing `components/MoveForward.tsx`), PDF/Word/Excel, Email, History, 360°,
  Delete.
- **Form footer (V36):** "Save Record" / "Update Record" by mode, plus Cancel; Save as Draft and
  Save & Submit where approval applies.
- **Every button is wired to its existing handler.** The Word, PDF, Move Forward, approval queue,
  email, import and export code all already exist from Phases 21–31.
  - If the backend truly doesn't exist: greyed + "Not available yet: {reason}" + listed for Phase 37.
  - **No "Arrives in Phase…" text anywhere.**
- **Acceptance check:** for every page, `buttons.csv` shows 0 MISSING and 0 PRESENT-DEAD.

### C4. Fix every break
- Fix every Part B **BREAK**, layout overflow, broken dialog, overlapping element, cut-off text and
  wrapped button row.
- Fix every "undefined / NaN / [object Object] / Invalid Date" and raw status code (use StatusBadge words).
- Tables scroll inside their own box with a sticky header and first column. No page-wide sideways scroll
  at 390px.
- No modal on top of a modal; record → edit happens inside the same drawer or page.

### C5. Lists, record views and forms in the V40 way
- **Lists open table-first (V36):** the register tab is the first tab; dashboards/KPIs move to an
  "Insights" tab or button, as V36 hides them on working screens.
- The same register layout on every page:
  1. head row
  2. filter row (search, plant, date, status)
  3. table
  4. pager
- `ScreenPage`, `GenericModulePage` and `DocPage` get the **same look and behaviour**. Merging them into
  one engine is decided in Phase 37.
- **Forms (V36 master grid):**
  - V40 field order and labels;
  - 2-column grid; required *;
  - **source pickers that auto-fill**: company, customer/supplier, source document, as V40 does;
  - type-ahead Combobox for parties and items;
  - the **"Add Line" item toolbar** and line grid;
  - **totals panel: Taxable, CGST, SGST/IGST, Grand Total, amount in words**, as V40 shows — values
    from the API or display sums; tax rules stay in the API;
  - a sticky footer;
  - a warning on leaving with unsaved changes;
  - errors next to the field.
- **Do these 12 documents first:** Quotation, Sales Order, PR, PO, GRN, Incoming QC, Production Order,
  Delivery Challan, GST Invoice, Receipt, Purchase Invoice, Payment. Then masters, then all other pages.

### C6. Dashboard and Home as in V39
- **The V39 department workspace:** hero, 4 metrics, quick bar, and the **8 queue cards** (Receive
  Documents, Accept Responsibility, Complete Department Work, Approval Required, Employee Tasks, Shift &
  Handover, Visitor / Gate, Canteen / Meal), with live counts from the existing APIs.
- Home shows this workspace plus a **My Dashboard** tab. Remove duplicate entry points so the user lands
  in one obvious place.
- Charts: at most 3 colours, Indian numbers, drill-down.

### C7. Phone and tablet
- Breakpoints 1440 / 1280 / 1024 / 768 / 480.
- Single-column forms; line items as stacked cards; sticky Save bar.
- List rows as cards on phone; 44px tap targets; 16px inputs.
- Print CSS hides the shell and buttons.

### C8. Small web-side data fixes
- Fix every **NO-DATA-BUG** and every API-ERROR caused by the web code (wrong URL, parameter or field).
- Put API-owned problems in the Phase 37 list; don't redesign the API here.

### C9. Re-audit, with before and after pictures
- Run the full Part B audit again.
- The gallery gets a **"Before | After | V40"** view for every page.
- The report shows before → after per page and per family: score, P0/P1, missing and dead buttons,
  breaks, inline styles, Lighthouse, axe.

---

## 4. Database
- No schema change.
- Part A creates data only in the local `rhai_erp_ui` / `rhai_erp_e2e` database. The first Super User is
  created by the bootstrap script; everything else through the screens.

## 5. Texts
- One wording everywhere, using V40's words: "Save Record", "Update Record", "Move Forward", "Received",
  "Accepted", "Submit Approval", "Approval Queue", "Industry PDF", "Documents", "← Return".
- Empty state: "No {things} yet. Press ＋ Add to create the first one."
- Greyed button: "Not available yet: {reason}".
- Delete: "Type {doc number} to delete."
- Hindi strings for new texts.

## 6. Tests
- **Part A:** the feed itself; every step passes or is logged as a finding.
- **Part B:** unit tests for the data-verdict and scoring rules; a dry run on 5 pages; then the full run.
- **Part C:**
  - the re-audit;
  - component tests (render, keyboard, states);
  - visual snapshots of `/admin/ui-kit` and the 12 documents at 3 widths;
  - axe 0 serious on 30 pages;
  - crawler 0 console errors;
  - the Part A feed re-run still passes (the redesign must not break data entry).
- Run suites one at a time.

## 7. Acceptance
**Part A**
- [ ] The local database is filled through the screens for every module in A2.
- [ ] DATA-FEED-LOG lists every failure.

**Part B**
- [ ] Every page and tab has V40, desktop, tablet and phone pictures.
- [ ] API calls, data verdict, V40 button comparison and score recorded.
- [ ] Report, CSVs and gallery written.

**Part C**
- [ ] **0 V40 buttons missing, 0 dead buttons, 0 "Arrives in Phase".**
- [ ] 0 breaks at 390 / 1024 / 1440.
- [ ] 0 WEB-owned P0/P1 issues.
- [ ] Every page has the same V40 head row and register layout, and opens table-first.
- [ ] The 12 main documents have the V36 form with source auto-fill, Add Line and the GST totals panel.
- [ ] Home = the V39 workspace.
- [ ] Average score ≥ 25/30, no page below 18.
- [ ] Inline styles < 50.
- [ ] Lighthouse accessibility ≥ 90 and performance ≥ 80 (desktop) on the 5 key pages.
- [ ] `/admin/ui-kit` ready.
- [ ] Login screen unchanged.
- [ ] Before/after gallery.

## 8. Out of scope (Phase 37)
- API speed and redesign.
- Missing backend for greyed buttons.
- New business flows or conversions.
- New modules.
- Deploy.

## 9. Owner check
1. **After A:** open the ERP locally. Do Sales Orders, POs, Invoices, Attendance and Department Inbox
   all have data? Read DATA-FEED-LOG: which forms failed?
2. **After B:** open `gallery.html`, filter "missing buttons". Is every page where the client saw
   buttons missing listed, with the V40 picture next to it? Send `UI-AUDIT-REPORT.md` to the planner
   chat.
3. **After C:** open the gallery "Before | After | V40" view, then the real app on your phone and
   laptop: Sales Orders, an SO, the SO form, Home, Department Inbox. Does it look like V40 or better,
   with every button there?

## 10. Build prompt
~~~
You are the senior UI/UX designer and front-end developer of this ERP. The approved V40 HTML
(RHAI_ERP_V40_Edit_Update_Fixed.html) is the UI and user-flow reference; match it page by page and
make it better, never less.

Read CLAUDE.md, STANDARDS, ROADMAP, ERRATA, PHASE-36.md, PARITY.md, packages/registry/registry.v2.json
and the V40 HTML (read-only).

PART A: create the local DB rhai_erp_ui, migrate, create ONLY the first Super User with the bootstrap
script, then enter all A2 data through the screens with Playwright as the right roles. Write
DATA-FEED-LOG.md. Commit locally.

```PART B: audit every page/tab/record/form for the 5 roles: pictures V40 | ERP 1440 | 1024 | 390, API
```calls, data verdict, V40-vs-ERP buttons, tabs/fields, breaks, score. Write UI-AUDIT-REPORT.md, the
CSVs and gallery.html; add `npm run ui:audit`. Commit locally. Continue to Part C unless the owner
wrote STOP AFTER B.

PART C: do C1→C9 in order, re-auditing after each step. Every V40 button present and working (or
greyed with a reason and listed for Phase 37). Fix every break. Keep the login screen unchanged.

One Chromium, batches of 20, resumable, pause below 1.5 GB free memory, never two test runs at once.
Local database only. Never push, never deploy, never touch production, never read secrets. Commit
locally per part and state "No DB schema changes". At the end update PHASE-36-REPORT.md,
PROGRESS-R2.md, docs/clicntmassage.md and docs/client-test-guide.md.
~~~

## 11. Client documents (end of Part C)
**clicntmassage.md — NEW:**
- The whole ERP has been redesigned to match the approved design screen by screen:
  - every button from the design is now on every page, in the same place;
  - screens no longer break on smaller laptops, tablets or phones;
  - one clean look everywhere;
  - a working search bar;
  - a collapsible menu;
  - order forms with search-as-you-type and a full GST totals panel;
  - the department dashboard with the 8 work cards.

**client-test-guide.md — add:**
- **Anyone:** open any page you checked before. ✔️ The same buttons as the approved design, in one row.
- **Sales:** Sales Orders → ＋ Add → choose a customer. ✔️ Address/GSTIN fill in; Add Line; the Grand
  Total panel shows CGST/SGST.
- **Any manager:** Home. ✔️ 8 work cards with counts.
- **Phone:** open the ERP. ✔️ No sideways scrolling; buttons in one sliding row.




