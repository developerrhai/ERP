
# PHASE 23 — Plant access (one, two or all plants), plant picker, personal Menu page and Home

## 1. Goal
- **Admin** can give each user one plant only, or several plants, by **checkboxes**, with one default plant.
- **After login** (login itself unchanged, R-30), a user with more than one plant chooses which plants
  to view: one, two or all three. They can change this any time from the top bar.
- **Every user** gets a beautiful **Menu page** (their own complete menu) and a **Home** page (their
  own work and shortcuts).

## 2. Pages
| Page | What it is |
|---|---|
| admin-users | user form gets the "Plants" section |
| /choose-plants | plant picker after login, only for users with 2+ plants |
| Top-bar plant selector | multi-select; replaces today's single Unit select |
| /menu | Menu page — opened by "☰ Menu" and by the Menu tile on Home |
| /home | Home page — the landing page |
| admin-landing | per-role landing: Home / My Dashboard / a chosen page |

## 3. Rules
**Plants on the user (Admin):**
- checkboxes, one per active plant: ☐ Talwade (TAL) ☐ Sawardari (SAW) ☐ Varale (VAR) (+ any unit added
  later);
- "☐ All plants (including future plants)" ticks every box and keeps future units included
  (flag all_units_access);
- "Default plant" radio, chosen only from the ticked plants;
- "Access type" shown read-only: "Single plant" (1 ticked) / "Multi-plant" (2+).
- At least one plant is required, except Super User, who always has all plants.

**Picker after login:**
- shown when the user has 2+ plants and has not ticked "Remember my choice";
- options:
  - one row per allowed plant with a checkbox and the plant's city;
  - quick buttons "Only {default}" and "All my plants";
  - ☐ "Remember my choice and don't ask again" (it can be reset in My Profile).
- **Owner (Super User)** sees all plants and can choose 1, 2 or 3 (R-37).
- Single-plant users skip the picker.

**Viewing vs creating:**
- Lists, dashboards and reports show the combined data of the selected plants, with a "Plant" column
  shown automatically when more than one is selected.
- **Creating** a document: the form shows a required "Plant" field.
  - When one plant is selected, it is fixed to that plant.
  - When several are selected, it defaults to the default plant (if selected), else the first; the
    user may change it among the selected plants only.
- Posting, approvals, numbering, stock and GL always use the document's own plant.

**Security:** the server checks every unit id against user_units on every request (R2-6). Removing a
plant from a user ends their sessions for it at once (SSE `session.context_changed` + the next
request re-checks).

**Menu page:** shows only the pages the user may open (Phase 2 permissions + modules switched on for
at least one selected plant, Phase 31).

## 4. Database (<ts>_phase23_plants_menu)
- ALTER users ADD all_units_access boolean default false. The default unit already exists as
  users.default_unit_id.
- user_units (exists) — the ticked plants. A trigger keeps default_unit_id ∈ user_units.
- ALTER user_preferences ADD unit_ids uuid[] NOT NULL DEFAULT '{}', ADD remember_plants boolean default
  false (unit_id/all_units are kept read-only for one release, E-40).
  Data migration: unit_ids = {unit_id}, or all user_units when all_units = true.
- user_home_prefs(user PK, pinned_pages text[], hidden_families text[], family_order text[],
  favourites text[], landing text default 'home', theme 'light'|'dark', density 'comfortable'|'compact')
- recent_pages(user, page_id, opened_at) — keeps the last 20 (trigger trims)
- role_landing(role_id PK, landing 'home'|'my-dashboard'|page_id)
- dept_work_counters(department_id, unit_id, receipt, accept, work, approvals, tasks, shifts,
  visitors, meals, updated_at) PK (department_id, unit_id)
  - created here; filled for approvals now, by Phase 25 for movements, by Phase 29 for
    tasks/visitors/meals.
- user_work_counters(user_id, unit_id, my_approvals, my_tasks, my_overdue, my_drafts, my_returned,
  updated_at) — updated in the same transaction by the owning services

## 5. Logic and examples
**A. Context resolution** (core/context.ts; one function used by every request):
~~~
allowed  = user.all_units_access ? all active units : user_units
selected = (header X-Units or prefs.unit_ids) ∩ allowed
if selected is empty → [default_unit] (or the first allowed)
ctx.units = selected; ctx.writeUnit = requested form unit, which must ∈ selected
~~~

**B. Example — plant sales in the Owner's view** (MTD, posted invoices, taxable value):
| Plants selected | Sales MTD |
|---|---|
| TAL | ₹42,50,000 |
| SAW | ₹18,20,000 |
| VAR | ₹9,30,000 |
| TAL + SAW | ₹60,70,000 |
| All three | ₹70,00,000 |

With 2+ plants, lists show a Plant column; dashboards show the total plus a per-plant split bar.

**C. Example — a store keeper with TAL only:** no picker; the top bar shows "Talwade" as a fixed chip;
the GRN Plant field is fixed to TAL; any SAW URL → "You don't have access to Sawardari."

**D. Example — a purchase head with TAL + SAW, viewing both:**
- The PO list shows both plants.
- ＋ Add PO → Plant field = TAL (the default), can switch to SAW, not VAR.
- Saving with VAR via a crafted request → 403 UNIT_NOT_ALLOWED.

**E. Menu page:**
- **Header:** search box (type 2+ letters → pages, plus "Create …" actions, plus recent records),
  plant chips, and "Customize".
- **Sections:**
  1. ⭐ Favourites (drag to reorder);
  2. 🕘 Recent (last 8);
  3. **All modules** — a grid of family cards (icon, colour band from the tokens, name, page count, a
     badge of pending items in that family). A click expands the card into its page list (2 columns),
     each page with a ⭐ toggle.
- **Customize:** hide a family, reorder families, set a landing page, compact/comfortable density.
- **Keyboard:** Ctrl+K opens the same search anywhere.
- Families and pages come from registry v2 filtered by permissions.
- **Per user:** an employee with 14 allowed pages sees 3 cards; the Owner sees 29 families.

**F. Home page:**
1. **Hero** (V39 gradient): "Good morning, {name}"; role · department · plant chips; today's date;
   a mini-calendar of today's meetings and tasks (from Phases 10 and 29 when built).
2. **My Work strip:** To Receive · To Accept · In Work · My Approvals · My Tasks · Returned to me ·
   My Drafts · Overdue (red). Each opens a filtered list. Counts come from the counters; modules not
   built yet show "—", never 0.
3. **Quick create** (by role): Lead · Quotation · Sales Order · PR · Visitor · Task · Leave · Expense ·
   Employee. Each opens the form with the plant pre-set.
4. **Shortcuts:** pinned pages and favourites as tiles.
5. **Announcements** (Phase 21 banner) and "What's new" (from clicntmassage.md, the latest section).
6. "Open Menu" and "Open My Dashboard" buttons.
- GET /home returns everything in one call (≤ 150 ms).

## 6. API
- PUT /admin/users/:id/plants {unitIds[], allUnits, defaultUnitId}
- GET /me/plants → {allowed[], selected[], default, remember}
- PUT /me/plants {selected[], remember}
- GET /me/menu → families + pages + badges (cached per user, 60 s, invalidated on permission change)
- GET /me/search?q=
- GET /home
- PUT /me/home-prefs; POST/DELETE /me/favourites/:pageId; POST /me/recent/:pageId
- PUT /admin/role-landing
- Header X-Units: comma-separated unit codes or ids; every request validates it

## 7. Screens
**User form, "Plants" section:**
- a row of large checkbox cards (plant name, code, city), with "All plants (incl. future)" above them;
- the "Default plant" radio appears under the ticked cards;
- live summary: "Ramesh can work in Talwade and Sawardari. Default: Talwade."

**Plant picker:** full-screen card over the brand background:
- "Choose the plants you want to see";
- one checkbox card per plant with a live small count ("Pending approvals: 4");
- [Only Talwade] [All my plants];
- ☐ Remember my choice;
- **Continue** — disabled until at least one is ticked.

**Top bar:** a plant chip group; a click opens a checkbox dropdown with Apply. With unsaved form changes,
it asks to discard first (the current behaviour).

**Menu and Home:** R2-1 look; 2 / 4 / 6 tiles per row on phone / tablet / desktop.

## 8. Messages
| Case | Message |
|---|---|
| no plant ticked | "Tick at least one plant." |
| default not ticked | "The default plant must be one of the ticked plants." |
| UNIT_NOT_ALLOWED | "You don't have access to {plant}." |
| picker, none ticked | "Choose at least one plant to continue." |
| creating with 2+ plants | hint "Choose the plant this document belongs to." |
| removed plant | toast "Your access to {plant} was changed by Admin. View updated." |

## 9. Audit & notifications
- Plant access changes (before/after) are audited and notify the user.
- The picker choice is logged (user, plants, time) for the security log.

## 10. Tests
- **Unit:** context resolution (every combination, all_units_access, future unit added).
- **API:**
  - a crafted X-Units with an unallowed plant → 403;
  - write with a unit not in selected → 403;
  - list totals = the sum per plant;
  - Menu only shows permitted pages.
- **Feeders:** create 6 users through admin-users — TAL only, SAW only, VAR only, TAL+SAW, all three,
  and Owner.
- **Flows:**
  - (a) the TAL-only user never sees a picker and can't open SAW data;
  - (b) the Owner picks TAL+SAW → the dashboard total = TAL + SAW; then All → VAR added;
  - (c) the multi-plant buyer creates a PO for SAW while viewing both;
  - (d) Menu search "grn" → Goods Receipt opens; ⭐ adds it to Favourites; Home shows it.
- **Speed:** /home and /me/menu p95 < 150 ms.

## 11. Acceptance
- [ ] Plant checkboxes and default work.
- [ ] Picker for multi-plant users and the Owner (1/2/3 plants).
- [ ] Combined lists and totals are correct.
- [ ] Creating needs one plant.
- [ ] The server blocks unallowed plants.
- [ ] Menu page and Home per user.
- [ ] Login screen unchanged.
- [ ] Zero-error gate. Client documents updated.

## 12. Out of scope
Dashboard widgets (Phase 24); the movement/task/visitor counts (Phases 25 and 29 fill them).

## 13. Owner check
1. Admin → Users → give Ramesh TAL + SAW, default TAL. Does the summary say so?
2. Log in as Ramesh. Does the picker show only TAL and SAW?
3. Log in as Owner and tick SAW + VAR. Do lists show a Plant column with only those two?
4. Press ☰ Menu. Do you see your modules as cards, and can you ⭐ a page?

## 14. Build prompt
~~~
Read …, PHASE-23.md and the current ContextSelectors.tsx / context resolution code. Keep the login
screen exactly as it is (R-30). Build §4–§7; ScopeFilter.units used by every list, report and
dashboard query (grep proves no direct unit filter is left). Feeders/flows §10. Zero-error gate ×3.
Local commit. Report + Deploy sheet + client documents.
~~~

## 15. Client documents
**NEW:**
- Admin can give each user one plant or several plants with tick boxes, plus a default plant.
- After sign-in, people with more than one plant choose which plants to see (one, two or all); this
  can be changed any time from the top bar.
- A new Menu page with all your modules as cards, search, favourites and recent pages.
- A new Home page with your own work counts and quick-create buttons.

**Test book:**
- **Administrator:**
  1. Users → edit a user → tick Talwade + Sawardari, default Talwade → Save.
     ✔️ "Can work in Talwade and Sawardari."
- **That user:**
  2. Sign in. ✔️ The plant picker shows only those two.
  3. Tick both → Continue. ✔️ Lists show a Plant column.
  4. ＋ Add a PO. ✔️ The Plant field offers only Talwade/Sawardari.
- **Owner:**
  5. Pick Sawardari + Varale. ✔️ Dashboard totals change.
- **Anyone:**
  6. ☰ Menu → search "grn" → ⭐. ✔️ Shows under Favourites and on Home.
