-- Phase 8 verification queries (read-only). Every query must return ZERO rows after migrations A-C, the first stock
-- postings and the GL cut-over.   psql "$DATABASE_URL" -f prisma/verify/phase08-verify.sql
-- (`npm run inventory:preflight` runs the same checks through the API code.)

-- V-01 every legacy voucher got a line
SELECT 'V-01 voucher without line' AS check, v.number FROM stock_vouchers v
 WHERE v.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stock_voucher_lines l WHERE l.voucher_id = v.id);

-- V-02 balance = ledger (quantity and value)
SELECT 'V-02 balance <> ledger' AS check, b.item_id, b.warehouse_id FROM stock_balances b
 LEFT JOIN (SELECT item_id, warehouse_id, sum(qty_in - qty_out) q, sum(value) v FROM stock_ledger GROUP BY 1,2) s
   ON s.item_id = b.item_id AND s.warehouse_id = b.warehouse_id
 WHERE b.on_hand <> COALESCE(s.q,0) OR b.value <> COALESCE(s.v,0);

-- V-03 slices add up to the balance
SELECT 'V-03 slices <> balance' AS check, b.item_id, b.warehouse_id FROM stock_balances b
 LEFT JOIN (SELECT item_id, warehouse_id, sum(qty) q FROM stock_slices GROUP BY 1,2) s
   ON s.item_id = b.item_id AND s.warehouse_id = b.warehouse_id
 WHERE b.on_hand <> COALESCE(s.q,0);

-- V-04 reserved never exceeds on hand
SELECT 'V-04 reserved > on hand' AS check, item_id, warehouse_id FROM stock_balances WHERE reserved_qty > on_hand;

-- V-05 every ledger voucher type is in the lookup
SELECT 'V-05 unknown voucher type' AS check, l.voucher_type FROM stock_ledger l
 LEFT JOIN stock_voucher_types t ON t.code = l.voucher_type WHERE t.code IS NULL GROUP BY l.voucher_type;

-- V-06 a voucher posted after the GL cut-over has its journal
SELECT 'V-06 posted without journal' AS check, v.number FROM stock_vouchers v
 WHERE v.status IN ('Posted','Dispatched','Received') AND v.journal_id IS NULL
   AND v.posted_at > COALESCE((SELECT min(created_at) FROM inventory_gl_cutovers), 'infinity');

-- V-07 after the cut-over, stock value per unit = GL inventory accounts (INVENTORY_RM / WIP / FG + STOCK_IN_TRANSIT)
SELECT 'V-07 stock value <> GL' AS check, u.code,
       COALESCE((SELECT sum(l.value) FROM stock_ledger l WHERE l.unit_id = u.id), 0) AS stock_value,
       COALESCE((SELECT sum(g.debit - g.credit) FROM gl_entries g JOIN account_defaults d ON d.account_id = g.account_id
                  WHERE g.unit_id = u.id AND d.key IN ('INVENTORY_RM','INVENTORY_WIP','INVENTORY_FG','STOCK_IN_TRANSIT')), 0) AS gl_value
  FROM units u
 WHERE EXISTS (SELECT 1 FROM inventory_gl_cutovers c WHERE c.unit_id = u.id)
   AND COALESCE((SELECT sum(l.value) FROM stock_ledger l WHERE l.unit_id = u.id), 0) <>
       COALESCE((SELECT sum(g.debit - g.credit) FROM gl_entries g JOIN account_defaults d ON d.account_id = g.account_id
                  WHERE g.unit_id = u.id AND d.key IN ('INVENTORY_RM','INVENTORY_WIP','INVENTORY_FG','STOCK_IN_TRANSIT')), 0);
