-- Phase 11 / D: every tax_documents row carries the GSTIN of its unit, whoever wrote it (Phase 7 events, Phase 9/10 feed).
UPDATE "tax_documents" t SET "gstin" = u."gstin" FROM "units" u WHERE t."unit_id" = u."id" AND t."gstin" IS NULL AND u."gstin" IS NOT NULL;
CREATE FUNCTION "tax_documents_set_gstin"() RETURNS trigger AS $$
BEGIN
  IF NEW."gstin" IS NULL THEN
    SELECT "gstin" INTO NEW."gstin" FROM "units" WHERE "id" = NEW."unit_id";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "tax_documents_gstin_trg" BEFORE INSERT ON "tax_documents" FOR EACH ROW EXECUTE FUNCTION "tax_documents_set_gstin"();
