-- A bill settled straight in the books (Cash / Bank Book payment, or "Allocate" of an advance or note) now updates its
-- invoice. This table remembers what each such allocation added, so cancelling it takes back exactly that.
CREATE TABLE "allocation_invoice_links" (
  "allocation_id"       uuid PRIMARY KEY REFERENCES "allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "purchase_invoice_id" uuid NULL REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sales_invoice_id"    uuid NULL REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount"              numeric(18,2) NOT NULL,
  "itc_reclaim_id"      uuid NULL REFERENCES "itc_reversals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at"          timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "allocation_invoice_links_amount_chk" CHECK ("amount" > 0),
  CONSTRAINT "allocation_invoice_links_one_chk" CHECK (("purchase_invoice_id" IS NULL) <> ("sales_invoice_id" IS NULL))
);
CREATE INDEX "allocation_invoice_links_pinv_idx" ON "allocation_invoice_links" ("purchase_invoice_id");
CREATE INDEX "allocation_invoice_links_sinv_idx" ON "allocation_invoice_links" ("sales_invoice_id");
CREATE INDEX "allocation_invoice_links_reclaim_idx" ON "allocation_invoice_links" ("itc_reclaim_id");

-- Bills already settled that way before today: bring their invoices up to date. Only allocations that are still in
-- force and were made by a direct Cash / Bank Book payment or by "Allocate" are counted, and an invoice is never
-- raised above what the books say is settled on its bill.
WITH direct AS (
  SELECT a.id, a.amount, a.created_at, o.side, o.party_id, o.journal_id
    FROM allocations a
    JOIN open_items o ON o.id = a.target_item_id AND o.amount > 0
   WHERE a.amount > 0
     AND NOT EXISTS (SELECT 1 FROM allocations r WHERE r.reverses_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM party_adjustment_lines l WHERE l.allocation_id = a.id)
     AND (
       (a.payment_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM payments p WHERE p.id = a.payment_id)
         AND NOT EXISTS (SELECT 1 FROM payments p JOIN supplier_payments s ON s.journal_id = p.journal_id WHERE p.id = a.payment_id))
       OR (a.payment_id IS NULL AND a.journal_id IS NULL)
     )
), matched AS (
  SELECT d.id, d.amount, d.created_at, i.id AS invoice_id,
         GREATEST(0, LEAST(i.net_payable, (SELECT COALESCE(SUM(x.settled_amount), 0) FROM open_items x
           WHERE x.journal_id = i.journal_id AND x.party_id = i.supplier_id AND x.side = 'PAYABLE' AND x.amount > 0)) - i.paid_amount) AS gap
    FROM direct d
    JOIN purchase_invoices i ON d.side = 'PAYABLE' AND i.journal_id = d.journal_id AND i.supplier_id = d.party_id
                            AND i.status = 'Posted' AND i.deleted_at IS NULL
), running AS (
  SELECT m.*, COALESCE(SUM(amount) OVER (PARTITION BY invoice_id ORDER BY created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
    FROM matched m
)
INSERT INTO allocation_invoice_links (allocation_id, purchase_invoice_id, amount)
SELECT id, invoice_id, LEAST(amount, gap - before) FROM running WHERE LEAST(amount, gap - before) > 0;

WITH direct AS (
  SELECT a.id, a.amount, a.created_at, o.side, o.party_id, o.journal_id
    FROM allocations a
    JOIN open_items o ON o.id = a.target_item_id AND o.amount > 0
   WHERE a.amount > 0
     AND NOT EXISTS (SELECT 1 FROM allocations r WHERE r.reverses_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM party_adjustment_lines l WHERE l.allocation_id = a.id)
     AND (
       (a.payment_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM payments p WHERE p.id = a.payment_id)
         AND NOT EXISTS (SELECT 1 FROM payments p JOIN supplier_payments s ON s.journal_id = p.journal_id WHERE p.id = a.payment_id))
       OR (a.payment_id IS NULL AND a.journal_id IS NULL)
     )
), matched AS (
  SELECT d.id, d.amount, d.created_at, i.id AS invoice_id,
         GREATEST(0, LEAST(i.grand_total, (SELECT COALESCE(SUM(x.settled_amount), 0) FROM open_items x
           WHERE x.journal_id = i.journal_id AND x.party_id = i.customer_id AND x.side = 'RECEIVABLE' AND x.amount > 0)) - i.received_amount) AS gap
    FROM direct d
    JOIN sales_invoices i ON d.side = 'RECEIVABLE' AND i.journal_id = d.journal_id AND i.customer_id = d.party_id
                         AND i.status = 'Posted' AND i.deleted_at IS NULL
), running AS (
  SELECT m.*, COALESCE(SUM(amount) OVER (PARTITION BY invoice_id ORDER BY created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
    FROM matched m
)
INSERT INTO allocation_invoice_links (allocation_id, sales_invoice_id, amount)
SELECT id, invoice_id, LEAST(amount, gap - before) FROM running WHERE LEAST(amount, gap - before) > 0;

UPDATE purchase_invoices i
   SET paid_amount = i.paid_amount + t.total,
       payment_status = CASE WHEN i.paid_amount + t.total >= i.net_payable THEN 'PAID' ELSE 'PARTIAL' END,
       version = i.version + 1
  FROM (SELECT purchase_invoice_id AS id, SUM(amount) AS total FROM allocation_invoice_links WHERE purchase_invoice_id IS NOT NULL GROUP BY 1) t
 WHERE i.id = t.id;

UPDATE sales_invoices i
   SET received_amount = i.received_amount + t.total,
       receipt_status = CASE WHEN i.received_amount + t.total >= i.grand_total THEN 'PAID' ELSE 'PARTIAL' END,
       version = i.version + 1
  FROM (SELECT sales_invoice_id AS id, SUM(amount) AS total FROM allocation_invoice_links WHERE sales_invoice_id IS NOT NULL GROUP BY 1) t
 WHERE i.id = t.id;
