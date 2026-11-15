# PHASE 36 report - UI phase (V40 parity)

**Status: Part A mostly done, Part B done (Super User fully, other roles at 1440), Part C partly done.**
No DB schema changes. Nothing committed, pushed or deployed (the repo `CLAUDE.md` forbids committing unless asked; it overrides the phase text "commit locally per part"). Local database `rhai_erp_ui` only.

Working files: `docs/ui-audit/` - `PHASE-36-CHECKPOINT.md` (running log), `DATA-FEED-LOG.md`, `UI-AUDIT-REPORT.md` (baseline), `super-after-UI-AUDIT-REPORT.md`, `BEFORE-AFTER.md`, `ROLES-SUMMARY.md`, CSVs (`pages.csv`, `api-calls.csv`, `buttons.csv`, `issues.csv`, `parity.csv`, and `super-after-*.csv`), `gallery.html` and `gallery-compare.html` (git-ignored, open in a browser), screenshots in `shots/` (git-ignored).

## Headline result (Super User, all 327 V40 pages, before -> after)
| Measure | Before | After |
|---|---|---|
| Pages that showed "Page not found" | 43 | **0** |
| P0 issues (broken page) | 43 | **0** |
| Average UI score (rule-based, /30) | 15.4 | **20.2** |
| Pages below 18/30 | 232 | **63** |
| V40 buttons missing | 7,294 | **3,208** |
| V40 buttons present | 1,527 | **4,623** |
| V40 buttons greyed with a reason | 1,086 | 2,076 |
| Pages with "Arrives in Phase..." | 11 | **0** |
| Page-wide sideways scroll at 1024 px | 37 | **0** |
| Page-wide sideways scroll at 390 px | 122 | **3** |
| Console errors (sum over pages) | 6 | 7 (a React duplicate-key warning on Balance Sheet was fixed after the audit; the other 3 are valid 404 answers: no employee profile for the Super User / no attendance data) |

"Before" is the first full audit. A few early pages of it were audited after the first button fix, so the true baseline is slightly worse than shown.

## Part A - data fed through the screens (see DATA-FEED-LOG.md)
Only the first Super User came from the seed script. Everything else was typed into the real forms with Playwright (fixed seed, valid GSTIN / Aadhaar / PAN check digits, Indian mobiles).
Entered: 1 Administrator + 31 users (every role, 1-, 2- and 3-plant) · company profile and 3 plants with state/GSTIN · designations, department Engineering · 20 customers · 20 suppliers (8 approved) · 4 HSN rows · 60 items · 3 warehouses · 3 work centres with rates · 3 BOMs (sent for approval and released) · 3 routings (released) · 10 enquiries · 9 quotations · 6 sales orders (multi-line, submitted, approved by the matrix approvers; 3 moved Sales -> Purchase / Production / Warehouse, each department Received and Accepted) · 5 PRs · 6 POs (approved by manager and head) · 4 GRNs (1 posted) · 3 production orders (released, job cards made) · 40 employees · 6 tasks · 4 assets · 3 visitors.
Result: 264 forms done, 2 not done (breakdowns: assets must be flagged "Needs maintenance" first).
**Not done (listed in the log):** approval/workflow matrix edits, mail automations, attendance policies and devices, price list, contract workers, department Return, QC, delivery challans, invoices, receipts, purchase invoices, payments, journals, bank entries, a month of attendance, leave, payroll, handovers, canteen, service ticket, project with gates, gate pass. Most records were typed as the Super User, not as each department's own user (approvals and receive/accept were done by the right people).

## Part B - audit (tools: `npm run ui:audit`)
`tests/ui-audit/` opens every V40 page in V40 (its own `nav(id)` after the built-in demo button) and in the ERP and records buttons, tabs, API calls, console, overflow, text problems, with screenshots at V40 1440 and ERP 1440 / 1024 / 390 (batches of 20, one Chromium, resumable, pauses on low memory; `chain.sh` + `heartbeat.sh` run it unattended). `build-report.mjs` writes the report, CSVs and gallery; `compare.mjs` writes the before/after; `roles-summary.mjs` the 5-role table.
Honest limits: buttons were **not clicked** (the spec allows only safe clicks) so "present" means a button with the same label exists, and PRESENT-WORKS vs PRESENT-DEAD is not tested; tabs inside pages, record views and add/edit forms are compared by label only; the score is a rule-based heuristic from the DOM.
Roles: Super User (327 pages) and Administrator, Department Manager Purchase TAL, Employee Stores TAL, Sales user TAL+SAW at 1440 only - see `ROLES-SUMMARY.md`.

## Part C - what was built
* **Design system:** `apps/web/src/ui/` (Button with "Not available yet: {reason}", StatusBadge, ActionRow with More, PageHeader, EmptyState, Skeleton, KpiCard, Field, MoneyInput, DateInput, Combobox, Tabs, DataTable, ConfirmDialog, Indian number/date/status helpers, amount in words), `styles/ui.css` (V36/V39 look on the V40 tokens, 34px controls, radius 9/15, sticky table header, soft badges, skeleton, 150 ms feedback, 3px focus ring), `/admin/ui-kit`. ESLint blocks inline styles in these files.
* **Buttons (C3):** the shared page bar now carries the V40 head row (← Return, Email, Industry PDF, Word, ⇧ Import, ⇩ Export, Duplicates, Documents, Submit Approval, Approval Queue, Move Forward, Project History; plus Excel / Print / Edit / Delete when the page has none of its own). Every button has a real action or is greyed with a reason; "Arrives in Phase" is gone. Documents have a record bar (Move Forward, Industry PDF, Word, Email, History).
* **Pages that were missing (C4):** 43 V40 page ids redirect to the right screen (department inboxes, department work, masters, My Approvals, plant movement, contract labour and more).
* **Forms (C5, partly):** customer / supplier / item pickers are type-ahead with server search (the old dropdown showed only 30 items), unique ids per line, GST totals panel with amount in words, Combobox.
* **Shell (C2):** one Menu button, desktop collapse (in memory only; the project bans localStorage), working search box, phone bottom bar, top bar on one line, no duplicate Notification Center.
* **Home (C6):** the eight V39 queue cards (counts for Shift & Handover, Visitor / Gate and Canteen are "—": the Home API has no counts).
* **Phone and tablet (C7, partly):** tables scroll in their own box, grid fixes, 44px targets, 16px inputs, one-line action row.
* **Real bugs fixed on the way:** designation create sent `status` (422); level range 1-100 vs 1-99; Balance Sheet list without a React key; overflow regression from my own CSS (found by the audit, fixed). The page bar also got Approvals, Reports, Analytics & Graphs, Audit Trail and 360° Tracking buttons (only where the page has none).
* Tests: ui kit, ActionBar (11), aliases (4), words (2), totals (2), procurement + sales (7) all pass; `tsc` clean. Pre-existing and unrelated: 6 failures in `ContextSelectors.test.tsx` and 5 in `App.test.tsx` (stale Home expectations).

## Acceptance (honest)
| Item | State |
|---|---|
| Part A: local DB filled through the screens for every module | **Partly** (see list above) |
| DATA-FEED-LOG lists every failure | Done |
| Part B pictures, API calls, button comparison, score, report, CSVs, gallery | Done |
| 0 V40 buttons missing | **Not met** (3,208 missing; mostly page tabs, row buttons and per-page extras) |
| 0 dead buttons / 0 "Arrives in Phase" | "Arrives in Phase" **met**; dead buttons not tested by clicking |
| 0 breaks at 390 / 1024 / 1440 | **Nearly** (3 pages at 390) |
| 0 WEB-owned P0/P1 | P0 **met**; P1 **not met** (missing buttons and tabs) |
| Same V40 head row on every page | **Met** (shared bar); register layout, table-first and V36 tabs **not met** |
| 12 main documents with V36 form, source auto-fill, GST panel | **Partly**: pickers + totals panel on the shared document form; source auto-fill and the full V36 layout not done |
| Home = V39 workspace | **Partly** (cards yes, hero/metrics/quick bar as before) |
| Average score >= 25, none below 18 | **Not met** (20.2; 63 below 18) |
| Inline styles < 50 | **Not met** (958 in source; lint rule added for new files; a blind rewrite would risk layout regressions) |
| Lighthouse / axe | **Not run** |
| `/admin/ui-kit` | Done |
| Login screen unchanged | Done |
| Before / after gallery | Done (`gallery-compare.html`) |

## Needs Phase 37 / next session
* **V36 tabs on every page** (295 pages): each V40 tab needs real content; a tab strip without content would be a dead button, so none was faked.
* Document detail shows the raw item id: the API must return `itemCode` / `itemName` on document lines.
* API gaps: `GET /hr/attendance/days?month=...` and `GET /hr/ess/me` return 404 on some pages; Home API has no counts for shift/visitor/canteen.
* Forms smaller than V40 (customer, supplier, enquiry), HSN master has no GST rate, "Submit for Approval" still offered on pending suppliers, dialogs that turn into a record view instead of closing, raw status codes (NOT_REQUIRED, NONE) in the GRN view, date inputs show mm/dd/yyyy, form footer wording (Save / Save Record / Save draft).
* Moving every page onto `src/ui`, the 12 documents in the full V36 layout with source auto-fill, inline-style clean-up, Lighthouse and axe, dead-button click tests.
* Feed leftovers (see Part A).

## How to resume
`docs/ui-audit/PHASE-36-CHECKPOINT.md` has the exact commands. Servers: `cd apps/api && node node_modules/tsx/dist/cli.mjs ../../tests/feed/ui/start-ui-servers.ts`. Feeders: `npx playwright test -c tests/feed/ui/playwright.config.ts a0N`. Audit: `npm run ui:audit`, then `node tests/ui-audit/build-report.mjs <dataset>`.
