# PHASE 34 — External Integrations: GSTN/IRP, Bank Feeds, WhatsApp & Webhook Hub

## 1. Goal
Upgrade v1's manual JSON/file interfaces (R-12) into production-ready, toggleable **External Integration Adapters** with encrypted credential vaults, dead-letter retries, and signature verification:
1. **GSTN / IRP & E-Way Bill Adapter Interface** (sandbox-tested NIC/GSP adapter pattern for IRN generation, QR signing, and E-Way Bill generation, cleanly falling back to Phase 11 JSON export when disabled);
2. **Bank H2H / Payment Link & UPI Reconciliation Adapter** (auto-pull statements & payment status webhooks);
3. **WhatsApp Business Cloud API & Signed Outbound Webhooks** (template messages for Invoices, Dispatch Alerts, POs, and signed HMAC webhook delivery with retry/dead-letter console).

## 2. Pages
| Page ID | Title | Family | Purpose |
|---|---|---|---|
| admin-integrations | Integrations & API Vault | Administration | Enable/test GSP/IRP, Bank, WhatsApp, SMTP adapters |
| admin-webhooks | Outbound Webhooks & DLQ | Administration | Manage webhook endpoints, secrets & dead-letter retries |

## 3. Rules
- STANDARDS §5–§10 + R-12: live external calls ONLY happen when the adapter is explicitly configured & enabled (`mode = SANDBOX | LIVE`); default `DISABLED` preserves offline/mocked JSON export behavior cleanly.
- All third-party API keys/secrets are AES-256-GCM encrypted at rest (reusing Phase 15/20 key derivation) and **never returned in plaintext** by any GET endpoint (masked last-4 only).
- Outbound webhooks include `X-RHAI-Signature` (HMAC-SHA256) + timestamp replay guard and run via `pg-boss` exponential backoff (`max 5` attempts → Dead-Letter Queue).
- Inbound webhooks verify provider signatures before processing (401/403 on invalid signature).

## 4. Database (`<ts>_phase34_external_integrations`)
- `integration_configs` (`id`, `provider_code` UNIQUE `GST_IRP/GST_EWAY/WHATSAPP/BANK_FEED/SMTP_RELAY`, `mode` CHECK `DISABLED/SANDBOX/LIVE`, `config_json`, `secrets_enc`, `last_tested_at`, `last_test_status`, `updated_by_id`, `updated_at`).
- `integration_logs` (`id`, `provider_code`, `direction` CHECK `OUTBOUND/INBOUND`, `doc_type`, `doc_id`, `http_status`, `latency_ms`, `request_summary`, `response_summary`, `error_text`, `created_at`).
- `webhook_endpoints` (`id`, `name`, `target_url`, `secret_enc`, `events_json`, `is_active`, `failure_count`, `created_by_id`).
- `webhook_deliveries` (`id`, `endpoint_id`, `event_name`, `payload_json`, `attempt_count`, `http_status`, `next_retry_at`, `status` CHECK `PENDING/DELIVERED/DLQ`, `last_error`, `created_at`).

## 5. Work, logic and examples
- **GSP / IRP Adapter:** `IrpClient` interface with `MockSandboxIrpClient` (used in tests/sandbox) and `HttpGspIrpClient` (live NIC/GSP API); populates `irn`, `ack_no`, `ack_date`, `signed_qr` directly onto `sales_invoices` when `Generate IRN` is clicked.
- **Webhook DLQ Replay:** Failed webhooks land in `DLQ` after 5 retries; Admin can inspect error and click `Replay` in `admin-webhooks`.

## 6. API
- `GET/PUT /api/v1/admin/integrations/:provider`, `POST /api/v1/admin/integrations/:provider/test`
- `GET /api/v1/admin/integrations/logs`
- `GET/POST/PATCH /api/v1/admin/webhooks`, `POST /api/v1/admin/webhooks/deliveries/:id/replay`
- `POST /api/v1/tax/einvoice/:invoiceId/generate-irn` (uses active adapter or returns clear `ADAPTER_DISABLED` prompting JSON download)
- `POST /api/v1/webhooks/inbound/whatsapp` & `/webhooks/inbound/bank` (HMAC signature verified)

## 7. Screens
- `admin-integrations`: Provider cards (`GST IRP`, `E-Way Bill`, `WhatsApp Cloud`, `Bank H2H`) with `Mode` pill, masked secret inputs, `Test Connection` button, and recent call log drawer.
- `admin-webhooks`: Endpoint list + event subscriptions + Delivery & DLQ tab with `Replay` button.

## 8. Messages
| Code | Message |
|---|---|
| ADAPTER_DISABLED | "Live {provider} adapter is disabled; download JSON or enable Sandbox/Live in Integrations." |
| WEBHOOK_SIGNATURE_INVALID | "Webhook signature verification failed." |

## 9. Audit & notifications
- Notification `system.integration_dlq` to Administrator when a webhook enters `DLQ` or an IRP/WhatsApp adapter fails 3× consecutively.
- Audit log records every integration config update (without plaintext secrets!) and DLQ replay.

## 10. Tests
- **Security:** verify secrets are never returned by GET endpoints; invalid HMAC signatures rejected with 403; SSRF guard blocks private/loopback webhook target URLs in production mode.
- **API:** sandbox IRN generation updates invoice, WhatsApp template dispatch logs delivery, webhook retry → DLQ → manual replay succeeds.
- **Crawler:** 0 errors across all 9 roles; 3 clean test runs.

## 11. Acceptance
- [ ] All integration secrets encrypted at rest and masked in UI/API.
- [ ] IRP, WhatsApp, Bank webhook, and Outbound Webhook DLQ pass sandbox/mocked E2E tests.
- [ ] 3 clean test runs.

## 12. Out of scope
Hard-coded vendor credentials (all configured per environment by Administrator).

## 13. Owner check
1. Administration → Integrations → configure GST IRP in Sandbox mode → open a posted Sales Invoice → click `Generate IRN`. ✔️ IRN & signed QR populate cleanly.
2. Administration → Outbound Webhooks → trigger a failing URL → verify it moves to DLQ and can be replayed.

## 14. Build prompt
~~~
Read CLAUDE.md, STANDARDS, ROADMAP, ERRATA, and PHASE-34.md. Build encrypted Integrations Vault,
toggleable GST IRP / E-Way / WhatsApp / Bank adapters, and signed Outbound Webhooks + DLQ with SSRF
& HMAC verification. Zero-error crawler ×3. Update STATUS.md, docs/clicntmassage.md, and
docs/client-test-guide.md. Write PHASE-34-REPORT.md.
~~~

## 15. Client documents
**clicntmassage.md — NEW in this update:**
- Added toggleable live/sandbox integrations for GST e-Invoice (IRN), E-Way Bill, WhatsApp Business notifications, Bank Feeds, and Signed Outbound Webhooks with retry queue.

**client-test-guide.md — add:**
- **Administrator:** Administration → Integrations → test Sandbox connection → inspect Delivery Logs. ✔️ Status shows Connected with masked credentials.

