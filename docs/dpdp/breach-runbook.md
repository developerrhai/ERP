# Personal Data Breach & Incident Runbook (DPDP Act, 2023 / Rules 2025)

**Note (ERRATA E-30):** Statutory notification timelines and thresholds are marked `needs_review` for confirmation by Company Legal Counsel before 13-May-2027.

## 1. Severity Classification & Immediate Triage (0 – 1 hour)
1. Contain incident: revoke compromised sessions (`POST /api/v1/auth/logout-all` / admin revoke), rotate affected API keys/JWT secrets (`rotation-checklist.md`), isolate EC2/S3 IAM session if credential leak suspected.
2. Preserve immutable evidence: snapshot `audit_logs` partitions, CloudWatch Logs (`/sawant-erp/api`), and Nginx access logs (retained >= 1 year per DPDP Rules).

## 2. Statutory Notification Protocol
1. **Without Delay (Initial Intimation):** Notify Data Protection Board of India and every affected Data Principal in clear, plain English / Hindi / Marathi stating: nature of breach, categories of personal data affected, likely consequences, and contact details of the **Grievance Officer** (`privacy@sawantgroup.example`).
2. **Within 72 Hours (Detailed Report):** Submit full root-cause summary, affected record count, remedial measures implemented, and mitigation guidance to the Data Protection Board.

## 3. Data Processor Register & DPAs
| Processor | Scope | DPA / Compliance Safeguards |
|---|---|---|
| **Amazon Web Services (ap-south-1)** | RDS PostgreSQL, EC2, S3 (`sawant-erp-prod-docs-aps1`), CloudWatch | AWS GDPR/DPDP Addendum, KMS encryption at rest, TLS 1.2+ in transit |
| **Vercel** | Static web frontend hosting | Security headers, HSTS, zero PII stored on edge |
| **Sentry** | Error telemetry | `sendDefaultPii: false` + server-side `scrubSentryEvent` + private source maps |

## 4. Access & Erasure Requests (30-Day SLA)
All Data Principal requests (Access / Correction / Erasure) are logged under **System > Hardening > DPDP Register** (`POST /api/v1/hardening/privacy/requests`), auto-tracked with a 30-day deadline, and backed by the weekly anonymisation sweep (`dpdp.retention.run`).

