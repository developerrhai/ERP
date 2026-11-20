-- A quotation / sales-order line may now override the item master's HSN/SAC. When it does and the typed
-- code differs from the item's own HSN, the line carries a non-blocking warning for the approver to see
-- (owner decision 2026-11-20: pre-fill from master, allow override, warn on divergence — never hard-block).
ALTER TABLE "sales_quotation_lines" ADD COLUMN "hsn_warning" varchar(300);
ALTER TABLE "sales_order_lines" ADD COLUMN "hsn_warning" varchar(300);
