 PART A — HOW TO RUN (the master prompt)
  ------------------------------------------------------------------------------------------------------------------

  A0. RESUME FIRST — do this every time you are started or this file is pointed to again
   1. Run `date`. Read docs/build/STATE.json and the last 40 lines of docs/build/JOURNAL.md (create them if missing — A2).
   2. If STATE.json status = "working" and heartbeat < 12 minutes old and you are the session doing it:
      append "<time> | check-in | still on <task>" and continue the same task.
   3. If the heartbeat is older than 12 minutes, or you don't remember the work → CRASH RECOVERY:
      a) journal "<time> | RECOVERY | was on <task> step <step>";
      b) `git status --short | head -50`; never discard changes; finish or repair half-edited files until typecheck passes;
      c) list, then stop only this repo's leftover node processes (ports 4100, 5180, 5173, e2e API); never other programs;
      d) run Tier 1 tests (A5) for the current task; continue from STATE.json "nextStep".
   4. If all phases 37–54 are in phasesDone → write the FINAL SUMMARY (A9) and stop.
   5. Otherwise start/continue the first phase not in phasesDone.

  A1. READ (once per phase, and whenever unsure)
   - CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md, ERRATA.md, the previous PHASE-XX-REPORT.md, docs/ui-audit/ (Phase 36 audit).
   - This file, Part B (rules), Part C (V40 reference), and the Part D section of the current phase.
   - V40 = RHAI_ERP_V40_Edit_Update_Fixed.html. Pages/tabs/fields/buttons come ONLY from packages/registry/registry.v2.json.

  A2. JOURNAL — crash trail (mandatory)
   Files (create on first run; commit with each phase):
   - docs/build/JOURNAL.md (append-only), one line per event:
     "<YYYY-MM-DD HH:MM> | Phase XX | T-XX-n | step | what was done | files | next"
   - docs/build/STATE.json (overwrite):
     {"phase":"41","task":"T-41-3","step":"plan|build|test|fix|review|commit","status":"working|blocked|done",
      "heartbeat":"<ISO>","nextStep":"<exact next action>","agents":[{"id":"","task":"","files":[]}],
      "phasesDone":[],"lastGreen":"<ISO of last passing typecheck>"}
   - docs/build/PHASE-XX-TASKS.md — the phase's task list with [ ] / [x].
   - docs/build/OWNER-ACTIONS.md — things only the owner can do (keys, devices, sign-offs), each with exact steps.
   Rules: update heartbeat + one journal line at least EVERY 10 MINUTES and after every task, test run, agent start/finish,
   error, decision, commit and recovery. Use `date`, never guess times. Before any command longer than 5 minutes, write
   "starting …" first, then the result after. The journal must let a brand-new session continue with no other context.

  A3. EACH PHASE — the cycle
   1. PLAN (≤ 15 min): read the phase in Part D. Build the V40 parity table for its pages from registry.v2.json
      (page → tabs / fields / buttons: present in ERP vs V40) → top of PHASE-XX-REPORT.md as "Before".
      Split into tasks T-XX-1…n (each ≤ 2 h) in PHASE-XX-TASKS.md: goal, files owned, worked examples → tests, done-criteria,
      and mark which tasks are INDEPENDENT (no shared files).
   2. BUILD each task in this order: migration → calc + unit tests (the worked examples first) → service → API (zod) →
      web (shared ui kit, V40 labels) → events/jobs → feeder through the screens.
   3. TEST by tiers (A5).
   4. REVIEW: one fresh read-only reviewer sub-agent checks the phase acceptance, V40 parity "After", Part B rules,
      fake data, dead buttons, missing plant scope. Fix every real finding.
   5. CLOSE: PHASE-XX-REPORT.md (first line DONE or NOT COMPLETE; parity Before/After; built; DB changes; test tiers;
      acceptance ticks; open problems; owner actions; DEPLOY SHEET = migrations, new env names only, jobs, 5-minute smoke
      test, rollback). Update docs/clicntmassage.md (client message: what's new, everything ready so far, how to test;
      logins only as <id>/<password>) and append the phase's numbered role-wise steps with ✔️ results to
      docs/client-test-guide.md. Regenerate STATUS.md / PARITY.md if their tools exist.
      One LOCAL commit "feat(phase-XX): …" listing migrations or "No DB changes" (+ docs/build/*).
      STATE.phasesDone += XX. Journal "Phase XX DONE".
      NOT COMPLETE is allowed only when the missing items need the owner (written in OWNER-ACTIONS.md).

  A4. SUB-AGENTS (speed) — at most 3 at once
   - Only for INDEPENDENT tasks. Brief each with: this file's path + its Part D section, its task, the files/folders it may
     change, the shared files it must NOT touch, Part B rules, Part C V40 rule.
   - Shared files are edited only by you: app router, registry, sidebar/menu, ui kit, words dictionary, prisma/schema.prisma,
     migration ordering, package.json, tabs-map.json.
   - Sub-agents run only typecheck + unit tests of their module. Never browsers, e2e, crawler, feeders, full suites. Never commit.
   - Record each agent in STATE.json + journal (start/finish). On finish: apply its shared-file requests, run Tier 1, tick the task.
   - An agent fails twice on a task → do it yourself.

  A5. TEST TIERS (so testing does not eat the time)
   - Tier 1, after EVERY task: typecheck API + web, lint, unit tests of touched modules, tools/check-unbounded.
   - Tier 2, END of each phase: API tests of touched modules; ui:audit of the phase's pages (score never drops, 0 new P0/P1);
     button click test on those pages (0 DEAD); the phase's feeders + flows on rhai_erp_ui; crawler (5 audit roles) on
     the phase's pages.
   - Tier 3, after Phases 41, 46, 50 and 54: full API + web suites, full crawler (5 roles × 327 pages), full ui:audit +
     gallery, unbounded check. Phase 54 runs Tier 3 three times in a row.
   - Red: fix (max 3 tries per failure). Still red → report "Open problems" (+ OWNER-ACTIONS if owner-only) and continue only
     if no earlier phase's acceptance breaks. Typecheck is never left red.
   - Never run two suites or two browsers at once. Free memory < 1.5 GB → pause agents, journal it, continue serially.

  A6. DECISIONS
   Do not ask the owner mid-run. Decide from Part D, then V40, then Zoho behaviour; journal "DECISION: …".
   Owner-only items (keys, sandbox accounts, devices, sign-offs): use the mock/sandbox/simulator, write OWNER-ACTIONS.md, continue.

  A7. CHAT OUTPUT
   After each phase post 5 lines only: phase · DONE/NOT COMPLETE · V40 parity after (pages/tabs/fields/buttons) · test tiers · next.

  A8. WHEN THINGS GO WRONG
   Crash → A0.3. Out of memory → stop agents, close browsers, resume serially. Failed migration → never edit an applied
   migration; add a new forward one. Agents clash → stop agents, `git diff --stat`, fix by hand, Tier 1. Same failure ×3 →
   record and move to the next independent task.

  A9. FINAL SUMMARY (after Phase 54)
   docs/build/FINAL-SUMMARY.md: each phase DONE/NOT COMPLETE; final V40 parity (327 pages, 1,800 tabs, 4,311 fields,
   buttons); Tier 3 ×3; journeys J1–J14; open problems; OWNER-ACTIONS; `git log --oneline` of the phase commits; the exact
   push command for the owner (do NOT run it). Then stop.

  ------------------------------------------------------------------------------------------------------------------
  PART B — RULES (never break)
  ------------------------------------------------------------------------------------------------------------------
  B1  Never git push, never deploy. Never touch a production or shared database. Databases: rhai_erp_ui (data through
      screens), rhai_erp_test (API tests), rhai_erp_e2e (browser tests).
  B2  The owner authorises ONE LOCAL COMMIT per phase (Part A3.5). Nothing else is committed.
  B3  Never read .env*, deploy_to_ec2*.ps1, .git internals, or the folder "doc from clint". No secrets in code or docs.
  B4  The login screen does not change (Email / User ID, Password, Forgot password, MFA, first-login password change).
      No sign-up, no access request.
  B5  V40 decides WHAT exists (pages, tabs, fields, buttons, names, flow). Zoho Books/Inventory/People decide HOW it behaves
      where V40 is silent. Never remove a V40 element; improve its look.
  B6  Every V40 button works, or is greyed "Not available yet: {reason}" AND listed in the report with the phase that will
      finish it. Never "Arrives in Phase…", never a dead button, never a duplicate button.
  B7  Every V40 tab has REAL content of one of 7 kinds:
        REGISTER (main list) · FILTERED VIEW (same list, fixed filter) · SUB-REGISTER (child table) ·
        FORM SECTION (part of the record as a table) · REPORT (totals + Excel/PDF) ·
        DASHBOARD (KPIs + charts, never the first tab) · ACTION QUEUE (rows waiting for this user + one-click actions).
      The first tab opens first (table-first).
  B8  Plants: every read uses ScopeFilter.units(ctx) = (plants chosen in the top bar) ∩ (plants ticked on the user).
      ctx.unitId is used only as the plant a NEW record belongs to. Creating/posting needs exactly one plant.
  B9  From Phase 42: every create/submit/approve/reject/return/post/cancel/move writes one domain_events row in the same
      transaction. Notifications, mail, counters, project history, webhooks and alerts read events — business services
      never send email directly.
  B10 Data only through the screens (Playwright feeders); only the first Super User from the bootstrap script. Fictitious
      names, valid Indian formats (GSTIN/PAN check digits, IFSC, mobile), dd-mm-yyyy, fixed seed, re-runnable by business key.
  B11 Never fake: no made-up numbers, no static KPI, no placeholder data. "—" + "No data in period" when empty.
  B12 Statutory values (GST rates, PF, ESIC, PT slabs, TDS, minimum wages, depreciation rates, OT limits) are dated rows
      with needs_review = true. Never constants in code.
  B13 Look: V40 tokens --bg #f4f7fb, --card #fff, --card2 #f8fafc, --text #172033, --muted #64748b, --line #e2e8f0,
      --primary #1d4ed8, --success #16a34a, --warn #d97706, --danger #dc2626, --side #0f172a; Inter; 13 px body;
      card radius 15, button radius 9, 34 px controls; V36 table header #f8fafc sticky uppercase #475569; sidebar gradient
      #0f172a → #111827; hero gradient only on Home/dashboards. Inline styles < 50 (each marked "// computed").
  B14 Words: one dictionary (EN/HI) with V40 labels; no hard-coded button text. Dates dd-mm-yyyy; money ₹ Indian commas,
      right-aligned; statuses as words with coloured badges (never raw codes like PENDING_L1).
  B15 Speed budget (p95): list 300 ms, record 200, save/post 800, Home/Menu 150, dashboard 500, search 300, 360° 400,
      inbox 300. Lists keyset-paginated (≤ 100 rows per page).
  B16 Never delete working code to pass a test; never weaken a test without writing why in the report.

  ------------------------------------------------------------------------------------------------------------------
  PART C — V40 REFERENCE (from registry.v2.json, extracted from RHAI_ERP_V40_Edit_Update_Fixed.html)
  ------------------------------------------------------------------------------------------------------------------
  C1  Size: 30 families · 327 pages · 296 pages with tabs · 1,800 tabs · 4,311 fields.
      Exact tab names/order, field labels and buttons for EVERY page: read packages/registry/registry.v2.json. Copy them
      letter for letter. If it looks wrong for a page, open that page in the V40 HTML (its own nav(id) function), compare,
      and report the difference. Never guess.

  C2  Families in V40 menu order (pages): Executive (7) · ERP Process Control (9) · Department Inbox (12) · CRM (8) ·
      Department Work (12) · Sales (10) · Procurement / SCM (11) · Inventory (14) · Warehouse / WMS (13) · Manufacturing (13) ·
      Quality / QMS (10) · Maintenance (10) · Finance & Accounts (19) · Indian Taxation (10) · HRMS (12) · Payroll (12) ·
      Projects (17) · Assets (8) · Service / Support (9) · Logistics / Fleet (16) · Business Documents (7) ·
      Document Management (6) · Business Intelligence (10) · AI & Automation (11) · Communication (6) · Administration (24) ·
      Contract Labour Management (17) · Work Management (2) · Workplace Management (2) · Integrated Plant Flow (10).
      Department Inbox and Department Work pages are generated from the departments table (one per department).

  C3  The standard V40 button row (≈ 260 pages), in this order, and what each does in the ERP:
      ← Return            back to the previous page (keeps filters), else the family's first page
      Excel               export the current tab's rows (filters applied) to .xlsx with a title row, plant, date, user
      Industry PDF        PDF of the current tab, or of the selected record (plant letterhead)
      Print               browser print with print CSS (shell and buttons hidden)
      ＋ Add New (primary) open the full form for a new record
      Load Selected       open the ticked row in the form (edit if allowed, else view)
      ＋ Add               add a child row in the current tab (line, step, contact…); hidden where the tab has no child
      Edit                edit the selected record; greyed with the reason when locked (posted / pending / with another dept)
      Delete              drafts only; confirm by typing the document number
      Documents           attachments drawer (upload, preview, versions, download)
      Submit Approval     send into the approval chain (amount/department matrix)
      Approval Queue      my-approvals filtered to this page
      Move Forward        the Move Forward popup (Phase 41)
      Move Document       document-movement-center with this record pre-selected (document pages)
      Project History     project-global-history for the record's Project Number
      ⇧ Import · ⇩ Export · Duplicates   the V37 Data Exchange panel for this page (Phase 50)
      Buttons needing a row are greyed "Select a row first" until one is ticked. Page-specific V40 buttons (registry
      "buttons" beyond this list) are wired in that page's phase.
      The V36 tab strip has ← → arrows when it overflows; the open tab is in the URL (?tab=).

  C4  V40 trace fields on business documents (filled automatically, read-only after save):
      PO Number · Sales Order · Manufacturing / Machine Order · Manufacturing Order · Project Code · Project Number ·
      Company Code · Customer PO Number · Part Number / SKU.

  C5  Tabs named "X Workspace / X Details / X Workflow / X Exceptions / X Performance / X Controls" (generic 6):
      Workspace = REGISTER; Details = the selected record; Workflow = approvals + movements; Exceptions = FILTERED VIEW;
      Performance = DASHBOARD; Controls = FORM SECTION (page settings for Admin).
      First-guess tab kinds by name: "…Register/Master/Directory/Queue" first tab → REGISTER; "Audit/History/Log/Timeline" →
      SUB-REGISTER of events; "Analytics/Trend/Performance/KPI/Summary/Ageing/Report" → REPORT or DASHBOARD;
      "Approval…" → ACTION QUEUE + decision history; "Controls/Rules/Policy/Settings" → FORM SECTION;
      "Exceptions/Variance/Disputes/Overdue/Due…/Pending…" → FILTERED VIEW. A person checks every guess.

  C6  V40 movement cycle text (shown in the Move Forward popup): "Move Forward → next department marks Received →
      Accepted → works on the record → Send for Approval to a selected department → approval Accepted → Move Forward
      becomes available again."
      Move Forward popup fields in order: From Department · Next Working Department · Responsible Manager · Work Type ·
      Priority (Normal/High/Critical) · Required By · Work Status · Short Handover Note · trace block (PO / SO / MO).
      Work Type: Department Work Handover, Technical Work, Purchase / Material Action, Manufacturing Action, Quality Action,
      Finance / Commercial Action, Project Action, Correction / Rework.
      Work Status: Work Required, Review Required, Material Action Required, Manufacturing Required, Quality Check Required,
      Dispatch Action Required, Finance Action Required, Correction Required.
      Default chain (owner dept): Quotation (Sales) → SO (Sales) → Project (Projects) → BOM (Engineering) → PR (Purchase) →
      PO (Purchase) → GRN (Warehouse) → Incoming QC (Quality) → Production Order (Production) → Final QC (Quality) →
      FG (Warehouse) → Delivery Challan (Warehouse) → GST Invoice (Finance) → Collection (Finance).
      12 departments: Administration, Sales, Projects, Engineering, Purchase, Warehouse, Production, Quality, Finance,
      Service, Maintenance, HR.

  C7  V39 Home dashboard work cards: Receive Documents · Accept Responsibility · Complete Department Work ·
      Approval Required · Employee Tasks · Shift & Handover · Visitor / Gate · Canteen / Meal.
      V40 dashboard buttons: ← Return, ⇧ Import, ⇩ Export, Duplicates, Department Inbox, Approvals, 360° Tracking, Tasks,
      Shifts, Open Details, History, Open.

  C8  Department Inbox (dept-inbox-<dept>, title "{Dept} Inbox (n)"): views Inbox · Unread · Attachments · Pending Receipt ·
      Pending Acceptance · Work / Rework · Approval Inbox · Ready to Move · Sent · Returned · Completed; buttons
      ＋ New Message / Attach Document · Detailed Approvals · Integrated Plant Flow · 360° Tracking · Apply Filters · Reset ·
      Move a Document.
      Department Work (dept-work-<dept>, "⚙ {Dept} Work Center"): Open {Dept} Inbox · New Message / Attach Document ·
      Approvals · Plant Flow · Workflow Matrix.
      my-approvals tabs: Pending / Received / Sent / Completed / Audit.
      document-movement-center tabs: Move Document / Department Queues / Document History / Pending Receipt /
      Pending Acceptance / Approvals / Audit; buttons Open My Inbox, ＋ Add Attachment, Send to Department Inbox,
      Clear Attachments, one tile per department "{n} pending actions · {Dept} Inbox".

  C9  V37 Data Exchange wording: Import → "Load & Preview Selected File" → "Import & Replace Duplicates" (duplicate rule:
      an incoming record with the same primary field replaces the older data — the ERP never replaces posted documents);
      Export → "Load Selected Document" → "Export Now" (xls / csv / json); "Clean This Module" (Super User, drafts/test only).

  ------------------------------------------------------------------------------------------------------------------
  PART D — THE PHASES (build strictly in order 37 → 54)
  ------------------------------------------------------------------------------------------------------------------
  Each phase lists: V40 pages (ids — take tabs/fields/buttons from registry.v2.json), work, worked examples (they become
  tests), feeders, acceptance. Every phase also does Part A3 (parity table, tiers, review, report, client docs, commit).

  ==================================================================================================================
  PHASE 37 — Save, stabilise, fix known backend/data bugs   (no new screens)
  ==================================================================================================================
  Work
   1 Save: one local commit per phase 22 → 36 (use each report's file list; overlapping files go to the earliest phase);
     revert the prettier reformat of the 34 API test files if present; fix the heading of docs/phases/PHASE-33.md;
     rewrite docs/phases/PROGRESS-R2.md with the true state.
   2 Database: replay all migrations on an empty DB ×3 (0 errors); `prisma migrate diff` = 0 drift; `prisma generate` works;
     remove the Phase 23 raw-SQL workarounds that existed only because generate couldn't run.
   3 Bugs (each with a regression test):
     C1 document lines return item code/name, UOM, HSN (PO, SO, quotation, GRN, DC, invoice, PR, MO) — never a uuid on screen;
     C2 HSN master gets gst_rate, cess, effective_from; lines take item → HSN rate; message "No GST rate for HSN {code} —
        set it in HSN / SAC.";
     C3 plant without state/GSTIN → page-level message "Plant {name} has no state set. Ask Admin to complete it."; plant
        form requires state + state code;
     C4 /hr/attendance/days and /hr/ess/me fixed; a login without an employee → 200 + "Your login is not linked to an
        employee record. Ask HR.";
     C5 Phase 17 project-service / project-budget-service write to the real columns;
     C6 the two dashboard 500s, the Balance Sheet key warning, every 4xx/5xx in docs/ui-audit/api-calls.csv;
     C7 one status-word map (no NOT_REQUIRED/NONE/PENDING_L1 on screen);
     C8 one DateInput dd-mm-yyyy everywhere;
     C9 Submit Approval greyed on records already pending;
     C10 after a dialog save → close the dialog and open the record.
   4 Tests green: fix the 56 stale web tests, ContextSelectors (6), App (5); fixed clock for Phase 11/21 tests; remove .skip
     or give reasons; API + web + e2e green.
   5 tools/dev/stop-stale.mjs (lists/stops only this repo's node on 4100/5180/5173).
   6 Rewrite docs/clicntmassage.md (it still describes Phase 5) with everything that truly works.
  Acceptance: commits for 22–36; replay clean; C1–C10 fixed with tests; suites green; crawler (5 roles, 327 pages) 0 errors.

  ==================================================================================================================
  PHASE 38 — The V40 frame on all 327 pages
  ==================================================================================================================
  Work
   1 SIDEBAR: the 30 families (C2) in V40 order with V40 names/icons; pages in V40 order; dynamic Department Inbox/Work
     from the departments table with live counts "Sales Inbox (3)"; accordion remembered on the server; ☰ collapses to icons
     on desktop; mobile drawer with backdrop; ⭐ Favourites and 🕘 Recent on top.
   2 TOP BAR: search "Search PO, SO, MO, DC, invoice or customer…" with live grouped results (Documents / Parties / Items /
     Pages), Enter → global-search; plant chips (multi) · FY · 🔔 · ? · EN/हिं · profile; ONE menu entry only.
   3 PAGE HEAD: ← Return, breadcrumb, title, the C3 button row on one line (extra buttons fold into "⋯ More" below 1280 px;
     on phones the row scrolls sideways). Remove the old action bar above the title.
   4 TABS: generate tabs-map.json from registry.v2.json (all 1,800 tabs): page → [tab, kind (B7/C5), data source]. Fill
     kind + source for every tab; a tab whose backend belongs to a later phase shows an EmptyState "This view is built in
     Phase {n}: {what}" (allowed only for pages owned by Phases 39–50; target ≤ 15 % here, 0 % by Phase 50).
   5 ONE REGISTER ENGINE for all lists (ScreenPage, GenericModulePage, DocPage become configs; old bodies deleted):
     head "All {things} ▾" views (All, My, Draft, Pending approval, With my department, Overdue, saved); filter row
     (search, plant when 2+, date range, status, party, department, More filters, Apply Filters / Reset; remembered per user
     on the server); table (sticky header + first column, checkbox, V39 row action cell Open · Edit · Industry PDF ·
     Move Forward · ⋯, status badges, ₹ right-aligned, "With {dept}" column on routable pages, Plant column when 2+);
     selection bar (Submit Approval · Approve · Move Forward · Excel · Industry PDF zip · Delete drafts); pager "1–25 of N"
     (25/50/100); row click → split view ≥ 1280 px, full page below, cards on phone.
   6 LOOK: port the V40 style layers V35 Clean Advanced, V36 Blue Table-First, V37 Data Exchange, V39 Simple Dashboard +
     Horizontal Actions from the V40 HTML (today's CSS came from V9.2 reference/index.html); tokens B13; soft badges,
     skeletons, line-art empty states, 150 ms hover, 3 px focus ring, slide-in drawers; inline styles from 1,262 to < 50;
     lint blocks new ones and hard-coded button labels.
   7 Click test on every V40 button (safe ones clicked; risky ones up to the confirm, then Cancel). axe on 30 pages;
     Lighthouse on Home, a list, a form, an inbox.
  Acceptance: 327 pages in the frame; sidebar = C2; C3 row on every page V40 shows it, 0 DEAD; 1,800 tabs with V40 names
  and order; one Register engine; inline styles < 50; average ui:audit ≥ 25, none < 20; axe 0 serious.

  ==================================================================================================================
  PHASE 39 — Documents & forms: Sales, Procurement, Business Documents, ERP Process Control masters
  ==================================================================================================================
  V40 pages
   Sales: sales-quotations, sales-orders, sales-reservations, sales-delivery, sales-dispatch, sales-invoices,
     sales-collections, sales-pricelist, sales-credit, sales-returns.
   Procurement: scm-pr, scm-rfq, scm-vendorquote, scm-comparison, scm-po, scm-grn, scm-purchaseinvoice, scm-approval,
     scm-suppliers, scm-evaluation, scm-contracts.
   Business Documents: business-documents (Letterhead Setup, Open Register), dispatch-dc, quality-certificate,
     accounts-gst-invoice, hr-offer-letter, hr-appointment-letter. (document-movement-center → Phase 41.)
   ERP Process Control: master-customers, master-products, master-materials, sales-enquiries, mfg-material-issue,
     customer-receipts.
   Examples of V40 tabs: sales-orders = Order Register / Order Items / Production Link / Delivery Balance / Billing Balance /
   Approval & Audit; scm-po = PO Register / Items / Commercial Terms / Approval / Receipt Balance / Audit;
   scm-grn = GRN Register / Receipt Quantity / Batch & Warehouse / Incoming Quality / PO Balance / Audit;
   dispatch-dc = DC Register / SO Quantity Control / Transport / Customer Receipt / Billing Eligibility / Audit.
  Work
   1 FIELDS: every V40 field of each page (registry "fields") exists with the V40 label. V40 keeps one product per row; the
     ERP keeps header + lines, so product fields (Product ID, Product, Ordered Quantity, Unit, Rate, Discount %, GST %,
     Delivered / Invoiced / Cancelled / Pending Quantity) are line fields and the "…Items" tab shows them flat like V40.
     Calculated V40 fields (Pending Quantity, Delivery Balance, Pending Amount, Total Amount) come from the API. Trace fields
     C4 auto-filled. V40 master fields are the minimum (master-customers: Customer ID, Company Name, Contact Person,
     Mobile Number, Email, GST Number, Billing Address, Shipping Address, Credit Limit, Payment Terms, Status, Project Number);
     extra ERP fields go under "More details".
   2 RECORD PAGE: header (number, status badge, plant chip, "With {dept} since …", status track Draft → Pending approval
     L1/2 → Approved → In department work → Posted → Closed); the C3 row acting on this record; "What's next" banner
     (e.g. "Approved. Next: Move Forward to Production" [Move Forward]; "Delivered. Next: GST invoice" [Convert to Invoice]);
     the page's V40 tabs filtered to this record + Document preview (looks like the PDF) + Attachments.
   3 FORM (full page, V36 master grid, Zoho behaviour): V40 labels/order, 2 columns, required *, inline errors keeping input;
     customer picker auto-fills address, GSTIN, state, place of supply, terms, price list, salesperson, credit limit and
     shows outstanding; supplier picker fills address, GSTIN, terms, MSME; item type-ahead (code/name/HSN) with stock in the
     plant; Enter = new line; ＋ Add Line; Add items in bulk; totals panel (Sub total, Discount, Freight, Taxable,
     CGST+SGST or IGST, TCS, Round off, Grand Total, amount in words lakh/crore) from packages/calc via the API;
     footer Save as Draft · Save Record / Update Record · Save and Submit ▾ · Cancel; unsaved-changes warning; server draft
     autosave every 30 s.
   4 COPY FROM / CONVERT TO (pending quantities only): Enquiry→Quotation→SO; SO shortage/MRP→PR→RFQ→Vendor quote→
     Comparison→PO (award); PO→GRN; SO/FQC→DC; DC/SO→Invoice; invoices→Collection; GRN/PO→Purchase invoice;
     invoice→Sales return.
   5 TAB CONTENT examples: Quotation › Conversion = accepted not converted [Convert to SO]; SO › Production Link = line →
     MO/job card planned/made; SO › Delivery Balance = ordered − delivered (overdue red); SO › Billing Balance = delivered −
     invoiced; PR › PO Conversion = approved PRs without PO [Create PO]; RFQ › Response Tracker = invited/responded/pending
     [Remind]; Comparison › Landed Cost = rate + freight + duty + payment-term cost ranked; Comparison › Award
     Recommendation [Award → PO]; PO › Receipt Balance = ordered − received by due date; GRN › Incoming Quality = QC hold /
     passed / rejected; Purchase invoice › PO GRN Matching = 3-way match; sales-credit › Credit Holds; DC › SO Quantity
     Control; DC › Billing Eligibility [Convert to Invoice]; quality-certificate › Customer Copy PDF; hr-offer-letter ›
     Compensation from pay-structure, Approval before issue; customer-receipts › Quantity Reconciliation (DC vs POD);
     mfg-material-issue › Reservation Check and Batch Allocation (FEFO).
  Worked examples (tests)
   - TAL (state 27) → Maharashtra customer: taxable ₹1,00,000 @ 18 % → CGST 9,000 + SGST 9,000 = ₹1,18,000;
     → Karnataka customer: IGST 18,000 = ₹1,18,000; ₹1,18,000.40 → round off −0.40 → ₹1,18,000.
   - GRN from PO: ordered 200, received earlier 120 → proposes 80.
   - 3-way match: PO 100 @ ₹50, GRN 98, invoice 100 @ ₹50.20 → qty mismatch 2 + rate +0.4 % → exception.
   - DC qty 120 with balance 80 → "Dispatch Quantity 120 exceeds Delivery Balance 80."
   - Credit hold: limit ₹10,00,000, outstanding ₹8,50,000, new SO ₹2,00,000 → hold; Finance override with approval.
  Feeders: 10 enquiries → 8 quotations → 6 SOs → DCs → invoices → collections; PR → RFQ → 3 quotes → comparison → PO →
  GRN → purchase invoice — typed by Sales, Purchase, Stores and Finance users.
  Acceptance: 33 pages with every V40 tab real and field parity 100 %; all copy/convert pairs; examples pass; scores ≥ 27.

  ==================================================================================================================
  PHASE 40 — Executive pages, Home (V39), plants combined everywhere, live counters
  ==================================================================================================================
  V40 pages: dashboard, command-center, notifications, global-search, ops-mfg-dashboard (Control Dashboard / Sales /
  Purchase / Production / Inventory / Dispatch / Finance; buttons Open 360° Order Tracking, Exceptions (n), Open Module).
  (my-approvals → 41, project-global-history → 48, ai-insights → 49.)
  Work
   1 HOME = V40 "dashboard": hero (V40 gradient: name, role, department, plant chips, date) · 4 department metrics ·
     quick bar (C7 buttons) · the 8 C7 cards with LIVE counts (to receive, to accept, in work, my approvals, tasks open/
     overdue, handovers to accept, visitors waiting/inside, meals today), each opening the matching inbox view · work queue
     table (Open Details / History / Open) · tab "My Dashboard" (filled in Phase 49). One API call ≤ 150 ms.
   2 COMMAND CENTER (Owner/Director): "＋ Add to Command Center" pins any KPI/list/record; per selected plant + total:
     sales, collections, cash & bank, AR overdue, AP due, production vs plan, rejection %, present today, contract workers
     on site, approvals pending by age, late movements, exceptions, mail/push health.
   3 notifications (Mark All Read, Open, Read, Unread; filters; deep link to record + tab); global-search (documents,
     parties, items, employees, pages, attachment names; ≤ 300 ms).
   4 PLANTS EVERYWHERE: replace the ~170 reads of ctx.unitId (finance, inventory, HR, payroll, procurement, sales, mfg, qms,
     maintenance, logistics, projects, service, bi, documents, notifications) with ScopeFilter.units; reports that total by
     plant get a Plant column + subtotals; lint bans ctx.unitId in read paths; stock combined view never double-counts
     transfers between chosen plants; trial balance combined shows "inter-plant balances are not eliminated".
   5 COUNTERS: dept_work_counters / user_work_counters written in the same transaction (moved to events in 42); nightly
     recount reports differences (must be 0); plant picker shows live "Pending approvals: n".
   6 My Profile "Reset plant choice"; admin-landing page (role → Home / page).
  Worked example: Sales MTD TAL ₹42,50,000, SAW ₹18,20,000, VAR ₹9,30,000 → TAL+SAW ₹60,70,000; all ₹70,00,000.
  Tests: per module total(TAL+SAW) = total(TAL) + total(SAW).
  Acceptance: Home 8 live cards (no "—"); Command Center per plant + total; 0 ctx.unitId reads; counters diff 0.
  ==================================================================================================================
  PHASE 41 — Department Inbox, Work Center, Approval Inbox, Document Movement, Integrated Plant Flow, My Inbox
  ==================================================================================================================
  V40 pages: dept-inbox-<12 depts>, dept-work-<12 depts>, my-approvals, document-movement-center, plant-flow-command,
  plant-project-forward, maint-part-movement, plant-process-movement, plant-unit-routing, plant-department-movement,
  plant-interplant-movement, flow-bom-approval, mfg-unit-route, mfg-transfer-note. Use C6 and C8 exactly.
  Page-specific V40 buttons to wire (from registry): plant-flow-command (Open Current Dept Inbox, Detailed Project Control,
  All Departments + one per department, Open Work, Move Forward → Next Gate); maint-part-movement (Word, PDF, My Approvals,
  + Add Movement, Maintenance Parts (n), Process Movement (n), Department Movement (n), Plant-to-Plant (n), Send for
  Approval); plant-unit-routing (Process Movements, Plant-to-Plant, New Route, Duplicate, Reset Sketch Template, + Add Step,
  Save Route); flow-bom-approval / mfg-unit-route / mfg-transfer-note (Word, PDF, + Job Card, BOM & Material Approval,
  Live Routing, WIP by Plant, Transfer Receipt, Quality Release, Dispatch Readiness, Advance, Receive, Reconcile).
  mfg-unit-route tabs "Unit 1–4" show our plants by name (TAL/SAW/VAR/4th). V40 example project buttons (PRJ-…) show the
  user's real projects.
  Work
   1 Move Forward popup = C6 fields; Workflow Matrix suggests the next department; target dept must have an active user in
     the document's plant; Responsible Manager list = those users.
   2 Approvals linked: Move Forward refused while an approval is pending ("Waiting for approval by {dept}. Move Forward opens
     after approval."); "Send for Approval" from Work Center and record sets WAITING_APPROVAL and returns to IN_WORK on decision;
     the rule's approval_department must have approved.
   3 Required attachments/fields from the Workflow Matrix: "Attach {type} before moving forward."
   4 Physical lines + stock: plant-to-plant → StockService transfer to STOCK_IN_TRANSIT; Receive dialog with lines (received
     qty, short reason); short qty stays in transit + Variance/Dispute; Warehouse returns it or writes it off (adjustment with
     approval); Return reverses stock.
   5 Bulk Received / Accepted; Recall with confirm; Return reason ≥ 10 characters; one open movement per document (409 on race).
   6 SLA by the plant's working-day pattern (Mon–Sat default, editable per plant) + holidays; late → manager, 2× → head
     (SLA & Escalation tabs).
   7 Plant route builder (steps: plant, process, department, work centre, std hours, QC); "Continue route" → next
     Manufacturing Action movement + transfer note when the plant changes.
   8 BOM & Material Approval in V40 tab order: BOM Selection → Sales Approval → Stock Verification (required vs available in
     the plant) → Purchase Shortage ("Raise PR") → Manufacturing Release → Traceability.
   9 360° Tracking drawer: trace block, every handover with times + time held per department, approvals, attachments.
  10 project_events written for each action (read in Phase 48).
  11 MY INBOX (new, Zoho-style): left rail with counts To Receive · To Accept · In Work · Approvals · Tasks · Mentions ·
     Returned to me · Department Mail · Alerts · Completed; preview pane with only valid actions; keyboard J/K, R, A, Enter;
     "Next item" after each action; live via SSE; sidebar badge; browser tab "(5) ERP".
  Worked examples (tests)
   - SLA: sent Friday 16:00, 2 days, Mon–Sat → due Monday 16:00; Monday 16:01 late; Wednesday 16:00 escalates to head.
   - 100 shafts TAL → SAW, received 96 "4 damaged in transit" → SAW +96, in transit 4, dispute "Short receipt 4 – MOV/TAL/…".
   - Route balance: planned 500, good 470, scrap 10 → balance 20.
   - BOM shortage: required 82.000 kg copper, available 60.000 → PR draft 22.000 kg.
  Feeders (each department's OWN user, not Super User): 6 SOs through the full C6 14-step chain using inbox buttons; 1 Return;
  1 short receipt; 1 route TAL→SAW→TAL; 1 BOM shortage → PR.
  Acceptance: all listed pages with every V40 tab and button; My Inbox; the chain runs through screens; stock = GL;
  TIER 3 run (milestone).

  ==================================================================================================================
  PHASE 42 — Mail automation, communication, rules, print (event backbone)
  ==================================================================================================================
  V40 pages: comm-email, comm-sms, comm-whatsapp, comm-templates, comm-logs, auto-rules, auto-workflows, auto-jobs,
  auto-webhooks, bi-scheduler. (comm-payment → 45.)
  Work
   1 EVENT BACKBONE (B9): domain_events(id, at, unit_id, actor_id, entity, entity_id, doc_no, kind, from_status, to_status,
     payload) written in the same transaction via emitEvent(tx,…); kinds CREATED, UPDATED, FIELD_CHANGED, SUBMITTED,
     APPROVED, REJECTED, RETURNED, POSTED, CANCELLED, MOVED_SENT/RECEIVED/ACCEPTED/RETURNED/LATE, PAYMENT_RECEIVED,
     PAYMENT_MADE, STOCK_BELOW_MIN, EXPIRY_DUE, ATT_*; idempotent consumers: notifications, mail automation, counters,
     project_events, webhooks, KPI alerts. A test fails if any status-changing service method emits nothing.
   2 AUTO-RULES = the rule builder (V40 tab order = steps): Rule Library (list, clone, on/off per plant, reorder, usage) →
     Triggers (Created / Edited / Field changes ≤ 3 / Status from→to / Approval / Movement / Date-based N days before/after
     a date field at a time / Schedule) → Conditions (dropdown AND/OR groups: field, operator, value, plant, department,
     amount) → Actions (Email with template + To party contact/field/role/user/department + CC/BCC + attach record
     PDF/Excel/Word; in-app + push; SMS DLT urgent only; WhatsApp approved template + opt-in; create task; Move to
     department = creates SENT, never auto-accepts; field update = needs approval to activate; webhook) → Escalations
     (not done in N h → next person) → Execution History (record, result, error, Retry). Guards: depth ≤ 3, rate cap,
     idempotency (rule, record, date), test mode (preview recipients, no send).
   3 THE 40 READY AUTOMATIONS — all running, each with a switch per plant, editable template/timing/recipients and
     "Send test to me":
     1 Enquiry acknowledgement · 2 Quotation sent (PDF) · 3 Quotation follow-up 7 days · 4 Order acknowledgement (SO PDF) ·
     5 Dispatch intimation (DC + e-way bill + LR) · 6 Invoice (PDF) · 7 Payment receipt · 8 Payment reminders +3/+15/+30 ·
     9 Monthly statement · 10 Quality certificate with DC · 11 RFQ to suppliers · 12 Purchase order (PDF) · 13 PO amendment ·
     14 Delivery reminder −3 days · 15 Delivery overdue +1 · 16 GRN short supply · 17 Debit note · 18 Payment advice with
     TDS · 19 SCAR · 20 Approval waiting 24 h · 21 Escalation 48 h · 22 Approval result (in-app + digest) · 23 Work sent to
     department · 24 Work late · 25 Work returned · 26 Welcome / set password · 27 Offer letter · 28 Appointment letter ·
     29 Payslip (password PDF) · 30 Leave decision · 31 Missed punch · 32 Daily attendance Excel 10:30 · 33 Monthly
     attendance summary · 34 Birthday (opt-in, off) · 35 Document expiry 30/15/7/0 days · 36 PM due list Monday 08:00 ·
     37 Calibration due · 38 Owner daily summary 08:00 (PDF) · 39 Weekly MIS · 40 Monthly P&L.
     Each: fake-clock test + mail-catcher check (recipient, subject, attachment).
   4 MAIL QUALITY: real file attachments (> 7 MB total → signed link valid 7 days); payslip PDF password rule stated in the
     email; comm-templates with merge fields {{customer.name}} {{doc.no}} {{doc.grand_total|inr}} {{doc.due_date|date}}
     {{link}}, plant letterhead header/footer, Hindi version, Test Preview with a real record, versions, approval before use;
     comm-email Email Accounts (sender per plant/department, SPF/DKIM/DMARC check), Outbox Queue, Delivery Status
     (sent/delivered/bounced/complained), Linked Records, Analytics; one-click unsubscribe on reminders/bulk; complaint
     rate warning at 0.1 %; comm-logs = all channels in one timeline + filters + Resend.
   5 DEPARTMENT MAIL (C8 "＋ New Message / Attach Document"): internal threads with files and read receipts, shown in
     My Inbox › Department Mail and each Department Inbox (Inbox / Unread / Attachments).
   6 PRINT: posted documents print from the stored copy (Duplicate / Triplicate labels); drafts get a diagonal DRAFT
     watermark; Industry PDF layouts Standard / Letterhead / Commercial (tax summary by HSN) + Word + Excel;
     business-documents Letterhead Setup per plant.
   7 bi-scheduler: schedule any report/list/dashboard (Frequency, Recipients, PDF/Excel); each recipient gets only their
     plants/scope; Run History.
   8 auto-jobs shows the job queues (Scheduled / Running / Failed + Retry); auto-webhooks: endpoints, subscriptions to
     domain events, secrets with rotate, delivery log, retry queue.
  Worked examples (tests)
   - #14: PO/TAL/2627/0145 line due 15-12-2026 → 12-12-2026 09:00 to supplier + CC buyer: "Reminder: PO/TAL/2627/0145 —
     200 nos BRK-14 due on 15-12-2026." Never twice the same day.
   - #38 Owner summary 08:00 per plant + total: yesterday's sales, collections, dispatches, production good/reject,
     attendance %, approvals pending (count + oldest), late movements, exceptions, cash & bank, AR overdue.
  Acceptance: events from every module; rule builder with test mode; 40/40 automations fire in tests; the 10 pages with
  every V40 tab; attachments, templates, logs; print layouts + watermark.

  ==================================================================================================================
  PHASE 43 — Inventory (14) and Warehouse / WMS (13)
  ==================================================================================================================
  V40 pages: inv-items, inv-stock, inv-transactions, inv-opening, inv-adjustment, inv-transfer, inv-reservation,
  inv-reconciliation, inv-ageing, inv-valuation, inv-reorder, inv-batch, inv-serial, inv-expiry; wms-warehouses, wms-zones,
  wms-racks, wms-shelves, wms-bins, wms-putaway, wms-pick, wms-packing, wms-cycle, wms-physical, wms-transfer,
  wms-barcode, wms-rfid.
  Work + worked examples (tests)
   - Ageing by receipt date (FIFO layers): 0–30 / 31–90 / 91–180 / 180+; slow = no issue 90 days; dead = 180 days.
   - Valuation (plant method, weighted average default): 100 @ ₹50 + 50 @ ₹56 → ₹52.00; issue 30 → ₹1,560.00.
     Inventory GL Bridge: stock value = GL inventory per plant (differences listed).
   - Reorder: safety stock = z × σ × √LT (1.65 × 4 × √9 = 19.8 → 20); ROP = 10 × 9 + 20 = 110;
     EOQ = √(2 × 3,600 × 500 / 20) = 424; "Suggested PR" creates a PR draft.
   - Putaway suggestion order: same-item bin with space → zone rule → nearest empty bin (volume/weight capacity);
     Dock to Stock Time = GRN post → putaway done.
   - Pick waves by aisle route; FEFO for batches; short pick → exception + reallocation.
   - Cartonization (smallest carton that fits); weight verification ±2 % (row) → exception.
   - Cycle count by ABC (A monthly, B quarterly, C half-yearly); variance > tolerance → recount → approval posting;
     Count Accuracy = lines without variance / lines counted.
   - Physical verification Freeze Controls block movements in chosen warehouses.
   - Batch recall: forward trace (movements, customers, DCs) + backward (supplier, GRN).
   - Barcode/QR label templates (item, bin, batch, pallet) + print queue; Invalid Scans logged; RFID reader/portal registry
     + read events through the API with a simulator.
  Feeders: opening stock upload; 3 warehouses with zones/racks/shelves/bins; putaway of GRNs; pick waves for DCs; a cycle
  count with variance; a batch recall.
  Acceptance: 27 pages with every V40 tab; examples pass; stock = GL per plant.

  ==================================================================================================================
  PHASE 44 — Manufacturing (13), Quality / QMS (10), Maintenance (10)
  ==================================================================================================================
  V40 pages: mfg-bom, mfg-routing, mfg-workcenters, mfg-plan, mfg-orders, mfg-mrp, mfg-workorders, mfg-shopfloor, mfg-wip,
  mfg-fg, mfg-scrap, mfg-rework, mfg-costing; qms-plans, qms-incoming, qms-process, qms-final, qms-supplier, qms-inspections,
  qms-ncr, qms-capa, qms-5why, qms-calibration; maint-machines, maint-equipment, maint-preventive, maint-breakdown,
  maint-workorders, maint-spares, maint-schedule, maint-downtime, maint-mtbf, maint-alerts.
  Work + worked examples (tests)
   - BOM multi-level cost rollup with scrap %; one active revision per date; approval before release.
   - MRP net = gross − on hand − on order + safety stock, lead-time offset, pegged to the SO line:
     gross 500, on hand 120, on order 200, SS 50 → 230 → PR on (need date − 9 days).
   - Capacity: work-centre hours per shift calendar vs routing standard times; > 100 % red.
   - OEE = A × P × Q: planned 480, downtime 60 → A 87.5 %; ideal 1 min/pc, 380 made → P 90.5 %; 370 good → Q 97.4 % →
     OEE 77.1 %.
   - WIP value = issued material + labour + machine overhead of open orders; variances (material price/usage,
     labour rate/efficiency).
   - AQL sampling rows (Normal II): lot 1,200 → sample 80, Ac 2 / Re 3.
   - SPC X̄-R; Cp/Cpk: USL 10.05, LSL 9.95, mean 10.01, σ 0.012 → Cp 1.39, Cpk 1.11 (< 1.33 amber).
   - Supplier PPM = rejected / received × 10⁶.
   - NCR → containment → root cause (5-Why link) → disposition (use-as-is / rework / scrap / return) → CAPA →
     effectiveness check after 30 days.
   - Calibration out of tolerance → list lots inspected with that instrument since the last good calibration.
   - PM by calendar or counter; due work generated; checklist on tablet; spares reserved.
   - MTBF = operating time / failures (720 h / 3 = 240 h); MTTR = repair time / repairs (9 / 3 = 3 h).
   - Breakdown response timeline (reported → acknowledged → started → finished); maint-alerts rules feed automations 35–37.
  Feeders: 3 BOMs (3 levels), MRP run, 3 production orders with job cards on the shop-floor screen, IQC with AQL,
  NCR → CAPA, a calibration failure, a PM plan, 2 breakdowns.
  Acceptance: 33 pages with every V40 tab; examples pass; dashboard OEE = hand calculation.

  ==================================================================================================================
  PHASE 45 — Finance & Accounts (19), Indian Taxation (10), Payment Gateway (Zoho Books level)
  ==================================================================================================================
  V40 pages: fin-coa, fin-gl, fin-journal, fin-cashbook, fin-bankbook, fin-ap, fin-ar, fin-creditnote, fin-debitnote,
  fin-bankreco, fin-costcenter, fin-profitcenter, fin-expenses, fin-budget, fin-trial, fin-pnl, fin-bs, fin-cashflow,
  fin-ageing; tax-gst, tax-gstr1, tax-gstr3b, tax-tds, tax-tcs, tax-hsn, tax-einvoice, tax-eway, tax-salesreg,
  tax-purchasereg; comm-payment.
  Work + worked examples (tests)
   - Ageing buckets Current / 1–15 / 16–30 / 31–45 / > 45 (+ 46–90 / > 90 for Ageing Trend); Collection Priority =
     overdue amount × days.
   - Bank auto-matching order: exact amount + reference/UTR → amount + date ±3 days + party name → many-to-one (sum of
     invoices); Accept/Reject; unmatched → create receipt/payment/journal from the line. Target ≥ 80 % auto on the sample.
   - AP Payment Proposal: due ≤ date, MSME 45-day first, cash limit → approval → bank file.
   - Budget Control: commitments (approved PR/PO) + actuals vs budget; > 100 % blocks the PO unless approved.
   - Cash Forecast: open AR by expected date + open AP by due date + payroll and tax calendar.
   - GST: place of supply, RCM; GSTR-1 (B2B/B2C/CDN/HSN summary) from posted documents; 3B liability vs ITC; 2B upload
     matching (GSTIN + invoice no + amount ±₹1) → 2B Match Status.
   - E-invoice: "Generate IRN" on posted B2B invoices (auto on post when enabled); IRN, Ack No/Date, signed QR printed;
     cancel within 24 h; Error Queue in plain words. Sandbox only, through the GSP the owner chooses (OWNER-ACTIONS).
   - E-way bill from DC/invoice (distance, vehicle, transporter), Part B update, extend/cancel; number on the DC + mail #5.
   - Payment link (Razorpay test mode) on invoices → webhook → receipt auto-created (event) → mail #7; Settlement
     Reconciliation with the bank book.
   - Zoho extras: recurring invoices/bills/journals/expenses (frequency, start/end, draft or post, email); customer and
     vendor statements (PDF + mail #9).
   - Posting into a closed period refused.
  Feeders: invoices, receipts, purchase invoices, payments, journals, a bank statement file, a 2B file, a month close.
  Acceptance: 30 pages with every V40 tab; TB balanced per plant; sandbox IRN on 3 invoices; e-way bill sandbox; bank
  auto-match ≥ 80 %; payment link creates the receipt; recurring invoice; statements; GSTR-1 = sales register.

  ==================================================================================================================
  PHASE 46 — HRMS (12) + Payroll (12): ATTENDANCE AUTOMATION, ESS, payroll from attendance (Zoho People level)
  ==================================================================================================================
  V40 pages: hr-employees, hr-recruitment, hr-onboarding, hr-attendance, hr-leave, hr-expense, hr-performance, hr-training,
  hr-documents, hr-exit, hr-ess, hr-shifts; pay-structure, pay-processing, pay-overtime, pay-incentive, pay-loan, pay-pf,
  pay-esic, pay-pt, pay-tds, pay-payslip, pay-bank, pay-register.
  hr-attendance V40 tabs: Daily Attendance / Monthly Calendar / Late Early & Overtime / Geo Device Logs / Regularization /
  Attendance Analytics. hr-ess tabs: My Profile / My Attendance / My Leave / My Payslips / My Expenses / HR Requests.
  Work
   1 Geo Device Logs: device push (ZKTeco ADMS /iclock/cdata, serial registered) AND a device AGENT (tools/att-agent: small
     Node Windows service reading the ZKTeco/eSSL database/export every 5 min, HMAC-signed batches, offline queue, installer
     + "Download agent" button with setup steps); device health ONLINE / STALE (30 min no data in shift) / OFFLINE (2 h,
     email); mobile punches with geo-fence (+ optional selfie); buddy-punch alert (2 codes on one device within 3 s, repeated).
     Nginx /iclock/ step → DEPLOY SHEET + OWNER-ACTIONS.
   2 Daily Attendance computed on every punch batch (≤ 1 minute) and nightly; auto-absent "A?" at shift end + 2 h, final at lock.
   3 Late Early & Overtime: late marks; OT candidate = floor((worked − shift)/15) × 15 → OT request to the manager;
     quarterly OT cap checked.
   4 Regularization with Admin-defined reasons (Forgot check-in / Forgot check-out / Forgot ID card / On duty / Device fault)
     → approval → recalculation; missed-punch reminder next day 10:00 (#31); not regularised in 3 days → auto half day
     with reason (HR can reverse with a reason).
   5 Monthly Calendar with colours and auto-action icons (reason on hover); Attendance Analytics (present %, late trend,
     heatmap departments × days).
   6 Policies (per plant, per category WORKER/STAFF/CONTRACT, dated, plain-English preview): late-mark (3 → 0.5 LOP);
     missed punch (3 days → HD); auto-absent; AUTO_LEAVE (absence + CL/EL balance → leave request to confirm in 3 days, then
     manager approval); AUTO_COMPOFF (weekly off/holiday ≥ 4 h → comp-off credit, expires 60 days); AUTO_SHIFT (nearest
     shift start ±90 min); mobile punch per role.
   7 Live Board (inside now / expected per department and shift; contract labour separate) + TV mode.
   8 Month end: day 1 10:00 "Attendance locks tomorrow 18:00 — n missed punches pending"; day 2 18:00 auto-lock → payroll
     inputs → notice to Payroll; mails #31–33 with Excel; kiosk mode (employee code/QR + photo).
   9 ESS: Punch In/Out button; My Leave (balance, apply, comp-off claim); My Payslips (password PDF); shift change requests;
     HR Requests.
  10 Payroll: Validation & Lock blocks a run if attendance is not locked; bank file with Validation Errors (IFSC/account);
     Form 16 summary; CTC Simulation; loans; canteen deduction (from Phase 47 when built).
  Worked examples (tests)
   - Shift 07:00–15:30, break 30, grace 10; punches 07:14 / 18:05 → worked 621 min, late 14, OT 135.
   - Late marks on 4th, 11th, 18th → on the 18th auto 0.5 LOP "3rd late mark in November (4, 11, 18)".
   - Only IN 07:05 Tuesday → MIS; Wednesday 10:00 reminder; not regularised by Friday 18:00 → HD.
   - Live board SAW A-shift: expected 180, inside 171 → 95.0 %.
   - Payroll: gross 30,000, basic 15,000 → PF 12 % = 1,800; ESIC not applicable above ₹21,000; PT Maharashtra 200
     (February 300); LOP 1.5 in a 31-day month → gross × 29.5/31; loan ₹20,000 / 10 EMIs = ₹2,000.
  Feeders: 40 employees; a month of punches from a device simulator (HTTP push = the real path); regularisations; OT and
  leave approvals by managers; lock; payroll run; payslips emailed.
  Acceptance: 24 pages with every V40 tab; agent installs and pushes; ESS punch; policies with logic; mails with Excel;
  paid days = locked attendance; TIER 3 run (milestone).

  ==================================================================================================================
  PHASE 47 — Work, Workplace, Contract Labour, Logistics / Fleet, Assets, Service
  ==================================================================================================================
  V40 pages
   Work/Workplace (buttons Word, PDF, + Add Task / + Add Roster / + New Visitor / + Add Meal):
     ops-tasks (Department Board / Task Register / My Tasks / Dependencies / SLA & Escalation / Workload / Approval /
     Shift Handover), ops-shift-roster (Weekly Roster / Rotation Planner / Department Coverage / Handover / Attendance Sync /
     Audit), ops-visitors (Expected Visitors / Approval Queue / Gate Check-In / Inside Plant / Overstay Alerts / Material Gate
     Pass / Check-Out History / Visitor Analytics; + Host Approve, Material Pass, PDF Pass), ops-canteen (Meal Transactions /
     Live Meal Desk / Shift Entitlement / Menu & Rates / Department Cost / Vendor Billing / Wastage & Feedback / Audit).
   Contract Labour: cl-command-center (Compliance, Wage Run, ＋ Add Worker, Deployment, Attendance, Gate Access, Safety,
     Worker Master, Billing Control, Compliance Score), cl-contractors, cl-workorders, cl-workers, cl-onboarding,
     cl-deployment, cl-attendance, cl-wages, cl-invoices, cl-compliance, cl-safety, cl-ppe, cl-medical, cl-incidents,
     cl-gatepass, cl-canteen, cl-exit.
   Logistics/Fleet: log-transporters, log-routes, log-freight, log-shipments, log-tracking, log-pod, fleet-vehicles,
     fleet-drivers, fleet-fuel, fleet-service, fleet-documents, gate-in, gate-out, gate-return, gate-nonreturn, container-track.
   Assets: asset-master, asset-capitalization, asset-allocation, asset-transfer, asset-maintenance, asset-depreciation,
     asset-disposal, asset-qr.
   Service: service-tickets, service-requests, service-technicians, service-visits, service-spares, service-history,
     service-amc, service-warranty, service-claims.
  Work + worked examples (tests)
   - Tasks: Kanban drag (If-Match); dependencies block start ("Blocked by T/TAL/2627/00012 (not done)."); recurring tasks
     (idempotent per date); SLA & Escalation; Workload red above 10 open or 3 overdue; approval through the approval engine;
     Shift Handover line grid + "Accept handover from {name}" banner at login, alert if not accepted 30 min after shift start.
   - Visitors: host pre-registers and shares a link by SMS/email (opt-in); Host Approve (push); PDF Pass A6 with QR;
     Gate Check-In with photo + last 4 digits of ID; overstay = planned out + 30 min (planned 16:00, still inside 16:31 →
     alert host + security); Material Pass → gate pass; anonymised after 1 year.
   - Canteen: Live Meal Desk scan ("Already served lunch today at 13:02."); entitlement by shift; employees, contract
     workers, visitors; payroll/cash/free; lunch ₹60 + GST 5 % = ₹63.00; employee 40 % = ₹25.20, company ₹37.80;
     22 lunches → CANTEEN_DED ₹554.40; vendor bill 1,410 vs 1,380 served = 2.17 % > 2 % → approval.
   - Contract labour: deployment allowed only if licence, agreement, insurance, work order (headcount + budget), KYC, medical,
     induction, police (if required), PPE all valid on the date ("Can't deploy: medical fitness expired on 02-11-2026.");
     Gate Reconciliation (gate IN ±60 min of first punch, else supervisor approval); wages 26 × ₹600 = 15,600 + OT 10 h ×
     ₹150 = 1,500 → gross 17,100; PF 12 % × min(15,600, 15,000) = 1,800; ESIC 0.75 % × 17,100 = 128.25 → 129; PT 200 →
     net 14,971; bill 40 × 26 = 1,040 man-days vs muster 1,028 → ₹7,200 disputed; compliance score 10/11 = 90.91 % →
     Payment Approval blocked; work-order budget ₹12,00,000 used ₹10,90,000 = 90.83 % → amber; incidents → CAPA, LTIFR;
     expiry alerts (#35); ID card with photo + QR; exit with gate block. Aadhaar last 4 only.
   - Logistics: freight = rate-card slab by weight/volume + fuel surcharge % + extras; Freight Variance vs bill;
     Shipment SLA; Delay Exceptions; Customer ETA mail; POD → Billing Release; gate-in with weighment for GRN vehicles;
     gate-out validates DC + e-way bill; returnable passes overdue alerts; vehicle/driver document expiry (#35).
   - Assets: capitalisation from purchase invoice lines; depreciation SLM/WDV dated rows (needs_review) with monthly GL
     posting; disposal gain/loss; QR verification by scan.
   - Service: SLA by priority; technician by skill/territory; visit checklist + customer sign-off on phone; AMC renewal
     mails 60/30 days; warranty eligibility by serial; claims → replacement or repair.
  Feeders: 40 tasks, 2 weeks of handovers, 25 visitors through the kiosk, 600 meal scans, 3 contractors / 60 workers / one
  wage month, 10 shipments with POD, 4 assets depreciated, 10 tickets with visits.
  Acceptance: 54 pages with every V40 tab and page-specific button; all examples pass.

  ==================================================================================================================
  PHASE 48 — CRM (8), Projects (17), 360° Order Tracking, Process Exceptions, Global Project History
  ==================================================================================================================
  V40 pages: crm-leads, crm-opportunities, crm-pipeline (＋ New Opportunity, Opportunity Register, Quotations, Sales Orders,
  View), crm-followups, crm-meetings, crm-customer360, crm-feedback, crm-sources; proj-demo-control, proj-stage-gates,
  proj-dependencies, proj-specifications, proj-test-records, proj-documents, proj-projects, proj-tasks, proj-subtasks,
  proj-milestones, proj-team, proj-timesheets, proj-expenses, proj-budget, proj-kanban, proj-gantt, proj-profitability;
  ops-order-360 (Order Timeline / Material & Purchase / Production & Quality / Delivery & Billing / Exceptions / Audit;
  buttons Load, Recalculate, Run Next Controlled Step, Word, PDF, Open Received / Accepted, Approval Inbox, Open);
  process-exceptions (Exception Register / Ownership / Corrective Action / SLA / Closure / Audit); project-global-history
  (Export History, ＋ Enter New Number, Load Project History, Department History, Load Document, Load).
  Work + worked examples (tests)
   - Project spine: C4 trace fields auto-filled on every copy/convert; project picker + badge on every form; changing it on a
     posted document needs approval. project_events from domain_events (one consumer, partitioned by year).
     History line example: "12-11-2026 14:05 · Production · R. Patil · ACCEPTED · MO/TAL/2627/0044".
   - 360°: stages Enquiry → Quotation → SO → Project → BOM & material → Reservation/Shortage → PR → PO → GRN → IQC →
     MO/job cards → FQC → FG → DC → Invoice → Collection with time spent per stage; weights order 5, material 25, production
     35 (pro-rata), quality 10, dispatch 15, billing 5, collection 5 → example 5 + 25 + 17.5 = 47.5 %; "Run Next Controlled
     Step" opens the next action for the user (never automatic).
   - Exceptions (every 30 min, auto-resolve): SO approved > 48 h with no project/MO; shortage > 24 h with no PR; PO late;
     GRN QC hold > 72 h; movement late; FQC passed no DC > 48 h; DC no invoice > 24 h; invoice overdue > 30 days; gate late;
     short receipt open > 48 h. Ownership, Corrective Action, SLA, Closure; department digest 09:00 + immediate High.
   - Stage gates: templates BLDC / SPPM / CUSTOM (gate docs URS, CHARTER, SPEC, DRR, BOM, PO, IQC, JC, TR, FAT, DC, SAT, INV,
     CLOSE); submit only when deliverable approved + tests passed + predecessors approved ("Gate G03 needs: approved SPEC,
     2 tests passed."); next gates open on approval (no work moves automatically); dossier PDF.
   - CRM: lead scoring rules; pipeline Kanban by stage with probability; forecast = Σ value × probability per month;
     follow-up reminders (automation); meetings with ICS invite; NPS = % promoters − % detractors; Win Loss reasons;
     "Won" → "Create Sales Order now?" from the quotation; prospect → customer with GSTIN check.
   - Projects: Gantt with critical path and baseline variance; timesheets → cost; EVM CPI = EV/AC, SPI = EV/PV
     (EV 40 L, AC 50 L, PV 45 L → CPI 0.80, SPI 0.89); ETC = (BAC − EV)/CPI; profitability.
  Feeders: 10 leads → 6 opportunities → 4 quotations → 3 won → SO; 2 product projects through G01–G04 by the right roles;
  timesheets.
  Acceptance: 28 pages with every V40 tab and button; project number carried through the whole chain; 360° with time per
  stage; 10 exception rules; gates with dossier.

  ==================================================================================================================
  PHASE 49 — Business Intelligence (10), My Dashboard, AI pages
  ==================================================================================================================
  V40 pages: bi-builder, bi-reports, bi-dashboards, bi-sales, bi-purchase, bi-inventory, bi-finance, bi-branch
  (Branch = Plant), bi-profit; ai-copilot, ai-demand, ai-inventory, ai-sales, ai-vendor, ai-finance, ai-executive,
  ai-insights (AI pages' buttons: AI Report PDF, Ask AI). (bi-scheduler done in 42.)
  Work
   - Chart.js 4 behind one <Chart>: line, bar/stacked, donut, heatmap, funnel, gauge, sparkline; Indian format;
     "View as table"; max 3 colours.
   - kpi_snapshots every 15 min + on events; period switch Today / Week / MTD / QTD / YTD / Custom; compare vs last period
     and vs last year.
   - MY DASHBOARD (Home tab) defaults by role: salesperson (my sales vs target gauge, pipeline, quotes waiting > 7 days,
     my overdue customers, follow-ups today, dispatches this week); buyer (open POs, deliveries due/overdue, PRs waiting,
     supplier rejections); store keeper (GRNs to post, putaway pending, picks pending, QC hold); production supervisor (OEE
     today, job cards running, downtime, handovers); quality inspector (lots waiting, my NCRs, instruments due);
     accountant (invoices to post, unreconciled bank lines, payments due, GST calendar); HR (present today, missed punches,
     leave requests, joiners/leavers); manager/head (C7 queues + team workload + department KPIs); employee (attendance
     calendar, leave balance, last payslip, my tasks); owner (Command Center). OWN data for salesperson/buyer.
     Drag/resize on a 12-column grid, widget picker, Reset to default.
   - Zoho finance widgets: Total Receivables / Payables (Current, 1–15, 16–30, 31–45, > 45), Cash Flow line,
     Income vs Expense bars, Top Expenses donut, bank balances — each opens its report.
   - Drill-down applies the filters and shows "Filtered from dashboard: {KPI} ✕"; row count = KPI value (test).
   - Targets green ≥ 90 %, amber ≥ 75 %, red below (exactly 90 = green, exactly 75 = amber). Example: target ₹25,00,000,
     achieved ₹18,75,000 = 75 % → amber.
   - bi-builder: data source (whitelisted plant-scoped views per module) → fields & measures (sum/avg/count/min/max) →
     filters & groups → chart → Preview & Publish to Report Library with Permissions; Favorites; Run History; Exports.
   - AI pages — deterministic first: demand = Holt-Winters/ETS per item with MAPE shown; anomalies = rules + z-score;
     duplicate payments = same supplier + amount ±1 % within 7 days; churn risk = drop in order frequency; vendor risk =
     OTIF, PPM, price trend. "Ask AI" and Executive Brief text use an LLM ONLY when Admin enables it in admin-settings;
     it receives only aggregated plant-scoped numbers (no personal data, no Aadhaar/PAN/bank), daily cost limit, every
     question logged, every answer shows its source numbers. With AI off, pages still work. "AI Report PDF" exports the page.
   - TV mode and KPI alerts verified; every dashboard < 500 ms.
  Acceptance: 17 pages with every V40 tab; role dashboards; report builder publishes a report; forecast with MAPE;
  drill-down equality; AI switch behaves as stated.

  ==================================================================================================================
  PHASE 50 — Administration (24) + Document Management (6): full owner/admin control, V37 Data Exchange
  ==================================================================================================================
  V40 pages: admin-company, admin-branches (Branch = Plant), admin-departments (Flexible Workflow & Access Matrix,
  ＋ Add Department, Open Inbox, Deactivate), admin-designations, admin-users (＋ Add User; tab Company Branch Scope =
  the plant checkboxes + default plant), admin-roles, admin-permissions (Save), admin-fy, admin-currency, admin-taxes,
  admin-numbering, admin-uom, admin-customfields, admin-formbuilder, admin-workflow (Apply, Save, Save Access; holds the
  Workflow Matrix), admin-import, admin-duplicates, admin-audit, admin-security, admin-backup, admin-api,
  admin-integrations, admin-settings, admin-approval; dms-folders, dms-docs, dms-versions, dms-permissions, dms-tags,
  dms-search.
  Work
   - V37 DATA EXCHANGE on every page (C9): Import (CSV/JSON/xls/xlsx) → "Load & Preview Selected File" (auto-map by V40
     label, saved mappings, rows with errors in red) → "Import & Replace Duplicates" (same primary field replaces older
     masters with audit; posted documents never replaced — listed as refused; batches of 500; result file). Export →
     "Load Selected Document" (all or one, with lines) → xls/csv/json → "Export Now" (logged in admin-audit › Exports &
     Downloads). "Clean This Module" (Super User, typed confirmation, drafts/test only, blocked on production unless the
     go-live cleanup flag is on). Duplicates: rules per page (name similarity + GSTIN/PAN/mobile), Merge Review side by
     side, merge re-points references, Undo within 7 days, blocked across different GSTINs with posted documents,
     Prevention Rules warn while typing.
   - Custom fields in form, list, filter, export, import template and PDF (max 50 per page; never in tax/money maths).
     Form Builder: sections, drag layout, Mandatory Rules and Conditional Visibility by role/status/plant, Preview & Publish;
     enforced by the API; system fields locked.
   - Roles: Module Rights × Action Rights (the C3 buttons as actions) × Data Scope (Own / Department / Plant / All) ×
     Approval Limits.
   - Security: password policy; MFA required per role (forced at next login); session controls + force logout; IP
     restrictions; login hours ("Sign-in is allowed 06:00–23:00 for your role."); auto-disable after N inactive days with a
     warning mail 7 days before; Security Events.
   - Numbering editor with preview and the ≤ 16-character GST check; FY open/close periods (posting into a closed period
     refused); carry forward.
   - API keys accepted for /api/v1 (scopes, plants, expiry, rate limit, usage logs). Integrations catalog with Mode
     Disabled / Sandbox / Live, Test connection, Sync Logs. Backup per module (password zip, logged). Feature flags per plant.
   - Module on/off per plant × role hides the module everywhere (menu, Home, search, dashboards, inbox, notifications).
   - DMS: folders with retention + access; versions with check-in/out, compare, rollback; share links with expiry; tags with
     auto rules; full-text search (Postgres tsvector on extracted PDF text).
  Worked examples (tests): custom field "Drawing No" on scm-po visible to Engineering in TAL and SAW → form, list column,
  filter, PDF "Drawing No: DRG-4412-B", Excel, import template; merge "Shree Engg Works" + "Shree Engineering Works"
  (same GSTIN) → 14 invoices + 3 SOs re-pointed, undo works; import of 200 items with 5 bad rows → correct error file.
  Acceptance: 30 pages with every V40 tab and button; examples pass; MFA forced for Directors; closed-period posting
  refused; DMS rollback; TIER 3 run (milestone).

  ==================================================================================================================
  PHASE 51 — Zoho-level extras
  ==================================================================================================================
  Work
   1 Comments tab on every record (internal): @user / @department → notification + My Inbox › Mentions; attachments;
     edit within 15 min.
   2 Activity timeline per record (events + audit; field before → after). Follow a record; "My followed records".
   3 Clone on every document; Bulk Update of chosen fields on draft rows; Mark as.
   4 Saved views shared with Only me / roles / users / everyone; favourite views.
   5 Customer portal (quotations accept/decline, orders, DCs, invoices, statements, pay online, certificates, raise a
     service ticket) and vendor portal (POs acknowledge, delivery schedule, upload invoice, payment status, SCAR reply):
     invite-only login, optional MFA, read-only by default, every action logged, plant-scoped.
   6 Getting Started checklist for Admin with progress %: company → plants → departments → users → masters → opening
     balances → approval matrix → workflow matrix → mail domain → first transaction.
   7 Help: "?" side panel per page (3–5 steps EN/HI from client-test-guide.md); first-login tour (Home → Search → ＋ Add New
     → a record → Move Forward → My Inbox); "What's new" from clicntmassage.md; keyboard sheet (? key: / search, N new,
     E edit, Ctrl+S save, J/K inbox).
  Acceptance: mentions reach My Inbox; timeline on every record; both portals with 3 flows each; Getting Started; help on all pages.

  ==================================================================================================================
  PHASE 52 — Phone, tablet, PWA, scanning, shop-floor screens
  ==================================================================================================================
  Work
   1 Breakpoints 1440/1280/1024/768/480; 0 sideways scroll at 360/390 on all 327 pages; lists → cards; single-column forms;
     lines as stacked cards; sticky Save bar; bottom bar Home · My Inbox · ＋ · Approvals · Menu; 44 px targets (56 px on
     shop-floor screens); 16 px inputs; the C3 row scrolls sideways on one line.
   2 PWA install (Android; iPhone 16.4+ needs Home Screen install for push); offline: shell + last-viewed lists read-only +
     drafts in IndexedDB synced later; never post offline.
   3 Camera scanning (BarcodeDetector + JS fallback): putaway, pick, cycle count, gate-in/out, canteen Live Meal Desk,
     asset QR / breakdown, visitor pass, cl-gatepass.
   4 Tablet screens: job card (Start/Pause/Complete, good/reject), PM checklist, gate, canteen, visitor kiosk,
     Department Inbox, Live Board.
  Acceptance: 0 sideways scroll at 390; install + push on Android and iOS (owner tests on real phones → OWNER-ACTIONS);
  scanning in the 8 flows.

  ==================================================================================================================
  PHASE 53 — Speed, security, backup, monitoring, DPDP
  ==================================================================================================================
  Work
   1 k6 on 100k-row tables, 100 virtual users: meet B15; web first JS ≤ 300 KB gzip, LCP < 2.5 s on 4G. Fix with indexes,
     select-only, React Query (staleTime 30 s, SSE invalidation), virtual lists above 200 rows, lazy routes per family,
     N+1 guard (> 25 queries per request fails).
   2 Concurrency: double post / approve / move → 409, never a duplicate document.
   3 Security: ZAP authenticated scan 0 High; ASVS L2 checklist; plant/role isolation with crafted requests; uploads (type,
     size); CSP; rate limits on login/OTP; secrets rotation steps → OWNER-ACTIONS.
   4 Backup: restore drill script (snapshot + point-in-time restore to a new instance + app smoke; time recorded) — the
     owner runs it on AWS (OWNER-ACTIONS); S3 versioning check.
   5 Monitoring: Sentry + CloudWatch alarm definitions (5xx, p95, queue backlog, disk, mail bounce rate, devices offline);
     admin-settings › System Diagnostics shows them.
   6 DPDP: privacy notice, consent records, employee/visitor data export & delete requests, retention jobs (visitors 1 year),
     breach runbook.
  Acceptance: k6 report meets every budget; ZAP 0 High; restore drill script ready; alarms defined; DPDP checklist ready.

  ==================================================================================================================
  PHASE 54 — Full company through the screens, all journeys, final V40 proof, UAT, go-live pack
Acceptance: k6 report meets every budget; ZAP 0 High; restore drill script ready; alarms defined; DPDP checklist ready.

==================================================================================================================
PHASE 54 — Full company through the screens, all journeys, final V40 proof, UAT, go-live pack
==================================================================================================================
Work
 A FULL FEED on rhai_erp_ui (through the screens, each department's OWN user, never Super User; resumable; SMOKE tier =
   1 week nightly): 60 users with plant checkboxes; 80 customers, 60 suppliers, 400 items, 30 BOMs; 300 employees +
   60 contract workers; opening balances; 150 enquiries → 90 SOs through the 14-step chain; 200 POs; production; quality;
   dispatch and billing with mail automations; 3 months of attendance (device simulator) + 3 payroll runs; contract wages
   and bills; workplace; maintenance; assets; service; logistics and gate; GST returns; bank reconciliation; 3 month
   closes; admin configuration.
 B JOURNEYS J1–J14, green 3 times: J1 Order to cash · J2 Procure to pay · J3 Plan to produce · J4 Hire to retire ·
   J5 Contract-labour month · J6 Department movement (12 inboxes) · J7 Product development (gates) · J8 Visitor & gate ·
   J9 Maintenance · J10 Multi-plant owner (1/2/3 plants; totals = sum) · J11 Plant security (crafted API calls refused) ·
   J12 Admin control (custom field, module off, view-as read-only) · J13 Dashboards (own data, drill-down equality) ·
   J14 Month end.
 C INTEGRITY: trial balance balanced per plant; stock value = GL inventory; AR/AP = control accounts; paid days = locked
   attendance; GSTR-1 = sales register; every posted document has its approval/movement trail.
 D FINAL V40 PROOF: ui:audit on the fed data for 9 roles × plant combinations, average ≥ 27/30, 0 P0/P1; parity pages
   327/327, tabs 1,800/1,800, fields 4,311/4,311 (or "changed on purpose" with a reason), buttons 100 %; gallery V40 | ERP
   for every page; TIER 3 three times.
 E UAT + GO-LIVE PACK: docs/client-test-guide.md = complete UAT book by role (every journey as numbered steps with ✔️) +
   sign-off sheet per department; OWNER-ACTIONS.md go-live list: CA / HR / plant-head sign-offs (needs_review = false
   only after signature), production setup (RDS, S3, SES domain SPF/DKIM/DMARC, devices + Nginx /iclock/, GSP / bank /
   payment live keys), backup before migrations, real masters by Data Exchange with validation reports, opening balances
   signed by Finance, role-wise training (1 hour each, Hindi cheat-sheet), 1-week parallel run, 30-day hypercare plan,
   zero test data on production. Final docs/clicntmassage.md for UAT.
Acceptance: full feed 0 failures; J1–J14 ×3; integrity green; parity 100 % or reasoned; UAT book + go-live list ready;
FINAL SUMMARY (A9) written.

------------------------------------------------------------------------------------------------------------------
START NOW: Part A, Step 0.
------------------------------------------------------------------------------------------------------------------

What happens after you start it:
- The builder works phase by phase, 37 → 54, without needing any other phase files.
- It writes a timestamped line to docs/build/JOURNAL.md at least every 10 minutes and keeps its exact next step in docs/build/STATE.json, so a crash or a new session resumes from the same place.
- Items only you can do (GST sandbox account, a biometric device, CA/HR sign-offs, real-phone tests) collect in docs/build/OWNER-ACTIONS.md. The build doesn't stop for them.
- After each phase it updates docs/clicntmassage.md and docs/client-test-guide.md and makes one local commit. You deploy and send the client message when you choose.

Send me any phase report, or the journal, whenever you want it checked against V40.



