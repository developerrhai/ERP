-- Phase 14: the GST charged on the sale of an asset is split CGST + SGST (same state) or IGST (other state); the disposal records which.
ALTER TABLE "asset_disposals" ADD COLUMN "gst_intra_state" boolean NOT NULL DEFAULT true;
