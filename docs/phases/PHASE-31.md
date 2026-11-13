# PHASE 31 — Owner & Admin Control Center (forms, custom fields, modules per plant, numbering, users & sessions, View-as, Data Center, health)

## 1. Goal
The owner and admins control the whole ERP from screens, with no developer needed:
- forms and fields;
- modules per plant and per role;
- numbering, letterheads, templates;
- users, plants, sessions and login rules;
- import/export, duplicates and backups;
- one Owner Console that shows and controls everything.

## 2. Pages
The 9 admin pages that were still generic:
| Page | What it becomes |
|---|---|
| admin-customfields | |
| admin-formbuilder | |
| admin-numbering | |
| admin-duplicates | |
| admin-import | the Data Center |
| admin-integrations | SES, push, devices, webhooks, Razorpay test |
| admin-api | API keys |
| admin-taxes | view of the Phase 6 tax masters |
| admin-workflow | Matrix + Rules tabs, done in Phases 25/27; checked here |

New: admin-module-control (upgraded), admin-sessions, admin-login-policies, admin-view-as,
admin-data-center, owner-console (the control part), admin-health.

## 3. Rules
**Custom fields:**
- types: text, number, decimal, date, yes/no, single select, multi select, lookup (customer, supplier,
  item, employee, project, plant), file;
- per page: label EN/HI, required, default, help, visible plants, visible roles, show in list/filter/
  PDF/Excel/import.
- Max 50 per page. Never used in tax or money calculations.

**Form rules:** page × role × status (× plant) → hidden / read-only / required. System-required fields
can't be relaxed (lock icon). Enforced by the API, not just the screen.

**Module control:** on/off per plant and per role. Off → gone from Menu, Home, search and dashboards
for that plant; the API returns 403 MODULE_OFF; existing data stays.

**Numbering:** series per document × plant × FY: prefix, padding, reset yearly, preview; a change can't
break the ≤ 16-character rule for GST documents.

**Users:**
- create/edit (plants R-37, departments, role, approval limit), deactivate;
- force password reset; unlock;
- sessions list and force logout;
- login hours and IP allow-list per role; MFA required per role;
- auto-disable after N days inactive.

**View as (R-34):** read-only, a red banner, 30 minutes, audited, the reason required.

**Data Center (V37):**
- Import (CSV/XLSX/JSON) into masters and drafts only; dry run → preview → apply in batches of 500 →
  result file.
- Export (XLSX/CSV/JSON with linked data).
- Duplicates (masters): find, then merge or ignore. Merge re-points references; blocked when posted
  documents sit under different GSTINs.
- Backup per module: password-protected zip; Owner/Admin only.
- Posted records are never changed or deleted.

**Owner Console control cards:** rules active/failing, automations on/off, modules off per plant,
sessions now, failed logins today, devices offline, needs_review statutory rows, last backup,
page-health errors.

## 4. Database (<ts>_phase31_control)
- custom_field_defs(page_id, key, label, label_hi, type, options, required, default, help, unit_ids[],
  role_ids[], in_list, in_filter, in_pdf, in_excel, in_import, sort, active)
- custom_field_values(page_id, record_id, key, value jsonb) PK (page_id, record_id, key) + GIN(value);
  an expression index per filterable key
- form_rules(page_id, role_id, status, unit_id, field_key, effect HIDDEN/READONLY/REQUIRED)
- module_controls: add unit_id, role_id (null = all)
- number_series (Phase 3): add preview function, admin edits audited
- role_login_policies(role_id, allowed_hours jsonb, ip_cidrs cidr[], mfa_required, inactive_days)
- view_as_sessions(owner_user, target_user, reason, started_at, ended_at)
- api_keys(name, prefix, hash, scopes[], unit_ids[], expires_at, last_used_at, created_by)
- data_jobs: add kinds DUPLICATE_SCAN, MERGE, BACKUP; duplicate_candidates(job, page_id, a, b, score,
  reasons, decision)

## 5. Logic and examples
**Custom field example:** Admin adds "Drawing No" (text, required for Engineering, visible in TAL and
SAW) to scm-po →
- the PO form shows it under Additional Details for TAL/SAW POs;
- the list has an optional column; the filter works;
- the PO PDF shows "Drawing No: DRG-4412-B";
- the Excel export includes it; the import template includes it.

**Form rule example:** scm-po × role Employee × status Approved → "Payment Terms" READONLY;
× status Draft → REQUIRED.

**Module control example:** Canteen OFF for VAR → VAR users don't see Canteen; Owner viewing VAR+TAL
sees Canteen data for TAL only, with a note "Canteen is off for Varale".

**Merge example:** customers "Shree Engg Works" and "Shree Engineering Works" — same GSTIN 27AAACS…
→ score 0.97 → merge keeps the older code; 14 invoices and 3 SOs re-pointed; an audit map is stored.
"Undo merge" is possible within 7 days if no new documents were created.

**Login policy example:** role Employee, hours 06:00–23:00 → a login at 23:30 is refused "Sign-in is
allowed 06:00–23:00 for your role."

## 6. API
- CRUD /admin/custom-fields; GET /meta/form/:pageId?status=&unit= (cached; NOTIFY invalidation)
- CRUD /admin/form-rules
- PUT /admin/module-control
- CRUD /admin/numbering (+ preview)
- GET /admin/sessions; DELETE /admin/sessions/:id
- CRUD /admin/login-policies
- POST/DELETE /owner/view-as
- CRUD /admin/api-keys
- POST /data-center/import (dry | apply); POST /data-center/export
- POST /data-center/duplicates/scan; POST /data-center/duplicates/:id/decide
- POST /data-center/backup
- GET /owner/console; GET /admin/health

## 7. Screens
- **Form designer:** field list (drag order) | properties panel | live preview per role/status/plant.
- **Module control:** a grid of modules × plants (switches) with a role filter.
- **Sessions:** table (user, plants, IP, device, started, last seen) + Force logout.
- **Data Center:** 4 tabs with a stepper; duplicates as side-by-side cards with differences highlighted.
- **Owner Console:** the Phase 24 widgets + control cards; each card links to its admin page.

## 8. Messages
| Case | Message |
|---|---|
| system field | "{field} is required by the system and can't be made optional." |
| module off | "{module} is turned off for {plant}." |
| login hours | "Sign-in is allowed {from}–{to} for your role." |
| merge blocked | "Both customers have posted invoices under different GSTINs; merge not allowed." |
| posted row in import | "Row {n}: {docNo} is posted; import can't change it." |
| view as | "Viewing as {name} — read-only." |

## 9. Audit & notifications
Every control change (before/after), view-as, force logout, import, merge and backup is audited.
Security events (IP refusals, repeated failures) → Admin.

## 10. Tests
- a custom field end to end (form, list, filter, PDF, Excel, import);
- form rules enforced by the API when the UI is bypassed;
- module off → 403 + hidden;
- numbering preview and the length rule;
- login hours/IP/MFA;
- view-as can't write;
- merge re-points and undo;
- import never touches posted rows;
- backup opens with the password.
- **Feeders:** all configuration through admin screens — 5 custom fields, 4 form rules, module
  switches per plant, 2 login policies, 1 import of 200 items, 1 duplicate merge.
- **Flows:** the configured custom field appears in a buyer's PO flow; the module switch hides a page
  for a VAR user.

## 11. Acceptance
- [ ] All 246 + new pages are real (0 generic).
- [ ] Admin can configure fields, rules, modules, numbering, users and policies without code.
- [ ] Data Center is safe.
- [ ] Owner Console controls work.
- [ ] Zero-error gate. Client documents updated.

## 12. Out of scope
Custom scripting (not allowed, for safety); SSO.

## 13. Owner check
1. Add "Drawing No" to the PO. Is it in the form, PDF and Excel?
2. Turn Canteen off for Varale. Is it gone for Varale users?
3. View as an employee. Is everything read-only, with a red banner?

## 14. Build prompt
~~~
Read …, PHASE-31.md, V40 v32*/v37* (reference). Build §4–§7; custom fields wired into the shared form,
list, filter, print and import kits (one place each). No eval, no user scripts. Feeders/flows §10.
Zero-error gate ×3. Local commit. Report + Deploy sheet + client documents.
~~~

## 15. Client documents
**NEW:** Admin control centre — add your own fields to any form, make fields required or read-only by
role and status, switch modules per plant, numbering, sign-in hours and IP rules, live sessions with
force logout, "View as" for the owner, Data Center for import, export, duplicates and backups.

**Test book:**
- **Admin:**
  1. Custom field "Drawing No" on PO. ✔️ Appears on the form, PDF and Excel.
  2. Canteen off for Varale. ✔️ A Varale user can't see it.
- **Owner:** View as an Employee. ✔️ Red banner, read-only.

---
