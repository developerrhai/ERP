-- Phase 13 / F: an MRP run being applied is claimed, so two applies at once cannot both raise the orders.
ALTER TABLE "mfg_mrp_runs" ADD COLUMN "applying_at" timestamptz(3);
