# PHASE 04

# PHASE 04 — Generic engine v2 + documents + print/Excel
(Read ERRATA.md first: E-01 timestamps, E-07 stored_files already exists from Phase 3, E-11, E-12.)

## 1. Goal & why
Every generic page and the 7 typed Inventory pages should behave like the module page in index.html:
honest tabs, a register with full bulk actions, real per-record documents, a server-side letterhead
PDF that renders ₹ and Hindi correctly, safe Excel/CSV, and an import wizard. This phase also leaves
the hooks that Phase 5 approvals plug into.

Existing code: modules/records/*, engine/*, kit/{commands,print}.ts, web pages/generic/*, and
migration phase4_generic_records (generic_records, number_series, idempotency_keys).

**Defects fixed here:**
- **C6 — delete and restore:**
  - remove() ignores status, so Cancelled, Approved and Posted rows can be deleted. This breaks R-09.
  - restore() works without the undo token; the token never expires and is not tied to a user.
  - Bulk delete returns no undo token.
- **C7 — kit commands (kit/commands.ts):**
  - COMMAND_RESULT_CACHE is an in-memory Map that is never cleared.
  - After a restart, a replay returns {} with status 200 — a silent wrong answer.
  - The idempotency row is saved outside the transaction, inside an empty catch {}.
  - Commands are not run in a transaction, so a half-finished command leaves partial writes.
  - The response normaliser is copy-pasted, with 8 "as any" casts.
  - Commands are not audited, and the response is {result} instead of {data}.
- **Excel:** the cell escaping misses TAB and CR, and header labels are not escaped.
- **Print:**
  - Web print checks "view" instead of "print".
  - Non-typed pages never check that the record is visible to the user.
  - pdfkit is not installed.
- **Tab notices** use the old phase numbers.
- **Dashboard and Data Quality** are counted in the browser from at most 100 rows.
- **Missing pieces:** no Submit, no documents service, no import, no job runner.

## 2. The 16-tab anatomy (applies to all generic + typed pages)
| Tab | State after Phase 4 |
|---|---|
| Module Dashboard | **Real.** Computed on the server: total, count per status, created this month, documents expiring in ≤30 days, Pending Approval count, 20 most recent. |
| 6 profile tabs | **Real.** The register tab shows the table. Other profile tabs show kit panels if they exist, otherwise a notice naming the phase that builds them. |
| Analytics & Graphs, AI Decision Center, Automation Studio | Notice: "Coming in Phase 19." |
| Data Quality | **Real, server-side, every visible row:** field completeness, invalid values, duplicate names, expired documents. |
| Activity Timeline, Audit Trail | **Real.** Also shows document, print, export and import events. |
| Documents | **Real.** Module-level and per-record. |
| Approvals | Notice "Approval workflow arrives in Phase 5", plus the **real** count of Pending Approval records, linking to the filtered register. |
| Reports | **Real.** Excel, CSV, letterhead PDF of the list, print current view. |

**Phase map for the notices:**
| Area | Phase |
|---|---|
| Approvals | 5 |
| Finance | 7 |
| Inventory / WMS | 8 |
| Procurement | 9 |
| CRM / Sales | 10 |
| Taxation | 11 |
| QMS | 12 |
| Manufacturing | 13 |
| Maintenance / Assets | 14 |
| HRMS | 15 |
| Payroll | 16 |
| Projects / Service | 17 |
| Logistics / DMS | 18 |
| Executive / BI / AI / Communication | 19 |
| Administration | 3 |

No tab ever shows a number that is not computed from the database.

## 3. Business logic & research (rules adopted)
**OWASP File Upload Cheat Sheet:**
- extension allow-list (checked after decoding the name);
- the file type is checked from its content (magic bytes), never from Content-Type;
- size limit enforced while streaming;
- random storage names outside any web root;
- antivirus hook;
- downloads served as attachment + nosniff;
- only authorised users may upload.

**OWASP CSV/formula injection:**
- Prefix ' to any cell starting with = + - @ TAB or CR, also after leading spaces.
- CSV fields are always quoted.
- Numbers stay typed numbers, so −500 is not mangled.

**PDF engine: pdfkit + fontkit + Noto Sans / Noto Sans Devanagari** (per R-10):
- Text is split into script runs: Devanagari (U+0900–097F, U+A8E0–A8FF) uses the Devanagari font;
  everything else, including ₹ U+20B9, uses Noto Sans.
- **Gate test:** 12 hard Hindi strings (कि, र्क, क्ष, त्र, श्र, प्र, द्ध, हृ, ज्ञ, कीर्ति, स्त्री, ₹ १,२३,४५६.७८)
  must produce the same glyph IDs as HarfBuzz (harfbuzzjs as a dev dependency).
- If the gate fails: keep pdfkit for drawing, but use harfbuzzjs (WASM) for shaping.
- Playwright/Chromium is rejected: about 300 MB, too much RAM, and unreliable inside the single process.

**Attachments and import (ERPNext/Frappe and Odoo patterns):**
- One file can link to many records.
- Content-addressed store (sha256, dedupe), with metadata kept in the database.
- Import wizard: Template → Upload → Map → Validate → Import, with an error report; "import only
  valid rows" is an option.

**pg-boss:** a Postgres queue running inside the API process, in its own schema "pgboss".

## 4. Database design
**`<ts>_phase04_files_documents`:**
- **stored_files** — extend the Phase 3 table:
  - sha256 UNIQUE, size_bytes, mime, ext, storage_key
  - scan_status: pending / clean / infected / skipped / error
  - scanned_at, scan_detail
  - Files are immutable.
- **documents:**
  - unit_id
  - category: General / Agreement / Compliance / Certificate / Identity / Invoice / Tax / HR (the prototype's list)
  - doc_number, title, issue_date, expiry_date (CHECK expiry ≥ issue)
  - current_version_no, deleted_at, deleted_by_id, plus the standard audit columns and version
- **document_versions:** document_id, version_no, file_id, original_name, note, created_at, created_by_id.
  UNIQUE(document_id, version_no).
- **document_links:**
  - document_id, page_id, record_id (NULL = module-level), linked_at, linked_by_id
  - UNIQUE(document_id, page_id, COALESCE(record_id, zero-uuid))
  - INDEX(page_id, record_id)
  - No FK to the record; the service checks the record exists.
- Indexes: documents(expiry_date) where not deleted; stored_files(scan_status).

**`<ts>_phase04_idempotency_v2`** (alters the existing table; this fixes C7):
- Add scope (e.g. "records.create", "cmd:inv-transfer:post").
- Add state (in_progress / done), response_status, response_body jsonb.
- Add expires_at = now + 24 h.
- Make record_id nullable; PK becomes (user_id, scope, key).
- Backfill scope 'records.create'. Fake zero record ids become NULL.

**`<ts>_phase04_import_export_jobs`:**
- **import_jobs:**
  - page_id, unit_id, fy_id, file_id, file_sha256
  - status: uploaded / mapped / validating / validated / committing / done / failed / cancelled
  - mode: all / valid_only
  - mapping jsonb
  - row counts: total, valid, error, created
  - report_file_id, started_at, finished_at, error
- **import_job_rows:** job_id, row_no, raw jsonb, status (valid / error / created / skipped), errors jsonb,
  record_id. PK(job_id, row_no).
- **export_jobs:** page_id, unit_id, fy_id, kind (xlsx / csv / pdf), query jsonb, status, row_count,
  file_id, expires_at (+24 h).

**pg-boss** creates its own schema when it starts. This is a deliberate, documented exception to
hand-written SQL.

**File layout:**
- STORAGE_ROOT (env, default /var/lib/sawant-erp/files; never inside the repo).
- quarantine/<uuid>.part → objects/ab/cd/<sha256> once clean; exports/<jobId>.<ext>.
- Directories 0700, files 0600.

## 5. Services, rules & algorithms
**StorageService:**
- put, get, move, delete, exists.
- LocalDiskStorage only (S3 later).
- Keys must match `^[a-z0-9/._-]+$` and must not contain "..".

**Upload pipeline** (busboy streaming, no multer):
1. Check auth and permission; exactly one file part.
2. Clean the name: NFC, basename only, strip control characters and <>:"/\|?*, at most 150 characters.
3. Extension allow-list: pdf png jpg jpeg doc docx xls xlsx csv. The last extension decides.
4. Stream to quarantine while computing sha256.
   - Abort above upload.maxBytes (setting, default 25 MB) → 413.
   - An empty file → 422.
5. Check the magic bytes:
   | Type | Must start with / contain |
   |---|---|
   | pdf | %PDF- |
   | png | 89504E47 |
   | jpg | FFD8FF |
   | doc / xls | D0CF11E0A1B11AE1 |
   | docx / xlsx | PK + word/ or xl/ in the archive; refuse if vbaProject.bin (macros) is present |
   | csv | valid UTF-8, no NUL byte |

   A mismatch with the extension → 415.
6. **Dedupe:** if the sha256 already exists, reuse that file. A file previously found infected is blocked.
7. **Virus scan:**
   - ClamdScanner (CLAMAV_HOST) when configured.
   - Otherwise NoopScanner → "skipped". This is allowed only while upload.allowUnscanned=true
     (dev default true, **production default false**).
   - Files ≤ 5 MB are scanned inline; larger files go to the pg-boss job file.scan.
   - Clean or skipped → move to objects/. Infected → delete the file, keep the row, audit FILE_INFECTED.
8. In one transaction: documents + document_versions + document_links + audit.

**Download:**
- Requires permission, and the scan status must be clean or skipped (otherwise 409 FILE_NOT_READY).
- Headers: attachment with a UTF-8 filename, nosniff, CSP sandbox, no-store.
- Every download is audited.

**Versions and delete:**
- A new upload onto a document creates version_no + 1; old versions stay downloadable.
- Deleting a document is a soft delete with Undo.

**Record lock matrix** — `engine/lock-matrix.ts`, one function used by the service and the UI:
| Status | edit | delete | submit | cancel | add doc | remove doc | print/export |
|---|---|---|---|---|---|---|---|
| Draft | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ |
| Rejected | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ |
| Pending Approval | ✘ | ✘ | – | ✘ (Phase 5 withdraw) | ✔ | ✘ | ✔ |
| Approved | ✘ | ✘ | – | ✔ | ✔ | ✘ | ✔ |
| Posted | never | never | – | only by the module's reversal (Phase 7+); generic → 409 | ✔ | ✘ | ✔ |
| Cancelled | ✘ | ✘ | – | – | ✘ | ✘ | ✔ |
| Active / Inactive (masters) | ✔ | ✔ | – | – | ✔ | ✔ | ✔ |

Legacy statuses map as follows: Open → Draft, In Progress → Draft, Pending → Pending Approval,
Completed → Approved.

**C6 fix:**
- remove() checks the lock matrix → 409 RECORD_LOCKED.
- restore() requires the token. Token = HMAC("undo:id:deletedAt:userId"); valid for 15 s (10 s UI +
  5 s grace) and only for the same user, otherwise 410 UNDO_EXPIRED.
- An admin can restore within 30 days through POST …/restore-admin (audited with admin:true).
- Bulk delete returns one batchUndoToken.

**Submit hook (R-06):**
- POST …/:id/submit needs permission "submit" and status Draft or Rejected → Pending Approval, then
  calls approvalHooks.onSubmitted.
- Phase 4 default: if approval_required=false, set Approved in the same transaction and audit
  RECORD_AUTO_APPROVED; otherwise stay Pending Approval.
- Phase 5 replaces this hook. changeStatus keeps refusing Approved/Rejected.

**C7 fix — rewrite of kit/commands.ts:**
1. Delete COMMAND_RESULT_CACHE and IN_FLIGHT_COMMANDS.
2. runCommand() works inside one transaction:
   - take pg_advisory_xact_lock(hash(user|scope|key));
   - if a done row with the same hash exists → return the stored response with Idempotent-Replay: true;
   - if the hash differs → 409;
   - otherwise run(db: tx), audit KIT_COMMAND_RUN, and insert the idempotency row.
   - Default timeout 15 s, up to 60 s per command.
   - A duplicate request waits on the lock, then replays.
3. One typed normaliseOutcome(); no "any" anywhere in kit/ (ESLint rule set to error).
4. The response becomes {data, meta:{replay}}; kitApi.ts is updated to match.
5. pg-boss job idempotency.purge runs hourly.

**PdfService (core/pdf):**
- render(template, dto) → Buffer. A4, 36 pt margins, bufferPages.
- Fonts live in apps/api/assets/fonts (with OFL.txt).
- Letterhead from Phase 3 company and unit data.
- Footer: "Prepared by <user> on <dd-MMM-yyyy HH:mm IST>" and "Page x of y".
- Templates:
  - record: two-column fields, ₹ amounts, documents list, signature boxes;
  - list: landscape, repeating header, up to 2,000 rows synchronously, more via the export.build job;
  - documents-index.
- Kit print renderers receive PdfService. PDFs over 20 MB are refused.

**Excel/CSV:**
- Fixed escaping applies to headers, the sheet name and every string.
- Up to 5,000 rows synchronously; up to 100,000 as a job; the download link lasts 24 h.
- CSV: UTF-8 BOM, CRLF line endings, every field quoted.

**Import wizard** (permission "import"):
1. **Template:** xlsx with sheet "Data" (row 1 = labels with * for required, row 2 hidden = keys),
   dropdown lists for enums, ₹ and date formats, and a "Help" sheet.
2. **Upload:** xlsx or csv, ≤ 10 MB, ≤ 5,000 rows, through the same upload pipeline. If the same file
   was already imported for this page and unit, confirmReimport:true is required.
3. **Map:** auto-map by exact label, then key, then case-insensitive label.
   - All required fields must be mapped, one column per field.
   - code and status cannot be imported.
4. **Dry run** (job import.validate):
   - every row goes through validateRecordInput + assertDateOrder;
   - duplicate rows are flagged;
   - an error report xlsx is produced (original columns + an "Errors" column).
5. **Commit** (job import.commit):
   - "all" = one transaction that aborts on any error;
   - "valid_only" = batches of 100;
   - records are created through the normal create path (numbering, audit with importJobId);
   - progress is polled; cancel is allowed before commit starts.

**pg-boss** starts in server.ts after Prisma. Queues:
| Queue | When |
|---|---|
| file.scan | on upload |
| import.validate, import.commit | on request |
| export.build | on request |
| docs.expiry-scan | daily 06:00 IST; calls notificationHooks.documentExpiring at 30/15/7 days (a no-op until Phase 5) |
| idempotency.purge | hourly |
| files.gc | quarantine files older than 24 h; orphan files older than 7 days |
| auth.cleanup | moved here from Phase 1 |

## 6. API (/api/v1; chain authenticate → requirePasswordChanged → resolveContext → requirePermission → validate)
**Summary and quality:**
- GET /pages/:p/summary (view) → {total, byStatus, createdThisMonth, docsExpiring30, pendingApproval, recent[20]}
- GET /pages/:p/quality (view) → {rows, fields[{key, filled, pct, invalid}], duplicates[], expiredDocs}

**Records — changes only:**
- DELETE …/records/:id (If-Match) → 409 when the record is locked
- POST …/:id/restore (undoToken required)
- POST …/:id/restore-admin (Admin)
- POST …/:id/submit (submit, If-Match)
- POST …/bulk {action: 'delete' | 'submit', ids ≤ 500, confirm?} — confirm must equal "DELETE" / "SUBMIT"
  when more than 10 ids
- GET …/export.xlsx and …/export.csv (export) → the file, or 202 {jobId}
- GET /pages/:p/records/:id/pdf (print)
- GET /pages/:p/pdf?filters (print)

**Documents:**
- GET /pages/:p/documents?recordId=
- POST /pages/:p/documents (multipart: file, category, docNumber, title, issueDate, expiryDate, recordId?)
- POST /documents/:id/versions
- PATCH /documents/:id
- DELETE /documents/:id → {undoToken}
- POST /documents/:id/restore
- GET /documents/:id/versions/:n/download (audited)

**Import:**
- GET /pages/:p/import/template.xlsx
- POST /pages/:p/imports
- PUT /imports/:id/mapping
- POST /imports/:id/validate
- GET /imports/:id and GET /imports/:id/rows?status=error
- GET /imports/:id/report.xlsx
- POST /imports/:id/commit {mode}
- POST /imports/:id/cancel
- GET /pages/:p/imports

**Jobs:** GET /export-jobs/:id and GET /export-jobs/:id/download.

**Kit:** POST /pages/:p/commands/:cmd → {data, meta}.

## 7. UI & user flow (index.html classes)
- **Register:**
  - New buttons: Submit Selected and Import (next to Excel).
  - Row buttons follow the lock matrix; locked rows show 🔒 with "Approved records cannot be edited".
  - Delete shows a 10-second Undo toast; bulk delete has one Undo.
- **Drawer:** 📎 count, a Documents section, and a Print ▾ menu (Print view / Letterhead PDF).
- **Documents tab:**
  - The prototype form: File, Category, Document No., Issue Date, Expiry Date, ＋ Add Document.
  - Cards show name, category, size, number and an expiry badge (red when expired, amber when ≤ 30 days).
  - Unscanned files are tagged "Not virus-scanned".
  - Buttons: Download / New version / Delete.
- **Import wizard:** a 4-step modal.
  - The check step says "120 rows: 117 ready, 3 with errors" with a "Download error report" button.
  - The user chooses "Import only ready rows" or "Import all (stops on any error)", then sees a
    progress bar and "117 records created".
- **Reports tab:** real KPI cards plus Excel / CSV / Letterhead PDF / Print. Big exports show
  "Preparing file…" and then a link.
- **Print stylesheet** hides the sidebar and toolbars.

## 8. Exact messages
| Case | Code | Message |
|---|---|---|
| Bad extension | 415 UNSUPPORTED_FILE | "Only PDF, PNG, JPG, DOC, DOCX, XLS, XLSX or CSV files can be added." |
| Content mismatch | 415 | "This file's content does not match its .{ext} extension." |
| Macros | 415 | "Files with macros cannot be uploaded." |
| Too big | 413 | "The file is larger than 25 MB." |
| Empty | 422 | "The file is empty." |
| Infected | 422 FILE_INFECTED | "This file failed the virus check and was not saved." |
| Not scanned yet | 409 FILE_NOT_READY | "The file is still being checked. Try again in a minute." |
| Expiry before issue | 422 | "Must not be before Issue Date." |
| Category | 422 | "Choose a category from the list." |
| Delete locked | 409 RECORD_LOCKED | "A {status} record cannot be deleted. Cancel it instead." |
| Edit locked | 409 RECORD_LOCKED | "A {status} record cannot be edited." |
| Undo late | 410 UNDO_EXPIRED | "Undo time is over. An administrator can restore it from Recently deleted." |
| Undo token missing | 422 | "Undo token is required." |
| Submit in wrong state | 409 | "Only Draft or Rejected records can be submitted." |
| Cancel a posted generic record | 409 | "Posted records are reversed by their own module, not cancelled here." |
| Bulk > 10 without confirm | 422 | "Type DELETE to confirm deleting {n} records." (same for SUBMIT) |
| Import too many rows | 422 | "The file has {n} rows; the limit is 5,000. Split it and import in parts." |
| Required field not mapped | 422 | "Map a column to {label} — it is required." |
| Re-import | 409 DUPLICATE_IMPORT | "This file was already imported on {date} ({created} records). Import it again?" |
| Export too large | 422 | "More than 100,000 rows match. Narrow the filters and try again." |
| Idempotency key reused | 409 | "This Idempotency-Key was already used for a different request." |

## 9. Audit
- New actions:
  - DOCUMENT_ADDED, DOCUMENT_VERSION_ADDED, DOCUMENT_UPDATED, DOCUMENT_DELETED, DOCUMENT_RESTORED,
    DOCUMENT_DOWNLOADED, FILE_INFECTED
  - RECORD_SUBMITTED, RECORD_AUTO_APPROVED, RECORD_RESTORED (admin flag)
  - RECORDS_EXPORTED (with format), PRINT_RENDERED
  - IMPORT_STARTED, IMPORT_VALIDATED, IMPORT_COMMITTED, IMPORT_FAILED, IMPORT_CANCELLED
  - KIT_COMMAND_RUN
- All of them appear in the Activity Timeline and the Audit Trail.
- Notifications are delivered from Phase 5. This phase only adds no-op hooks.

## 10. Tests
- **Every endpoint:**
  - 401, 403 (missing action, wrong unit, OWN scope on another user's record → 404), 404, 422;
  - the happy path, with an audit row.
- **C6:**
  - deleting Approved, Posted or Cancelled → 409;
  - restore without a token → 422;
  - restore after 15 s → 410;
  - another user's token → 410;
  - admin restore at 29 days works, at 31 days → 410.
- **C7:**
  - the same key twice → one execution and an identical replay;
  - a restart between the two calls → still identical, not {};
  - a mid-way failure → no partial rows and no idempotency row;
  - 10 parallel requests with the same key → one run;
  - a grep check: no COMMAND_RESULT_CACHE and no "any" left.
- **Upload:**
  - every allowed type passes;
  - .exe renamed .pdf → 415;
  - .docm renamed .docx → 415;
  - 25 MB + 1 byte → 413;
  - the same file twice → one stored_files row;
  - EICAR test file through a stub clamd → infected;
  - production mode without clamd → refused;
  - "../../a.pdf" is stored as "a.pdf".
- **Lock matrix:** a table-driven test over every status × action.
- **Excel/CSV:**
  - "=1+1", "\t=x", "  @SUM" and "-2+3" are escaped;
  - the number −500 stays a number;
  - a header "=x" is escaped.
- **PDF:**
  - the Devanagari gate passes;
  - the ₹ glyph is present;
  - "Page 2 of 3" can be extracted;
  - the letterhead fields come from settings.
- **Import:**
  - template round-trip;
  - a file with 3 errors gives exact row numbers;
  - "all" mode creates 0 records on error; "valid_only" creates exactly the valid rows;
  - re-import needs confirm;
  - two commits of the same job → one runs (409 IMPORT_ALREADY_RUNNING).
- **Concurrency:** two submits with the same If-Match → one succeeds.
- **Playwright:**
  - add a vendor agreement with an expiry date, download it, and see it in the Audit Trail;
  - delete then Undo;
  - import 50 items with 2 bad rows;
  - Letterhead PDF of an Approved record with a Hindi name;
  - the Approvals tab shows the Phase 5 notice and the real pending count.
- 3 clean runs.

## 11. Acceptance checks
- [ ] No tab shows a number that is not from the database; notices name the right phase.
- [ ] C6 and C7 tests pass; COMMAND_RESULT_CACHE is gone; there is no "any" in kit/.
- [ ] Documents work on every generic page and in the drawer. Files are only under STORAGE_ROOT and
      can only be reached through the API.
- [ ] A PDF with "₹ 1,23,456.00" and "श्री कृष्ण ट्रेडर्स, प्रा. लि." renders correctly.
- [ ] An exported Excel file runs no formulas when opened.
- [ ] A 5,000-row import validates in under 60 s and commits in under 120 s.
- [ ] 3 clean runs. The migration was tested on a copy of production.

## 12. Out of scope
| Item | Owner |
|---|---|
| Approval workflow and notification delivery | Phase 5 |
| Posting and reversal handlers | Phase 7 onwards |
| S3 storage | Phase 20 |
| Photo EXIF strip | Phase 15 |
| Bulk Edit | Later |
| DMS pages | Phase 18 |
| OCR, e-signature | Not planned |
| Hard purge of deleted rows | Phase 20 |
| Print designer | Not planned (templates are code) |

## 13. Owner manual check
1. Open any page. Does the Module Dashboard total match the register? Do the Approvals, Analytics, AI
   and Automation tabs say "coming in Phase 5/19" with no invented numbers?
2. Add a record, delete it, and click Undo within 10 s. Is it back? Delete it again, wait 20 s and
   click Undo. Do you see "Undo time is over"?
3. Submit a Draft. Do Edit and Delete disappear and a 🔒 appear?
4. Add a PDF with an expiry date next week. Is the badge amber? Can you download it? Is a renamed
   .exe refused?
5. Click Letterhead PDF on a record with a Hindi name. Are ₹ and the Hindi text correct, and does the
   footer say "Page 1 of 1"?
6. Export a record whose text starts with "=". Does Excel show it as text?
7. Import 10 rows that contain 2 mistakes. Does it name the 2 bad rows and create 8 records?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md, ERRATA.md, PHASE-04.md, then
docs/archive/phase3-4/CONTRACT.md, docs/archive/plans/07-ENGINE-KIT.md, apps/api/src/modules/records/*,
kit/commands.ts, kit/print.ts, engine/*, apps/web/src/pages/generic/*.
Order:
1 migrations files_documents / idempotency_v2 / import_export_jobs — show SQL, ask owner before applying;
2 deps pdfkit (if not from Phase 3), pg-boss, busboy; dev harfbuzzjs, @types/pdfkit, @types/busboy;
3 engine/lock-matrix.ts used by update/remove/submit/status/documents; fix C6 per §5;
4 rewrite kit/commands.ts per §5 C7, update kitApi.ts, keep kit contract tests green;
5 core/storage, core/scan, modules/documents, upload pipeline;
6 core/pdf with script runs — make the Devanagari gate test pass before any template work;
7 export fixes + CSV + async export; start pg-boss in server.ts (move Phase 1 cleanup into it);
8 modules/imports wizard + jobs;
9 summary/quality endpoints, submit + bulk submit;
10 web: phase map, server dashboard/quality, Documents tab, drawer docs, Submit Selected, Import
   wizard, Reports, PDF buttons, print CSS;
11 tests §10, 3 clean runs; update README-PHASE4.md.
Rules: {data,meta}, error shape, ETag/If-Match, Idempotency-Key; no "any"; no in-memory state that
must survive a restart; no demo data; Postgres only; never read .env*; never push; commit only if
asked. Write PHASE-04-REPORT.md with all DB changes.
~~~
