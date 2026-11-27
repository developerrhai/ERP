-- Sales comparison report: fields the quotation and credit-limit forms ask for.
ALTER TABLE sales_quotations
  ADD COLUMN IF NOT EXISTS delivery_date date,
  ADD COLUMN IF NOT EXISTS customer_po_no varchar(60);

-- Notes about a customer's credit that do not change the limit itself (limit and days keep their approval route).
CREATE TABLE IF NOT EXISTS customer_credit_profiles (
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  risk_grade varchar(10) CHECK (risk_grade IN ('Low', 'Medium', 'High')),
  review_date date,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  updated_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
