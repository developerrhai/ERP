# PHASE 21

# PHASE 21 — Installable app (PWA), real-time notifications, admin notification control, email automation
(Read ERRATA E-32, E-33 and ROADMAP R-25..R-28 first. Build after Phase 19, before Phase 20.)

## 1. Goal
1. **Installable app.** The ERP website installs as an app on Android, iPhone, Windows and Mac: own
   icon, full screen, shortcuts, unread badge. One codebase; no app store.
2. **Real-time notifications.** The bell updates within 2 seconds without refreshing. Phone/desktop
   push works even when the app is closed.
3. **Admin control.** Admin decides:
   - which notifications exist and which channels they use (in-app / push / email / SMS);
   - which ones users cannot switch off;
   - quiet hours and rate limits;
   - a kill switch per channel.
   Admin can also publish announcements to everyone or to chosen units, departments, roles or users,
   with scheduling, a pinned banner and acknowledgement tracking.
4. **Email automation.** Posting a sales invoice emails its PDF to the customer's accounts address on
   its own. The same applies to credit notes, POs to suppliers, receipts, monthly statements, payment
   reminders and payslips (password-protected).
   - Every email is logged, with delivered / bounced status.
   - Bounced addresses are blocked and the document owner is told to fix them.
   - A manual "Email this document" button exists on every printable document.

**Why:**
- Approvals stall when nobody sees them.
- Customers ask for invoice copies by phone.
- The prototype's notification bell was fake.

## 2. Pages
| Page | New / extended | Who |
|---|---|---|
| Bell + drawer (top bar, every page) | new component | everyone |
| notif-center (/notifications) | new | everyone: full history, filters, mark read |
| notif-preferences (/settings/notifications) | new | everyone: per-type × channel switches, quiet hours, devices, daily digest |
| admin-notif-types | new | Administrator+: catalogue, channels, mandatory, priority, on/off, test send |
| admin-notif-broadcast | new | Administrator+ (approval rules §5.6) |
| admin-notif-health | new | Administrator+: deliveries in 24 h by channel, failures, device count, SES quota, domain DKIM/SPF/DMARC status, kill switches |
| admin-email-rules | new | Administrator, CFO: automatic email rules |
| comm-templates | extended (Phase 19) | email templates per rule, with preview and test |
| comm-logs | extended (Phase 19) | email log with delivery timeline, resend, attachment link |
| admin-email-suppressions | new | Administrator: blocked addresses, with reason and remove + note |
| "Email" button | extended on every Phase 4 print action | document users |
| /install | new | install guide per device (auto-detected) |

## 3. Research & rules (verified 4-Nov-2026)
**PWA installability:**
- HTTPS, a web app manifest (name, icons 192 + 512 + maskable, start_url, scope, display standalone)
  and a service worker.
- Built with vite-plugin-pwa in **injectManifest** mode, so our own service worker can handle push.
- Lighthouse 12 dropped its PWA audit category, so installability is tested by our own Playwright checks (§10).

**Web Push:**
- Standard Push API with VAPID keys (npm `web-push`).
- The browser's push service wakes the service worker even when the app is closed.
- Payloads are encrypted by the protocol and are only a few KB, so we send a title, a short body and a
  link — never business data.
- Endpoints that answer 404 or 410 are dead and must be deleted.

**iPhone/iPad:**
- Needs iOS/iPadOS 16.4+, and the app must be **added to the Home Screen and opened from there**.
  Only then can it ask for permission (from a button tap).
- A Safari tab cannot subscribe.
- iOS/iPadOS 18.4+ also supports Declarative Web Push (the OS shows the notification itself) — we
  send a payload that works both ways.
- Some reports say EU iPhones lack standalone PWAs. Sawant users are in India, so this is not a blocker.

**Permission etiquette:** never prompt on page load. Show our own "Turn on alerts?" card first and call
the browser prompt only from that click (a denied browser prompt cannot be re-asked by code).

**Real time:**
- SSE suits one-way server → browser notifications; WebSockets are only needed for constant two-way traffic.
- Behind Nginx: `proxy_buffering off`, `X-Accel-Buffering: no`, HTTP/1.1, long read timeout, and no
  gzip compression on the stream.

**Email deliverability:**
- Gmail and Yahoo (since Feb 2024) and Outlook (since 5-May-2025) require SPF + DKIM + DMARC aligned
  with the From domain, valid PTR/TLS, and spam rate < 0.3 % (aim < 0.1 %).
- Marketing mail needs RFC 8058 one-click unsubscribe, honoured within 2 days.
- Invoices, POs and payslips are transactional and need no unsubscribe link, but we still meet every
  authentication rule.

**Amazon SES:**
- Account-level suppression list for bounces and complaints; a configuration set per mail stream;
  SNS event destinations for delivery / bounce / complaint.
- A new account starts in the **sandbox** (only verified recipients), so production access must be
  requested (owner task, §13).

**India:**
- DPDP purpose limits apply to notification data.
- SMS still goes only through the Phase 19 DLT adapter (registered templates).
- Payslips are emailed as **password-protected PDFs** (common Indian payroll practice).

## 4. Database (<ts>_phase21_notify / _push / _broadcast / _email; all ALTERs are additive)
**Notification types and preferences:**
- notification_types(code PK e.g. `approval.requested`, module, category APPROVAL/ALERT/DOCUMENT/
  ANNOUNCEMENT/SECURITY/REMINDER/DIGEST/MARKETING, label, label_hi, priority LOW/NORMAL/HIGH/URGENT,
  enabled, allowed_channels[], default_channels[], mandatory_channels[], sensitive bool,
  title_tpl, body_tpl, deep_link_tpl, collapse_key_tpl, digest_allowed, updated_by/at)
  - Seeded from every NotificationService.notify call in Phases 5–19 (about 60 rows).
  - Rule: `in_app` ⊂ allowed for every type; `SECURITY` cannot be disabled.
- notification_settings (one row): channel kill switches email/push/sms, quiet_start 22:00,
  quiet_end 07:00, push_max_per_user_hour 20, digest_time 08:30, retention_days 180,
  broadcast_approval_threshold_users 50, sse_max_streams_per_user 5
- user_notification_prefs(user, type_code, channel, enabled, mode IMMEDIATE/DIGEST) PK (user, type, channel)
- user_notification_settings(user PK, quiet_start, quiet_end (null = company default), digest_enabled,
  language en/hi, soft_ask_dismissed_at)

**Notifications (ALTER Phase 5 `notifications`):**
- add type_code FK, priority, title, body, deep_link, collapse_key, dedupe_key, seq bigint identity,
  seen_at, read_at, archived_at, broadcast_id, expires_at
- unique (user_id, dedupe_key)
- index (user_id, seq DESC), partial index unread (user_id) WHERE read_at IS NULL

**Deliveries and devices:**
- notification_deliveries(notification_id, channel IN_APP/PUSH/EMAIL/SMS, target_ref,
  status QUEUED/HELD/SENT/DELIVERED/FAILED/SKIPPED/SUPPRESSED, skip_reason PREF_OFF/TYPE_OFF/
  CHANNEL_KILLED/QUIET_HOURS/NO_DEVICE/NO_ADDRESS/NO_CONSENT/RATE_LIMIT/SUPPRESSED, release_at,
  attempts, provider_id, error, sent_at)
- push_subscriptions(id, user_id, endpoint unique, p256dh, auth, platform ANDROID/IOS/DESKTOP/OTHER,
  browser, device_label (user-editable), standalone bool, created_at, last_success_at, failure_count,
  revoked_at, revoke_reason LOGOUT/GONE_410/USER/ADMIN/DEACTIVATED)

**Broadcasts:**
- broadcasts(number BRC/2627/0001, title ≤ 120, body_md ≤ 4,000, severity INFO/WARNING/CRITICAL,
  audience jsonb {all, unitIds[], departmentIds[], roleIds[], userIds[]}, channels[], emergency bool,
  scheduled_at, expires_at, pin_banner, require_ack, status DRAFT/PENDING_APPROVAL/SCHEDULED/SENDING/
  SENT/WITHDRAWN/CANCELLED, approval_request_id, recipient_count, created_by, sent_at, withdrawn_by/at, reason)
- broadcast_recipients(broadcast, user, notification_id, read_at, acked_at) PK (broadcast, user)

**Email automation:**
- email_rules(code, name, event_code (Phase 19 catalogue), enabled, unit_ids[] (null = all),
  conditions (Phase 19 AST), recipient_resolver CUSTOMER_DOC_CONTACT/SUPPLIER_DOC_CONTACT/EMPLOYEE/
  DOC_OWNER/ROLE/FIXED, cc_resolvers[], fixed_cc[], bcc_archive bool, template_code,
  attachment NONE/DOC_PDF/STATEMENT_PDF/PAYSLIP_PDF, attach_mode ATTACH/LINK/AUTO,
  send_mode IMMEDIATE/DELAY/WINDOW, delay_min, window "09:00-19:00 Mon-Sat", stream TRANSACTIONAL/MARKETING,
  version, updated_by/at)
- ALTER message_templates (Phase 19): add subject_tpl, html_tpl, text_tpl, layout_code, sample_payload
- ALTER outbound_messages (Phase 19): add rule_id, doc_type, doc_id, email_to[], cc[], bcc[], subject,
  attachments jsonb [{document_id, filename, bytes, sha256}], share_link_id, message_id_header,
  ses_message_id, idempotency_key unique, resend_of_id, resend_reason, body_stored bool (false for payslips)
- email_events(outbound_message_id, type SEND/DELIVERY/DELIVERY_DELAY/BOUNCE/COMPLAINT/REJECT,
  bounce_type PERMANENT/TRANSIENT, sub_type, recipient, diagnostic, at, raw jsonb) — unique (ses_event_id)
- email_suppressions(email_norm PK, reason HARD_BOUNCE/COMPLAINT/MANUAL/UNSUBSCRIBE, source_message_id,
  added_at, removed_by/at, removed_note)
- Contact flags, ALTER Phase 6 party contacts: receives_invoices, receives_statements, receives_po,
  receives_reminders, email_status OK/BOUNCED. Customers/suppliers: email_documents default true,
  sms_documents default false.

**Keys:** in env only, never in the DB — VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
VAPID_SUBJECT=mailto:it@<domain>, SES_REGION=ap-south-1, SES_CONFIG_SET_TXN, SES_CONFIG_SET_MKT,
SES_SNS_TOPIC_ARN, MAIL_FROM_DOMAIN. The SES role is the EC2 instance role (no static keys).

## 5. Services & algorithms
### 5.1 Dispatch pipeline (NotificationService v2 — same signature as Phase 5, so callers don't change)
~~~
notify(tx, { type, recipients: userIds | resolver, data, docRef?, dedupeKey?, priority? })
~~~
1. **Inside the caller's transaction:**
   - render title/body/link from notification_types templates (escaped; `sensitive` → generic body);
   - insert one in-app row per recipient (ON CONFLICT dedupe → no-op);
   - insert delivery rows from decideChannels;
   - `pg_notify('erp_rt', {"u":[ids],"k":"n"})` — Postgres delivers it **only on commit**, so a
     rolled-back invoice never notifies anyone.
2. **After commit:** pg-boss jobs `notify.push`, `notify.email`, `notify.sms` read QUEUED rows
   (an outbox pattern, so retries are safe).

### 5.2 decideChannels(type, prefs, settings, now, devices, addresses) — pure, in packages/calc
**Order** (first match wins per channel):
1. Type disabled → nothing at all (SECURITY can't be disabled).
2. Channel not allowed → skip.
3. Channel killed → CHANNEL_KILLED.
4. Not mandatory and user pref off → PREF_OFF.
5. No device / address → NO_DEVICE / NO_ADDRESS.
6. Suppressed address → SUPPRESSED.
7. Push/SMS inside quiet hours and priority < URGENT → **HELD** until quiet end (email ignores quiet hours).
8. More than push_max_per_user_hour → collapse into one summary push.
9. Pref mode DIGEST → held for the digest.

In-app is always delivered.

**Examples (fixtures):**
| Case | In-app | Push | Email | SMS |
|---|---|---|---|---|
| `approval.requested` PO ₹3.2 L to CFO at 23:10, quiet 22–07 | now | HELD → 07:00 summary "3 approvals waiting" | now | — |
| `maint.breakdown.p1` (URGENT) at 02:00 to maint head | now | now (renotify) | — | now (DLT template) |
| `payroll.payslip.released` (sensitive) | now | "Your payslip is ready" (no amounts) | encrypted PDF | — |
| user switched email off for `stock.below_reorder` | now | per pref | PREF_OFF | — |
| `security.new_login` (mandatory email) with email pref off | now | now | sent anyway (mandatory) | — |

### 5.3 Real time (SSE)
- **Endpoint:** `GET /api/v1/realtime/stream`.
  - Auth: `Authorization: Bearer` via fetch-based SSE (`@microsoft/fetch-event-source`). The token is
    never put in the URL.
  - Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
  - Excluded from compression.
  - A comment heartbeat `:hb` every 25 s.
  - Max 5 streams per user (oldest closed).
- **Events:**
  | Event | Use |
  |---|---|
  | `notification.new` {id, seq, title, body, link, priority} | new item for the bell |
  | `notification.read` {ids} | syncs other tabs/devices |
  | `badge` {unread} | unread count |
  | `broadcast.banner` {id, severity, title, until} | pinned banner |
  | `approval.changed` {docType, docId} | refreshes the open approval inbox |
  | `session.revoked` | Phase 1 logout everywhere |
  | `resync` | client must refetch |
- **Fan-out:**
  - Each API process holds one LISTEN connection on `erp_rt` and a map userId → open streams.
  - NOTIFY carries ids only (< 8,000 bytes; batch large broadcasts into chunks of 500 ids). The
    process loads the row and writes to its local streams.
  - This works across Phase 20's two processes with no extra infrastructure.
- **Missed events:** the client sends `Last-Event-ID` = last seq. The server replays up to 200 rows
  from the last 24 h, else sends `resync`.
- **Client:**
  - **one** stream per browser — tabs elect a leader with the Web Locks API and share events via
    BroadcastChannel;
  - reconnect with backoff 1 → 30 s;
  - after 3 failures, fall back to polling `/notifications/unread-count` every 60 s.
- **Nginx location** (sample for Phase 20):
~~~nginx
location /sawant-erp/api/v1/realtime/ {
  proxy_pass http://erp_api; proxy_http_version 1.1; proxy_set_header Connection "";
  proxy_buffering off; proxy_cache off; gzip off; proxy_read_timeout 3600s; }
~~~

### 5.4 Web Push
**Subscribe** (only from a button click):
1. If iOS and not standalone (`matchMedia('(display-mode: standalone)')` / `navigator.standalone`),
   show the 3-step "Share → Add to Home Screen → open from icon" guide and stop.
2. Otherwise call `Notification.requestPermission()`, then
   `pushManager.subscribe({userVisibleOnly:true, applicationServerKey: VAPID_PUBLIC})`.
3. POST /push/subscriptions with the subscription + platform + browser.
- If permission is denied, show how to re-enable it in browser settings.

**Send** (job `notify.push`, concurrency 10):
- payload ≤ 2 KB JSON, carrying **both** the classic fields for our service worker and the Declarative
  Web Push fields (title, body, navigate URL, app badge) per Apple's WWDC25 spec, behind setting
  `push.declarative` (default on);
- options: `TTL` (URGENT 4 h, HIGH 24 h, else 72 h), `urgency` (high / normal / low), `topic` =
  collapse key (≤ 32 chars, base64url) so newer replaces older.
- Responses:
  | Response | Action |
  |---|---|
  | 201 | SENT; last_success_at |
  | 404 / 410 | revoke subscription (GONE_410) |
  | 413 | trim body and retry once |
  | 429 / 5xx | retry honouring Retry-After, backoff 1 m / 5 m / 30 m, then FAILED |

**Service worker (`src/sw.ts`, injectManifest):**
- `push` → `showNotification(title, {body, icon, badge, tag: collapseKey, data:{url}, renotify: priority==='URGENT'})`
  + `navigator.setAppBadge(unread)`;
- `notificationclick` → only a same-origin URL inside the app scope is allowed (otherwise `/notifications`);
  focus an open window and navigate, else `clients.openWindow`;
- `pushsubscriptionchange` → resubscribe and POST.

**Lifecycle:**
- Logout unsubscribes this device and deletes its row.
- An admin deactivating a user, or the user's "sign out all devices", revokes all their subscriptions.
- A subscription with no success in 60 days is revoked by the job `push.cleanup`.

### 5.5 PWA shell
- **Manifest:** name "Sawant Group ERP", short_name "Sawant ERP", start_url `/?source=pwa`, scope `/`,
  display standalone, theme/background from STANDARDS tokens, icons 192 / 512 / maskable 512.
  Shortcuts: My Approvals, Notifications, Scan QR (Phase 14), New Gate Entry (Phase 18).
- **Caching** (Workbox):
  - precache the app shell (JS / CSS / fonts / icons) only;
  - `/api/**` is **NetworkOnly** — money and stock must never come from a stale cache;
  - offline → an "You are offline — data needs the network" page.
  - Existing offline drafts (Phase 17 visits, Phase 13 shop floor) keep their own IndexedDB queues.
- **Updates:** `registerType: 'prompt'`. A toast says "New version available — Reload". Never auto-reload
  while a form is dirty. The service worker version is shown in Settings → About.
- **Logout:** clear runtime caches and IndexedDB drafts of that user (with a warning if unsynced drafts exist).
- **Install prompt:** capture `beforeinstallprompt` (Chromium) for an "Install app" item in the user
  menu; iOS gets the guide; `/install` explains each device with screenshots.
- **Badge:** `navigator.setAppBadge(unread)` on each `badge` event; cleared at 0.

### 5.6 Admin broadcasts
**Audience resolution:** the union of unit / department / role / user lists, minus inactive users;
`all` = every active user. Shown as a live count before sending ("This will reach 142 people").

**Approval (Phase 5 doc type BROADCAST):**
- needed if recipients > broadcast_approval_threshold_users (50), or channels include EMAIL or SMS,
  or severity CRITICAL;
- approver is Director+ and not the creator;
- an **Emergency** flag (Super User / Administrator only: fire, power cut, gate closure) skips
  approval, is limited to in-app + push, is URGENT, and is audited with a mandatory reason.

**Sending:**
- job `broadcast.send` at scheduled_at: insert recipients + notifications in batches of 500 (NOTIFY per batch);
- email via template `broadcast.generic` (stream TRANSACTIONAL for internal staff);
- SMS only with a DLT template that matches.

**After sending:**
- banner shown until expires_at;
- require_ack → a blocking modal on next page load until "I have read this" (recorded with time);
- report: delivered / read / acknowledged, per unit;
- **Withdraw** removes the banner and in-app items (already-sent emails/pushes can't be recalled — the UI says so);
- **Cancel** is possible before scheduled_at.

### 5.7 Email automation
**Seeded rules** (all ON except where noted; admin can edit):
| Rule | Event | To | Attachment | When |
|---|---|---|---|---|
| INV_EMAIL | sales_invoice.posted | customer contacts with receives_invoices (else the billing email) | invoice PDF (Rule 46, with IRN QR when present) | immediate |
| INV_CANCEL | sales_invoice.cancelled | same, only if the original was emailed | cancellation notice | immediate |
| CN_EMAIL | sales_credit_note.posted | same | credit note PDF | immediate |
| RCPT_EMAIL | sales_receipt.posted | same | receipt PDF | immediate |
| STMT_MONTHLY | cron 1st 09:00 | receives_statements, open AR > 0 | statement PDF | window 09–19 Mon–Sat |
| DUNNING_D3/D15/D30 | invoice.overdue (3/15/30 days) | receives_reminders, CC salesperson | statement PDF | window |
| PO_EMAIL | purchase_order.approved | supplier contact receives_po | PO PDF | immediate |
| PO_AMEND | purchase_order.amended | same | revised PO PDF | immediate |
| PAYSLIP | payroll.payslip.released | employee personal email | **encrypted** payslip PDF | immediate (batched) |
| AMC_RENEWAL | amc.renewal_due 30 days | customer | quotation PDF | window |
| DIGEST | cron digest_time | users with digest on and unread > 0 | none | daily |
| WELCOME | user.created | user | none (set-password link from Phase 1) | immediate |

**Pipeline** (job `notify.email`, honours the SES send rate):
1. The rule matches the event + conditions + unit.
2. Recipients are resolved and normalised (lowercase, trimmed); suppressed or BOUNCED addresses are
   dropped (if none remain → status SUPPRESSED + notify the doc owner).
3. The PDF is the **stored copy of the posted document** (DocumentService, same sha256 as the print),
   never re-rendered with today's data.
4. attach_mode AUTO: total attachments ≤ 7 MB → attach, else a Phase 18 share link (30 days, view-only,
   access logged, revocable).
5. The template renders HTML + plain text (escaped variables; letterhead of the document's unit; inline
   CID logo, no remote images; no tracking pixels or click tracking).
6. Build MIME with nodemailer MailComposer.
   - Message-ID `<doc-id.version@MAIL_FROM_DOMAIN>`; `X-ERP-Ref: SITAL/2627/00031`.
   - Reply-To = the unit's accounts mailbox.
   - MARKETING stream adds `List-Unsubscribe` (https + mailto) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
7. Send with SES v2 SendEmail (raw) and the stream's configuration set.
8. Record ses_message_id.

**Idempotency:**
- key = rule + doc + doc version, so a retried job or double post never sends twice;
- **Resend** is a new message (resend_of_id, reason required, can change To/CC);
- the manual "Email" button = preview dialog (To / CC prefilled from the rules, editable, attachment
  shown) → send; it is logged the same way.

**Payslip PDF password:** first 4 letters of PAN in capitals + DDMM of date of birth (e.g. ABCD0507).
- The email states the format, never the password.
- No PAN → the employee code + DDMM.
- pdfkit userPassword with AES-256; owner password random.
- The email body is not stored (body_stored = false).

**Bounces and complaints:**
- SES → SNS → `POST /webhooks/inbound/ses`. The SNS signature is verified (certificate URL host must be
  `sns.<region>.amazonaws.com`). SubscriptionConfirmation is auto-confirmed only for SES_SNS_TOPIC_ARN.
- Events are stored in email_events (deduplicated).
- PERMANENT bounce or complaint → email_suppressions + contact email_status BOUNCED + in-app alert to
  the document owner:
  > "Invoice SITAL/2627/00031 email to accounts@abc.co.in bounced (mailbox does not exist). Update the
  > customer contact and press Resend."
- TRANSIENT → DELAYED (SES retries).
- Spam complaint rate is shown on admin-notif-health; alarm at 0.1 %, auto-pause of the MARKETING stream at 0.3 %.

**Quotas:** read the SES GetAccount send quota hourly; warning at 80 % of the daily quota; the job rate
limiter stays under the max send rate.

**Domain setup** (owner tasks, checked live on admin-notif-health via SES GetEmailIdentity):
- Easy DKIM 2048-bit (3 CNAMEs);
- SPF via custom MAIL FROM `bounce.<domain>`;
- DMARC `p=none; rua=…` for 30 days, then `p=quarantine`;
- From `billing@<domain>` (invoices / statements), `purchase@` (POs), `hr@` (payslips), `erp@` (system).

### 5.8 SMS (only via the Phase 19 adapter)
Used only for URGENT types and the optional "invoice emailed" SMS for customers with sms_documents.
Every one needs a registered DLT template and whitelisted short-link domain. Quiet hours don't apply to
URGENT; promotional is never used here.

### 5.9 Retention & privacy
| Data | Kept |
|---|---|
| In-app notifications | 180 days, then purged by `notify.purge` |
| Broadcasts + acknowledgements | 3 years |
| Document email log (who, when, what, sha256) | 8 years — proof the invoice was sent |
| Push subscriptions | until revoked |
| Suppressions | until removed |

Notification text never contains Aadhaar, PAN, bank or salary figures (lint test on templates).

## 6. API (/api/v1; {data,meta}; ETag; Idempotency-Key)
- **Real time:** GET /realtime/stream
- **Notifications:**
  - GET /notifications?cursor=&unread=&category=; GET /notifications/unread-count
  - POST /notifications/read {ids | all:true}; POST /notifications/:id/archive
- **Preferences:** GET|PUT /me/notification-prefs; GET|PUT /me/notification-settings
- **Push:** GET /push/vapid-public-key; POST /push/subscriptions; GET /me/devices;
  PATCH /me/devices/:id {label}; DELETE /me/devices/:id
- **Types:** GET|PATCH /admin/notification-types(/:code); POST /admin/notification-types/:code/test (sends to self)
- **Settings:** GET|PUT /admin/notification-settings (kill switches audited)
- **Broadcasts:**
  - CRUD /admin/broadcasts; POST /admin/broadcasts/:id/preview-audience | submit | send-now | cancel | withdraw
  - GET /admin/broadcasts/:id/report
  - POST /broadcasts/:id/ack; GET /broadcasts/active
- **Email rules:** CRUD /admin/email-rules (+ /:id/test {docId} → renders a preview, sends only to self)
- **Documents:** POST /documents/:docType/:id/email {to, cc, message?} (preview: GET …/email-preview)
- **Email log:** GET /comm/messages?channel=EMAIL&doc=; POST /comm/messages/:id/resend {to?, cc?, reason}
- **Suppressions:** GET|POST|DELETE /admin/email-suppressions
- **Health:** GET /admin/notif-health
- **SES webhook:** POST /webhooks/inbound/ses (SNS-signed, no login)

## 7. UI (index.html look; built for non-expert users)
**Bell:**
- red count (99+); drawer with tabs All / Approvals / Alerts / Announcements;
- each row: icon, title, one line, "5 min ago", unread dot; tap opens the record and marks it read;
- "Mark all read"; "See all" → /notifications.

**Banner:** under the top bar for active broadcasts (yellow WARNING, red CRITICAL), with ✕ unless require_ack.

**Soft-ask card**, shown once after the 2nd login, only if push is supported and permission is "default":
> "Get approval and breakdown alerts on this device even when the ERP is closed?" [Turn on] [Not now]

"Not now" hides it for 30 days.

**Preferences page:**
- one table: rows = notification types grouped by module; columns = In-app (locked on) / Push /
  Email / SMS;
- mandatory switches shown locked with "Required by company";
- quiet hours picker; daily digest switch;
- "My devices" list (Android Chrome — "Ramesh phone", last used, Remove) and "Send test notification".

**Broadcast composer:**
1. Title, message (simple editor: bold, list, link).
2. Severity.
3. Audience pickers with a live count.
4. Channels.
5. Schedule / expiry, pin, acknowledgement.
6. Preview as phone push + banner + email.
7. Submit (shows "needs approval by Director" when rules apply).

**Document Email dialog:** To / CC chips (prefilled; invalid or bounced shown red with the reason),
subject, a message box, attachment chip with size, "Send". Afterwards the document shows "Emailed to
accounts@abc.co.in · Delivered 10:42".

**Email log:** a timeline Queued → Sent → Delivered (or Bounced with the plain reason), the attachment,
Resend.

**Install:** user menu "Install app". On iPhone, 3 pictures (Share → Add to Home Screen → Open).

## 8. Messages
| Code | Message |
|---|---|
| PUSH_UNSUPPORTED | "This browser can't show alerts. Use Chrome, Edge, Firefox, or install the app on iPhone." |
| PUSH_IOS_INSTALL_FIRST | "On iPhone, first add Sawant ERP to your Home Screen and open it from there." |
| PUSH_DENIED | "Alerts are blocked for this site. Allow them in your browser's site settings." |
| PREF_MANDATORY | "The company requires this notification." |
| BROADCAST_AUDIENCE_EMPTY | "No active users match this audience." |
| BROADCAST_NEEDS_APPROVAL (info) | "Goes to {n} people by email — a Director must approve." |
| BROADCAST_EMERGENCY_REASON | "Write why this is an emergency." |
| BROADCAST_ALREADY_SENT | "Already sent. You can withdraw it from the app, but emails can't be recalled." |
| EMAIL_NO_RECIPIENT | "{party} has no email for invoices. Add one in the customer's Contacts tab." |
| EMAIL_SUPPRESSED | "{email} is blocked: {reason} on {date}. Fix the address or ask Admin to unblock it." |
| EMAIL_INVALID | "{text} is not a valid email address." |
| EMAIL_CHANNEL_OFF | "Email sending is paused by Admin." |
| EMAIL_QUOTA | "Daily email limit nearly reached ({used}/{max}). Non-urgent emails will wait." |
| EMAIL_DOC_NOT_POSTED | "Only posted documents can be emailed. Post it first." |
| EMAIL_RESEND_REASON | "Say why you are sending again." |
| SSE_FALLBACK (silent log) | Polling mode active |


-  9. Audit & notifications
- **Audit:**
  - type / setting / kill-switch changes (before/after);
  - every broadcast state change incl. emergency reason;
  - rule changes (versioned);
  - every manual email / resend;
  - suppression add/remove (with note);
  - device revoke by admin;
  - test sends;
  - SES webhook failures (signature invalid → security alert).
- **This phase's own notifications:**
  - bounce → doc owner;
  - complaint rate high → Admin;
  - SES quota 80 % → Admin;
  - broadcast approval → approver;
  - broadcast sent → creator, with counts;
  - push failure rate > 20 % in 1 h → Admin.

## 10. Tests
- **Unit:**
  - decideChannels — every §5.2 fixture + quiet hours crossing midnight + rate collapse + mandatory override;
  - audience resolution (overlap, inactive users);
  - collapse key ≤ 32 base64url;
  - payslip password builder (no PAN, DOB edge);
  - MIME headers (Message-ID, Reply-To, List-Unsubscribe only for MARKETING);
  - template variable escaping (`<script>` in a customer name);
  - "no PII in notification templates" lint.
- **Integration:**
  - notify inside a rolled-back transaction → no row, no NOTIFY, no push;
  - the invoice post emails once even when the job runs twice (idempotency);
  - attachment 6.9 MB attaches, 7.1 MB → link;
  - stored-PDF sha256 = print sha256;
  - suppressed contact → SUPPRESSED + owner alert;
  - SNS signature good / bad / wrong topic;
  - permanent bounce → suppression + contact BOUNCED;
  - 404/410 push → revoked; 429 respects Retry-After;
  - broadcast > 50 users requires approval, emergency skips it with a reason, withdraw removes the banner;
  - a TAL-unit audience never reaches SAW users.
- **Real time:**
  - two API processes: a user on process B gets a notification created on process A in < 2 s;
  - Last-Event-ID replay;
  - > 200 missed → resync;
  - six tabs → one server stream (leader election);
  - kill the stream → polling fallback;
  - heartbeat keeps Nginx from closing it.
- **PWA (Playwright, Chromium):**
  - manifest fields and icons present; service worker registered and controlling;
  - `beforeinstallprompt` fires; offline page shown;
  - `/api` never served from cache;
  - update prompt doesn't reload a dirty form;
  - logout clears caches.
- **Push E2E:** Playwright with a mocked push service + `web-push` test vectors.
- **Manual device matrix** (signed sheet): Android Chrome, iPhone iOS 18 Home Screen app, Windows Edge,
  Mac Safari — install, receive while closed, tap opens the right record, badge count.
- **Email E2E:** SES mailbox simulator addresses (success / bounce / complaint) in a staging configuration set.
- 3 clean runs.

## 11. Acceptance
- [ ] The app installs on Android, iPhone (Home Screen), Windows and Mac, and opens full screen with the Sawant icon.
- [ ] Approval requested on one PC → approver's bell updates in ≤ 2 s and their phone gets a push with the app closed; tapping opens that approval.
- [ ] Admin can switch a notification type off, make one mandatory, kill email globally, and set quiet hours — each takes effect for the next event.
- [ ] A broadcast to "SAW, Production department" reaches exactly those users, shows the banner, and the report shows read/ack counts.
- [ ] Posting an invoice emails the stored PDF once, logged as Delivered (SES simulator).
- [ ] A bounce blocks the address and alerts the owner.
- [ ] Payslips arrive encrypted and open only with the stated password format.
- [ ] Domain shows DKIM / SPF / DMARC verified on admin-notif-health (staging domain allowed).
- [ ] No business figures in any push payload; `/api` never cached.

## 12. Out of scope
Play Store / App Store apps (TWA backlog), native SDKs (FCM / APNs directly), WhatsApp document sending
rules (Phase 19 adapter; added later as a channel), inbound email parsing (e.g. supplier invoices by
mail), open/click tracking, marketing campaign builder, chat between users, voice calls, offline approvals.

## 13. Owner check (and owner tasks)
**Owner tasks before testing:**
1. Request SES production access in ap-south-1.
2. Add the DKIM / MAIL FROM / DMARC DNS records the admin-notif-health page lists.
3. Put the VAPID keys (generated once by the builder's script, shown once) into the server secrets.

**Checks:**
1. On your Android phone open the ERP. Does "Install app" add an icon? Does it open without the browser bar?
2. On iPhone: Add to Home Screen → open → Turn on alerts. Does the test notification arrive with the app closed?
3. From the PC, submit a PO for approval. Does the approver's bell turn red within 2 s, and does their phone ring?
4. Admin → Broadcast "Plant closed tomorrow" to SAW only. Do SAW users see the banner, and TAL users not?
5. Post an invoice for a customer with your own email as contact. Does the PDF arrive, and does the log say "Delivered"?
6. Change that contact to `bounce@simulator.amazonses.com` and resend. Does it show "Bounced" and alert you?
7. Turn email off in Admin → post another invoice. Is it queued as "Email paused"?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md (R-01..R-28), ERRATA.md (E-32, E-33), PHASE-21.md,
and the Phase 1, 4, 5, 6, 10, 16, 18, 19 code as built. Extend — never recreate — notifications,
message_templates, outbound_messages, contact_consents, dms_share_links and the Phase 19 event
catalogue/AST evaluator.
1 migrations <ts>_phase21_{notify,push,broadcast,email} per §4; seed notification_types from every
  existing notify() call, the §5.7 email rules (editable), default templates in English; no demo data.
2 packages/calc/notify: decideChannels, quietHours, collapseKey, audienceResolve, payslipPassword —
  §5.2 fixtures as tests first.
3 NotificationService v2 (same signature; outbox rows + pg_notify in caller's tx), jobs notify.push /
  notify.email / notify.sms / notify.digest / notify.purge / push.cleanup / broadcast.send /
  email.statements / email.dunning (pg-boss, idempotent).
4 Realtime: SSE route + per-process LISTEN erp_rt registry + Last-Event-ID replay; client
  fetch-event-source with Web Locks leader + BroadcastChannel + polling fallback; Nginx sample in
  infra/nginx/.
5 PWA: vite-plugin-pwa injectManifest, manifest + icons + shortcuts, src/sw.ts (precache shell,
  /api NetworkOnly, push, notificationclick same-origin only, pushsubscriptionchange, badge), update
  prompt, install item, /install guide, iOS standalone detection, logout cleanup.
6 Push: web-push with VAPID from env, payload ≤2 KB classic + declarative fields, TTL/urgency/topic,
  404/410 revoke, Retry-After; script tools/gen-vapid prints keys once (never writes them to the repo).
7 Email: SES v2 adapter (instance role, config sets per stream), MailComposer MIME, stored-PDF
  attachments, AUTO attach/link at 7 MB, idempotency key, manual Email dialog on every printable doc,
  resend, payslip AES-256 PDF, SNS webhook with signature verification, suppressions, quota guard,
  domain health via GetEmailIdentity. SMTP adapter remains the fallback behind a setting.
8 Admin pages §2, preferences page, bell/drawer/banner/ack modal, messages §8, audit §9.
9 Tests §10 incl. two-process SSE and SES mailbox simulator; 3 clean runs.
No secrets in code; no PII in push or templates; never auto-approve from email.
Migrations local dev/test only (R-16). Never push; commit only if asked. Write PHASE-21-REPORT.md
listing DB changes and the owner tasks of §13.
