# UI audit tooling (Phase 36 Part B)

Compares every V40 page (`RHAI_ERP_V40_Edit_Update_Fixed.html`, read-only) with the ERP: buttons, tabs, API calls, console, overflow, text problems, screenshots.

## Run
1. Start the local servers: `cd apps/api && node node_modules/tsx/dist/cli.mjs ../../tests/feed/ui/start-ui-servers.ts` (API 4100, web 5180, database `rhai_erp_ui`; passwords live in the git-ignored `tests/feed/ui/state.json`).
2. `npm run ui:audit` - options: `--family=Sales`, `--page=sales-orders,inv-items`, `--role=super|admin|mgr-purchase|emp-stores|sales-talsaw`, `--width=1440,390`, `--tag=after`, `--force`.
   Batches of 20 pages, one Chromium, resumable, pauses when free memory is low. Output: `docs/ui-audit/data/<role>[-tag]/pages.jsonl`, screenshots in `docs/ui-audit/shots/<family>/` (git-ignored).
3. `node tests/ui-audit/build-report.mjs <dataset>` (e.g. `super`, `super-after`, `admin`) - report, CSVs, gallery.
4. `node tests/ui-audit/compare.mjs` - before/after numbers and `gallery-compare.html`. `node tests/ui-audit/roles-summary.mjs > docs/ui-audit/ROLES-SUMMARY.md` - role table.

## Unattended
`bash tests/ui-audit/chain.sh` (after audit then four roles) or `chain2.sh` (refresh of the Super User "after"), with `bash tests/ui-audit/heartbeat.sh` which writes a status line to `docs/ui-audit/PHASE-36-CHECKPOINT.md` every 10 minutes and restarts a dead chain.

## Debug
`PROBE=1 AUDIT_PAGE=<id> AUDIT_W=<px> npx playwright test -c tests/ui-audit/playwright.config.ts probe` lists the elements that stick out past the viewport.

## Limits
Buttons are never clicked (the phase allows only safe clicks), so "present" means a button with the same label exists. Tabs, record views and forms are compared by label only. The score is a rule-based heuristic from the DOM.
