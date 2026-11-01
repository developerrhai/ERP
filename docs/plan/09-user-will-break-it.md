# 9. "User Will Break It" Plan

[← Back to PLAN.md](../../PLAN.md)

Each scenario has an id (`B-nn`). Every id has an automated test (Playwright or API) in `tests/break-it/B-nn.*` (§11). "Prototype today" shows what index.html actually does, where it was checked by reading the code or by the Playwright probe (marked ✔probe).

Several mechanisms recur in the table:

* **Idempotency key:** the client sends a UUID per submit, and the server stores `(user, key) → response` for 24 h.
* **Optimistic lock:** every row has a `version` column. `PATCH` must send `If-Match: <version>`, and a mismatch returns 409.
* **Soft delete:** sets `deleted_at`, with a 10-s Undo toast. A hard purge is admin-only and only after retention.

| # | Scenario (careless or unlucky user) | Prototype today | Expected safe behaviour in the rebuild |
|---|---|---|---|
| B-01 | Double-clicks **Save** in the Add modal | Two records (no guard) | The button disables on the first click and shows a spinner. The idempotency key means the second request returns the first result, so one record is created |
| B-02 | Double-clicks **Submit Approval** | Second click shows "Already pending" | Same as the prototype, enforced by a server unique `(module, record, status=Pending)` |
| B-03 | Double-clicks **Approve** at level 1, so level 2 gets approved by the same click | Director can click through all levels ✔probe | Each level needs a distinct approver (configurable SoD). Approve is idempotent per level, with a 409 "Level already decided" |
| B-04 | Refreshes the browser mid-save | Data in localStorage may be half written; the session is lost (`CURRENT_USER` lives in memory) | Each save is a single DB transaction (all or nothing). The session survives refresh through the httpOnly refresh cookie. The unsaved form draft is restored from sessionStorage with a "Restore draft?" banner |
| B-05 | Presses browser **Back** after saving | n/a (single page, no routes) | React Router history. Back returns to the list, and re-submitting is impossible because the form is reset and the idempotency key is consumed |
| B-06 | Presses Back while a modal is open | — | Back closes the modal, not the page. If the form is dirty: "Discard changes?" |
| B-07 | Opens the same record in two tabs and edits both | Last write wins silently | Optimistic lock. The second save gets 409 "Changed by X at 10:42" with a Reload / Compare option |
| B-08 | Two users approve the same request at the same time | Both write to localStorage; last wins | A row lock on the approval request; the second user gets 409 |
| B-09 | Session expires during long form filling | — | The access token is refreshed silently. If the refresh also expired, a modal re-login keeps the form state and retries the save |
| B-10 | Logs out in one tab and keeps working in another | — | A BroadcastChannel signals logout to every tab. The next API call returns 401 and redirects to login |
| B-11 | Loses internet while saving | — | The request fails, a toast "Offline — not saved" appears, the form stays filled, Retry is offered. A navigator.onLine banner is shown. No offline queue for financial documents (decision D-14) |
| B-12 | Types letters in an amount field | `type=number` blocks some input. Values are stored as strings | The input mask allows digits, one decimal point and minus only where allowed. The server rejects with a field-level 422 error |
| B-13 | Pastes "₹1,25,000.50" into an amount | Stored as text | The paste is parsed to 125000.50 (strip ₹, commas, spaces). Ambiguous text is rejected |
| B-14 | Enters a negative quantity on a sales order | Accepted | `min 0` for qty. Returns use return documents |
| B-15 | Enters 1e309 / a 25-digit amount | Accepted | Precision `numeric(18,2)`. More gives 422 "Too large" |
| B-16 | Enters an end date before the start date (leave, contract, project) | Accepted | A cross-field validation error on both fields |
| B-17 | Picks 31-Feb by typing a date | Browser-dependent | Date picker plus server ISO validation |
| B-18 | Posts a voucher dated in a closed FY or period | No concept | 409 "Period locked". The FY selector shows only open years for entry |
| B-19 | Uploads the wrong file type (a .exe renamed to .pdf) | Accepted (accept attribute only); stored base64 | Allow-list of extensions **and** magic-byte sniffing; rejected with a reason |
| B-20 | Uploads a 500 MB video | `FileReader`; localStorage quota error → "File is too large for local browser storage" | Client pre-check of the max size (25 MB default) plus a server limit (multer `limits`); 413 with a message |
| B-21 | Uploads a file whose name contains `../../etc/passwd` or emoji | — | A server-generated storage key (UUID). The original name is sanitised and kept only as metadata |
| B-22 | Uploads a malware sample | — | ClamAV scan (in the docker compose). The file is quarantined until clean |
| B-23 | Deletes a record that other records use (customer with invoices, item with stock) | Deleted instantly; links break | 409 "In use by 12 invoices", with a link. Inactivate is offered instead |
| B-24 | Deletes by mistake | `confirm()` then gone forever | Soft delete plus a 10-s **Undo** toast. Restorable from "Recently deleted" for 30 days (admin) |
| B-25 | Bulk-selects every page and deletes | `confirm` "Delete N selected?" | Typed confirmation for > 10 records ("type DELETE"). Records in use are skipped with a report. Audit entry per record |
| B-26 | Deletes **all** rows of a module | Module re-seeds 25 demo rows ✔probe | Empty state "No records yet — Add or Import". Never re-seeded in production |
| B-27 | Clicks **Reset 25 Demo** | Wipes real module data (any user with access) | Button not present in production builds. Demo seeding is a CLI command only on the `demo` environment |
| B-28 | Creates a duplicate customer or vendor (same GSTIN) | Allowed | Unique (company, GSTIN) for masters. Fuzzy-name duplicate warning |
| B-29 | Enters the same vendor invoice number twice | Allowed | Unique (vendor, invoice no, FY) |
| B-30 | Types an invalid GSTIN or PAN | Accepted | Format and checksum validation. PAN must equal GSTIN chars 3–12 |
| B-31 | Edits an approved or posted document | Allowed; the Status field is free text, so a user can even type "Approved" | Locked. Status is never editable. Amend/reverse through dedicated actions |
| B-32 | Changes the Department field so the approval goes to their own department | `submitApproval` uses `row.Department` | The approval department comes from the document owner's department plus the matrix, never from an editable field |
| B-33 | Approves their own request | Allowed ✔probe | Blocked (requester ≠ approver) unless a configured exception with a reason |
| B-34 | Approves above their limit | `approvalLimit` is shown but never checked | The approver's limit must be ≥ document amount for the final level |
| B-35 | Employee role submits for approval although not allowed to | Submit button shown regardless ✔probe | Permission `submit` (part of `edit`) checked server-side. The button is hidden |
| B-36 | Opens a URL to a page of another department | `nav()` checks `can()` client-side only | The route guard hides it **and** the API returns 403 for every call. 403 page with "Request access" |
| B-37 | Edits localStorage or uses devtools to raise their role | Trivial: everything is in localStorage | Role and permissions live only on the server. The JWT holds the user id and session id only. Each request re-loads permissions (cached 60 s, busted on change) |
| B-38 | Uses the URL hash `#finance` to log in without a password | Works ✔probe | No such route. Login only with credentials or SSO |
| B-39 | Clicks a demo department button to log in | Logs in without a password | Removed from production. Seeded demo users exist only on the `demo` environment, with random passwords printed at seed time |
| B-40 | Signs up and picks "Department Head" | Gets the role ✔probe | Self-signup disabled. Users are invited by an admin with a role. Optional open signup gets the "Employee" role in a pending state |
| B-41 | Resets password with the code 123456 | Code is static; nothing changes | Single-use, 15-min, hashed token sent by email. All sessions revoked after reset |
| B-42 | Tries 1,000 passwords | Unlimited | Rate limit (5/min per IP + account), lockout after 10 failures for 15 min, generic error text |
| B-43 | Pastes a 1 MB string into a text field | Stored | maxLength in the UI. Server limit (200/4000 chars). Body size limit 1 MB |
| B-44 | Types `<script>` or `=HYPERLINK(...)` in a name | `esc()` escapes HTML, but inline `onclick` uses unescaped labels; Excel export is raw | React escapes by default, no `dangerouslySetInnerHTML`. CSV/XLSX export prefixes `'` to cells starting with `= + - @` |
| B-45 | Searches with 1 character | Requires 2 characters | Keep the 2-character minimum; debounce 300 ms; cancel stale requests |
| B-46 | Filters a list, edits a record, comes back and loses the filter | State lost on rerender | Filter, sort, page and tab state kept in the URL query string |
| B-47 | Sorts a money column that holds strings | `v8Num` parsing | Typed numeric columns sorted in SQL |
| B-48 | Opens a list of 200k rows | All rows in memory | Server pagination (default 20, max 200), keyset paging for big tables |
| B-49 | Exports 200k rows to Excel | Builds an HTML-as-.xls in the browser | Async export job, then a notification with a download link. Hard cap 100k rows per file |
| B-50 | Prints the page | `window.print()` prints the whole app chrome | A print stylesheet hides the sidebar and top bar. Document prints use the letterhead PDF |
| B-51 | PDF with ₹ sign or Hindi text | ₹ and non-ASCII become spaces (`pdfEsc`) ✔probe | Embedded Unicode fonts (Noto Sans + Noto Sans Devanagari) |
| B-52 | Long text overflowing PDF lines | Truncated at 100 characters | Word-wrap, multi-page with "Page x of y" |
| B-53 | Leaves a payroll month half processed and runs it again | No guard | Payroll run states and a unique (company, month). Re-run allowed only in Draft/Calculated and replaces the previous calculation |
| B-54 | Issues stock that another user just issued (last unit) | No stock model | Row lock on the balance; the second request gets "Insufficient stock (available 0)" |
| B-55 | Receives more than ordered on a GRN | Free numbers | Validation against open PO qty + tolerance |
| B-56 | Saves a journal that does not balance | Free numbers | Save disabled with the live difference shown; the server rejects |
| B-57 | Changes the item valuation method after transactions | — | Blocked |
| B-58 | Mobile user (390 px) opens a wide table | Horizontal scroll inside `.table-wrap` | Same, plus a sticky first column and a card view on phones (same tokens) |
| B-59 | Uses only the keyboard / a screen reader | Buttons OK; modal has no focus trap; inline onclick buttons break (Add Line etc.) ✔probe | Focus trap in the modal/drawer, ESC closes, labelled inputs, ARIA live toasts (§5 accessibility) |
| B-60 | Leaves the browser open overnight on a shared PC | Logged in forever until refresh | Idle timeout (15 min default, configurable in Security) with a warning at 13 min |
| B-61 | Changes Company/Branch/FY in the top bar with unsaved changes | Selectors do nothing | Prompt "Discard unsaved changes?". The context switch reloads data in the new scope |
| B-62 | Selects a different FY and posts | — | Posting date must be inside the selected FY and an open period |
| B-63 | Imports an Excel file with wrong headers or blank mandatory columns | No import | Template-based mapping. Dry-run report per row. Nothing committed until all rows are valid or the user chooses "import valid rows only" |
| B-64 | Imports the same file twice | — | File hash check warning plus duplicate detection rules |
| B-65 | Uses an old browser or JS disabled | — | `<noscript>` message. Supported-browser list (last 2 versions of Chrome/Edge/Firefox/Safari) |
| B-66 | Clicks a notification for a record that was deleted | — | "Record no longer exists (deleted by X on date)" |
| B-67 | Admin deletes the department a user logs in with | Allowed (array splice) | Blocked while users or employees reference it |
| B-68 | Admin renames a role | Permissions keyed by name are orphaned | Roles have immutable ids; the name is a label |
| B-69 | Admin demotes or deletes the last Super User | Super User is editable to another role | Blocked: "At least one active Super User required" |
| B-70 | Admin creates approval levels with gaps or overlaps (L1 ₹0, L3 ₹50k, no L2) | Allowed | Validation: contiguous levels, strictly increasing thresholds |
| B-71 | A user's clock is wrong (date in 2030) | Dates come from the client | All timestamps from the server (UTC); display in the company timezone |
| B-72 | Very slow network (3G) | — | Skeleton loaders, request timeouts (30 s) with retry, no double submit (B-01) |
| B-73 | The webhook or automation target is down | — | Retries with backoff, then dead-letter. The admin sees the failure in Background Jobs |
| B-74 | An automation rule loops (update → trigger → update) | — | Max depth 3 per causal chain; rule auto-disabled after 100 errors/hour |
| B-75 | Pastes an AI Copilot prompt asking to "delete all invoices" | Canned answers | The Copilot has read-only tools. Write suggestions need explicit human confirmation and the normal permission checks |
