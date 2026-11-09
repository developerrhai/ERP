-- Phase 11 / B: the supplier's own invoice number (the key GSTR-2B is matched on) next to our internal number.
ALTER TABLE "tax_documents" ADD COLUMN "ref_no" varchar(60);
CREATE INDEX "tax_documents_ref_idx" ON "tax_documents"("gstin","party_gstin","ref_no");
