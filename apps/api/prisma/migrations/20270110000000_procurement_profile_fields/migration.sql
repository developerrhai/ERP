-- Procurement comparison report: the reference and commercial fields the purchasing forms ask for.
-- Every column is optional, so existing documents stay as they are.
ALTER TABLE purchase_requisitions
  ADD COLUMN IF NOT EXISTS pr_date date,
  ADD COLUMN IF NOT EXISTS priority varchar(10) CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  ADD COLUMN IF NOT EXISTS request_department varchar(60),
  ADD COLUMN IF NOT EXISTS preferred_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_plan_id uuid REFERENCES mfg_production_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mrp_line_no varchar(60),
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mfg_order_id uuid REFERENCES mfg_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE rfqs
  ADD COLUMN IF NOT EXISTS pr_id uuid REFERENCES purchase_requisitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS buyer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category varchar(80),
  ADD COLUMN IF NOT EXISTS technical_spec varchar(2000),
  ADD COLUMN IF NOT EXISTS commercial_terms varchar(2000),
  ADD COLUMN IF NOT EXISTS delivery_location varchar(200),
  ADD COLUMN IF NOT EXISTS validity varchar(80),
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mfg_order_id uuid REFERENCES mfg_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE vendor_quotes
  ADD COLUMN IF NOT EXISTS warranty varchar(200),
  ADD COLUMN IF NOT EXISTS compliance_note varchar(500),
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mfg_order_id uuid REFERENCES mfg_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE vendor_comparisons
  ADD COLUMN IF NOT EXISTS doc_date date,
  ADD COLUMN IF NOT EXISTS required_date date,
  ADD COLUMN IF NOT EXISTS request_department varchar(60),
  ADD COLUMN IF NOT EXISTS buyer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference varchar(120),
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mfg_order_id uuid REFERENCES mfg_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS mfg_order_id uuid REFERENCES mfg_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
