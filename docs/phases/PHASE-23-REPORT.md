# PHASE 23 — Report (built, NOT tested)

Built locally on 2026-11-13. Nothing committed, pushed or deployed. By the owner's instruction (2026-11-13) no tests were run
while building; only `tsc` (API and web, both clean). All testing is in the final small-batch round after Phase 25.

## What was built
**Database** — migration `20261211000000_phase23_plants_menu` (not yet applied to any database):
`users.all_units_access`; `user_preferences.unit_ids` + `remember_plants` (back-filled from the old single-plant columns);
`user_home_prefs`, `recent_pages` (trigger keeps the last 20), `role_landing`, `dept_work_counters`, `user_work_counters`;
a trigger that clears a user's default plant when that plant is removed; notification type `access.plants_changed`.
`schema.prisma` has the new columns, but `prisma generate` could not run (the engine file is locked by leftover e2e servers),
so the new code reads and writes these columns with raw SQL.

**API**
- Context (`core/context/resolve-context.ts`): new header `X-Units` (plant codes or ids); `ctx.unitIds` is always filled;
  `ctx.unitId` stays the plant a new record belongs to (default plant if chosen, else the first). A plant the user may not use gives
  **403 `UNIT_NOT_ALLOWED` "You don't have access to {plant}."** The saved choice (`user_preferences.unit_ids`) is used when no header is sent.
  The old `X-Unit-Id` behaviour and its error code are unchanged.
- `GET/PUT /me/plants` (picker data, own choice, audited as `PLANTS_CHOSEN`), `PUT /users/:id/plants` (Admin checkboxes, "all plants incl. future",
  default plant, audited `USER_PLANTS_CHANGED`, notifies the user, SSE `session.context_changed`), `GET /me/menu-v2`, `GET /me/search?q=`,
  `GET /me/home`, `PUT /me/home-prefs`, `POST/DELETE /me/favourites/:pageId`, `POST /me/recent/:pageId`, `PUT /admin/role-landing`.
- Generic records engine (about 227 pages): lists show the combined data of all chosen plants (`g.unit_id = ANY(...)`); rows carry `unitCode`.
  Creating a record with 2+ plants chosen takes a `unitId` that must be one of the chosen plants (else 403 `UNIT_NOT_ALLOWED`).

**Web**
- `PlantPickerPage` (after sign-in for 2+ plants unless "Remember"), top-bar `PlantSelector` (chips + checkbox list + Apply, asks before discarding unsaved edits),
  `MenuPage` (family cards, search with Ctrl+K, favourites, recent) at `/menu`, `HomePage` at `/` and `/home` (hero, My Work strip, quick create, shortcuts, recent,
  announcements, What's new), a "⊞ Menu" button in the top bar.
- Registers show a **Plant** column automatically when 2+ plants are chosen; the Add form shows a required **Plant** field in that case.
- User form: "All plants (including future plants)" checkbox, read-only Access type, live summary line ("X can work in A and B. Default: A.").
- Admin changing a user's plants updates that user's open tabs at once and shows "Your access to {plant} was changed by Admin. View updated."

## Deviations / not done (carry-over)
1. **Only the generic records engine lists across plants.** About 170 other places read `ctx.unitId` directly (finance, inventory, HR, payroll, procurement,
   sales, etc.). With 2+ plants chosen they still show only the write plant (never another plant's data: safe, but not "combined"). Retrofitting each to
   `ctx.unitIds` is the remaining work for "no direct unit filter left" and "list totals = sum per plant".
2. **Counters are not filled.** `dept_work_counters` / `user_work_counters` exist but no service writes them yet; Home's My Approvals and Overdue come live from the approvals
   queries, every other tile shows "—". The picker's "Pending approvals" per plant shows "—" for the same reason.
3. **"Remember my choice" reset in My Profile** is not built (the flag is saved; the reset button is missing).
4. **Per-role landing screen (`admin-landing`)** has the API (`PUT /admin/role-landing`) but no admin page yet. "My Dashboard" is a Phase 24 page; until then the button opens a placeholder page.
5. **Menu customise** (reorder / hide families, density, drag to reorder favourites) is stored by `PUT /me/home-prefs` but the Menu page has no UI for it yet; favourites and search work.
6. **Per-family pending badges** on the Menu cards are `null` (not tracked yet).
7. **Admin form can set "All plants" but not clear it**: the user list does not expose the flag, so unticking on an existing user does not clear it (the plant ticks are replaced as before).
8. **Search shows no recent *records*** (only recent pages). Quick create tiles use the page's own Add form (no pre-set plant yet beyond the Plant field).
9. `prisma generate` blocked by two leftover e2e servers holding the engine file (ports 4100 / 5180). Owner: stop them, then `npm run db:generate` in apps/api.
10. Not run: any test. Existing tests that may need an update: `ContextSelectors.test.tsx` (new Unit select `hidden` attribute and the plants store), `Sidebar`/`App` tests that expect the dashboard at `/`.

## Deploy sheet (owner, by hand — not done by me)
1. Backup the production database.
2. `prisma migrate deploy` (migration `20261211000000_phase23_plants_menu`, forward-only, idempotent `IF NOT EXISTS`).
3. `npm run db:generate` in apps/api. No new dependencies, no new environment variables.
4. Build API and web, restart, `/health` OK.
5. Smoke: Admin → Users → give a user two plants (summary line) → sign in as that user (picker shows two plants) → ☰ Menu → search "grn" → ⭐ → Home shows it.
6. Rollback: the columns and tables are additive; the old single-plant path still works, so the code can be reverted without touching the data.

## Test round (2026-11-13, small batches, API only)
`tests/phase23-25.test.ts` (new, 14 tests) passes: plant rules, the 90 % / 75 % colour edges, SLA over a Sunday and a holiday, the state machine through the API
(send, receive, accept, return, recall, short receipt, one open movement per document, wrong department refused), the Workflow Matrix suggestion, targets, TV link
(read-only, wrong token 401, POST 405, rotated link stops), Menu / favourites / search / Home. Bugs found and fixed by the round: wrong column name `user_departments.department_name`;
an empty user id passed to the target lookup; an Owner without a department could not send (now names the sending department).
Also green: context (49), records + numbering (44), forms / all-GET-routes / users (39). `phase3-context.test.ts` expectations updated for the new `unitIds` field.
Not run: the web unit tests, the e2e / crawler / feeders (blocked: two old servers hold ports 4100 and 5180 and the Prisma engine file, and memory is under 1 GB),
and the remaining API test files (a full run was stopped by the system for low memory). Known failing before and after: Phase 21 web-push test, Phase 11 date-dependent tests.
