-- Phase 13 / D: the work centre's hourly rate is copied onto the order's operation when the order is released, so a later
-- rate change never rewrites the cost of an old order.
ALTER TABLE "mfg_order_ops" ADD COLUMN "cost_per_hour" numeric(18,2) NOT NULL DEFAULT 0;
