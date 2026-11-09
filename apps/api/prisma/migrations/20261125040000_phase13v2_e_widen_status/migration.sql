-- Phase 13 v2: the new status words (PENDING_APPROVAL, Pending Approval) are longer than the first columns allowed.
ALTER TABLE "mfg_boms" ALTER COLUMN "status" TYPE varchar(24);
ALTER TABLE "mfg_routings" ALTER COLUMN "status" TYPE varchar(24);
ALTER TABLE "mfg_orders" ALTER COLUMN "status" TYPE varchar(24);
ALTER TABLE "mfg_orders" ALTER COLUMN "material_status" TYPE varchar(24);
ALTER TABLE "mfg_order_ops" ALTER COLUMN "status" TYPE varchar(24);
ALTER TABLE "mfg_production_receipts" ALTER COLUMN "qc_status" TYPE varchar(24);
