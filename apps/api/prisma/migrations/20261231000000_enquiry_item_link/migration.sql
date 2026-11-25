-- Sales Enquiries: the product is picked from the Item master (QA report 25 Nov 2026), so the register's Product ID has a source.
ALTER TABLE "sales_enquiries" ADD COLUMN IF NOT EXISTS "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "sales_enquiries_item_idx" ON "sales_enquiries"("item_id");
