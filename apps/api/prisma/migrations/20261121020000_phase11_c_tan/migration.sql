-- Phase 11 / C: the deductor TAN is entered by the owner (never guessed). Empty until then; the TDS return refuses to
-- be called ready while it is empty.
INSERT INTO "tax_rules" ("rule_key","description","value_num","value_text","effective_from")
VALUES ('DEDUCTOR_TAN','TAN of the deductor, printed on 24Q / 26Q returns',NULL,NULL,'2017-07-01');
