-- Security review fixes (apps/api/README-PHASE1.md).

-- The REFRESH_RACE grace is granted only once per rotated refresh token.
ALTER TABLE "sessions" ADD COLUMN "grace_used_at" TIMESTAMPTZ(3);

-- loginId and email share one namespace (login accepts either): a login_id may not equal another
-- user's email and an email may not equal another user's login_id. An advisory lock per value
-- serialises concurrent writers, so the check holds even under races.
CREATE FUNCTION "users_identifier_namespace"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('users_identifier:' || NEW.login_id));
  IF NEW.email IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('users_identifier:' || NEW.email));
  END IF;
  IF EXISTS (SELECT 1 FROM "users" WHERE "id" <> NEW.id AND "email" = NEW.login_id) THEN
    RAISE EXCEPTION 'login_id collides with another user''s email'
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'users_login_id_email_namespace';
  END IF;
  IF NEW.email IS NOT NULL AND EXISTS (SELECT 1 FROM "users" WHERE "id" <> NEW.id AND "login_id" = NEW.email) THEN
    RAISE EXCEPTION 'email collides with another user''s login_id'
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'users_email_login_id_namespace';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_identifier_namespace"
  BEFORE INSERT OR UPDATE OF "login_id", "email" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "users_identifier_namespace"();
