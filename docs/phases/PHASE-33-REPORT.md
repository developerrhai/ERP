# PHASE 33 (file PHASE-33.md, titled "PHASE 32") — Report: only the offline parts could be done

Built locally on 2026-11-13. Nothing committed, pushed or deployed.

This phase is "feed a complete company through the screens with Playwright, run every journey, prove V40 parity, polish and sign off". It needs a running API and web, a staging database, many hours of browser runs and a computer with free memory.
This machine has under 2 GB free and two old test servers hold ports 4100 / 5180, so **the feed, the journeys, the visual compare, axe, ZAP, k6 and Lighthouse were NOT run.** What follows is what could be built and checked without a browser.

## Done
1. **`docs/PARITY.md`** (generated, `node scripts/gen-parity.cjs`, no database or network): all 327 V40 pages against the built app. Result: **271 pages have a dedicated screen or typed / guarded API, 3 are generic registers, 53 are not in the menu yet** (for example `my-approvals`, `master-customers / products / materials`, `mfg-material-issue`, `customer-receipts`, the per-department inbox pages `dept-inbox-*`, `ops-mfg-dashboard`). The check is code-level: it does not compare tabs, fields and buttons one by one; that needs the browser.
2. **Global integrity checks** (`apps/api/src/core/integrity/checks.ts`, run with `npm run integrity` in `apps/api`): trial balance debit = credit per plant, every posted journal balanced, GL lines equal the journal totals, locked attendance has a locked summary, canteen month totals equal the meals served, one open movement per document, deployed contract workers belong to an approved contractor, no full Aadhaar in the worker register, locked wage sheets equal their lines. A check whose table is missing is skipped. A **safety guard** refuses any database that is not named `*_staging`, `*_e2e` or `*_test` (or the local `rhai_erp`). `tests/integrity.test.ts` (2 tests) runs the checks on the test database and passes.
3. **The feed plan** `tests/feed/full/feed-order.json`: the 23 steps with roles and contents from section 5; every step is marked **NOT WRITTEN**.
4. **Client documents:** `docs/client-test-guide.md` has a Part for each phase 22-31 in numbered steps with expected results, and `docs/clicntmassage.md` has a "Phase 26-33 - what is new" section that also says plainly what is not finished.

## Not done (and why)
1. **The full feed (23 steps, ~60 users, 300 employees, ~18,000 canteen scans ...) through the UI**, the SMOKE tier, the resumable checkpoints, and journeys **J1-J14** with the integrity checks run after them. Needs the browser run on staging.
2. **Visual compare with V40** (≤ 3 % layout diff), the **beauty pass** (Lucide icons, skeletons, empty-state drawings, transitions, hero gradient), the **friendly pass** (help "?" on every page in English and Hindi, first-login tour, "What's new" panel, Hindi strings for all new pages).
3. **Proofs:** k6 on the full data, Lighthouse, the crawler × 9 roles × plant combinations, axe, ZAP.
4. **Closing Phase 20:** two-process e2e × 3, secret rotation, RDS restore drill, S3, CloudWatch alarm test, opening balances signed, UAT signed, needs_review sign-off. Owner steps listed in PHASE-35-REPORT.
5. Dropping the old `user_preferences.unit_id` / `all_units` columns (E-40): not done on purpose, because it needs the full run to prove nothing reads them.

## What to do next (owner or a session with a free machine)
1. Free the memory, stop the two old servers (ports 4100 / 5180), create a database named `rhai_erp_staging` and point the API at it.
2. Write the feeders step by step from `tests/feed/full/feed-order.json` (the Phase 22 framework in `tests/feed/lib` is the base), run SMOKE, then `npm run integrity` after each step.
3. Run the crawler, axe and the visual baselines (Phase 32 CSS is ready).
