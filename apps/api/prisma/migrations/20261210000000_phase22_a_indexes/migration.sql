-- Phase 22-A: list indexes for the keyset / filtered lists (STANDARDS "API pagination").
-- Document header tables: (unit_id, <date> DESC, id DESC), (unit_id, status, id DESC), and
-- (unit_id, party, <date> DESC) where the table has a party. Masters: lower(name) text_pattern_ops for
-- prefix search, trigram GIN on name and code for contains search.
-- Prisma runs a migration in one transaction, so these are plain CREATE INDEX IF NOT EXISTS (as in
-- Phase 20-D). For a hot production table, run infra/db/phase22-concurrent-indexes.sql first: it
-- builds the same indexes CONCURRENTLY, and this migration then skips them.
-- The list is the default sorts/filters of the lists; the slow-query log of the first crawler run
-- (page_health.p95_ms) decides any additions in a later migration.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "accounting_event_queue_p22_unit_date_idx" ON "accounting_event_queue" (unit_id, doc_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "accounting_event_queue_p22_unit_status_idx" ON "accounting_event_queue" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "credit_debit_notes_p22_unit_date_idx" ON "credit_debit_notes" (unit_id, doc_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "credit_debit_notes_p22_unit_status_idx" ON "credit_debit_notes" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "credit_debit_notes_p22_unit_party_idx" ON "credit_debit_notes" (unit_id, party_id, doc_date DESC);
CREATE INDEX IF NOT EXISTS "customer_material_docs_p22_unit_date_idx" ON "customer_material_docs" (unit_id, doc_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "customer_material_docs_p22_unit_status_idx" ON "customer_material_docs" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "customer_material_docs_p22_unit_party_idx" ON "customer_material_docs" (unit_id, customer_id, doc_date DESC);
CREATE INDEX IF NOT EXISTS "einvoice_records_p22_unit_date_idx" ON "einvoice_records" (unit_id, doc_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "einvoice_records_p22_unit_status_idx" ON "einvoice_records" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "generic_records_p22_unit_date_idx" ON "generic_records" (unit_id, doc_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "generic_records_p22_unit_status_idx" ON "generic_records" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "journals_p22_unit_date_idx" ON "journals" (unit_id, doc_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "journals_p22_unit_status_idx" ON "journals" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "open_items_p22_unit_date_idx" ON "open_items" (unit_id, doc_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "open_items_p22_unit_status_idx" ON "open_items" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "open_items_p22_unit_party_idx" ON "open_items" (unit_id, party_id, doc_date DESC);
CREATE INDEX IF NOT EXISTS "payments_p22_unit_date_idx" ON "payments" (unit_id, doc_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "payments_p22_unit_status_idx" ON "payments" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "payments_p22_unit_party_idx" ON "payments" (unit_id, party_id, doc_date DESC);
CREATE INDEX IF NOT EXISTS "purchase_invoices_p22_unit_date_idx" ON "purchase_invoices" (unit_id, doc_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "purchase_invoices_p22_unit_status_idx" ON "purchase_invoices" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "purchase_invoices_p22_unit_party_idx" ON "purchase_invoices" (unit_id, supplier_id, doc_date DESC);
CREATE INDEX IF NOT EXISTS "qms_forms_p22_unit_date_idx" ON "qms_forms" (unit_id, doc_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "qms_forms_p22_unit_status_idx" ON "qms_forms" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "qms_forms_p22_unit_party_idx" ON "qms_forms" (unit_id, customer_id, doc_date DESC);
CREATE INDEX IF NOT EXISTS "qms_inspections_p22_unit_date_idx" ON "qms_inspections" (unit_id, doc_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "qms_inspections_p22_unit_status_idx" ON "qms_inspections" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "qms_inspections_p22_unit_party_idx" ON "qms_inspections" (unit_id, customer_id, doc_date DESC);
CREATE INDEX IF NOT EXISTS "stock_vouchers_p22_unit_date_idx" ON "stock_vouchers" (unit_id, posting_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "stock_vouchers_p22_unit_status_idx" ON "stock_vouchers" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "tax_documents_p22_unit_date_idx" ON "tax_documents" (unit_id, doc_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS "tax_documents_p22_unit_status_idx" ON "tax_documents" (unit_id, status, id DESC);
CREATE INDEX IF NOT EXISTS "tax_documents_p22_unit_party_idx" ON "tax_documents" (unit_id, party_id, doc_date DESC);
CREATE INDEX IF NOT EXISTS "items_p22_name_lower_idx" ON "items" (lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS "items_p22_name_trgm_idx" ON "items" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "items_p22_code_trgm_idx" ON "items" USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "customers_p22_name_lower_idx" ON "customers" (lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS "customers_p22_name_trgm_idx" ON "customers" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "customers_p22_code_trgm_idx" ON "customers" USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "suppliers_p22_name_lower_idx" ON "suppliers" (lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS "suppliers_p22_name_trgm_idx" ON "suppliers" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "suppliers_p22_code_trgm_idx" ON "suppliers" USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "warehouses_p22_name_lower_idx" ON "warehouses" (lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS "warehouses_p22_name_trgm_idx" ON "warehouses" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "warehouses_p22_code_trgm_idx" ON "warehouses" USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "accounts_p22_name_lower_idx" ON "accounts" (lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS "accounts_p22_name_trgm_idx" ON "accounts" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "accounts_p22_code_trgm_idx" ON "accounts" USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "price_lists_p22_name_lower_idx" ON "price_lists" (lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS "price_lists_p22_name_trgm_idx" ON "price_lists" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "price_lists_p22_code_trgm_idx" ON "price_lists" USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "projects_p22_name_lower_idx" ON "projects" (lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS "projects_p22_name_trgm_idx" ON "projects" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "projects_p22_code_trgm_idx" ON "projects" USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "banks_p22_name_lower_idx" ON "banks" (lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS "banks_p22_name_trgm_idx" ON "banks" USING gin (name gin_trgm_ops);
