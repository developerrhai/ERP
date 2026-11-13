# PHASE 31 — Report (core built and API-tested; web not browser-tested)

Built locally on 2026-11-13. Nothing committed, pushed or deployed.

## What was built
**Database** — migration `20261219000000_phase31_control` (idempotent): `custom_field_defs`, `custom_field_values` (GIN index), `form_rules`, `module_plant_controls` (off / on per page, plant and optionally role), `role_login_policies`, `view_as_sessions`, `api_keys`.

**API** (`modules/control/`)
- **Custom fields** (`/admin/custom-fields`, `PUT /custom-fields/:pageId/:recordId`, `GET /forms/:pageId/meta`): 9 types (text, number, decimal, date, yes/no, single select, multi select, lookup, file), label EN/HI, required, visible plants and roles, show in list / filter / PDF / Excel / import, at most 50 per page. Values are checked against their definition; a field of Talwade only is invisible in Sawardari. **They print**: the Word / PDF / Excel of any catalog document carries the custom fields switched on for it ("Drawing No: DRG-4412-B"); a field can be switched off for PDF only.
- **Form rules** (`/admin/form-rules`): page × role × status × plant → hidden / read-only / required. **Enforced by the shared record engine on every create and update**, so the screen cannot bypass them ("company is required.", "company is read-only here."). Fields the system needs (status, code, number, customer, supplier, item ...) cannot be hidden or made read-only: "{field} is required by the system and can't be made optional."
- **Modules per plant / role** (`/admin/module-plants`): a switched-off module answers `403 MODULE_OFF` "Canteen is turned off for Sawardari." from every page-guarded endpoint (one hook in the RBAC guard, 15 s cache), disappears from the Menu for users whose chosen plants all have it off, other plants are unaffected, and a role-specific "on" row re-enables it for that role.
- **Login policies** (`/admin/login-policies`): sign-in hours in IST (also across midnight) and an IPv4 allow-list per role, checked at sign-in after the password is right ("Sign-in is allowed 06:00–23:00 for your role." / "Sign-in from this address is not allowed for your role."); every refusal is audited (`LOGIN_BLOCKED_POLICY`).
- **Sessions** (`/admin/sessions`): all live sign-ins with IP and device; **force logout** ends a session at once (the token stops working).
- **View as** (`POST /owner/view-as`, header `X-View-As`): Owner / Administrator only, reason required, 30 minutes, the request is answered as the other person and **every write is refused** ("Viewing as {name} — read-only."), ended by DELETE, audited; the web shows a red banner.
- **API keys** (`/admin/api-keys`): `rhk_xxxxxxxx.<48 hex>` shown once, only a hash stored, revoke.
- **Numbering**: list of series with a preview; `POST /admin/numbering/preview` and the 16-character rule for GST documents.
- **Owner console cards** `GET /owner/console` (custom fields, form rules, automations on / off, modules off per plant, sessions now, failed logins today, devices offline, needs-review rows, View-as today, API keys, open exceptions) and **System health** `GET /admin/health` (database time, job queues, email queue).

**Web**: Custom Fields, Form Rules (Form Builder), Modules per Plant, Numbering (with preview), Sessions, Login Policies, View As (starts the session, reloads with the banner), API Keys, System Health (with the console cards).

## Tests (`tests/phase31.test.ts`, 9 tests, all pass)
Pure: every field type, rule resolution and violations, hours (including a night window) and IP ranges, numbering preview / 16 characters, module switches. API: a "Drawing No" end to end (definition, uniqueness, plant scope, value errors, required, form meta per plant, Word and Excel contain it, PDF-off hides it); form rules enforced through the lead record API with the UI bypassed, removed rules let the change through; module off (403 with the plant name, menu hidden, other plant fine, role re-enable); login policy refusal audited, hours with a chosen clock, sessions listed and force-logged-out; View as (reason, answers as the other person, write refused, unknown session ignored, ended, employee cannot start it); API key shown once and revoked; numbering preview; console and health.
Regression: records engine (Phase 4, 40 tests), authentication (30 tests), Phases 23-25 still pass.

## Deviations / not done (carry-over)
1. **Custom fields are not yet in the shared form, list, filter and import screens**: they print (PDF / Word / Excel) and have their own API and form-meta endpoint, but the existing generic form / register / import code does not read `GET /forms/:pageId/meta` yet; the Form Designer (drag order, live preview per role / status / plant) is a list, not a designer. The `in_filter` / `in_list` flags are stored; per-key expression indexes are not created.
2. **Not built:** the **Data Center** (import dry-run / apply in batches, export with linked data, duplicate scan and **merge with undo**, password-protected module backup) and its pages `admin-import`, `admin-duplicates`, `admin-data-center`; `admin-integrations` (SES / push / devices / webhooks / Razorpay test) and `admin-taxes` (view of tax masters) are still generic pages; `admin-workflow` Rules tab was checked as it stands (Phase 25 matrix only; the Phase 27 rule builder is a carry-over).
3. Login policy: **MFA-required per role** and **auto-disable after N inactive days** are stored but not enforced; API keys are created and revoked but **not yet accepted as authentication** on any endpoint. Numbering: editing a series from the screen is not built (preview and list only).
4. Module control is checked in the page-permission guard and the Menu only; Home tiles, global search and dashboards do not yet hide a switched-off module, and a user who chose several plants is blocked only by the plant new records belong to (the write plant).
5. Not run: the feeders (5 custom fields, 4 rules, module switches, 2 policies, an import of 200 items, a duplicate merge) and the two flows through the screens, browser test of the new pages.

## Deploy sheet (owner, by hand — not done by me)
1. Backup the production database. 2. `prisma migrate deploy` (migration `20261219000000_phase31_control`). No new dependencies or environment variables.
3. Build API and web, restart, `/health` OK.
4. Smoke: Administration ➜ Custom Fields ➜ page `sales-orders`, add "Drawing No"; set a value with `PUT /custom-fields/sales-orders/<id>`; print the order to Word and see it. Modules per Plant ➜ switch Canteen off for Varale ➜ a Varale user no longer sees Canteen. View As ➜ choose an employee ➜ red banner, read-only.
5. Rollback: all additive; remove a form rule or switch a module back on from the same screens.
