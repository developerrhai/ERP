# PHASE 27 — Documents and Mail: PDF / Word / Excel everywhere, business documents, Document Center, Mail Compose, MAIL AUTOMATION (rule builder + 40 ready automations + scheduled reports)

## 1. Goal
- Every record prints and downloads in 5 formats.
- Every business document matches V40.
- Any document can be sent to a department or emailed with attachments.
- **Mail automation** sends the right email at the right time on its own: on events, on dates, and
  on schedules.
- Admin controls all of it from screens.

## 2. Pages
| Page | What it is |
|---|---|
| business-documents | PDF Document Center |
| dispatch-dc | DC Register / Ready to Dispatch / Transport Details / Customer Receipt / Pending Billing / Report |
| quality-certificate | Certificate Register / Inspection Results / NCR Link / Release Approval / Customer Copy / Report |
| accounts-gst-invoice | posted invoices with the GST PDF |
| hr-offer-letter | Offer Register / Compensation / Joining Terms / Approval / Issued Offers / Report |
| hr-appointment-letter | |
| dept-mail | Department Mail: Compose / Inbox / Sent |
| admin-workflow | Rules tab: the rule builder |
| admin-mail-automation | the ready-made automation library |
| admin-print-templates | |
| admin-letter-templates | |
| comm-logs | email log (exists; gets new filters) |

## 3. Rules
- **Posted documents print from the stored copy** (Phase 21); drafts get a "DRAFT" watermark.
- **Standard PDF (V21 layout):** title; number; date; revision; status; department; plant; copy label;
  field groups; lines table; totals; amount in words (lakh/crore); authorization block (Prepared /
  Checked / Approved with names and dates from the approval trail); footer (company, plant address,
  GSTIN, page x/y).
- **Letterhead PDF:** the plant letterhead (Phase 3/6B). **Commercial PDF:** quotation/PO/invoice/DC
  layout with tax summary.
- **Word:** the same sections, editable, with "Uncontrolled copy" in the footer.
- **Excel:** header sheet + lines sheet.
- **Delivery challan:** Rule 55, triplicate, ≤ 16 characters (Phase 18 numbering).
- **Letters:** templates with merge fields; issued only after approval.
- **Mail automation:**
  - uses the Phase 21 pipeline (SES, suppression, attachment ≤ 7 MB or a link, log, bounces);
  - honours the customer/supplier contact flags (receives_invoices, receives_po, receives_reminders,
    receives_statements);
  - internal emails respect R-37: a recipient gets only data of plants they hold;
  - every automation can be switched on/off per plant;
  - every email is in comm-logs.
- **Rule engine** (extends Phase 19 automation_rules):
  - triggers: CREATE, EDIT, STATUS (from → to), FIELD_CHANGE, APPROVAL (submitted/approved/rejected),
    MOVEMENT (sent/late/returned), DATE (N days before/after a date field, checked daily at a set
    time), SCHEDULE (cron);
  - conditions: the Phase 19 AST (dropdowns only);
  - actions: SEND_EMAIL, NOTIFY (in-app/push), SMS (DLT only, urgent), CREATE_TASK (Phase 29),
    MOVE_TO_DEPARTMENT (creates SENT, R-31), WEBHOOK, FIELD_UPDATE (needs approval to activate).
  - Guards: depth ≤ 3; rate cap per rule; idempotency per (rule, record, trigger date); test mode.

## 4. Database (<ts>_phase27_docs_mail)
- print_templates(doc_type, kind STANDARD/LETTERHEAD/COMMERCIAL/WORD, version, layout_json, active,
  approved_by)
- letter_templates(code, body_html, merge_fields[], version, approved); issued_letters(template, person,
  data_json, pdf_document_id, approval_id, issued_at, emailed_at)
- quality_certificates — the V40 fields (Certificate No, Job Card No, Part Code, Part Name, Inspection
  Date, Sample Qty, Accepted Qty, Rejected Qty, Drawing Revision, Inspector, Result, NCR No,
  Quality Approval, Remarks) + unit_id, so_id, dc_id
- internal_messages(from_user, from_department, unit_id, to_department, to_user_ids[], subject, body,
  movement_id, created_at) + internal_message_attachments(message, document_id | record_ref)
  + internal_message_reads
- automation_rules: add trigger kinds above, date_field, offset_days, run_time, cron, unit_ids[],
  library_code (null for custom)
- mail_automation_library(code PK, name, module, trigger, default_on, template_code, recipients_spec,
  attachment_spec, description)
- report_schedules (Phase 19): add kind DASHBOARD/REPORT/LIST, plant mode
- print_cache(doc_type, doc_id, doc_version, kind, template_version, document_id) — unique

## 5. Logic and examples
**A. Print service:**
- `render(docType, id, kind)` builds one view-model; adapters produce pdfkit (PDF), `docx` (Word) or
  exceljs (Excel).
- Fonts: Noto Sans + Devanagari.
- Cached by version; reprint of a posted document = the stored copy + copy label "Duplicate".

**B. Document Center (V27):**
- a catalog of ~25 document types with counts; choose type → record → preview;
- buttons Send to Department (= Phase 25 movement with attachments), Email, Download, Print.

**C. Mail Compose (V28):**
- **From:** department (elevated users choose).
- **To:** departments/users (internal) or email addresses (external; contacts suggested).
- **Subject** default "Department Document • Review / Action"; **Message** default "Please review the
  attached ERP document(s) and complete the required action."
- **Attach:** this record (PDF/Excel/Word), linked documents, uploads.
- **Send:** internal → internal_messages + a notification; external → Phase 21.

**D. Ready-made mail automations** (seeded in mail_automation_library; Admin switches each on or off,
edits the template, timing and recipients):
| # | Automation | Trigger | To | Attachment | Default |
|---|---|---|---|---|---|
| 1 | Enquiry acknowledgement | enquiry created with an email | customer | — | on |
| 2 | Quotation sent | quotation status → Sent | customer contact | quotation PDF | on |
| 3 | Quotation follow-up reminder | DATE: 7 days after sent, no reply | salesperson | — | on |
| 4 | Order acknowledgement | SO approved | customer | SO PDF | on |
| 5 | Dispatch intimation | DC posted / gate-out | customer | DC + e-way bill no. + LR | on |
| 6 | Invoice email | invoice posted | customer accounts | invoice PDF | on (P21) |
| 7 | Payment receipt | receipt posted | customer | receipt PDF | on (P21) |
| 8 | Payment reminders | DATE: due +3/+15/+30 | customer, CC salesperson | statement | on (P21) |
| 9 | Monthly statement | SCHEDULE: 1st 09:00 | customer | statement | on (P21) |
| 10 | Quality certificate with dispatch | DC posted with certificate | customer | certificate PDF | on |
| 11 | RFQ to suppliers | RFQ issued | invited suppliers | RFQ PDF | on |
| 12 | Purchase order | PO approved | supplier | PO PDF | on (P21) |
| 13 | PO amendment | PO amended | supplier | revised PO | on |
| 14 | Delivery reminder | DATE: 3 days before line due date | supplier, CC buyer | — | on |
| 15 | Delivery overdue | DATE: 1 day after due date | supplier + buyer | — | on |
| 16 | GRN / short supply note | GRN posted with short or rejected qty | supplier | GRN summary | on |
| 17 | Debit note | debit note posted | supplier | DN PDF | on |
| 18 | Payment advice | supplier payment posted | supplier | advice (TDS shown) | on |
| 19 | SCAR to supplier | SCAR raised | supplier | 8D form | on |
| 20 | Approval waiting | approval pending 24 h | approver | — | on |
| 21 | Approval escalation | pending 48 h | next level | — | on |
| 22 | Approval result | approved / rejected | requester | — | on (in-app + email digest) |
| 23 | Work sent to department | movement SENT | target department managers | — | on |
| 24 | Work late | movement late | target manager → head | — | on |
| 25 | Work returned | movement RETURNED | sender | — | on |
| 26 | Welcome / set password | user created | user | — | on |
| 27 | Offer letter | offer issued | candidate | offer PDF | on |
| 28 | Appointment letter | letter issued | employee | PDF | on |
| 29 | Payslip | payslip released | employee | encrypted PDF | on (P21) |
| 30 | Leave decision | leave approved/rejected | employee | — | on |
| 31 | Missed punch | Phase 28 | employee + manager | — | on |
| 32 | Daily attendance report | Phase 28, 10:30 | department managers | Excel | on |
| 33 | Monthly attendance summary | Phase 28, 1st | employee | — | on |
| 34 | Birthday / work anniversary | DATE | employee (opt-in) | — | off |
| 35 | Document expiry (vehicle/licence/contractor) | DATE: 30/15/7 days | owner + vendor/contractor | — | on |
| 36 | PM due list | SCHEDULE: Monday 08:00 | maintenance | Excel | on |
| 37 | Calibration due | DATE: 15 days before | quality | — | on |
| 38 | Owner daily summary | SCHEDULE: 08:00 | Owner, Directors | Owner console PDF | on |
| 39 | Weekly MIS | SCHEDULE: Monday 09:00 | Directors, CFO | MIS PDF | on |
| 40 | Monthly P&L snapshot | SCHEDULE: 5th 10:00 | Owner, CFO | P&L PDF | on |

**E. Example (delivery reminder):** PO/TAL/2627/0145 line due 15-12-2026; rule 14 runs daily at 09:00 →
on 12-12-2026 at 09:00 it emails the supplier's purchase contact, CC the buyer:
"Reminder: PO/TAL/2627/0145 — 200 nos BRK-14 due on 15-12-2026."
Idempotency key (rule 14, line id, 2026-12-12) → never twice that day.

**F. Owner daily summary (08:00):** per selected plant + total:
- yesterday's sales, collections and dispatches;
- production good/reject;
- attendance %;
- new orders; approvals pending (count, oldest);
- late movements;
- critical exceptions;
- cash & bank; AR overdue.

A PDF + a short HTML body; each recipient gets only their plants (R-37).

## 6. API
- GET /print/:docType/:id?kind=standard|letterhead|commercial|word|excel&copy=
- CRUD /admin/print-templates (+ preview) and /admin/letter-templates
- CRUD /hr/letters (+ submit | issue | email); CRUD /qms/certificates
- GET /documents/catalog; POST /documents/send
- POST /mail/internal; GET /mail/inbox|sent?dept=; POST /mail/external
- GET /admin/mail-automation; PUT /admin/mail-automation/:code {on, template, timing, recipients, unitIds}
- CRUD /admin/rules (+ test | activate | pause; GET runs)
- CRUD /report-schedules

## 7. Screens
- **Print ▾** in the ActionBar: Standard PDF · Letterhead PDF · Commercial PDF · Word · Excel ·
  Print preview.
- **Document Center:** catalog on the left (icons, counts), picker in the centre, preview on the right
  with actions.
- **Mail Compose:** V28 layout, attachment chips with size, send bar at the bottom.
- **Mail Automation page:**
  - cards grouped by module; each with a switch, "Edit template", "Timing" and "Recipients";
  - a "Send test to me" button;
  - last 10 runs with status;
  - plant toggles.
- **Rule builder:** 4 steps — When → If → Then → Test & Activate.

## 8. Messages
| Case | Message |
|---|---|
| contact missing | "{party} has no email for {purpose}. Add it in Contacts." |
| rule needs approval | "This rule changes data; it needs approval before it can run." |
| letter not approved | "The offer letter must be approved before issue." |
| automation off for plant | info "Automation is off for {plant}." |

## 9. Audit & notifications
Every print of a posted document (copy label), email, internal send, rule change, rule run and
template change is audited. Failing rules → Admin.

## 10. Tests
- every printable page × 5 formats renders (crawler-like);
- PDF snapshots (invoice, DC, PO, quality certificate, offer letter);
- Word opens (docx validation);
- each of the 40 automations fires once in a fake clock with the right recipients and attachment
  (mail catcher);
- idempotency; plant filter of internal recipients;
- rule depth guard; test mode has no side effects.
- **Feeders:** switch automations through the admin screen; compose 3 internal mails with attachments;
  issue 2 offer letters after approval.
- **Flows:** an SO approved → the customer gets the acknowledgement; a PO approaching due → reminder;
  a DC → dispatch intimation + certificate; the 08:00 owner summary arrives.

## 11. Acceptance
- [ ] 5 formats on every record.
- [ ] V40 business documents.
- [ ] Document Center + Compose.
- [ ] 40 automations configurable and verified.
- [ ] Rule builder.
- [ ] Zero-error gate. Client documents updated.

## 12. Out of scope
E-signature, inbound email parsing, WhatsApp automations (Phase 19 adapter; can be added as an action later).

## 13. Owner check
1. PO → Print ▾ → Word. Does it open in Word?
2. Admin → Mail Automation → "Delivery reminder" → Send test to me. Does it arrive?
3. Approve an SO. Does the customer email appear in the email log?

## 14. Build prompt
~~~
Read …, PHASE-27.md, V40 v12*/v14*/v15*/v21*/v27*/v28* (reference), Phase 19/21 code. Add `docx`.
Build §4–§7; seed the 40 automations; all email via Phase 21. Feeders/flows §10 with a mail catcher.
Zero-error gate ×3. Local commit. Report + Deploy sheet + client documents.
~~~

## 15. Client documents
**NEW:** Word download for every record; Delivery Challan, Quality Certificate, GST Invoice, Offer and
Appointment letters; Document Center; Mail Compose with attachments; **40 ready email automations**
(quotation, order acknowledgement, dispatch, reminders to suppliers, approval reminders, owner's
morning summary…) that Admin can switch on or off.

**Test book:**
- **Admin:** Mail Automation → Owner daily summary → Send test to me. ✔️ Email with PDF.
- **Sales:** approve an SO. ✔️ The email log shows "Order acknowledgement — Delivered".
- **Purchase:** a PO line due in 3 days. ✔️ The supplier reminder in the log at 09:00.
- **Anyone:** a record → Print ▾ → Word. ✔️ Opens in MS Word.

---
