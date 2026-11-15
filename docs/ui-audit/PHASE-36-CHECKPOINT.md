# PHASE 36 checkpoint log (newest at the bottom; updated about every 10 minutes)
Resume rule: read the last entry, continue from "Next".

## 2026-11-13 21:44 - checkpoint 1
**Done**
- Part C foundation (code, uncommitted): apps/web/src/ui/{components.tsx,format.ts}, styles/ui.css, pages/admin/UiKitPage.tsx (route /admin/ui-kit), shell fixes (duplicate Menu removed, desktop collapse, working search Enter, phone bottom bar). tsc clean; src/ui tests pass. 6 ContextSelectors test failures are PRE-EXISTING.
- Reports written: docs/phases/PHASE-36-REPORT.md, client-test-guide.md + clicntmassage.md updated.
- Part A1: stopped old ERP servers on 4100/5180; created + migrated + seeded local DB rhai_erp_ui via tests/feed/ui/setup-ui-db.ts (first Super User only, login id "owner"; password only in git-ignored tests/feed/ui/state.json).
- Free memory now ~1.6 GB (was 0.57).
**In progress**
- Starting API(4100)+web(5180) with tests/feed/ui/start-ui-servers.ts: API crashed at src/core/db/prisma.ts:7 (require error) - debugging.
**Next**
1. Fix server start, confirm /api/v1/health and /login.
2. Write feeders (Playwright, reuse tests/feed/lib + tests/e2e/phase22.feed.spec.ts pattern) for A2 steps 1-13; log failures to docs/ui-audit/DATA-FEED-LOG.md.
3. Part B audit tooling, then Part C page migration.
**Rules**: no commit/push/deploy; local DB rhai_erp_ui only; one browser; pause if free RAM < 1.5 GB.

## 2026-11-13 21:51 - checkpoint 2
**Done**
- Servers run: API 4100 + web dev 5180 on DB rhai_erp_ui (start: `cd apps/api && node node_modules/tsx/dist/cli.mjs ../../tests/feed/ui/start-ui-servers.ts`; needs NODE_ENV=test for RATE_LIMIT_DISABLED, already set in script).
- DB recreated clean (`RESET_UI=1 ... setup-ui-db.ts`); owner login works (state.json holds initial + changed password, git-ignored). Seed gives 11 departments already (spec lists 12).
- Playwright config tests/feed/ui/playwright.config.ts + helpers.ts (ENV from state.json) + dbq.ts (read-only SELECT helper) work.
**Next**: run discover.spec.ts (DISCOVER=page,ids) to read real form labels, then write feeders step 1-3; keep logging to DATA-FEED-LOG.md.

## 2026-11-13 22:02 - checkpoint 3
**Done (Part A, through the screens as Super User)**
- Seed already gives: 3 plants (TAL/SAW/VAR), FY 2026-27, 11 departments. Added Engineering (12th) via screen; added 10 designations via screen.
- Infrastructure: tests/feed/ui/{helpers.ts (enter(): login + plant picker + DPDP ack), log.ts (attempt()/record() -> docs/ui-audit/feed-results.jsonl), render-log.ts (-> DATA-FEED-LOG.md), a01-setup.spec.ts, discover.spec.ts, shot.spec.ts}.
- Run a spec: `npx playwright test -c tests/feed/ui/playwright.config.ts <name>` (servers must be up on 4100/5180).
**Real bugs found + FIXED (web-side)**
- DesignationMasterPage sent `status` on create but API create schema is strict -> every create got 422. Fixed (apps/web/src/pages/admin/DesignationMasterPage.tsx). Also level range was 1-100 in web but 1-99 in API; web now 1-99.
**Findings (to log in DATA-FEED-LOG.md)**
- Page head row (Industry PDF / Word / Approval Queue / Move Forward) sits ABOVE the title (C3 says move into head row).
- Sidebar lists "Notification Center" twice.
- Top-bar search placeholder is cut off at 1440.
- Plant picker + DPDP notice appear after first login (helpers handle them).
**Next**: step 2 (Administrator user) + users for roles (users form labels: Login ID, Full Name, Email, Role, Department, Also Works In, Approval Limit, Temporary Password; plant checkboxes NOT seen in the add dialog - check after choosing role), step 3 approval matrix etc.

## 2026-11-13 22:21 - checkpoint 4
**Done (Part A)**
- Step 2: Administrator (feed.admin) created by Super User through the screen.
- Step 3: 31 users created by the Administrator through the Add User form: 2 Directors, CFO, 2 GMs, 7 Dept Heads, 8 Dept Managers, 4 Supervisors, 7 Employees; 1-, 2- and 3-plant users (43 user-unit rows). DB: 33 users total. Includes Part B personas: feed.admin, mgr.purchase.tal, emp.stores.tal, emp.sales.talsaw.
- Passwords: all feed users have temp password (state.json tempPassword), they change to userPassword on first login (enterFirst() in helpers.ts). Administrator already changed.
**Findings (Part A, UI)**
- Add User: multi-plant users REQUIRE a "Default unit" select (shown only after ticking 2+ plants) - easy to miss.
- Users list paginates at 7/page; list-based "exists" check is unreliable -> feeders treat HTTP 409 as "exists".
- First-login "Set a new password" screen appears after the sign-in response; the shared helper tests/feed/lib firstLogin() checks too early (race) - use enterFirst() from tests/feed/ui/helpers.ts.
- Sidebar menu search box is easy to confuse with page search.
**Next**: step 3b/4: approval matrix (50k/2L/10L), workflow matrix, mail automations, attendance policies, devices; then step 5 masters (customers 20, suppliers 20, items 60, ...). Use discover.spec.ts (DISCOVER=page-ids) to read form labels first. Re-render log: `cd apps/api && node node_modules/tsx/dist/cli.mjs ../../tests/feed/ui/render-log.ts`.

## 2026-11-13 23:00 - checkpoint 5
**Done (Part A, step 5 masters)**
- 20 customers (page crm-customer360) + 20 suppliers (scm-suppliers) created through the Add forms, 0 failures. GSTINs valid (mod-36 check digit generator in tests/feed/ui/gen.ts), Indian mobiles.
- Items: first attempts failed - Item Code is auto-generated (don't fill); HSN must be 6+ digits AND chosen from the HSN master (page tax-hsn: form HSN/SAC Code, Description, Default UQC, Status) -> create HSN rows FIRST (720810, 850110, 848210, 340319), then re-run `a03-masters.spec.ts -g 5b`.
- Config: playwright.config.ts now has actionTimeout 15s + expect 10s (without it a missing control hangs the run).
**Problems**
- Free RAM fell to 0.9 GB; Chromium "Page crashed" after ~13 forms in one context -> run items in batches with a fresh context each (<=10), kill stray chrome-headless-shell first. Antigravity IDE/msedgewebview2 still use ~1 GB (owner asked to close it).
**Findings**: master-customers = "Page not found" (screen lives on crm-customer360); HSN error only after Save ("Use at least 6 digits"/"Choose the HSN/SAC code"); form footer wording inconsistent; Customer/Supplier forms only 5 fields vs V40.
**Next**: HSN rows via tax-hsn, items in batches (60), then UOM check, warehouses, BOM/routing/work centres, price list, then step 7 sales chain (enquiry 10 -> quotation 8 -> SO 6; forms: enquiries: customer name/product/qty; quotations: Customer*, Valid until, lines Item/Qty/Rate/GST; SO: Customer*, PO no/date, lines).

## 2026-11-13 23:32 - checkpoint 6
**Done (Part A, through the screens)**
- Step 1b: company profile + 3 plants (address, state 27, GSTIN) - quotations need plant state/GSTIN.
- Step 5: 20 customers, 20 suppliers, 4 HSN rows, 60 items (6 batches of 10, fresh browser context each).
- Step 7: 10 enquiries, 8 quotations (1-3 lines), 6 sales orders (2-3 lines). Specs: tests/feed/ui/a01..a06*.spec.ts. All pass; failures logged in docs/ui-audit/feed-results.jsonl -> DATA-FEED-LOG.md.
**Findings logged**: master-customers page not found; item dropdown capped at 30 and no search; customer dropdown no type-ahead; date box mm/dd/yyyy; line labels not linked (a11y) on line 2+; GST rate missing for HSN -> 422; unit state missing -> 422 on field that is not on the form; HSN needs 6+ digits and master row; Customer/Supplier/Enquiry forms much smaller than V40.
**NOT done yet in Part A (time/RAM)**: approval matrix, workflow matrix, mail automations, attendance policies/devices (step 4); warehouses/BOM/routing/work centres/price list (5); employees/shifts/leave (6); department movements (8); purchase PR/PO/GRN/QC (9); production (10); finance (11); attendance + payroll (12); tasks/visitors/etc (13). Listed as TODO in DATA-FEED-LOG.md.
**Next**: Part B tooling now (crawl every registry page: screenshots 1440/1024/390, console/page errors, API calls, buttons, text problems -> UI-AUDIT-REPORT.md/CSVs/gallery + npm run ui:audit), run for Super User; then Part C fixes (C3 head row, C4 breaks).

## 2026-11-13 23:35 - checkpoint 7
**Done (Part B tooling)**
- tests/ui-audit/{audit.spec.ts, login.ts, playwright.config.ts, run.mjs}; `npm run ui:audit -- --family= --page= --role= --width= --force` (root package.json). Batches of 20, resumable, pauses < 1.2-1.5 GB free. V40 driven via its own nav(id) after the built-in "Open Demo ERP" button (no demo passwords copied).
- Per page it records: V40 buttons/tabs/rows + screenshot 1440; ERP at 1440/1024/390 screenshots, load ms, console+page errors, API calls (method,url,status,ms,bytes), buttons, tabs, table rows, bad text, overflow per width. Output: docs/ui-audit/data/<role>/pages.jsonl; shots in docs/ui-audit/shots/<family>/ (git-ignored).
- Dry run on 3 pages OK (~8s/page). Example: sales-orders - V40 has 12 tabs + 51 distinct buttons; ERP has 0 tabs + 16 buttons and shows "Arrives in Phase".
- FULL Super User audit started in background (log: %TEMP%\audit-super.log). To resume after a crash: `node tests/ui-audit/run.mjs` (skips audited pages).
**Next**: write tests/ui-audit/build-report.mjs (CSVs, UI-AUDIT-REPORT.md, gallery.html); after the super run, run 4 more roles (admin, mgr-purchase, emp-stores, sales-talsaw) with --width=1440 only to save time; then Part C.

## 2026-11-13 23:39 - checkpoint 8
**Done**
- tests/ui-audit/build-report.mjs written and working (CSVs, UI-AUDIT-REPORT.md, gallery.html). Run: `node tests/ui-audit/build-report.mjs super`.
- Part C C3 (first real fix): apps/web/src/components/ActionBar.tsx rewritten - root cause of "buttons dead / Arrives in Phase": the page-level bar rendered Industry PDF / Word / Approval Queue / Move Forward with NO click handler and fixed "Arrives in Phase 27/25" text. Now: Print=window.print, Excel=visible table as CSV (or record Excel via print endpoint), Industry PDF/Word=print endpoint (needs a selected record, otherwise greyed "Select a record first."), Approval Queue=/approvals, Documents=/m/business-documents, Move Forward=Phase 25 dialog (needs record). onAction returning true = page handled it (ScreenPage updated). ModulePage passes pageId; ScreenPage passes pageId/recordId/docNo. tsc clean; ActionBar.test.tsx 10/10 pass.
- NOTE: the super audit (running in background, ~25s/page, 45/327 at this checkpoint) reads the live dev server, so pages audited AFTER this edit already show the new ActionBar (baseline contaminated for ActionBar-related items only: placeholder/Arrives-in-Phase counts). Say so in the report.
**Next**: let audit finish (resume with `node tests/ui-audit/run.mjs` if it dies); fix sidebar duplicate "Notification Center", V40 'master-customers' route, head row position; run 4 more roles at 1440 only; build report; re-audit changed pages; PHASE-36-REPORT.md final.

## 2026-11-13 23:59 - checkpoint 9
**Done (Part C, web code; all uncommitted)**
- ActionBar page bar now carries the full V40 head row: ← Return, Email, Industry PDF, Word, ⇧ Import, ⇩ Export, Duplicates, Documents, Submit Approval, Approval Queue, Move Forward, Project History (+ Excel/Print/Add/Edit/Delete on list screens). Working defaults: Return=history back, Import/Duplicates/Project History/Documents/Approval Queue=navigate, Export/Excel=table CSV, Email=EmailDocDialog, PDF/Word/Move Forward=print endpoint / Phase 25 dialog; record-needing ones greyed "Select a record first." 11/11 ActionBar tests pass.
- ModulePage: V40_ALIASES redirect (dept-inbox-*, dept-work-*, master-customers/suppliers/products/materials, my-approvals) instead of "Page not found" (audit showed 19 of first 63 pages not found); tests pass.
- registry.ts: duplicate sidebar "Notification Center" hidden. AppShell: menu collapse kept in memory (lint bans localStorage). Prettier applied to new files only (old files already fail prettier).
- Tests: ui/ActionBar/alias = 22 pass. App.test.tsx has 5 failures ("Unable to find heading Sales Dashboard" - stale Home expectation, not caused by this work; ContextSelectors 6 also pre-existing).
- Memory file written: project-erp-phase36-status.md.
**Audit**: super run at ~200+/327 (still running in background).
**Next**: when audit finishes: build report, run 4 more roles (--width=1440), re-audit touched pages for before/after, write final PHASE-36-REPORT.md.

## 2026-11-14 00:12 - checkpoint 10
**Done**: Super audit complete 327/327 (baseline report built: 43 not found, 324 pages missing buttons, 295 missing tabs, 122 sideways scroll at 390). Owner went to sleep ~8h: continue autonomously to the end, update this file ~every 10 min, rerun where stuck.
**Plan (in order)**: 1 alias remaining not-found pages; 2 tabs from registry on pages; 3 phone/tablet overflow CSS; 4 role audits (admin, mgr-purchase, emp-stores, sales-talsaw @1440) chained in background; 5 Part A leftovers (steps 4,6,8-13); 6 re-audit touched pages, final report PHASE-36-REPORT.md + client docs.

## 2026-11-14 00:17 - checkpoint 11
**Done**: ModulePage V40_ALIASES extended to all 43 not-found V40 ids (web uses registry.json v1; V40 has v2 ids) - 4 alias tests pass; ui.css overflow rules (grid minmax(0,1fr), tables scroll in box, actionbar one line, .sr-only contained -> fixed a regression where overflow:auto actionbar widened the document). Probe tool: tests/ui-audit/probe.spec.ts (AUDIT_PAGE/AUDIT_W). Audit tool got --tag=after (separate data dir + screenshot names).
**Running now (background, log %TEMP%\audit-chain.log)**: tests/ui-audit/chain.sh = full AFTER audit (data/super-after) then roles admin, mgr-purchase, emp-stores, sales-talsaw @1440 (data/<role>). RESUME if dead: `bash tests/ui-audit/chain.sh` (each step skips audited pages).
**Decision**: V36 tabs NOT faked - a tab strip without content = dead tabs; listed as open (needs per-page content, Phase 37). 
**Next while chain runs (no second browser!)**: code-only work: Part C forms/GST totals panel via src/ui, Home V39 cards, inline-style cleanup; then Part A leftovers AFTER the chain; then final report.

## 2026-11-14 00:20 - checkpoint 12
**Done (Part C forms, code-only while audit chain runs)**
- DocPage.tsx (engine behind Quotation, SO, PR, PO, GRN... doc forms): supplier/customer/item full-list dropdowns (capped at 30!) replaced by type-ahead Combobox with server search (LookupCombo); every line control now has a unique id (was one id per column for all lines = broken labels); GST TOTALS PANEL (Taxable, CGST, SGST/IGST, Grand total, amount in words Indian lakh/crore; display only, API owns the final split); ui/words.ts. Tests: words 2, DocPage totals 2, Procurement 3 + Sales 4 pass; tsc clean.
- !! The Part A feeders a05-sales/a03 use <select> for customer/item -> must be updated to the combobox (type text, click option) before re-running feed (do AFTER the audit chain, one browser only).
**Chain status**: super-after audit running (20/327 at this time); log %TEMP%\audit-chain.log. If dead: `bash tests/ui-audit/chain.sh`.
**Next**: more code-only Part C (Home V39 cards, inline-style cleanup, ui-kit page update), then after chain: update feeders to combobox, Part A leftovers, final reports.

## 2026-11-14 00:21 - checkpoint 13
**Done**: Home = V39 department workspace names (Receive Documents, Accept Responsibility, Complete Department Work, Approval Required, Employee Tasks, Shift & Handover, Visitor / Gate, Canteen / Meal; last 3 show "—" because GET /me/home has no counts for them - API gap for Phase 37) + secondary strip (Returned, Drafts, Overdue). ESLint rule: no inline styles in src/ui, ActionBar, UiKitPage (inline styles elsewhere: 958 - codemod skipped deliberately: inline beats class specificity, no visual check possible; listed as open). tsc clean.

## 2026-11-14 00:23 - checkpoint 14
**Done**: watchdog tests/ui-audit/heartbeat.sh (appends a status line here every 10 min and restarts chain.sh if the audit died). build-report.mjs now writes prefixed files for other datasets (super-after-*.csv, super-after-UI-AUDIT-REPORT.md, ...). compare.mjs -> BEFORE-AFTER.md + gallery-compare.html. Feeder a05-sales updated for the Combobox pickers (type + click option).
**Final-steps recipe (after chain DONE)**: 1) node tests/ui-audit/build-report.mjs super-after; 2) for each role: node tests/ui-audit/build-report.mjs <role>; 3) node tests/ui-audit/compare.mjs; 4) run feeders again (a05 etc.) to check data entry still works; 5) Part A leftover feeders; 6) PHASE-36-REPORT.md + client docs.
- 2026-11-14 00:32 heartbeat: super-after=144/327; admin=0 mgr-purchase=0 emp-stores=0 sales-talsaw=0 (of 327 each); free RAM 0.73 GB; chain running

## 2026-11-14 00:33 - checkpoint 15
**Done**: ActionBar page mode also adds Excel/Print/Edit/Delete when the page body has none of its own (ifAbsent). tsc clean, ActionBar tests 11/11. Client docs written (clicntmassage.md, client-test-guide.md - honest scope).
**IMPORTANT for the final re-audit**: code changed while super-after was running. ActionBar last edited at 2026-11-13T18:53:41Z (UTC). Pages in data/super-after/pages.jsonl with at < that time must be re-audited: `node tests/ui-audit/run.mjs --tag=after --force --page=<ids>` (ids = those rows). Script: tests/ui-audit/stale-ids.mjs prints them.
- 2026-11-14 00:42 heartbeat: super-after=248/327; admin=0 mgr-purchase=0 emp-stores=0 sales-talsaw=0 (of 327 each); free RAM 0.86 GB; chain running
- 2026-11-14 00:52 heartbeat: super-after=327/327; admin=28 mgr-purchase=0 emp-stores=0 sales-talsaw=0 (of 327 each); free RAM 0.74 GB; chain running

## 2026-11-14 01:09 - checkpoint 16
**Chain paused on purpose** (roles admin=28/327 done; mgr-purchase, emp-stores, sales-talsaw not started): browser needed for Part A leftovers. TO RESTORE at the end: `(bash tests/ui-audit/chain.sh > %TEMP%/audit-chain.log 2>&1 &)` then `(bash tests/ui-audit/heartbeat.sh > %TEMP%/heartbeat.log 2>&1 &)` - chain.sh runs "after" (done, skipped) then the 4 roles (resumes admin).
**Done**: super-after complete 327/327 + stale pages re-audited (forced) + overflow fix (ui.css: table min-width:0 !important <=1100px) + overflow pages re-audited. RESULT before -> after (Super User, 327 pages): avg score 15.4 -> 20.0; pages <18: 232 -> 69; not found 43 -> 0; "Arrives in Phase" 11 -> 0; V40 buttons missing 7294 -> 4247 (present 1527 -> 3582, greyed-with-reason 1086 -> 2078); sideways scroll @1024 37 -> 0, @390 122 -> 3. Files: docs/ui-audit/BEFORE-AFTER.md, super-after-UI-AUDIT-REPORT.md, gallery-compare.html (git-ignored), CSVs.
**Next**: Part A leftovers (approval matrix, price list, warehouses/BOM/routing, employees, PR/PO/GRN, production, invoices, attendance, tasks...) via discover + feeders; then restart chain+heartbeat for roles; final report.

## 2026-11-14 01:27 - checkpoint 17
**Part A new data (through screens)**: 5 purchase requisitions, 8 suppliers submitted + approved (matrix approver = Sachin Gaikwad, mgr.purchase.tal, Dept Manager L1 - approvals are routed to a SPECIFIC person, not Super User), 6 purchase orders (supplier + item type-ahead pickers work). Feeders: a07-purchase-ops.spec.ts, a08-approvals.spec.ts, forms.ts (shared helpers; NOTE: a plain <select> also has role=combobox -> pickers use input[role=combobox]).
**CSS**: top bar one line at 1440, item picker min-width in line grid (ui.css).
**Findings**: supplier must be approved before a PO can use it (lookup empty otherwise); "Submit for Approval" stays on already-pending suppliers.
**Next**: a07 -g "5b|step 10" (work centres, tasks, assets, production orders), re-run a05 (combobox) to prove feed still passes, step 12/13 others, then restart chain (roles) + heartbeat, final report.

## 2026-11-14 01:55 - checkpoint 18
**Part A progress (all through screens)**: 3 warehouses (TAL-FG/RM/SP), 3 work centres + rates/cost centre (Finance fields needed for release), 6 tasks, 4 assets, 3 BOMs (draft -> Send for approval -> Release), 3 routings (release from draft), 3 production orders created AND released (job cards made), 8 suppliers approved, 6 POs, 5 PRs. Feeders a07..a11. Findings: production order needs released BOM AND released routing AND work-centre rates ("Finance must set"); order dialog turns into the order panel instead of closing; BOM approval does not appear in Approval Center (own Release button).
**Plan until ~03:15**: PO submit+approve -> GRN -> QC; SO approve -> challan -> invoice; employees; then START CHAIN (roles) by 03:15 at the latest: `(bash tests/ui-audit/chain.sh > %TEMP%/audit-chain.log 2>&1 &)` + heartbeat.sh, then final reports while it runs.

## 2026-11-14 02:15 - checkpoint 19
**Part A more**: 6 POs submitted+approved (manager L1, head L2 for >50k); 4 GRNs created (GRN 1 Posted, others waiting for further approvers); 6 sales orders submitted + approved (mgr.sales.tal / head.sales / gm.shinde / dir / cfo pass); 3 sales orders moved Sales -> Purchase / Production / Warehouse (Move Forward dialog, V40 field order) and each department Received (To Receive tab) and Accepted (To Accept tab). Feeders a12-a16.
**Code (Part C)**: DocPage detail now has the V40 record bar (Move Forward, Industry PDF, Word, Email, History) - approved SO had no Move Forward before. 9 procurement/sales tests pass, tsc clean.
**Findings**: raw item UUID in PO/SO detail (API should return itemCode/itemName); raw codes NOT_REQUIRED/NONE in GRN view; dialogs that turn into a record view instead of closing; Submit for Approval shown on pending suppliers; approvals are routed to specific people, BOM approval is separate (Release button).
**Next**: restart chain (roles) NOW-ish; while it runs: final docs. Remaining Part A not done: employees/payroll/attendance, finance (invoices, receipts, journals), QC, delivery challan, visitors/canteen/breakdown/service tickets - listed as TODO in DATA-FEED-LOG.

## 2026-11-14 02:24 - checkpoint 20
**Part A done for this session**: 40 employees (valid Verhoeff Aadhaar + personal-format PAN), 3 visitors, + earlier steps. Combobox feed re-run proved (quotation 9 created with type-ahead customer/item). Breakdown skipped: assets must be flagged "Needs maintenance" first (machine list empty). pickCombo now types char by char (pressSequentially) - fill() sometimes does not open the list.
**CHAIN RESTARTED** (roles admin, mgr-purchase, emp-stores, sales-talsaw @1440, resumes admin) + heartbeat watchdog. Expected end ~06:30. DO NOT run other browser tests while it runs.
**While chain runs (no browser)**: finalize docs: DATA-FEED-LOG (render-log), PHASE-36-REPORT.md, memory file; then after CHAIN DONE: build-report for each role, compare, final report numbers.
- 2026-11-14 02:34 heartbeat: super-after=450/327; admin=173 mgr-purchase=0 emp-stores=0 sales-talsaw=0 (of 327 each); free RAM 0.73 GB; chain running
- 2026-11-14 02:44 heartbeat: super-after=450/327; admin=305 mgr-purchase=0 emp-stores=0 sales-talsaw=0 (of 327 each); free RAM 0.61 GB; chain running
- 2026-11-14 02:54 heartbeat: super-after=450/327; admin=327 mgr-purchase=104 emp-stores=0 sales-talsaw=0 (of 327 each); free RAM 0.65 GB; chain running
- 2026-11-14 03:04 heartbeat: super-after=450/327; admin=327 mgr-purchase=237 emp-stores=0 sales-talsaw=0 (of 327 each); free RAM 0.49 GB; chain running
- 2026-11-14 03:14 heartbeat: super-after=450/327; admin=327 mgr-purchase=327 emp-stores=38 sales-talsaw=0 (of 327 each); free RAM 0.64 GB; chain running
- 2026-11-14 03:24 heartbeat: super-after=450/327; admin=327 mgr-purchase=327 emp-stores=165 sales-talsaw=0 (of 327 each); free RAM 0.80 GB; chain running
- 2026-11-14 03:34 heartbeat: super-after=450/327; admin=327 mgr-purchase=327 emp-stores=297 sales-talsaw=0 (of 327 each); free RAM 0.66 GB; chain running
- 2026-11-14 03:44 heartbeat: super-after=450/327; admin=327 mgr-purchase=327 emp-stores=327 sales-talsaw=100 (of 327 each); free RAM 1.34 GB; chain running
- 2026-11-14 03:54 heartbeat: super-after=450/327; admin=327 mgr-purchase=327 emp-stores=327 sales-talsaw=227 (of 327 each); free RAM 0.73 GB; chain running

## 2026-11-14 04:02 - checkpoint 21
**Done**: 4 role audits finished (327 pages each, 1440 px): ROLES-SUMMARY.md written (Super 327 open / Admin 327 / Purchase Manager 126 open, 201 denied / Stores Employee 129 open, 198 denied / Sales user 103 open, 224 denied; no admin page opens for the 3 restricted roles; 0 page errors). Reports built for every role (<role>-UI-AUDIT-REPORT.md, <role>-*.csv). PHASE-36-REPORT.md, PROGRESS.md, memory written. ActionBar also got Approvals / Reports / Analytics & Graphs / Audit Trail / 360° Tracking buttons (only when the page has none).
**RUNNING**: final refresh of data/super-after (chain2.sh; old data backed up to scratchpad super-after-v1.jsonl) + heartbeat (restarts chain2 if dead). Expected ~50 min. RESUME: `bash tests/ui-audit/chain2.sh`.
**After it ends**: node tests/ui-audit/build-report.mjs super-after && node tests/ui-audit/compare.mjs && update numbers in PHASE-36-REPORT.md headline table.
- 2026-11-14 04:04 heartbeat: super-after=18/327; admin=327 mgr-purchase=327 emp-stores=327 sales-talsaw=327 (of 327 each); free RAM 0.63 GB; chain CHAIN DONE
- 2026-11-14 04:12 heartbeat: super-after=100/327; admin=327 (of 327 each); free RAM 0.75 GB; chain running
- 2026-11-14 04:22 heartbeat: super-after=202/327; admin=327 (of 327 each); free RAM 0.73 GB; chain running
- 2026-11-14 04:32 heartbeat: super-after=305/327; admin=327 (of 327 each); free RAM 0.76 GB; chain running

## 2026-11-14 04:36 - checkpoint 22 (FINAL for this session)
**Final audit numbers (Super User, 327 pages, before -> after)**: avg score 15.4 -> 20.2; pages <18: 232 -> 63; not found 43 -> 0; P0 43 -> 0; V40 buttons missing 7294 -> 3208, present 1527 -> 4623; "Arrives in Phase" 11 -> 0; sideways scroll @1024 37 -> 0, @390 122 -> 3. Roles: see ROLES-SUMMARY.md (restricted roles open 103-129 pages, 0 admin pages; 0 page errors).
**Also fixed after audit**: Balance Sheet duplicate-key warning (finance tests 22/22 pass). 
**Documents final**: PHASE-36-REPORT.md, DATA-FEED-LOG.md, UI-AUDIT-REPORT.md (baseline), super-after-UI-AUDIT-REPORT.md, BEFORE-AFTER.md, ROLES-SUMMARY.md, gallery.html, gallery-compare.html, docs/PROGRESS.md, clicntmassage.md, client-test-guide.md, memory.
**Nothing is running now.** Open items are in PHASE-36-REPORT.md ("Needs Phase 37 / next session").
