-- Phase 09 / H (code review): a freight / service invoice line that belongs to a GRN's landed cost is linked to
-- that receipt on the line itself (it was matched by amount, which mixed up equal amounts).
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "landed_grn_id" uuid REFERENCES "goods_receipts"("id") ON DELETE RESTRICT;
CREATE INDEX "purchase_invoice_lines_landed_grn_idx" ON "purchase_invoice_lines"("landed_grn_id");

-- One purchase order per awarded comparison (a double click or a retry can no longer create two).
CREATE UNIQUE INDEX "purchase_orders_comparison_uq" ON "purchase_orders"("comparison_id") WHERE "comparison_id" IS NOT NULL AND "deleted_at" IS NULL AND "status" <> 'Cancelled';
