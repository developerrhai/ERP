# PHASE 34 — Report (built and API-tested with sandbox / mock adapters; no live call was made)

Built locally on 2026-11-13. Nothing committed, pushed or deployed. **No real government, bank or WhatsApp service was contacted.**

## What was built
**Database** — migration `20261220000000_phase34_external_integrations` (idempotent): `integration_configs` (5 providers, **mode DISABLED by default**), `integration_logs`; the e-invoice columns `ack_no`, `ack_date`, `signed_qr` on `sales_invoices`; `webhook_deliveries.last_error` and `replay_of`; the Phase 19 `webhook_inbound` source list now also allows `WHATSAPP` and `BANK_FEED`; notification type `system.integration_dlq`.

**API** (`modules/integrations/`)
- **Vault** `GET/PUT /admin/integrations/:provider`, `POST …/test`, `GET /admin/integrations/logs`: providers `GST_IRP`, `GST_EWAY`, `WHATSAPP`, `BANK_FEED`, `SMTP_RELAY`; mode DISABLED / SANDBOX / LIVE; secrets are stored **AES-256-GCM encrypted** (the existing MFA key) and **only a masked hint (`••••1234`) is ever returned**; a masked value sent back from the screen keeps the old secret; the audit never carries a secret; a service address must be a public https URL.
- **E-invoice (IRN)** `POST /tax/einvoice/:id/generate-irn`: `ADAPTER_DISABLED` ("Live GST_IRP adapter is disabled; download JSON or enable Sandbox/Live in Integrations.") when disabled, so the Phase 11 JSON download stays the fallback; otherwise the adapter (a built-in **sandbox IRP**, or the live **HTTP GSP client** when an address is set) fills `irn`, `ack_no`, `ack_date`, `signed_qr` on a **posted B2B invoice**, once per invoice; every call is logged; **3 failures in a row alert the Administrator** (`system.integration_dlq`); a success resets the streak.
- **WhatsApp** `POST /admin/integrations/whatsapp/send` (template message; sandbox records it, live posts to the configured Cloud API; the full phone number is not logged).
- **Signed inbound hooks** `POST /api/v1/webhooks/inbound/whatsapp` and `/bank` (mounted before the JSON parser so the signature is over the raw text): hex HMAC-SHA256 (Meta `sha256=` form accepted); a bad or missing signature is **403 `WEBHOOK_SIGNATURE_INVALID` "Webhook signature verification failed."**; every hook is stored with `signature_ok` and logged.
- **Outbound webhooks** (on the Phase 19 endpoints): the **retry job that was an empty handler is now real**: a failed delivery waits 1, 2, 4, 8 minutes and the **5th failure goes to the dead-letter queue** with a notice to the Administrator; `GET /admin/webhooks`, `…/deliveries?status=`, `POST …/deliveries/:id/replay` (a fresh delivery from a dead-letter one; the original stays as evidence), `POST …/run`. Each send carries `webhook-id`, `webhook-timestamp`, `webhook-signature` and `X-RHAI-Signature` / `X-RHAI-Timestamp`; the **SSRF guard runs again at send time**, so a private target is never called even if the row was edited.
- **Security fix in Phase 19:** webhook signing secrets were stored in **plain text**; new endpoints now store them encrypted, and delivery reads both forms (old rows keep working until their secret is rotated).
- `integrationService.emit(event, payload)` queues a signed delivery for every active endpoint subscribed to an event.

**Web**: Integrations & API Vault (provider cards with the mode, masked secrets, Configure, Test connection, recent calls), Outbound Webhooks (endpoints with the one-time secret, add endpoint, deliveries with the dead-letter queue and Replay).

## Tests (`tests/phase34.test.ts`, 7 tests, all pass)
Pure: backoff, dead-letter step, masking, sandbox IRN, hex signature. API: vault encryption / masking / audit / private address / test / logs / employee refused; e-invoice disabled message, draft and walk-in refused, IRN filled, one per invoice, 502 ×3 + alert + reset; WhatsApp disabled / bad number / sent / number not logged; inbound good, bad, missing and tampered signatures for WhatsApp and bank; outbound private URL refused, secret encrypted and never listed, signed delivery verified, not-due, 1-3-7-15 minute attempts, dead letter on the 5th, notice, replay twice, delivered, failure count reset, only a dead-letter delivery replays, legacy plain secret works, SSRF at send time. Regression: Phase 19 tests pass.

## Deviations / not done (carry-over)
1. **No live call was ever made** (no GSP / IRP, e-way bill, WhatsApp Cloud, bank or SMTP relay account exists here). `HttpGspIrpClient`'s paths follow the common GSP pattern and **must be checked against the chosen GSP's documentation and sandbox**. E-Way Bill generation, bank statement pulling / UPI reconciliation and payment-link webhooks are **vault entries only** (settings, test, logs); no adapter code beyond IRN and WhatsApp send. `SMTP_RELAY` is stored but the mail service still uses its own SES / SMTP settings.
2. The inbound bank and WhatsApp hooks **store** the message; they do not yet update records (no bank-reconciliation match, no delivery-status update).
3. The invoice screen has no **Generate IRN** button yet (API only); invoices posting do not emit a webhook event automatically yet (only `emit()` exists; no module calls it).
4. Not run: the crawler × 9 roles and three clean full runs, a browser test of the new pages.

## Deploy sheet (owner, by hand — not done by me)
1. Backup the production database. 2. `prisma migrate deploy` (migration `20261220000000_phase34_external_integrations`). No new dependencies. Set `MFA_ENCRYPTION_KEY` in the server environment if it is not set (the vault uses it; in production a missing key falls back to a key derived from the JWT secret).
3. Build API and web, restart, `/health` OK.
4. Smoke: Administration ➜ Integrations ➜ GST IRP ➜ Sandbox ➜ Test connection ➜ open a posted B2B invoice by API `POST /tax/einvoice/<id>/generate-irn`. Outbound Webhooks ➜ add an endpoint to a URL that fails ➜ see the retries and the dead-letter entry ➜ Replay.
5. **Existing webhook endpoints** keep their plain-text secret until it is rotated (`POST /webhooks/endpoints/:id/rotate-secret`); rotate them after deploy.
6. Rollback: additive; every provider is DISABLED by default.
