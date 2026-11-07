-- Phase 06 M7: item data migration (data only; docs/phases/PHASE-06.md §4 "Item data migration").
-- 1. HSN rows for every distinct valid items.hsn_sac, flagged needs_review, then items.hsn_id.
INSERT INTO "hsn_sac_codes" ("code", "description", "needs_review")
SELECT DISTINCT "hsn_sac", 'Imported from item master — please describe', true
  FROM "items"
 WHERE "hsn_sac" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'
ON CONFLICT ("code") DO NOTHING;

UPDATE "items" i SET "hsn_id" = h."id"
  FROM "hsn_sac_codes" h
 WHERE h."code" = i."hsn_sac" AND i."hsn_id" IS NULL;

-- 2. One item group per distinct category; category stays as a deprecated mirror.
INSERT INTO "item_groups" ("code", "name")
SELECT DISTINCT ON (upper(regexp_replace(btrim("category"), '[^A-Za-z0-9]+', '_', 'g')))
       upper(regexp_replace(btrim("category"), '[^A-Za-z0-9]+', '_', 'g')), btrim("category")
  FROM "items"
 WHERE "category" IS NOT NULL AND btrim("category") <> ''
 ORDER BY upper(regexp_replace(btrim("category"), '[^A-Za-z0-9]+', '_', 'g')), btrim("category")
ON CONFLICT ("code") DO NOTHING;

UPDATE "items" i SET "item_group_id" = g."id"
  FROM "item_groups" g
 WHERE i."category" IS NOT NULL AND btrim(i."category") <> ''
   AND g."code" = upper(regexp_replace(btrim(i."category"), '[^A-Za-z0-9]+', '_', 'g'))
   AND i."item_group_id" IS NULL;

-- 3. alt_uom / alt_uom_factor become item_uom_conversions (the old columns are dropped in Phase 8).
INSERT INTO "item_uom_conversions" ("item_id", "uom_code", "factor")
SELECT "id", "alt_uom", "alt_uom_factor"
  FROM "items"
 WHERE "alt_uom" IS NOT NULL AND "alt_uom_factor" IS NOT NULL AND "alt_uom_factor" > 0
ON CONFLICT ("item_id", "uom_code") DO NOTHING;
