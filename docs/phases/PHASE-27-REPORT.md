# PHASE 27 — Report (built and API-tested; web not browser-tested)

Built locally on 2026-11-13. Nothing committed, pushed or deployed.

## What was built
**Database** — migration `20261215000000_phase27_docs_mail` (idempotent): `print_templates` (created, not used yet), `letter_templates` (OFFER and APPOINTMENT seeded, approved), `issued_letters`,
`quality_certificates` (the V40 fields), `internal_messages` + attachments + reads, `mail_automation_library` (**40 rows seeded from the spec table**), `mail_automation_plants` (per-plant off switches),
`mail_automation_runs` (run log + idempotency by a unique key), notification type `mail.internal`. New dependency: `docx` 8.5.0 (loaded with a dynamic `import()`; its typings are ESM-only).

**API** (`modules/docsmail/`, mounted at the API root)
- **Print service** `GET /print/:pageId/:id?kind=standard|letterhead|commercial|word|excel&copy=`: one view-model, three adapters (pdfkit PDF, `docx` Word, exceljs Excel with a Header sheet and a Lines sheet).
  Model comes from a typed print builder, else the generic record, else the table row of any of the **21 catalog documents** (quotation, sales order, delivery challan, GST invoice, receipt, return, enquiry, PR, RFQ, PO, GRN, purchase invoice, production order, inspection, quality certificate, stock voucher, gate pass, shipment, service ticket, project, letters).
  **Copy label:** a draft prints "DRAFT", a posted/approved document "Original" the first time and "Duplicate" afterwards; Word has "Uncontrolled copy" in the footer. Every print is audited.
- **Document Center**: `GET /doc-center/catalog` (type, group, count), `/doc-center/catalog/:pageId/records?q=`, `POST /doc-center/send` (= a Phase 25 Move Forward to a department).
- **Department Mail**: `POST /mail/internal` (default subject and message as in V28; recipients are the active people of the chosen department **who work in the plant** - a person of another plant gets nothing and cannot be picked; in-app notification), `GET /mail/inbox | sent`, `GET /mail/:id` (opening marks it read), `POST /mail/external` (Phase 21 outbox).
- **Mail Automation**: `GET /admin/mail-automation`, `PUT /:code` (on / off, subject, message, time, days), `PUT /:code/plants/:unitId`, `POST /:code/test` ("Send test to me"), `GET /:code/runs` (last 10), `POST /run`.
  Engine: every send claims a unique run key first (same record + same day never sends twice), honours the plant switch, uses the customer / supplier contact flags, goes through the Phase 21 outbox, and is logged.
  **Wired and tested (12 of 40):** #4 order acknowledgement (sales order approved → customer), #6 invoice and #29 payslip (already Phase 21), #14 delivery reminder (3 days before) and #15 delivery overdue (1 day after) to the supplier contact with the buyer in CC,
  #20 approval waiting (24 h) and #21 approval escalation (48 h), #22 approval result, #23 work sent, #24 work late, #25 work returned, #38 owner daily summary (08:00, each person gets only the plants they hold).
- **Letters**: templates with merge fields (a missing field is refused), a letter is made as Draft, **approved by a different person**, issued only after approval ("The offer letter must be approved before issue."), then emailed; printable in 5 formats.
- **Quality certificates**: numbered `QCT/<plant>/<FY>/…`, accepted + rejected cannot exceed the sample, a failed certificate needs an NCR number, release approval by a different person.
- Jobs: `mail.automation` every 5 minutes.

**Web**: Document Center (catalog left, records centre, Print ▾ and Send to Department right), Department Mail (Compose / Inbox / Sent; to a department or to outside addresses), Mail Automation (cards by module with the On switch, per-plant switches, Edit template, Send test to me, Last runs; "Planned" badge on the 28 not yet running by themselves),
Quality Certificates, Offer & Appointment Letters, and **Print ▾** (Standard / Letterhead / Commercial PDF, Word, Excel) on the record drawer of every generic page.

## Tests (`tests/phase27.test.ts`, 10 tests, all pass)
Pure: merge fields, letter text, catalog size. API: certificate rules and numbering; draft / Original / Duplicate labels; Word has the footer and the data; all PDF kinds start with `%PDF`; Excel has two sheets; unknown kind 422; every one of the 21 catalog documents lists without error; a sales order prints in PDF / Word / Excel; send to a department is a SENT movement;
mail reaches only people of the plant, unread / read / sent counts, outside mail is queued; the 40-automation library, edits, bad time refused, test mail, idempotency, no-recipient run, per-plant off, off everywhere; delivery reminder with supplier contact + buyer CC once a day, overdue, none after full receipt; owner summary only shows the person's plants; letters end to end.
Regression: approvals (Phase 5), kit print, phases 23-25 all still pass.

## Deviations / not done (carry-over)
1. **Rule engine** (admin-workflow "Rules" tab, 4-step rule builder, triggers CREATE / EDIT / FIELD_CHANGE / APPROVAL / MOVEMENT / DATE / SCHEDULE on any page, conditions, actions NOTIFY / SMS / WEBHOOK / FIELD_UPDATE / MOVE_TO_DEPARTMENT, depth guard, rate cap, test mode, `automation_rules` columns) is **not built**; the 12 automations above run from fixed code.
2. **28 automations do not run by themselves yet** (#1-3, 5, 7-13, 16-19, 26-28, 30-37, 39, 40): their source events or data are in other modules or later phases (attendance is Phase 28). They are in the library, can be edited and tested, and are marked "Planned".
3. Posted documents print **from the stored copy** (Phase 21) is not wired: print renders live from the data. DRAFT is a title mark, not a diagonal watermark. Commercial and Letterhead PDFs differ from Standard only in the header details (no separate tax-summary layout). `print_templates` table and the admin pages `admin-print-templates` / `admin-letter-templates` are not built; no `print_cache`.
4. Outside mail carries **no file attachments** (an "Open in ERP" link per attached record); internal mail attachments are references to records, not files; the Document Center has no "Email" button (use Department Mail).
5. Emails go to the Phase 21 outbox and the new run log; they are **not** also written to the `comm-logs` table, and comm-logs has no new filters.
6. Sub-tabs of `dispatch-dc` (Register / Ready to Dispatch / Transport / Customer Receipt / Pending Billing / Report), `quality-certificate` (Inspection Results / NCR Link / Customer Copy) and `hr-offer-letter` (Compensation / Joining Terms) are single register pages; `accounts-gst-invoice`, `dispatch-dc`, `hr-appointment-letter` have no pages of their own (invoices and challans print from the Document Center).
7. Approval result (#22) emails the requester for every decision (the spec says in-app plus an email digest). `report_schedules` kinds DASHBOARD / REPORT / LIST and plant mode are not built. The owner summary is an HTML text body (no PDF attachment).
8. Not run: PDF snapshot comparisons, docx validation in Word itself, the "every page × 5 formats" crawl, feeders and the flows with a mail catcher beyond what the tests above do, browser test of the new web pages.

## Deploy sheet (owner, by hand — not done by me)
1. Backup the production database. 2. `prisma migrate deploy` (migration `20261215000000_phase27_docs_mail`, forward-only). 3. **New dependency `docx` 8.5.0**: the deploy script runs `npm install --omit=dev` on the server, which installs it. No new environment variables.
4. Build API and web, restart (new cron queue `mail.automation`), `/health` OK. 5. Smoke: Administration ➜ Mail Automation ➜ Owner daily summary ➜ Send test to me (needs SMTP/SES configured, else the test waits in the outbox); a record ➜ Print ▾ ➜ Word opens in MS Word; approve a Sales Order ➜ the customer's primary contact gets "Order acknowledgement".
6. Rollback: all additive; the automations can be switched off one by one in the screen.
