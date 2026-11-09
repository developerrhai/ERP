-- Phase 09 / G: the TDS ledger needs a true order. created_at is the transaction START time, so two parallel
-- invoices of one supplier could be stored in the opposite order of their cumulative totals. seq is assigned when
-- the row is inserted, i.e. while the per supplier + year + section advisory lock is held.
ALTER TABLE "supplier_tds_ledger" ADD COLUMN "seq" bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX "supplier_tds_ledger_seq_uq" ON "supplier_tds_ledger"("seq");
CREATE INDEX "supplier_tds_ledger_order_idx" ON "supplier_tds_ledger"("supplier_id","fy_id","section_code","seq");
