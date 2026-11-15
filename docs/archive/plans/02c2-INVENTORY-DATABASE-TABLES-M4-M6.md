# 02c2 - Inventory and WMS: database design, tables of migrations M4-M6 (section 5.5 continued)

Continues `02c-INVENTORY-DATABASE.md` (sections 5.1-5.4 and the tables of M1-M3). Same conventions; paste in the order shown.

#### 5.5.M4.1 `stock_cost_layers`

```sql
-- stock_cost_layers: FIFO cost layers (one per inflow of a FIFO item). qty_remaining falls as outflows consume the oldest layer first (BR-INV-20).
CREATE TABLE "stock_cost_layers" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "batch_id" uuid,
  "ledger_id" uuid NOT NULL,
  "received_on" date NOT NULL,
  "qty_in" numeric(18,3) NOT NULL,
  "qty_remaining" numeric(18,3) NOT NULL,
  "rate" numeric(18,6) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "stock_cost_layers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_cost_layers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_cost_layers_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_cost_layers_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_cost_layers_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_cost_layers_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "stock_ledger" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_cost_layers_qty_in_check" CHECK (qty_in > 0),
  CONSTRAINT "stock_cost_layers_qty_remaining_check" CHECK (qty_remaining >= 0),
  CONSTRAINT "stock_cost_layers_rate_check" CHECK (rate >= 0),
  CONSTRAINT "stock_cost_layers_remaining" CHECK (qty_remaining <= qty_in)
);
CREATE UNIQUE INDEX "stock_cost_layers_ledger_id_key" ON "stock_cost_layers" ("ledger_id");
CREATE INDEX "stock_cost_layers_item_id_idx" ON "stock_cost_layers" ("item_id");
CREATE INDEX "stock_cost_layers_warehouse_id_idx" ON "stock_cost_layers" ("warehouse_id");
CREATE INDEX "stock_cost_layers_batch_id_idx" ON "stock_cost_layers" ("batch_id");
CREATE INDEX "stock_cost_layers_open" ON "stock_cost_layers" ("item_id", "warehouse_id", "received_on", "created_at") WHERE "qty_remaining" > 0;
```

```prisma
model StockCostLayer {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  itemId                 String     @map("item_id") @db.Uuid
  warehouseId            String     @map("warehouse_id") @db.Uuid
  batchId                String?    @map("batch_id") @db.Uuid
  ledgerId               String     @map("ledger_id") @db.Uuid
  receivedOn             DateTime   @map("received_on") @db.Date
  qtyIn                  Decimal    @map("qty_in") @db.Decimal(18, 3)
  qtyRemaining           Decimal    @map("qty_remaining") @db.Decimal(18, 3)
  rate                   Decimal    @db.Decimal(18, 6)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  @@index([itemId])
  @@index([warehouseId])
  @@index([batchId])
  @@unique([ledgerId])
  @@map("stock_cost_layers")
}
```

#### 5.5.M4.2 `stock_layer_consumptions`

```sql
-- stock_layer_consumptions: Append-only: which layer an outflow ledger row consumed, so a reversal restores the layers exactly.
CREATE TABLE "stock_layer_consumptions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "layer_id" uuid NOT NULL,
  "out_ledger_id" uuid NOT NULL,
  "qty" numeric(18,3) NOT NULL,
  "rate" numeric(18,6) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "stock_layer_consumptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_layer_consumptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_layer_consumptions_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "stock_cost_layers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_layer_consumptions_out_ledger_id_fkey" FOREIGN KEY ("out_ledger_id") REFERENCES "stock_ledger" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_layer_consumptions_qty_check" CHECK (qty > 0),
  CONSTRAINT "stock_layer_consumptions_rate_check" CHECK (rate >= 0)
);
CREATE INDEX "stock_layer_consumptions_layer_id_idx" ON "stock_layer_consumptions" ("layer_id");
CREATE INDEX "stock_layer_consumptions_out_ledger_id_idx" ON "stock_layer_consumptions" ("out_ledger_id");
SELECT inv_make_append_only('stock_layer_consumptions');
```

```prisma
model StockLayerConsumption {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  layerId                String     @map("layer_id") @db.Uuid
  outLedgerId            String     @map("out_ledger_id") @db.Uuid
  qty                    Decimal    @db.Decimal(18, 3)
  rate                   Decimal    @db.Decimal(18, 6)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  @@index([layerId])
  @@index([outLedgerId])
  @@map("stock_layer_consumptions")
}
```

#### 5.5.M4.3 `stock_revaluations`

```sql
-- stock_revaluations: Inventory revaluation document (inv-valuation tab Revaluation): rate change, standard cost change, NRV write-down / reversal, landed cost. Posts a REVALUATION ledger row of quantity 0.
CREATE TABLE "stock_revaluations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "code" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "fy_id" uuid NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT 'Warehouse',
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "kind" varchar(12) NOT NULL,
  "method_at_post" varchar(12),
  "qty_at_post" numeric(18,3),
  "old_value" numeric(18,2),
  "new_value" numeric(18,2),
  "delta_value" numeric(18,2),
  "old_rate" numeric(18,6),
  "new_rate" numeric(18,6),
  "reason" varchar(200) NOT NULL,
  "ref" varchar(60),
  "status" varchar(10) NOT NULL DEFAULT 'Draft',
  "posted_at" timestamptz(3),
  "posted_by_id" uuid,
  "ledger_id" uuid,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "stock_revaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_revaluations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_revaluations_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_revaluations_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_revaluations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_revaluations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_revaluations_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_revaluations_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "stock_ledger" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_revaluations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_revaluations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_revaluations_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_revaluations_kind_check" CHECK (kind IN ('RATE','STANDARD','NRV','NRV_REVERSAL','LANDED')),
  CONSTRAINT "stock_revaluations_new_rate_check" CHECK (new_rate >= 0),
  CONSTRAINT "stock_revaluations_status_check" CHECK (status IN ('Draft','Posted','Cancelled'))
);
CREATE UNIQUE INDEX "stock_revaluations_code_key" ON "stock_revaluations" ("code");
CREATE INDEX "stock_revaluations_item_id_warehouse_id_idx" ON "stock_revaluations" ("item_id", "warehouse_id");
CREATE INDEX "stock_revaluations_unit_id_idx" ON "stock_revaluations" ("unit_id");
CREATE INDEX "stock_revaluations_fy_id_idx" ON "stock_revaluations" ("fy_id");
CREATE INDEX "stock_revaluations_warehouse_id_idx" ON "stock_revaluations" ("warehouse_id");
CREATE INDEX "stock_revaluations_ledger_id_idx" ON "stock_revaluations" ("ledger_id");
```

```prisma
model StockRevaluation {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String     @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(60)
  docDate                DateTime   @map("doc_date") @db.Date
  fyId                   String     @map("fy_id") @db.Uuid
  department             String     @default("Warehouse") @db.VarChar(60)
  itemId                 String     @map("item_id") @db.Uuid
  warehouseId            String     @map("warehouse_id") @db.Uuid
  kind                   String     @db.VarChar(12)
  methodAtPost           String?    @map("method_at_post") @db.VarChar(12)
  qtyAtPost              Decimal?   @map("qty_at_post") @db.Decimal(18, 3)
  oldValue               Decimal?   @map("old_value") @db.Decimal(18, 2)
  newValue               Decimal?   @map("new_value") @db.Decimal(18, 2)
  deltaValue             Decimal?   @map("delta_value") @db.Decimal(18, 2)
  oldRate                Decimal?   @map("old_rate") @db.Decimal(18, 6)
  newRate                Decimal?   @map("new_rate") @db.Decimal(18, 6)
  reason                 String     @db.VarChar(200)
  ref                    String?    @db.VarChar(60)
  status                 String     @default("Draft") @db.VarChar(10)
  postedAt               DateTime?  @map("posted_at") @db.Timestamptz(3)
  postedById             String?    @map("posted_by_id") @db.Uuid
  ledgerId               String?    @map("ledger_id") @db.Uuid
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([itemId, warehouseId])
  @@index([unitId])
  @@index([fyId])
  @@index([warehouseId])
  @@index([ledgerId])
  @@unique([code])
  @@map("stock_revaluations")
}
```

#### 5.5.M4.4 `stock_reconciliations`

```sql
-- stock_reconciliations: Stock reconciliation line (inv-reconciliation): one item x warehouse x batch, created by a count or by hand, approved, then posted as a RECONCILIATION ledger row.
CREATE TABLE "stock_reconciliations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "code" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "fy_id" uuid NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT 'Warehouse',
  "count_type" varchar(8) NOT NULL DEFAULT 'Manual',
  "count_id" uuid,
  "count_ref" varchar(60),
  "warehouse_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "bin_id" uuid,
  "system_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "physical_qty" numeric(18,3) NOT NULL,
  "variance_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "unit_cost" numeric(18,6),
  "value_variance" numeric(18,2) NOT NULL DEFAULT 0,
  "root_cause_code" varchar(24),
  "root_cause" varchar(300),
  "status" varchar(12) NOT NULL DEFAULT 'Draft',
  "serial_nos" jsonb,
  "approved_by_id" uuid,
  "approved_at" timestamptz(3),
  "posting_ref" varchar(60),
  "posted_at" timestamptz(3),
  "posted_by_id" uuid,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "stock_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_reconciliations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reconciliations_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reconciliations_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reconciliations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reconciliations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reconciliations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reconciliations_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "wms_bins" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reconciliations_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_reconciliations_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_reconciliations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reconciliations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_reconciliations_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_reconciliations_count_type_check" CHECK (count_type IN ('Manual','Cycle','Physical')),
  CONSTRAINT "stock_reconciliations_physical_qty_check" CHECK (physical_qty >= 0),
  CONSTRAINT "stock_reconciliations_unit_cost_check" CHECK (unit_cost >= 0),
  CONSTRAINT "stock_reconciliations_root_cause_code_check" CHECK (root_cause_code IN ('Counting Error','Unrecorded Issue','Unrecorded Receipt','Wrong Location','Damage','Theft','Unit Conversion','System Error')),
  CONSTRAINT "stock_reconciliations_status_check" CHECK (status IN ('Draft','Under Review','Approved','Posted','Rejected','Cancelled'))
);
CREATE UNIQUE INDEX "stock_reconciliations_code_key" ON "stock_reconciliations" ("code");
CREATE INDEX "stock_reconciliations_warehouse_id_item_id_idx" ON "stock_reconciliations" ("warehouse_id", "item_id");
CREATE INDEX "stock_reconciliations_count_type_count_id_idx" ON "stock_reconciliations" ("count_type", "count_id");
CREATE INDEX "stock_reconciliations_status_idx" ON "stock_reconciliations" ("status");
CREATE INDEX "stock_reconciliations_unit_id_idx" ON "stock_reconciliations" ("unit_id");
CREATE INDEX "stock_reconciliations_fy_id_idx" ON "stock_reconciliations" ("fy_id");
CREATE INDEX "stock_reconciliations_item_id_idx" ON "stock_reconciliations" ("item_id");
CREATE INDEX "stock_reconciliations_batch_id_idx" ON "stock_reconciliations" ("batch_id");
CREATE INDEX "stock_reconciliations_bin_id_idx" ON "stock_reconciliations" ("bin_id");
```

```prisma
model StockReconciliation {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String     @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(60)
  docDate                DateTime   @map("doc_date") @db.Date
  fyId                   String     @map("fy_id") @db.Uuid
  department             String     @default("Warehouse") @db.VarChar(60)
  countType              String     @default("Manual") @map("count_type") @db.VarChar(8)
  countId                String?    @map("count_id") @db.Uuid
  countRef               String?    @map("count_ref") @db.VarChar(60)
  warehouseId            String     @map("warehouse_id") @db.Uuid
  itemId                 String     @map("item_id") @db.Uuid
  batchId                String?    @map("batch_id") @db.Uuid
  binId                  String?    @map("bin_id") @db.Uuid
  systemQty              Decimal    @default(0) @map("system_qty") @db.Decimal(18, 3)
  physicalQty            Decimal    @map("physical_qty") @db.Decimal(18, 3)
  varianceQty            Decimal    @default(0) @map("variance_qty") @db.Decimal(18, 3)
  unitCost               Decimal?   @map("unit_cost") @db.Decimal(18, 6)
  valueVariance          Decimal    @default(0) @map("value_variance") @db.Decimal(18, 2)
  rootCauseCode          String?    @map("root_cause_code") @db.VarChar(24)
  rootCause              String?    @map("root_cause") @db.VarChar(300)
  status                 String     @default("Draft") @db.VarChar(12)
  serialNos              Json?      @map("serial_nos")
  approvedById           String?    @map("approved_by_id") @db.Uuid
  approvedAt             DateTime?  @map("approved_at") @db.Timestamptz(3)
  postingRef             String?    @map("posting_ref") @db.VarChar(60)
  postedAt               DateTime?  @map("posted_at") @db.Timestamptz(3)
  postedById             String?    @map("posted_by_id") @db.Uuid
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([warehouseId, itemId])
  @@index([countType, countId])
  @@index([status])
  @@index([unitId])
  @@index([fyId])
  @@index([itemId])
  @@index([batchId])
  @@index([binId])
  @@unique([code])
  @@map("stock_reconciliations")
}
```

#### 5.5.M4.5 `valuation_runs`

```sql
-- valuation_runs: A stock valuation run (header of the lines shown on inv-valuation).
CREATE TABLE "valuation_runs" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "code" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "fy_id" uuid NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT 'Warehouse',
  "from_date" date NOT NULL,
  "to_date" date NOT NULL,
  "warehouse_id" uuid,
  "status" varchar(8) NOT NULL DEFAULT 'Draft',
  "total_closing_value" numeric(18,2) NOT NULL DEFAULT 0,
  "gl_balance" numeric(18,2),
  "finalized_at" timestamptz(3),
  "finalized_by_id" uuid,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "valuation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "valuation_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "valuation_runs_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "valuation_runs_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "valuation_runs_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "valuation_runs_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "valuation_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "valuation_runs_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "valuation_runs_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "valuation_runs_status_check" CHECK (status IN ('Draft','Final')),
  CONSTRAINT "valuation_runs_dates" CHECK (to_date >= from_date)
);
CREATE UNIQUE INDEX "valuation_runs_code_key" ON "valuation_runs" ("code");
CREATE INDEX "valuation_runs_unit_id_idx" ON "valuation_runs" ("unit_id");
CREATE INDEX "valuation_runs_fy_id_idx" ON "valuation_runs" ("fy_id");
CREATE INDEX "valuation_runs_warehouse_id_idx" ON "valuation_runs" ("warehouse_id");
```

```prisma
model ValuationRun {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String     @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(60)
  docDate                DateTime   @map("doc_date") @db.Date
  fyId                   String     @map("fy_id") @db.Uuid
  department             String     @default("Warehouse") @db.VarChar(60)
  fromDate               DateTime   @map("from_date") @db.Date
  toDate                 DateTime   @map("to_date") @db.Date
  warehouseId            String?    @map("warehouse_id") @db.Uuid
  status                 String     @default("Draft") @db.VarChar(8)
  totalClosingValue      Decimal    @default(0) @map("total_closing_value") @db.Decimal(18, 2)
  glBalance              Decimal?   @map("gl_balance") @db.Decimal(18, 2)
  finalizedAt            DateTime?  @map("finalized_at") @db.Timestamptz(3)
  finalizedById          String?    @map("finalized_by_id") @db.Uuid
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([unitId])
  @@index([fyId])
  @@index([warehouseId])
  @@unique([code])
  @@map("valuation_runs")
}
```

#### 5.5.M4.6 `valuation_lines`

```sql
-- valuation_lines: One line (item x warehouse) of a valuation run. The identity closing = opening + receipt - issue + adjustment is a CHECK.
CREATE TABLE "valuation_lines" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "code" varchar(70) NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "method" varchar(12) NOT NULL,
  "opening_value" numeric(18,2) NOT NULL DEFAULT 0,
  "receipt_value" numeric(18,2) NOT NULL DEFAULT 0,
  "issue_value" numeric(18,2) NOT NULL DEFAULT 0,
  "adjustment_value" numeric(18,2) NOT NULL DEFAULT 0,
  "closing_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "closing_value" numeric(18,2) NOT NULL DEFAULT 0,
  "gl_balance" numeric(18,2),
  "variance" numeric(18,2),
  CONSTRAINT "valuation_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "valuation_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "valuation_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "valuation_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "valuation_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "valuation_lines_line_no_check" CHECK (line_no >= 1),
  CONSTRAINT "valuation_lines_method_check" CHECK (method IN ('MOVING_AVG','FIFO','STANDARD')),
  CONSTRAINT "valuation_lines_identity" CHECK (closing_value = opening_value + receipt_value - issue_value + adjustment_value)
);
CREATE UNIQUE INDEX "valuation_lines_run_id_line_no_key" ON "valuation_lines" ("run_id", "line_no");
CREATE UNIQUE INDEX "valuation_lines_code_key" ON "valuation_lines" ("code");
CREATE INDEX "valuation_lines_item_id_warehouse_id_idx" ON "valuation_lines" ("item_id", "warehouse_id");
CREATE INDEX "valuation_lines_warehouse_id_idx" ON "valuation_lines" ("warehouse_id");
```

```prisma
model ValuationLine {
  id                     String     @id @default(uuid()) @db.Uuid
  runId                  String     @map("run_id") @db.Uuid
  lineNo                 Int        @map("line_no")
  code                   String     @db.VarChar(70)
  warehouseId            String     @map("warehouse_id") @db.Uuid
  itemId                 String     @map("item_id") @db.Uuid
  method                 String     @db.VarChar(12)
  openingValue           Decimal    @default(0) @map("opening_value") @db.Decimal(18, 2)
  receiptValue           Decimal    @default(0) @map("receipt_value") @db.Decimal(18, 2)
  issueValue             Decimal    @default(0) @map("issue_value") @db.Decimal(18, 2)
  adjustmentValue        Decimal    @default(0) @map("adjustment_value") @db.Decimal(18, 2)
  closingQty             Decimal    @default(0) @map("closing_qty") @db.Decimal(18, 3)
  closingValue           Decimal    @default(0) @map("closing_value") @db.Decimal(18, 2)
  glBalance              Decimal?   @map("gl_balance") @db.Decimal(18, 2)
  variance               Decimal?   @db.Decimal(18, 2)
  @@index([itemId, warehouseId])
  @@index([warehouseId])
  @@unique([runId, lineNo])
  @@unique([code])
  @@map("valuation_lines")
}
```

#### 5.5.M4.7 `item_classifications`

```sql
-- item_classifications: ABC / XYZ class per item (company-wide, warehouse_id NULL) or per item x warehouse, plus the editable ageing action note.
CREATE TABLE "item_classifications" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid,
  "abc" char(1),
  "xyz" char(1),
  "annual_value" numeric(18,2),
  "cv" numeric(9,4),
  "action_note" text,
  "computed_on" date,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "item_classifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "item_classifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "item_classifications_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "item_classifications_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "item_classifications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "item_classifications_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "item_classifications_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "item_classifications_abc_check" CHECK (abc IN ('A','B','C')),
  CONSTRAINT "item_classifications_xyz_check" CHECK (xyz IN ('X','Y','Z'))
);
CREATE INDEX "item_classifications_item_id_idx" ON "item_classifications" ("item_id");
CREATE INDEX "item_classifications_warehouse_id_idx" ON "item_classifications" ("warehouse_id");
CREATE UNIQUE INDEX "item_classifications_unique" ON "item_classifications" ("item_id", COALESCE("warehouse_id", '00000000-0000-0000-0000-000000000000'::uuid));
```

```prisma
model ItemClassification {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  itemId                 String     @map("item_id") @db.Uuid
  warehouseId            String?    @map("warehouse_id") @db.Uuid
  abc                    String?    @db.Char(1)
  xyz                    String?    @db.Char(1)
  annualValue            Decimal?   @map("annual_value") @db.Decimal(18, 2)
  cv                     Decimal?   @db.Decimal(9, 4)
  actionNote             String?    @map("action_note")
  computedOn             DateTime?  @map("computed_on") @db.Date
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([itemId])
  @@index([warehouseId])
  @@map("item_classifications")
}
```


#### 5.5.M5.1 `putaway_rules`

```sql
-- putaway_rules: Putaway rule: the first matching active rule by priority decides the candidate bins (BR-INV-52).
CREATE TABLE "putaway_rules" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "priority" integer NOT NULL,
  "name" varchar(100) NOT NULL,
  "item_id" uuid,
  "item_category" varchar(100),
  "item_type" varchar(30),
  "storage_class" varchar(12),
  "zone_id" uuid,
  "fixed_bin_id" uuid,
  "target_bin_type" varchar(12),
  "max_qty_per_bin" numeric(18,3),
  "allow_mix_items" boolean NOT NULL DEFAULT true,
  "allow_mix_batches" boolean NOT NULL DEFAULT true,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "putaway_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "putaway_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_rules_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_rules_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_rules_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_rules_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "wms_zones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_rules_fixed_bin_id_fkey" FOREIGN KEY ("fixed_bin_id") REFERENCES "wms_bins" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "putaway_rules_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "putaway_rules_priority_check" CHECK (priority >= 1),
  CONSTRAINT "putaway_rules_storage_class_check" CHECK (storage_class IN ('General','Cold Chain','Hazardous','Bulk','High Value')),
  CONSTRAINT "putaway_rules_target_bin_type_check" CHECK (target_bin_type IN ('Standard','Pallet','Floor','Pick Face','Bulk')),
  CONSTRAINT "putaway_rules_max_qty_per_bin_check" CHECK (max_qty_per_bin > 0)
);
CREATE INDEX "putaway_rules_warehouse_id_priority_idx" ON "putaway_rules" ("warehouse_id", "priority");
CREATE INDEX "putaway_rules_unit_id_idx" ON "putaway_rules" ("unit_id");
CREATE INDEX "putaway_rules_item_id_idx" ON "putaway_rules" ("item_id");
CREATE INDEX "putaway_rules_zone_id_idx" ON "putaway_rules" ("zone_id");
CREATE INDEX "putaway_rules_fixed_bin_id_idx" ON "putaway_rules" ("fixed_bin_id");
```

```prisma
model PutawayRule {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String     @map("unit_id") @db.Uuid
  warehouseId            String     @map("warehouse_id") @db.Uuid
  priority               Int
  name                   String     @db.VarChar(100)
  itemId                 String?    @map("item_id") @db.Uuid
  itemCategory           String?    @map("item_category") @db.VarChar(100)
  itemType               String?    @map("item_type") @db.VarChar(30)
  storageClass           String?    @map("storage_class") @db.VarChar(12)
  zoneId                 String?    @map("zone_id") @db.Uuid
  fixedBinId             String?    @map("fixed_bin_id") @db.Uuid
  targetBinType          String?    @map("target_bin_type") @db.VarChar(12)
  maxQtyPerBin           Decimal?   @map("max_qty_per_bin") @db.Decimal(18, 3)
  allowMixItems          Boolean    @default(true) @map("allow_mix_items")
  allowMixBatches        Boolean    @default(true) @map("allow_mix_batches")
  active                 Boolean    @default(true)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([warehouseId, priority])
  @@index([unitId])
  @@index([itemId])
  @@index([zoneId])
  @@index([fixedBinId])
  @@map("putaway_rules")
}
```

#### 5.5.M5.2 `putaway_tasks`

```sql
-- putaway_tasks: Putaway (and replenishment) task (wms-putaway).
CREATE TABLE "putaway_tasks" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "code" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "fy_id" uuid NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT 'Warehouse',
  "warehouse_id" uuid NOT NULL,
  "task_type" varchar(12) NOT NULL DEFAULT 'Putaway',
  "source_ref" varchar(60),
  "source_ledger_id" uuid,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "qty" numeric(18,3) NOT NULL,
  "done_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "source_dock" varchar(30),
  "from_bin_id" uuid,
  "suggested_bin_id" uuid,
  "suggested_rule_id" uuid,
  "chosen_bin_id" uuid,
  "operator_id" uuid,
  "priority" varchar(6) NOT NULL DEFAULT 'Medium',
  "status" varchar(12) NOT NULL DEFAULT 'Pending',
  "exception_text" varchar(200),
  "started_at" timestamptz(3),
  "completed_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "putaway_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "putaway_tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_source_ledger_id_fkey" FOREIGN KEY ("source_ledger_id") REFERENCES "stock_ledger" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_from_bin_id_fkey" FOREIGN KEY ("from_bin_id") REFERENCES "wms_bins" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_suggested_bin_id_fkey" FOREIGN KEY ("suggested_bin_id") REFERENCES "wms_bins" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_suggested_rule_id_fkey" FOREIGN KEY ("suggested_rule_id") REFERENCES "putaway_rules" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_chosen_bin_id_fkey" FOREIGN KEY ("chosen_bin_id") REFERENCES "wms_bins" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "putaway_tasks_task_type_check" CHECK (task_type IN ('Putaway','Replenishment')),
  CONSTRAINT "putaway_tasks_qty_check" CHECK (qty > 0),
  CONSTRAINT "putaway_tasks_done_qty_check" CHECK (done_qty >= 0),
  CONSTRAINT "putaway_tasks_priority_check" CHECK (priority IN ('High','Medium','Low')),
  CONSTRAINT "putaway_tasks_status_check" CHECK (status IN ('Pending','Assigned','In Progress','Completed','Exception','Cancelled')),
  CONSTRAINT "putaway_tasks_done" CHECK (done_qty <= qty)
);
CREATE UNIQUE INDEX "putaway_tasks_code_key" ON "putaway_tasks" ("code");
CREATE INDEX "putaway_tasks_warehouse_id_status_idx" ON "putaway_tasks" ("warehouse_id", "status");
CREATE INDEX "putaway_tasks_operator_id_idx" ON "putaway_tasks" ("operator_id");
CREATE INDEX "putaway_tasks_unit_id_idx" ON "putaway_tasks" ("unit_id");
CREATE INDEX "putaway_tasks_fy_id_idx" ON "putaway_tasks" ("fy_id");
CREATE INDEX "putaway_tasks_source_ledger_id_idx" ON "putaway_tasks" ("source_ledger_id");
CREATE INDEX "putaway_tasks_item_id_idx" ON "putaway_tasks" ("item_id");
CREATE INDEX "putaway_tasks_batch_id_idx" ON "putaway_tasks" ("batch_id");
CREATE INDEX "putaway_tasks_from_bin_id_idx" ON "putaway_tasks" ("from_bin_id");
CREATE INDEX "putaway_tasks_suggested_bin_id_idx" ON "putaway_tasks" ("suggested_bin_id");
CREATE INDEX "putaway_tasks_suggested_rule_id_idx" ON "putaway_tasks" ("suggested_rule_id");
CREATE INDEX "putaway_tasks_chosen_bin_id_idx" ON "putaway_tasks" ("chosen_bin_id");
```

```prisma
model PutawayTask {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String     @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(60)
  docDate                DateTime   @map("doc_date") @db.Date
  fyId                   String     @map("fy_id") @db.Uuid
  department             String     @default("Warehouse") @db.VarChar(60)
  warehouseId            String     @map("warehouse_id") @db.Uuid
  taskType               String     @default("Putaway") @map("task_type") @db.VarChar(12)
  sourceRef              String?    @map("source_ref") @db.VarChar(60)
  sourceLedgerId         String?    @map("source_ledger_id") @db.Uuid
  itemId                 String     @map("item_id") @db.Uuid
  batchId                String?    @map("batch_id") @db.Uuid
  qty                    Decimal    @db.Decimal(18, 3)
  doneQty                Decimal    @default(0) @map("done_qty") @db.Decimal(18, 3)
  sourceDock             String?    @map("source_dock") @db.VarChar(30)
  fromBinId              String?    @map("from_bin_id") @db.Uuid
  suggestedBinId         String?    @map("suggested_bin_id") @db.Uuid
  suggestedRuleId        String?    @map("suggested_rule_id") @db.Uuid
  chosenBinId            String?    @map("chosen_bin_id") @db.Uuid
  operatorId             String?    @map("operator_id") @db.Uuid
  priority               String     @default("Medium") @db.VarChar(6)
  status                 String     @default("Pending") @db.VarChar(12)
  exceptionText          String?    @map("exception_text") @db.VarChar(200)
  startedAt              DateTime?  @map("started_at") @db.Timestamptz(3)
  completedAt            DateTime?  @map("completed_at") @db.Timestamptz(3)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([warehouseId, status])
  @@index([operatorId])
  @@index([unitId])
  @@index([fyId])
  @@index([sourceLedgerId])
  @@index([itemId])
  @@index([batchId])
  @@index([fromBinId])
  @@index([suggestedBinId])
  @@index([suggestedRuleId])
  @@index([chosenBinId])
  @@unique([code])
  @@map("putaway_tasks")
}
```

#### 5.5.M5.3 `pick_waves`

```sql
-- pick_waves: Pick wave: a batch of pick tasks released together.
CREATE TABLE "pick_waves" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "code" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "fy_id" uuid NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT 'Warehouse',
  "warehouse_id" uuid NOT NULL,
  "strategy" varchar(4) NOT NULL DEFAULT 'FEFO',
  "status" varchar(12) NOT NULL DEFAULT 'Open',
  "released_at" timestamptz(3),
  "closed_at" timestamptz(3),
  "note" varchar(300),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "pick_waves_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pick_waves_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_waves_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_waves_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_waves_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_waves_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_waves_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pick_waves_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pick_waves_strategy_check" CHECK (strategy IN ('FEFO','FIFO')),
  CONSTRAINT "pick_waves_status_check" CHECK (status IN ('Open','Released','In Progress','Completed','Cancelled'))
);
CREATE UNIQUE INDEX "pick_waves_code_key" ON "pick_waves" ("code");
CREATE INDEX "pick_waves_unit_id_idx" ON "pick_waves" ("unit_id");
CREATE INDEX "pick_waves_fy_id_idx" ON "pick_waves" ("fy_id");
CREATE INDEX "pick_waves_warehouse_id_idx" ON "pick_waves" ("warehouse_id");
```

```prisma
model PickWave {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String     @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(60)
  docDate                DateTime   @map("doc_date") @db.Date
  fyId                   String     @map("fy_id") @db.Uuid
  department             String     @default("Warehouse") @db.VarChar(60)
  warehouseId            String     @map("warehouse_id") @db.Uuid
  strategy               String     @default("FEFO") @db.VarChar(4)
  status                 String     @default("Open") @db.VarChar(12)
  releasedAt             DateTime?  @map("released_at") @db.Timestamptz(3)
  closedAt               DateTime?  @map("closed_at") @db.Timestamptz(3)
  note                   String?    @db.VarChar(300)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([unitId])
  @@index([fyId])
  @@index([warehouseId])
  @@unique([code])
  @@map("pick_waves")
}
```

#### 5.5.M5.4 `pick_tasks`

```sql
-- pick_tasks: Pick task (wms-pick): one allocation of a reservation from one bin / batch.
CREATE TABLE "pick_tasks" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "code" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "fy_id" uuid NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT 'Warehouse',
  "wave_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "reservation_id" uuid,
  "demand_ref" varchar(60),
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "serial_nos" jsonb,
  "from_bin_id" uuid,
  "to_bin_id" uuid,
  "required_qty" numeric(18,3) NOT NULL,
  "picked_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "short_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "picker_id" uuid,
  "route_seq" integer,
  "status" varchar(12) NOT NULL DEFAULT 'Open',
  "short_reason" varchar(120),
  "started_at" timestamptz(3),
  "completed_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "pick_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pick_tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_wave_id_fkey" FOREIGN KEY ("wave_id") REFERENCES "pick_waves" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "stock_reservations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_from_bin_id_fkey" FOREIGN KEY ("from_bin_id") REFERENCES "wms_bins" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_to_bin_id_fkey" FOREIGN KEY ("to_bin_id") REFERENCES "wms_bins" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_picker_id_fkey" FOREIGN KEY ("picker_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pick_tasks_required_qty_check" CHECK (required_qty > 0),
  CONSTRAINT "pick_tasks_picked_qty_check" CHECK (picked_qty >= 0),
  CONSTRAINT "pick_tasks_short_qty_check" CHECK (short_qty >= 0),
  CONSTRAINT "pick_tasks_status_check" CHECK (status IN ('Open','Released','In Progress','Picked','Short Picked','Cancelled')),
  CONSTRAINT "pick_tasks_qty" CHECK (picked_qty + short_qty <= required_qty)
);
CREATE UNIQUE INDEX "pick_tasks_code_key" ON "pick_tasks" ("code");
CREATE INDEX "pick_tasks_wave_id_route_seq_idx" ON "pick_tasks" ("wave_id", "route_seq");
CREATE INDEX "pick_tasks_picker_id_status_idx" ON "pick_tasks" ("picker_id", "status");
CREATE INDEX "pick_tasks_reservation_id_idx" ON "pick_tasks" ("reservation_id");
CREATE INDEX "pick_tasks_unit_id_idx" ON "pick_tasks" ("unit_id");
CREATE INDEX "pick_tasks_fy_id_idx" ON "pick_tasks" ("fy_id");
CREATE INDEX "pick_tasks_warehouse_id_idx" ON "pick_tasks" ("warehouse_id");
CREATE INDEX "pick_tasks_item_id_idx" ON "pick_tasks" ("item_id");
CREATE INDEX "pick_tasks_batch_id_idx" ON "pick_tasks" ("batch_id");
CREATE INDEX "pick_tasks_from_bin_id_idx" ON "pick_tasks" ("from_bin_id");
CREATE INDEX "pick_tasks_to_bin_id_idx" ON "pick_tasks" ("to_bin_id");
```

```prisma
model PickTask {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String     @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(60)
  docDate                DateTime   @map("doc_date") @db.Date
  fyId                   String     @map("fy_id") @db.Uuid
  department             String     @default("Warehouse") @db.VarChar(60)
  waveId                 String     @map("wave_id") @db.Uuid
  warehouseId            String     @map("warehouse_id") @db.Uuid
  reservationId          String?    @map("reservation_id") @db.Uuid
  demandRef              String?    @map("demand_ref") @db.VarChar(60)
  itemId                 String     @map("item_id") @db.Uuid
  batchId                String?    @map("batch_id") @db.Uuid
  serialNos              Json?      @map("serial_nos")
  fromBinId              String?    @map("from_bin_id") @db.Uuid
  toBinId                String?    @map("to_bin_id") @db.Uuid
  requiredQty            Decimal    @map("required_qty") @db.Decimal(18, 3)
  pickedQty              Decimal    @default(0) @map("picked_qty") @db.Decimal(18, 3)
  shortQty               Decimal    @default(0) @map("short_qty") @db.Decimal(18, 3)
  pickerId               String?    @map("picker_id") @db.Uuid
  routeSeq               Int?       @map("route_seq")
  status                 String     @default("Open") @db.VarChar(12)
  shortReason            String?    @map("short_reason") @db.VarChar(120)
  startedAt              DateTime?  @map("started_at") @db.Timestamptz(3)
  completedAt            DateTime?  @map("completed_at") @db.Timestamptz(3)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([waveId, routeSeq])
  @@index([pickerId, status])
  @@index([reservationId])
  @@index([unitId])
  @@index([fyId])
  @@index([warehouseId])
  @@index([itemId])
  @@index([batchId])
  @@index([fromBinId])
  @@index([toBinId])
  @@unique([code])
  @@map("pick_tasks")
}
```

#### 5.5.M5.5 `pack_orders`

```sql
-- pack_orders: Pack order (wms-packing).
CREATE TABLE "pack_orders" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "code" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "fy_id" uuid NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT 'Warehouse',
  "warehouse_id" uuid NOT NULL,
  "wave_id" uuid,
  "demand_ref" varchar(60),
  "customer_name" varchar(150) NOT NULL,
  "status" varchar(18) NOT NULL DEFAULT 'Open',
  "label_status" varchar(16) NOT NULL DEFAULT 'Not Printed',
  "packer_id" uuid,
  "qc_check" boolean NOT NULL DEFAULT false,
  "dispatch_ready" boolean NOT NULL DEFAULT false,
  "expected_net_kg" numeric(12,3),
  "measured_net_kg" numeric(12,3),
  "delivery_ref" varchar(60),
  "dispatched_at" timestamptz(3),
  "dispatch_voucher_no" varchar(60),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "pack_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pack_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pack_orders_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pack_orders_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pack_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pack_orders_wave_id_fkey" FOREIGN KEY ("wave_id") REFERENCES "pick_waves" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pack_orders_packer_id_fkey" FOREIGN KEY ("packer_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pack_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pack_orders_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pack_orders_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pack_orders_status_check" CHECK (status IN ('Open','Packing','Packed','Ready to Dispatch','Dispatched','Cancelled')),
  CONSTRAINT "pack_orders_label_status_check" CHECK (label_status IN ('Not Printed','Printed','Reprint Needed'))
);
CREATE UNIQUE INDEX "pack_orders_code_key" ON "pack_orders" ("code");
CREATE INDEX "pack_orders_warehouse_id_status_idx" ON "pack_orders" ("warehouse_id", "status");
CREATE INDEX "pack_orders_unit_id_idx" ON "pack_orders" ("unit_id");
CREATE INDEX "pack_orders_fy_id_idx" ON "pack_orders" ("fy_id");
CREATE INDEX "pack_orders_wave_id_idx" ON "pack_orders" ("wave_id");
CREATE INDEX "pack_orders_packer_id_idx" ON "pack_orders" ("packer_id");
```

```prisma
model PackOrder {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String     @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(60)
  docDate                DateTime   @map("doc_date") @db.Date
  fyId                   String     @map("fy_id") @db.Uuid
  department             String     @default("Warehouse") @db.VarChar(60)
  warehouseId            String     @map("warehouse_id") @db.Uuid
  waveId                 String?    @map("wave_id") @db.Uuid
  demandRef              String?    @map("demand_ref") @db.VarChar(60)
  customerName           String     @map("customer_name") @db.VarChar(150)
  status                 String     @default("Open") @db.VarChar(18)
  labelStatus            String     @default("Not Printed") @map("label_status") @db.VarChar(16)
  packerId               String?    @map("packer_id") @db.Uuid
  qcCheck                Boolean    @default(false) @map("qc_check")
  dispatchReady          Boolean    @default(false) @map("dispatch_ready")
  expectedNetKg          Decimal?   @map("expected_net_kg") @db.Decimal(12, 3)
  measuredNetKg          Decimal?   @map("measured_net_kg") @db.Decimal(12, 3)
  deliveryRef            String?    @map("delivery_ref") @db.VarChar(60)
  dispatchedAt           DateTime?  @map("dispatched_at") @db.Timestamptz(3)
  dispatchVoucherNo      String?    @map("dispatch_voucher_no") @db.VarChar(60)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([warehouseId, status])
  @@index([unitId])
  @@index([fyId])
  @@index([waveId])
  @@index([packerId])
  @@unique([code])
  @@map("pack_orders")
}
```

#### 5.5.M5.6 `pack_cartons`

```sql
-- pack_cartons: Carton of a pack order; volumetric weight = L x W x H / divisor (BR-INV-56).
CREATE TABLE "pack_cartons" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "pack_id" uuid NOT NULL,
  "carton_no" integer NOT NULL,
  "length_cm" numeric(9,2),
  "width_cm" numeric(9,2),
  "height_cm" numeric(9,2),
  "gross_weight_kg" numeric(12,3),
  "label_code" varchar(80),
  CONSTRAINT "pack_cartons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pack_cartons_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "pack_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pack_cartons_carton_no_check" CHECK (carton_no >= 1),
  CONSTRAINT "pack_cartons_length_cm_check" CHECK (length_cm > 0),
  CONSTRAINT "pack_cartons_width_cm_check" CHECK (width_cm > 0),
  CONSTRAINT "pack_cartons_height_cm_check" CHECK (height_cm > 0),
  CONSTRAINT "pack_cartons_gross_weight_kg_check" CHECK (gross_weight_kg >= 0)
);
CREATE UNIQUE INDEX "pack_cartons_pack_id_carton_no_key" ON "pack_cartons" ("pack_id", "carton_no");
```

```prisma
model PackCarton {
  id                     String     @id @default(uuid()) @db.Uuid
  packId                 String     @map("pack_id") @db.Uuid
  cartonNo               Int        @map("carton_no")
  lengthCm               Decimal?   @map("length_cm") @db.Decimal(9, 2)
  widthCm                Decimal?   @map("width_cm") @db.Decimal(9, 2)
  heightCm               Decimal?   @map("height_cm") @db.Decimal(9, 2)
  grossWeightKg          Decimal?   @map("gross_weight_kg") @db.Decimal(12, 3)
  labelCode              String?    @map("label_code") @db.VarChar(80)
  @@unique([packId, cartonNo])
  @@map("pack_cartons")
}
```

#### 5.5.M5.7 `pack_lines`

```sql
-- pack_lines: What is in a carton: quantities coming from pick tasks.
CREATE TABLE "pack_lines" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "pack_id" uuid NOT NULL,
  "carton_id" uuid,
  "pick_task_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "serial_nos" jsonb,
  "qty" numeric(18,3) NOT NULL,
  CONSTRAINT "pack_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pack_lines_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "pack_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pack_lines_carton_id_fkey" FOREIGN KEY ("carton_id") REFERENCES "pack_cartons" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pack_lines_pick_task_id_fkey" FOREIGN KEY ("pick_task_id") REFERENCES "pick_tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pack_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pack_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pack_lines_qty_check" CHECK (qty > 0)
);
CREATE INDEX "pack_lines_pack_id_idx" ON "pack_lines" ("pack_id");
CREATE INDEX "pack_lines_pick_task_id_idx" ON "pack_lines" ("pick_task_id");
CREATE INDEX "pack_lines_carton_id_idx" ON "pack_lines" ("carton_id");
CREATE INDEX "pack_lines_item_id_idx" ON "pack_lines" ("item_id");
CREATE INDEX "pack_lines_batch_id_idx" ON "pack_lines" ("batch_id");
```

```prisma
model PackLine {
  id                     String     @id @default(uuid()) @db.Uuid
  packId                 String     @map("pack_id") @db.Uuid
  cartonId               String?    @map("carton_id") @db.Uuid
  pickTaskId             String     @map("pick_task_id") @db.Uuid
  itemId                 String     @map("item_id") @db.Uuid
  batchId                String?    @map("batch_id") @db.Uuid
  serialNos              Json?      @map("serial_nos")
  qty                    Decimal    @db.Decimal(18, 3)
  @@index([packId])
  @@index([pickTaskId])
  @@index([cartonId])
  @@index([itemId])
  @@index([batchId])
  @@map("pack_lines")
}
```

#### 5.5.M5.8 `cycle_count_plans`

```sql
-- cycle_count_plans: Cycle count plan (wms-cycle).
CREATE TABLE "cycle_count_plans" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "code" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "fy_id" uuid NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT 'Warehouse',
  "warehouse_id" uuid NOT NULL,
  "zone_id" uuid,
  "abc_class" varchar(3) NOT NULL DEFAULT 'All',
  "frequency" varchar(12) NOT NULL DEFAULT 'Monthly',
  "planned_date" date NOT NULL,
  "blind" boolean NOT NULL DEFAULT true,
  "tolerance_pct" numeric(7,4) NOT NULL DEFAULT 2,
  "tolerance_value" numeric(18,2) NOT NULL DEFAULT 500,
  "supervisor_id" uuid,
  "status" varchar(12) NOT NULL DEFAULT 'Planned',
  "items_planned" integer NOT NULL DEFAULT 0,
  "items_counted" integer NOT NULL DEFAULT 0,
  "variance_lines" integer NOT NULL DEFAULT 0,
  "accuracy_pct" numeric(7,4),
  "started_at" timestamptz(3),
  "completed_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "cycle_count_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cycle_count_plans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_plans_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_plans_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_plans_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_plans_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "wms_zones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_plans_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_plans_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_plans_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_plans_abc_class_check" CHECK (abc_class IN ('A','B','C','All')),
  CONSTRAINT "cycle_count_plans_frequency_check" CHECK (frequency IN ('Weekly','Monthly','Quarterly','Half-Yearly','Yearly')),
  CONSTRAINT "cycle_count_plans_tolerance_pct_check" CHECK (tolerance_pct >= 0),
  CONSTRAINT "cycle_count_plans_tolerance_value_check" CHECK (tolerance_value >= 0),
  CONSTRAINT "cycle_count_plans_status_check" CHECK (status IN ('Planned','Counting','Recount','Under Review','Approved','Completed','Cancelled'))
);
CREATE UNIQUE INDEX "cycle_count_plans_code_key" ON "cycle_count_plans" ("code");
CREATE INDEX "cycle_count_plans_warehouse_id_status_idx" ON "cycle_count_plans" ("warehouse_id", "status");
CREATE INDEX "cycle_count_plans_planned_date_idx" ON "cycle_count_plans" ("planned_date");
CREATE INDEX "cycle_count_plans_unit_id_idx" ON "cycle_count_plans" ("unit_id");
CREATE INDEX "cycle_count_plans_fy_id_idx" ON "cycle_count_plans" ("fy_id");
CREATE INDEX "cycle_count_plans_zone_id_idx" ON "cycle_count_plans" ("zone_id");
CREATE INDEX "cycle_count_plans_supervisor_id_idx" ON "cycle_count_plans" ("supervisor_id");
```

```prisma
model CycleCountPlan {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String     @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(60)
  docDate                DateTime   @map("doc_date") @db.Date
  fyId                   String     @map("fy_id") @db.Uuid
  department             String     @default("Warehouse") @db.VarChar(60)
  warehouseId            String     @map("warehouse_id") @db.Uuid
  zoneId                 String?    @map("zone_id") @db.Uuid
  abcClass               String     @default("All") @map("abc_class") @db.VarChar(3)
  frequency              String     @default("Monthly") @db.VarChar(12)
  plannedDate            DateTime   @map("planned_date") @db.Date
  blind                  Boolean    @default(true)
  tolerancePct           Decimal    @default(2) @map("tolerance_pct") @db.Decimal(7, 4)
  toleranceValue         Decimal    @default(500) @map("tolerance_value") @db.Decimal(18, 2)
  supervisorId           String?    @map("supervisor_id") @db.Uuid
  status                 String     @default("Planned") @db.VarChar(12)
  itemsPlanned           Int        @default(0) @map("items_planned")
  itemsCounted           Int        @default(0) @map("items_counted")
  varianceLines          Int        @default(0) @map("variance_lines")
  accuracyPct            Decimal?   @map("accuracy_pct") @db.Decimal(7, 4)
  startedAt              DateTime?  @map("started_at") @db.Timestamptz(3)
  completedAt            DateTime?  @map("completed_at") @db.Timestamptz(3)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([warehouseId, status])
  @@index([plannedDate])
  @@index([unitId])
  @@index([fyId])
  @@index([zoneId])
  @@index([supervisorId])
  @@unique([code])
  @@map("cycle_count_plans")
}
```

#### 5.5.M5.9 `cycle_count_lines`

```sql
-- cycle_count_lines: Line of a cycle count plan. system_qty is hidden from the counter while the plan is blind.
CREATE TABLE "cycle_count_lines" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "zone_id" uuid,
  "shelf_id" uuid,
  "bin_id" uuid,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "system_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "snapshot_at" timestamptz(3) NOT NULL DEFAULT now(),
  "count1_qty" numeric(18,3),
  "count1_by" uuid,
  "count1_at" timestamptz(3),
  "count2_qty" numeric(18,3),
  "count2_by" uuid,
  "count2_at" timestamptz(3),
  "final_qty" numeric(18,3),
  "variance_qty" numeric(18,3),
  "unit_cost" numeric(18,6),
  "value_variance" numeric(18,2),
  "status" varchar(10) NOT NULL DEFAULT 'Pending',
  "reconciliation_id" uuid,
  CONSTRAINT "cycle_count_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cycle_count_lines_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "cycle_count_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_lines_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "wms_zones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_lines_shelf_id_fkey" FOREIGN KEY ("shelf_id") REFERENCES "wms_shelves" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_lines_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "wms_bins" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_lines_count1_by_fkey" FOREIGN KEY ("count1_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_lines_count2_by_fkey" FOREIGN KEY ("count2_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_lines_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "stock_reconciliations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_lines_line_no_check" CHECK (line_no >= 1),
  CONSTRAINT "cycle_count_lines_count1_qty_check" CHECK (count1_qty >= 0),
  CONSTRAINT "cycle_count_lines_count2_qty_check" CHECK (count2_qty >= 0),
  CONSTRAINT "cycle_count_lines_final_qty_check" CHECK (final_qty >= 0),
  CONSTRAINT "cycle_count_lines_status_check" CHECK (status IN ('Pending','Counted','Recount','Accepted','Stale','Approved'))
);
CREATE UNIQUE INDEX "cycle_count_lines_plan_id_line_no_key" ON "cycle_count_lines" ("plan_id", "line_no");
CREATE INDEX "cycle_count_lines_item_id_bin_id_idx" ON "cycle_count_lines" ("item_id", "bin_id");
CREATE INDEX "cycle_count_lines_zone_id_idx" ON "cycle_count_lines" ("zone_id");
CREATE INDEX "cycle_count_lines_shelf_id_idx" ON "cycle_count_lines" ("shelf_id");
CREATE INDEX "cycle_count_lines_bin_id_idx" ON "cycle_count_lines" ("bin_id");
CREATE INDEX "cycle_count_lines_batch_id_idx" ON "cycle_count_lines" ("batch_id");
CREATE INDEX "cycle_count_lines_count1_by_idx" ON "cycle_count_lines" ("count1_by");
CREATE INDEX "cycle_count_lines_count2_by_idx" ON "cycle_count_lines" ("count2_by");
CREATE INDEX "cycle_count_lines_reconciliation_id_idx" ON "cycle_count_lines" ("reconciliation_id");
```

```prisma
model CycleCountLine {
  id                     String     @id @default(uuid()) @db.Uuid
  planId                 String     @map("plan_id") @db.Uuid
  lineNo                 Int        @map("line_no")
  zoneId                 String?    @map("zone_id") @db.Uuid
  shelfId                String?    @map("shelf_id") @db.Uuid
  binId                  String?    @map("bin_id") @db.Uuid
  itemId                 String     @map("item_id") @db.Uuid
  batchId                String?    @map("batch_id") @db.Uuid
  systemQty              Decimal    @default(0) @map("system_qty") @db.Decimal(18, 3)
  snapshotAt             DateTime   @default(now()) @map("snapshot_at") @db.Timestamptz(3)
  count1Qty              Decimal?   @map("count1_qty") @db.Decimal(18, 3)
  count1By               String?    @map("count1_by") @db.Uuid
  count1At               DateTime?  @map("count1_at") @db.Timestamptz(3)
  count2Qty              Decimal?   @map("count2_qty") @db.Decimal(18, 3)
  count2By               String?    @map("count2_by") @db.Uuid
  count2At               DateTime?  @map("count2_at") @db.Timestamptz(3)
  finalQty               Decimal?   @map("final_qty") @db.Decimal(18, 3)
  varianceQty            Decimal?   @map("variance_qty") @db.Decimal(18, 3)
  unitCost               Decimal?   @map("unit_cost") @db.Decimal(18, 6)
  valueVariance          Decimal?   @map("value_variance") @db.Decimal(18, 2)
  status                 String     @default("Pending") @db.VarChar(10)
  reconciliationId       String?    @map("reconciliation_id") @db.Uuid
  @@index([itemId, binId])
  @@index([zoneId])
  @@index([shelfId])
  @@index([binId])
  @@index([batchId])
  @@index([count1By])
  @@index([count2By])
  @@index([reconciliationId])
  @@unique([planId, lineNo])
  @@map("cycle_count_lines")
}
```

#### 5.5.M5.10 `physical_counts`

```sql
-- physical_counts: Physical verification (wms-physical): freezes a warehouse, counts, recounts, approves, posts.
CREATE TABLE "physical_counts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "code" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "fy_id" uuid NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT 'Warehouse',
  "warehouse_id" uuid NOT NULL,
  "freeze_date" date NOT NULL,
  "count_team" varchar(200),
  "blind" boolean NOT NULL DEFAULT true,
  "tolerance_pct" numeric(7,4) NOT NULL DEFAULT 2,
  "status" varchar(12) NOT NULL DEFAULT 'Planned',
  "line_count" integer NOT NULL DEFAULT 0,
  "first_variance_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "recount_variance_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "value_variance" numeric(18,2) NOT NULL DEFAULT 0,
  "frozen_at" timestamptz(3),
  "approved_by_id" uuid,
  "approved_at" timestamptz(3),
  "posting_date" date,
  "closed_by_id" uuid,
  "closed_at" timestamptz(3),
  "closure_note" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "physical_counts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "physical_counts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "physical_counts_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "physical_counts_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "physical_counts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "physical_counts_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "physical_counts_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "physical_counts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "physical_counts_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "physical_counts_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "physical_counts_tolerance_pct_check" CHECK (tolerance_pct >= 0),
  CONSTRAINT "physical_counts_status_check" CHECK (status IN ('Planned','Frozen','Counting','Recount','Under Review','Approved','Posted','Closed','Cancelled'))
);
CREATE UNIQUE INDEX "physical_counts_code_key" ON "physical_counts" ("code");
CREATE INDEX "physical_counts_warehouse_id_status_idx" ON "physical_counts" ("warehouse_id", "status");
CREATE INDEX "physical_counts_unit_id_idx" ON "physical_counts" ("unit_id");
CREATE INDEX "physical_counts_fy_id_idx" ON "physical_counts" ("fy_id");
```

```prisma
model PhysicalCount {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String     @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(60)
  docDate                DateTime   @map("doc_date") @db.Date
  fyId                   String     @map("fy_id") @db.Uuid
  department             String     @default("Warehouse") @db.VarChar(60)
  warehouseId            String     @map("warehouse_id") @db.Uuid
  freezeDate             DateTime   @map("freeze_date") @db.Date
  countTeam              String?    @map("count_team") @db.VarChar(200)
  blind                  Boolean    @default(true)
  tolerancePct           Decimal    @default(2) @map("tolerance_pct") @db.Decimal(7, 4)
  status                 String     @default("Planned") @db.VarChar(12)
  lineCount              Int        @default(0) @map("line_count")
  firstVarianceQty       Decimal    @default(0) @map("first_variance_qty") @db.Decimal(18, 3)
  recountVarianceQty     Decimal    @default(0) @map("recount_variance_qty") @db.Decimal(18, 3)
  valueVariance          Decimal    @default(0) @map("value_variance") @db.Decimal(18, 2)
  frozenAt               DateTime?  @map("frozen_at") @db.Timestamptz(3)
  approvedById           String?    @map("approved_by_id") @db.Uuid
  approvedAt             DateTime?  @map("approved_at") @db.Timestamptz(3)
  postingDate            DateTime?  @map("posting_date") @db.Date
  closedById             String?    @map("closed_by_id") @db.Uuid
  closedAt               DateTime?  @map("closed_at") @db.Timestamptz(3)
  closureNote            String?    @map("closure_note")
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([warehouseId, status])
  @@index([unitId])
  @@index([fyId])
  @@unique([code])
  @@map("physical_counts")
}
```

#### 5.5.M5.11 `physical_count_lines`

```sql
-- physical_count_lines: Line of a physical count (same columns as cycle_count_lines).
CREATE TABLE "physical_count_lines" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "count_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "zone_id" uuid,
  "shelf_id" uuid,
  "bin_id" uuid,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "system_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "snapshot_at" timestamptz(3) NOT NULL DEFAULT now(),
  "count1_qty" numeric(18,3),
  "count1_by" uuid,
  "count1_at" timestamptz(3),
  "count2_qty" numeric(18,3),
  "count2_by" uuid,
  "count2_at" timestamptz(3),
  "final_qty" numeric(18,3),
  "variance_qty" numeric(18,3),
  "unit_cost" numeric(18,6),
  "value_variance" numeric(18,2),
  "status" varchar(10) NOT NULL DEFAULT 'Pending',
  "reconciliation_id" uuid,
  CONSTRAINT "physical_count_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "physical_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "physical_counts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "physical_count_lines_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "wms_zones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "physical_count_lines_shelf_id_fkey" FOREIGN KEY ("shelf_id") REFERENCES "wms_shelves" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "physical_count_lines_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "wms_bins" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "physical_count_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "physical_count_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "physical_count_lines_count1_by_fkey" FOREIGN KEY ("count1_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "physical_count_lines_count2_by_fkey" FOREIGN KEY ("count2_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "physical_count_lines_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "stock_reconciliations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "physical_count_lines_line_no_check" CHECK (line_no >= 1),
  CONSTRAINT "physical_count_lines_count1_qty_check" CHECK (count1_qty >= 0),
  CONSTRAINT "physical_count_lines_count2_qty_check" CHECK (count2_qty >= 0),
  CONSTRAINT "physical_count_lines_final_qty_check" CHECK (final_qty >= 0),
  CONSTRAINT "physical_count_lines_status_check" CHECK (status IN ('Pending','Counted','Recount','Accepted','Stale','Approved'))
);
CREATE UNIQUE INDEX "physical_count_lines_count_id_line_no_key" ON "physical_count_lines" ("count_id", "line_no");
CREATE INDEX "physical_count_lines_item_id_bin_id_idx" ON "physical_count_lines" ("item_id", "bin_id");
CREATE INDEX "physical_count_lines_zone_id_idx" ON "physical_count_lines" ("zone_id");
CREATE INDEX "physical_count_lines_shelf_id_idx" ON "physical_count_lines" ("shelf_id");
CREATE INDEX "physical_count_lines_bin_id_idx" ON "physical_count_lines" ("bin_id");
CREATE INDEX "physical_count_lines_batch_id_idx" ON "physical_count_lines" ("batch_id");
CREATE INDEX "physical_count_lines_count1_by_idx" ON "physical_count_lines" ("count1_by");
CREATE INDEX "physical_count_lines_count2_by_idx" ON "physical_count_lines" ("count2_by");
CREATE INDEX "physical_count_lines_reconciliation_id_idx" ON "physical_count_lines" ("reconciliation_id");
```

```prisma
model PhysicalCountLine {
  id                     String     @id @default(uuid()) @db.Uuid
  countId                String     @map("count_id") @db.Uuid
  lineNo                 Int        @map("line_no")
  zoneId                 String?    @map("zone_id") @db.Uuid
  shelfId                String?    @map("shelf_id") @db.Uuid
  binId                  String?    @map("bin_id") @db.Uuid
  itemId                 String     @map("item_id") @db.Uuid
  batchId                String?    @map("batch_id") @db.Uuid
  systemQty              Decimal    @default(0) @map("system_qty") @db.Decimal(18, 3)
  snapshotAt             DateTime   @default(now()) @map("snapshot_at") @db.Timestamptz(3)
  count1Qty              Decimal?   @map("count1_qty") @db.Decimal(18, 3)
  count1By               String?    @map("count1_by") @db.Uuid
  count1At               DateTime?  @map("count1_at") @db.Timestamptz(3)
  count2Qty              Decimal?   @map("count2_qty") @db.Decimal(18, 3)
  count2By               String?    @map("count2_by") @db.Uuid
  count2At               DateTime?  @map("count2_at") @db.Timestamptz(3)
  finalQty               Decimal?   @map("final_qty") @db.Decimal(18, 3)
  varianceQty            Decimal?   @map("variance_qty") @db.Decimal(18, 3)
  unitCost               Decimal?   @map("unit_cost") @db.Decimal(18, 6)
  valueVariance          Decimal?   @map("value_variance") @db.Decimal(18, 2)
  status                 String     @default("Pending") @db.VarChar(10)
  reconciliationId       String?    @map("reconciliation_id") @db.Uuid
  @@index([itemId, binId])
  @@index([zoneId])
  @@index([shelfId])
  @@index([binId])
  @@index([batchId])
  @@index([count1By])
  @@index([count2By])
  @@index([reconciliationId])
  @@unique([countId, lineNo])
  @@map("physical_count_lines")
}
```

#### 5.5.M5.12 `wms_transfers`

```sql
-- wms_transfers: Warehouse-to-warehouse transfer task (wms-transfer) orchestrating pick, dispatch, receive, putaway over inv-transfer vouchers.
CREATE TABLE "wms_transfers" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "code" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "fy_id" uuid NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT 'Warehouse',
  "source_warehouse_id" uuid NOT NULL,
  "dest_warehouse_id" uuid NOT NULL,
  "wave_id" uuid,
  "expected_date" date,
  "reason" varchar(200),
  "status" varchar(12) NOT NULL DEFAULT 'Draft',
  "dispatch_refs" jsonb,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "wms_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_transfers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_transfers_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_transfers_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_transfers_source_warehouse_id_fkey" FOREIGN KEY ("source_warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_transfers_dest_warehouse_id_fkey" FOREIGN KEY ("dest_warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_transfers_wave_id_fkey" FOREIGN KEY ("wave_id") REFERENCES "pick_waves" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_transfers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_transfers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "wms_transfers_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "wms_transfers_status_check" CHECK (status IN ('Draft','Picking','In Transit','Received','Putaway','Completed','Cancelled')),
  CONSTRAINT "wms_transfers_differ" CHECK (source_warehouse_id <> dest_warehouse_id)
);
CREATE UNIQUE INDEX "wms_transfers_code_key" ON "wms_transfers" ("code");
CREATE INDEX "wms_transfers_status_idx" ON "wms_transfers" ("status");
CREATE INDEX "wms_transfers_unit_id_idx" ON "wms_transfers" ("unit_id");
CREATE INDEX "wms_transfers_fy_id_idx" ON "wms_transfers" ("fy_id");
CREATE INDEX "wms_transfers_source_warehouse_id_idx" ON "wms_transfers" ("source_warehouse_id");
CREATE INDEX "wms_transfers_dest_warehouse_id_idx" ON "wms_transfers" ("dest_warehouse_id");
CREATE INDEX "wms_transfers_wave_id_idx" ON "wms_transfers" ("wave_id");
```

```prisma
model WmsTransfer {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String     @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(60)
  docDate                DateTime   @map("doc_date") @db.Date
  fyId                   String     @map("fy_id") @db.Uuid
  department             String     @default("Warehouse") @db.VarChar(60)
  sourceWarehouseId      String     @map("source_warehouse_id") @db.Uuid
  destWarehouseId        String     @map("dest_warehouse_id") @db.Uuid
  waveId                 String?    @map("wave_id") @db.Uuid
  expectedDate           DateTime?  @map("expected_date") @db.Date
  reason                 String?    @db.VarChar(200)
  status                 String     @default("Draft") @db.VarChar(12)
  dispatchRefs           Json?      @map("dispatch_refs")
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([status])
  @@index([unitId])
  @@index([fyId])
  @@index([sourceWarehouseId])
  @@index([destWarehouseId])
  @@index([waveId])
  @@unique([code])
  @@map("wms_transfers")
}
```

#### 5.5.M5.13 `wms_transfer_lines`

```sql
-- wms_transfer_lines: Line of a WMS transfer (one inv-transfer voucher per line).
CREATE TABLE "wms_transfer_lines" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "transfer_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "serial_nos" jsonb,
  "qty" numeric(18,3) NOT NULL,
  "picked_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "dispatched_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "received_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "putaway_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "voucher_id" uuid,
  "rate" numeric(18,6),
  CONSTRAINT "wms_transfer_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "wms_transfers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "wms_transfer_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_transfer_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_transfer_lines_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "stock_vouchers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_transfer_lines_line_no_check" CHECK (line_no >= 1),
  CONSTRAINT "wms_transfer_lines_qty_check" CHECK (qty > 0)
);
CREATE UNIQUE INDEX "wms_transfer_lines_transfer_id_line_no_key" ON "wms_transfer_lines" ("transfer_id", "line_no");
CREATE INDEX "wms_transfer_lines_item_id_idx" ON "wms_transfer_lines" ("item_id");
CREATE INDEX "wms_transfer_lines_batch_id_idx" ON "wms_transfer_lines" ("batch_id");
CREATE INDEX "wms_transfer_lines_voucher_id_idx" ON "wms_transfer_lines" ("voucher_id");
```

```prisma
model WmsTransferLine {
  id                     String     @id @default(uuid()) @db.Uuid
  transferId             String     @map("transfer_id") @db.Uuid
  lineNo                 Int        @map("line_no")
  itemId                 String     @map("item_id") @db.Uuid
  batchId                String?    @map("batch_id") @db.Uuid
  serialNos              Json?      @map("serial_nos")
  qty                    Decimal    @db.Decimal(18, 3)
  pickedQty              Decimal    @default(0) @map("picked_qty") @db.Decimal(18, 3)
  dispatchedQty          Decimal    @default(0) @map("dispatched_qty") @db.Decimal(18, 3)
  receivedQty            Decimal    @default(0) @map("received_qty") @db.Decimal(18, 3)
  putawayQty             Decimal    @default(0) @map("putaway_qty") @db.Decimal(18, 3)
  voucherId              String?    @map("voucher_id") @db.Uuid
  rate                   Decimal?   @db.Decimal(18, 6)
  @@index([itemId])
  @@index([batchId])
  @@index([voucherId])
  @@unique([transferId, lineNo])
  @@map("wms_transfer_lines")
}
```


#### 5.5.M6.1 `label_templates`

```sql
-- label_templates: Label layout (wms-barcode tab Label Templates).
CREATE TABLE "label_templates" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "code" varchar(30) NOT NULL,
  "name" varchar(100) NOT NULL,
  "kind" varchar(8) NOT NULL,
  "symbology" varchar(16) NOT NULL DEFAULT 'Code 128',
  "width_mm" numeric(7,2) NOT NULL DEFAULT 50,
  "height_mm" numeric(7,2) NOT NULL DEFAULT 25,
  "layout" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "label_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "label_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "label_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "label_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "label_templates_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "label_templates_kind_check" CHECK (kind IN ('ITEM','BIN','LOT','PACK','SERIAL')),
  CONSTRAINT "label_templates_symbology_check" CHECK (symbology IN ('Code 128','EAN-13','QR Code','GS1 DataMatrix','GS1-128')),
  CONSTRAINT "label_templates_width_mm_check" CHECK (width_mm > 0),
  CONSTRAINT "label_templates_height_mm_check" CHECK (height_mm > 0)
);
CREATE UNIQUE INDEX "label_templates_code_key" ON "label_templates" ("code");
```

```prisma
model LabelTemplate {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  code                   String     @db.VarChar(30)
  name                   String     @db.VarChar(100)
  kind                   String     @db.VarChar(8)
  symbology              String     @default("Code 128") @db.VarChar(16)
  widthMm                Decimal    @default(50) @map("width_mm") @db.Decimal(7, 2)
  heightMm               Decimal    @default(25) @map("height_mm") @db.Decimal(7, 2)
  layout                 Json       @default("{}")
  active                 Boolean    @default(true)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@unique([code])
  @@map("label_templates")
}
```

#### 5.5.M6.2 `label_printers`

```sql
-- label_printers: Printer setup. No driver: the API returns ZPL / text and the browser prints it.
CREATE TABLE "label_printers" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid,
  "code" varchar(30) NOT NULL,
  "name" varchar(100) NOT NULL,
  "printer_type" varchar(8) NOT NULL DEFAULT 'ZPL',
  "location" varchar(100),
  "dpi" integer NOT NULL DEFAULT 203,
  "address" varchar(100),
  "status" varchar(10) NOT NULL DEFAULT 'Active',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "label_printers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "label_printers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "label_printers_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "label_printers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "label_printers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "label_printers_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "label_printers_printer_type_check" CHECK (printer_type IN ('ZPL','PDF','Browser')),
  CONSTRAINT "label_printers_dpi_check" CHECK (dpi IN (150,203,300,600)),
  CONSTRAINT "label_printers_status_check" CHECK (status IN ('Active','Inactive'))
);
CREATE UNIQUE INDEX "label_printers_code_key" ON "label_printers" ("code");
CREATE INDEX "label_printers_unit_id_idx" ON "label_printers" ("unit_id");
```

```prisma
model LabelPrinter {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String?    @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(30)
  name                   String     @db.VarChar(100)
  printerType            String     @default("ZPL") @map("printer_type") @db.VarChar(8)
  location               String?    @db.VarChar(100)
  dpi                    Int        @default(203)
  address                String?    @db.VarChar(100)
  status                 String     @default("Active") @db.VarChar(10)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([unitId])
  @@unique([code])
  @@map("label_printers")
}
```

#### 5.5.M6.3 `item_barcodes`

```sql
-- item_barcodes: Barcode registry (wms-barcode). The item master barcode is mirrored as the primary row.
CREATE TABLE "item_barcodes" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "barcode" varchar(60) NOT NULL,
  "barcode_type" varchar(16) NOT NULL DEFAULT 'Code 128',
  "uom_code" varchar(20),
  "pack_qty" numeric(18,3) NOT NULL DEFAULT 1,
  "label_template_id" uuid,
  "printer_code" varchar(30),
  "last_printed_at" timestamptz(3),
  "scan_count" integer NOT NULL DEFAULT 0,
  "invalid_scan_count" integer NOT NULL DEFAULT 0,
  "is_primary" boolean NOT NULL DEFAULT false,
  "status" varchar(10) NOT NULL DEFAULT 'Active',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "item_barcodes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "item_barcodes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "item_barcodes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "item_barcodes_label_template_id_fkey" FOREIGN KEY ("label_template_id") REFERENCES "label_templates" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "item_barcodes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "item_barcodes_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "item_barcodes_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "item_barcodes_barcode_check" CHECK (char_length(barcode) >= 4),
  CONSTRAINT "item_barcodes_barcode_type_check" CHECK (barcode_type IN ('EAN-13','UPC-A','Code 128','GS1-128','QR Code','GS1 DataMatrix','Internal')),
  CONSTRAINT "item_barcodes_pack_qty_check" CHECK (pack_qty > 0),
  CONSTRAINT "item_barcodes_status_check" CHECK (status IN ('Active','Inactive','Retired'))
);
CREATE INDEX "item_barcodes_item_id_idx" ON "item_barcodes" ("item_id");
CREATE INDEX "item_barcodes_label_template_id_idx" ON "item_barcodes" ("label_template_id");
CREATE UNIQUE INDEX "item_barcodes_barcode_key" ON "item_barcodes" ("barcode") WHERE "deleted_at" IS NULL;
```

```prisma
model ItemBarcode {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  itemId                 String     @map("item_id") @db.Uuid
  barcode                String     @db.VarChar(60)
  barcodeType            String     @default("Code 128") @map("barcode_type") @db.VarChar(16)
  uomCode                String?    @map("uom_code") @db.VarChar(20)
  packQty                Decimal    @default(1) @map("pack_qty") @db.Decimal(18, 3)
  labelTemplateId        String?    @map("label_template_id") @db.Uuid
  printerCode            String?    @map("printer_code") @db.VarChar(30)
  lastPrintedAt          DateTime?  @map("last_printed_at") @db.Timestamptz(3)
  scanCount              Int        @default(0) @map("scan_count")
  invalidScanCount       Int        @default(0) @map("invalid_scan_count")
  isPrimary              Boolean    @default(false) @map("is_primary")
  status                 String     @default("Active") @db.VarChar(10)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([itemId])
  @@index([labelTemplateId])
  @@map("item_barcodes")
}
```

#### 5.5.M6.4 `scan_events`

```sql
-- scan_events: Append-only log of every scan (valid or not): feeds Scan Transactions, Invalid Scans, Scan Productivity.
CREATE TABLE "scan_events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid,
  "warehouse_id" uuid,
  "context" varchar(8) NOT NULL,
  "raw" varchar(300) NOT NULL,
  "parsed" jsonb,
  "result_kind" varchar(8) NOT NULL,
  "item_id" uuid,
  "batch_id" uuid,
  "serial_id" uuid,
  "bin_id" uuid,
  "barcode_id" uuid,
  "valid" boolean NOT NULL,
  "reason" varchar(120),
  "scanned_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid,
  CONSTRAINT "scan_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scan_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scan_events_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scan_events_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scan_events_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scan_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scan_events_serial_id_fkey" FOREIGN KEY ("serial_id") REFERENCES "serial_numbers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scan_events_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "wms_bins" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scan_events_barcode_id_fkey" FOREIGN KEY ("barcode_id") REFERENCES "item_barcodes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scan_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "scan_events_context_check" CHECK (context IN ('LOOKUP','RECEIVE','PUTAWAY','PICK','COUNT')),
  CONSTRAINT "scan_events_result_kind_check" CHECK (result_kind IN ('ITEM','BATCH','SERIAL','BIN','UNKNOWN'))
);
CREATE INDEX "scan_events_created_by_id_scanned_at_idx" ON "scan_events" ("created_by_id", "scanned_at");
CREATE INDEX "scan_events_valid_scanned_at_idx" ON "scan_events" ("valid", "scanned_at");
CREATE INDEX "scan_events_unit_id_idx" ON "scan_events" ("unit_id");
CREATE INDEX "scan_events_warehouse_id_idx" ON "scan_events" ("warehouse_id");
CREATE INDEX "scan_events_item_id_idx" ON "scan_events" ("item_id");
CREATE INDEX "scan_events_batch_id_idx" ON "scan_events" ("batch_id");
CREATE INDEX "scan_events_serial_id_idx" ON "scan_events" ("serial_id");
CREATE INDEX "scan_events_bin_id_idx" ON "scan_events" ("bin_id");
CREATE INDEX "scan_events_barcode_id_idx" ON "scan_events" ("barcode_id");
SELECT inv_make_append_only('scan_events');
```

```prisma
model ScanEvent {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String?    @map("unit_id") @db.Uuid
  warehouseId            String?    @map("warehouse_id") @db.Uuid
  context                String     @db.VarChar(8)
  raw                    String     @db.VarChar(300)
  parsed                 Json?
  resultKind             String     @map("result_kind") @db.VarChar(8)
  itemId                 String?    @map("item_id") @db.Uuid
  batchId                String?    @map("batch_id") @db.Uuid
  serialId               String?    @map("serial_id") @db.Uuid
  binId                  String?    @map("bin_id") @db.Uuid
  barcodeId              String?    @map("barcode_id") @db.Uuid
  valid                  Boolean
  reason                 String?    @db.VarChar(120)
  scannedAt              DateTime   @default(now()) @map("scanned_at") @db.Timestamptz(3)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String?    @map("created_by_id") @db.Uuid
  @@index([createdById, scannedAt])
  @@index([valid, scannedAt])
  @@index([unitId])
  @@index([warehouseId])
  @@index([itemId])
  @@index([batchId])
  @@index([serialId])
  @@index([binId])
  @@index([barcodeId])
  @@map("scan_events")
}
```

#### 5.5.M6.5 `rfid_readers`

```sql
-- rfid_readers: RFID reader / portal and the zone it covers.
CREATE TABLE "rfid_readers" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid,
  "code" varchar(30) NOT NULL,
  "name" varchar(100) NOT NULL,
  "warehouse_id" uuid,
  "zone_id" uuid,
  "reader_type" varchar(10) NOT NULL DEFAULT 'Portal',
  "status" varchar(10) NOT NULL DEFAULT 'Active',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "rfid_readers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rfid_readers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_readers_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_readers_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_readers_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "wms_zones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_readers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_readers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "rfid_readers_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "rfid_readers_reader_type_check" CHECK (reader_type IN ('Portal','Handheld')),
  CONSTRAINT "rfid_readers_status_check" CHECK (status IN ('Active','Inactive'))
);
CREATE UNIQUE INDEX "rfid_readers_code_key" ON "rfid_readers" ("code");
CREATE INDEX "rfid_readers_unit_id_idx" ON "rfid_readers" ("unit_id");
CREATE INDEX "rfid_readers_warehouse_id_idx" ON "rfid_readers" ("warehouse_id");
CREATE INDEX "rfid_readers_zone_id_idx" ON "rfid_readers" ("zone_id");
```

```prisma
model RfidReader {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String?    @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(30)
  name                   String     @db.VarChar(100)
  warehouseId            String?    @map("warehouse_id") @db.Uuid
  zoneId                 String?    @map("zone_id") @db.Uuid
  readerType             String     @default("Portal") @map("reader_type") @db.VarChar(10)
  status                 String     @default("Active") @db.VarChar(10)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([unitId])
  @@index([warehouseId])
  @@index([zoneId])
  @@unique([code])
  @@map("rfid_readers")
}
```

#### 5.5.M6.6 `rfid_tags`

```sql
-- rfid_tags: RFID tag registry (wms-rfid). Report only: never changes stock.
CREATE TABLE "rfid_tags" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid,
  "tag_epc" varchar(48) NOT NULL,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "serial_id" uuid,
  "expected_bin_id" uuid,
  "expected_zone_id" uuid,
  "last_read_at" timestamptz(3),
  "last_rssi" numeric(6,1),
  "last_reader_id" uuid,
  "actual_zone_id" uuid,
  "exception" varchar(60),
  "status" varchar(10) NOT NULL DEFAULT 'Active',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "rfid_tags_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rfid_tags_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_tags_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_tags_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_tags_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_tags_serial_id_fkey" FOREIGN KEY ("serial_id") REFERENCES "serial_numbers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_tags_expected_bin_id_fkey" FOREIGN KEY ("expected_bin_id") REFERENCES "wms_bins" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_tags_expected_zone_id_fkey" FOREIGN KEY ("expected_zone_id") REFERENCES "wms_zones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_tags_last_reader_id_fkey" FOREIGN KEY ("last_reader_id") REFERENCES "rfid_readers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "rfid_tags_actual_zone_id_fkey" FOREIGN KEY ("actual_zone_id") REFERENCES "wms_zones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_tags_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_tags_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "rfid_tags_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "rfid_tags_tag_epc_check" CHECK (tag_epc ~ '^[0-9A-F]{8,48}$'),
  CONSTRAINT "rfid_tags_last_rssi_check" CHECK (last_rssi BETWEEN -120 AND 0),
  CONSTRAINT "rfid_tags_status_check" CHECK (status IN ('Active','Missing','Inactive'))
);
CREATE UNIQUE INDEX "rfid_tags_tag_epc_key" ON "rfid_tags" ("tag_epc");
CREATE INDEX "rfid_tags_item_id_idx" ON "rfid_tags" ("item_id");
CREATE INDEX "rfid_tags_last_read_at_idx" ON "rfid_tags" ("last_read_at");
CREATE INDEX "rfid_tags_unit_id_idx" ON "rfid_tags" ("unit_id");
CREATE INDEX "rfid_tags_batch_id_idx" ON "rfid_tags" ("batch_id");
CREATE INDEX "rfid_tags_serial_id_idx" ON "rfid_tags" ("serial_id");
CREATE INDEX "rfid_tags_expected_bin_id_idx" ON "rfid_tags" ("expected_bin_id");
CREATE INDEX "rfid_tags_expected_zone_id_idx" ON "rfid_tags" ("expected_zone_id");
CREATE INDEX "rfid_tags_last_reader_id_idx" ON "rfid_tags" ("last_reader_id");
CREATE INDEX "rfid_tags_actual_zone_id_idx" ON "rfid_tags" ("actual_zone_id");
```

```prisma
model RfidTag {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String?    @map("unit_id") @db.Uuid
  tagEpc                 String     @map("tag_epc") @db.VarChar(48)
  itemId                 String     @map("item_id") @db.Uuid
  batchId                String?    @map("batch_id") @db.Uuid
  serialId               String?    @map("serial_id") @db.Uuid
  expectedBinId          String?    @map("expected_bin_id") @db.Uuid
  expectedZoneId         String?    @map("expected_zone_id") @db.Uuid
  lastReadAt             DateTime?  @map("last_read_at") @db.Timestamptz(3)
  lastRssi               Decimal?   @map("last_rssi") @db.Decimal(6, 1)
  lastReaderId           String?    @map("last_reader_id") @db.Uuid
  actualZoneId           String?    @map("actual_zone_id") @db.Uuid
  exception              String?    @db.VarChar(60)
  status                 String     @default("Active") @db.VarChar(10)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([itemId])
  @@index([lastReadAt])
  @@index([unitId])
  @@index([batchId])
  @@index([serialId])
  @@index([expectedBinId])
  @@index([expectedZoneId])
  @@index([lastReaderId])
  @@index([actualZoneId])
  @@unique([tagEpc])
  @@map("rfid_tags")
}
```

#### 5.5.M6.7 `rfid_read_events`

```sql
-- rfid_read_events: Append-only imported read events.
CREATE TABLE "rfid_read_events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "tag_epc" varchar(48) NOT NULL,
  "reader_id" uuid,
  "reader_code" varchar(30) NOT NULL,
  "zone_id" uuid,
  "rssi" numeric(6,1),
  "read_at" timestamptz(3) NOT NULL,
  "import_ref" varchar(40),
  "matched" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid,
  CONSTRAINT "rfid_read_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rfid_read_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_read_events_reader_id_fkey" FOREIGN KEY ("reader_id") REFERENCES "rfid_readers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "rfid_read_events_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "wms_zones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rfid_read_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "rfid_read_events_tag_epc_read_at_idx" ON "rfid_read_events" ("tag_epc", "read_at");
CREATE INDEX "rfid_read_events_import_ref_idx" ON "rfid_read_events" ("import_ref");
CREATE INDEX "rfid_read_events_reader_id_idx" ON "rfid_read_events" ("reader_id");
CREATE INDEX "rfid_read_events_zone_id_idx" ON "rfid_read_events" ("zone_id");
SELECT inv_make_append_only('rfid_read_events');
```

```prisma
model RfidReadEvent {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  tagEpc                 String     @map("tag_epc") @db.VarChar(48)
  readerId               String?    @map("reader_id") @db.Uuid
  readerCode             String     @map("reader_code") @db.VarChar(30)
  zoneId                 String?    @map("zone_id") @db.Uuid
  rssi                   Decimal?   @db.Decimal(6, 1)
  readAt                 DateTime   @map("read_at") @db.Timestamptz(3)
  importRef              String?    @map("import_ref") @db.VarChar(40)
  matched                Boolean    @default(false)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String?    @map("created_by_id") @db.Uuid
  @@index([tagEpc, readAt])
  @@index([importRef])
  @@index([readerId])
  @@index([zoneId])
  @@map("rfid_read_events")
}
```

#### 5.5.M6.8 `reorder_policies`

```sql
-- reorder_policies: Reorder policy per item x warehouse (inv-reorder). Computed columns are refreshed by Recalculate.
CREATE TABLE "reorder_policies" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "method" varchar(8) NOT NULL DEFAULT 'ROP_EOQ',
  "min_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "max_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "order_multiple" numeric(18,3) NOT NULL DEFAULT 1,
  "lead_time_days" numeric(9,2) NOT NULL DEFAULT 7,
  "lead_time_sigma_days" numeric(9,2) NOT NULL DEFAULT 0,
  "service_level_pct" numeric(7,4) NOT NULL DEFAULT 95,
  "ordering_cost" numeric(18,2),
  "holding_cost_pct" numeric(7,4) NOT NULL DEFAULT 20,
  "review_days" integer NOT NULL DEFAULT 0,
  "preferred_vendor" varchar(150) NOT NULL,
  "preferred_vendor_id" uuid,
  "avg_daily_usage" numeric(18,3) NOT NULL DEFAULT 0,
  "usage_sigma" numeric(18,3) NOT NULL DEFAULT 0,
  "safety_stock" numeric(18,3) NOT NULL DEFAULT 0,
  "reorder_level" numeric(18,3) NOT NULL DEFAULT 0,
  "eoq" numeric(18,3) NOT NULL DEFAULT 0,
  "computed_at" timestamptz(3),
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "reorder_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reorder_policies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_policies_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_policies_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_policies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_policies_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "reorder_policies_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "reorder_policies_method_check" CHECK (method IN ('MIN_MAX','ROP_EOQ')),
  CONSTRAINT "reorder_policies_min_qty_check" CHECK (min_qty >= 0),
  CONSTRAINT "reorder_policies_max_qty_check" CHECK (max_qty >= 0),
  CONSTRAINT "reorder_policies_order_multiple_check" CHECK (order_multiple > 0),
  CONSTRAINT "reorder_policies_lead_time_days_check" CHECK (lead_time_days >= 0),
  CONSTRAINT "reorder_policies_lead_time_sigma_days_check" CHECK (lead_time_sigma_days >= 0),
  CONSTRAINT "reorder_policies_service_level_pct_check" CHECK (service_level_pct BETWEEN 50 AND 99.9),
  CONSTRAINT "reorder_policies_ordering_cost_check" CHECK (ordering_cost >= 0),
  CONSTRAINT "reorder_policies_holding_cost_pct_check" CHECK (holding_cost_pct BETWEEN 0 AND 100),
  CONSTRAINT "reorder_policies_review_days_check" CHECK (review_days >= 0),
  CONSTRAINT "reorder_policies_minmax" CHECK (max_qty >= min_qty)
);
CREATE INDEX "reorder_policies_item_id_idx" ON "reorder_policies" ("item_id");
CREATE INDEX "reorder_policies_warehouse_id_idx" ON "reorder_policies" ("warehouse_id");
CREATE UNIQUE INDEX "reorder_policies_unique" ON "reorder_policies" ("item_id", "warehouse_id") WHERE "deleted_at" IS NULL;
```

```prisma
model ReorderPolicy {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  itemId                 String     @map("item_id") @db.Uuid
  warehouseId            String     @map("warehouse_id") @db.Uuid
  method                 String     @default("ROP_EOQ") @db.VarChar(8)
  minQty                 Decimal    @default(0) @map("min_qty") @db.Decimal(18, 3)
  maxQty                 Decimal    @default(0) @map("max_qty") @db.Decimal(18, 3)
  orderMultiple          Decimal    @default(1) @map("order_multiple") @db.Decimal(18, 3)
  leadTimeDays           Decimal    @default(7) @map("lead_time_days") @db.Decimal(9, 2)
  leadTimeSigmaDays      Decimal    @default(0) @map("lead_time_sigma_days") @db.Decimal(9, 2)
  serviceLevelPct        Decimal    @default(95) @map("service_level_pct") @db.Decimal(7, 4)
  orderingCost           Decimal?   @map("ordering_cost") @db.Decimal(18, 2)
  holdingCostPct         Decimal    @default(20) @map("holding_cost_pct") @db.Decimal(7, 4)
  reviewDays             Int        @default(0) @map("review_days")
  preferredVendor        String     @map("preferred_vendor") @db.VarChar(150)
  preferredVendorId      String?    @map("preferred_vendor_id") @db.Uuid
  avgDailyUsage          Decimal    @default(0) @map("avg_daily_usage") @db.Decimal(18, 3)
  usageSigma             Decimal    @default(0) @map("usage_sigma") @db.Decimal(18, 3)
  safetyStock            Decimal    @default(0) @map("safety_stock") @db.Decimal(18, 3)
  reorderLevel           Decimal    @default(0) @map("reorder_level") @db.Decimal(18, 3)
  eoq                    Decimal    @default(0) @db.Decimal(18, 3)
  computedAt             DateTime?  @map("computed_at") @db.Timestamptz(3)
  active                 Boolean    @default(true)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([itemId])
  @@index([warehouseId])
  @@map("reorder_policies")
}
```

#### 5.5.M6.9 `reorder_suggestions`

```sql
-- reorder_suggestions: Suggested purchase request lines (tab Suggested PR). Converted by SCM or marked converted by hand.
CREATE TABLE "reorder_suggestions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "code" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "fy_id" uuid NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT 'Warehouse',
  "policy_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "on_hand" numeric(18,3) NOT NULL,
  "available" numeric(18,3) NOT NULL,
  "open_po" numeric(18,3) NOT NULL DEFAULT 0,
  "position" numeric(18,3) NOT NULL,
  "net_requirement" numeric(18,3) NOT NULL,
  "suggested_qty" numeric(18,3) NOT NULL,
  "preferred_vendor" varchar(150),
  "status" varchar(10) NOT NULL DEFAULT 'Open',
  "pr_ref" varchar(60),
  "converted_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "reorder_suggestions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reorder_suggestions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_suggestions_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_suggestions_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_suggestions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "reorder_policies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_suggestions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_suggestions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_suggestions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_suggestions_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "reorder_suggestions_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "reorder_suggestions_net_requirement_check" CHECK (net_requirement >= 0),
  CONSTRAINT "reorder_suggestions_suggested_qty_check" CHECK (suggested_qty > 0),
  CONSTRAINT "reorder_suggestions_status_check" CHECK (status IN ('Open','Converted','Dismissed'))
);
CREATE UNIQUE INDEX "reorder_suggestions_code_key" ON "reorder_suggestions" ("code");
CREATE INDEX "reorder_suggestions_status_idx" ON "reorder_suggestions" ("status");
CREATE INDEX "reorder_suggestions_item_id_warehouse_id_idx" ON "reorder_suggestions" ("item_id", "warehouse_id");
CREATE INDEX "reorder_suggestions_unit_id_idx" ON "reorder_suggestions" ("unit_id");
CREATE INDEX "reorder_suggestions_fy_id_idx" ON "reorder_suggestions" ("fy_id");
CREATE INDEX "reorder_suggestions_policy_id_idx" ON "reorder_suggestions" ("policy_id");
CREATE INDEX "reorder_suggestions_warehouse_id_idx" ON "reorder_suggestions" ("warehouse_id");
```

```prisma
model ReorderSuggestion {
  id                     String     @id @default(uuid()) @db.Uuid
  companyId              String     @map("company_id") @db.Uuid
  unitId                 String     @map("unit_id") @db.Uuid
  code                   String     @db.VarChar(60)
  docDate                DateTime   @map("doc_date") @db.Date
  fyId                   String     @map("fy_id") @db.Uuid
  department             String     @default("Warehouse") @db.VarChar(60)
  policyId               String     @map("policy_id") @db.Uuid
  itemId                 String     @map("item_id") @db.Uuid
  warehouseId            String     @map("warehouse_id") @db.Uuid
  onHand                 Decimal    @map("on_hand") @db.Decimal(18, 3)
  available              Decimal    @db.Decimal(18, 3)
  openPo                 Decimal    @default(0) @map("open_po") @db.Decimal(18, 3)
  position               Decimal    @db.Decimal(18, 3)
  netRequirement         Decimal    @map("net_requirement") @db.Decimal(18, 3)
  suggestedQty           Decimal    @map("suggested_qty") @db.Decimal(18, 3)
  preferredVendor        String?    @map("preferred_vendor") @db.VarChar(150)
  status                 String     @default("Open") @db.VarChar(10)
  prRef                  String?    @map("pr_ref") @db.VarChar(60)
  convertedAt            DateTime?  @map("converted_at") @db.Timestamptz(3)
  createdAt              DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  createdById            String     @map("created_by_id") @db.Uuid
  updatedAt              DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedById            String?    @map("updated_by_id") @db.Uuid
  version                Int        @default(1)
  deletedAt              DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedById            String?    @map("deleted_by_id") @db.Uuid
  @@index([status])
  @@index([itemId, warehouseId])
  @@index([unitId])
  @@index([fyId])
  @@index([policyId])
  @@index([warehouseId])
  @@unique([code])
  @@map("reorder_suggestions")
}
```



The hand-written SQL that goes with M5 and M6 is in `02c` sections 5.4.5 and 5.4.6; the volumes, seeds and account mapping (5.6-5.8) are in `02c` after the M1-M3 tables.
