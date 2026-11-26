-- A scrap entry with recovered material posts a 'SCRAP_RECOVERY' move (allowed by mfg_move_kind_chk since phase 13 v2),
-- but the column was left at 10 characters, so submitting such an entry always failed.
ALTER TABLE "mfg_order_moves" ALTER COLUMN "kind" TYPE varchar(20);
