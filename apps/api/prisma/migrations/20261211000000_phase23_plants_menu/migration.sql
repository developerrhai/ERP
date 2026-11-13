-- Phase 23: plant access (one, several or all plants), plant picker, personal Menu page and Home.
-- Forward-only. Local / test databases only until the owner deploys by hand.

-- 1. Users: "all plants, including future plants" flag (Super User keeps all_units via the role).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "all_units_access" boolean NOT NULL DEFAULT false;

-- 2. Preferences: the plants the user chose to view (unit_id / all_units stay readable for one release, E-40).
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "unit_ids" uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "remember_plants" boolean NOT NULL DEFAULT false;

UPDATE "user_preferences" p
   SET "unit_ids" = CASE
         WHEN p."all_units" THEN COALESCE((SELECT array_agg(uu."unit_id") FROM "user_units" uu WHERE uu."user_id" = p."user_id"), '{}')
         WHEN p."unit_id" IS NOT NULL THEN ARRAY[p."unit_id"]
         ELSE '{}'::uuid[]
       END
 WHERE p."unit_ids" = '{}';

-- 3. The default plant must stay one of the user's plants: removing a plant clears a default that pointed at it.
CREATE OR REPLACE FUNCTION phase23_clear_default_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "users" SET "default_unit_id" = NULL WHERE "id" = OLD."user_id" AND "default_unit_id" = OLD."unit_id";
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS "user_units_clear_default" ON "user_units";
CREATE TRIGGER "user_units_clear_default" AFTER DELETE ON "user_units"
  FOR EACH ROW EXECUTE FUNCTION phase23_clear_default_unit();

-- 4. Home / Menu preferences.
CREATE TABLE IF NOT EXISTS "user_home_prefs" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "pinned_pages" text[] NOT NULL DEFAULT '{}',
  "hidden_families" text[] NOT NULL DEFAULT '{}',
  "family_order" text[] NOT NULL DEFAULT '{}',
  "favourites" text[] NOT NULL DEFAULT '{}',
  "landing" varchar(80) NOT NULL DEFAULT 'home',
  "theme" varchar(10) NOT NULL DEFAULT 'light' CHECK ("theme" IN ('light', 'dark')),
  "density" varchar(12) NOT NULL DEFAULT 'comfortable' CHECK ("density" IN ('comfortable', 'compact')),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "recent_pages" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "page_id" varchar(80) NOT NULL,
  "opened_at" timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "page_id")
);
CREATE INDEX IF NOT EXISTS "recent_pages_user_opened_idx" ON "recent_pages" ("user_id", "opened_at" DESC);

-- keep the last 20 per user
CREATE OR REPLACE FUNCTION phase23_trim_recent_pages() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "recent_pages"
   WHERE "user_id" = NEW."user_id"
     AND "page_id" NOT IN (
       SELECT "page_id" FROM "recent_pages" WHERE "user_id" = NEW."user_id" ORDER BY "opened_at" DESC LIMIT 20);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS "recent_pages_trim" ON "recent_pages";
CREATE TRIGGER "recent_pages_trim" AFTER INSERT ON "recent_pages"
  FOR EACH ROW EXECUTE FUNCTION phase23_trim_recent_pages();

CREATE TABLE IF NOT EXISTS "role_landing" (
  "role_id" uuid PRIMARY KEY REFERENCES "roles"("id") ON DELETE CASCADE,
  "landing" varchar(80) NOT NULL DEFAULT 'home',
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "role_landing_updated_by_idx" ON "role_landing" ("updated_by_id");

-- Notification type: plant access changed (audited, notifies the user).
INSERT INTO "notification_types"
  ("code", "module", "category", "label", "label_hi", "priority", "enabled",
   "allowed_channels", "default_channels", "mandatory_channels", "sensitive",
   "title_tpl", "body_tpl", "deep_link_tpl", "collapse_key_tpl", "digest_allowed")
VALUES
  ('access.plants_changed', 'System', 'ALERT', 'Plant access changed', 'प्लांट एक्सेस बदला गया',
   'HIGH', true, ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false,
   '{{title}}', '{{body}}', '/menu', 'plants:{{entityId}}', false)
ON CONFLICT ("code") DO NOTHING;

-- 5. Work counters. Created here; approvals fill them now, movements (Phase 25) and tasks / visitors / meals (Phase 29) later.
-- A NULL counter means "the module that fills it is not built yet" (the UI shows a dash, never 0).
CREATE TABLE IF NOT EXISTS "dept_work_counters" (
  "department_id" uuid NOT NULL REFERENCES "departments"("id") ON DELETE CASCADE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "receipt" integer, "accept" integer, "work" integer, "approvals" integer,
  "tasks" integer, "shifts" integer, "visitors" integer, "meals" integer,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("department_id", "unit_id")
);
CREATE INDEX IF NOT EXISTS "dept_work_counters_unit_idx" ON "dept_work_counters" ("unit_id");

CREATE TABLE IF NOT EXISTS "user_work_counters" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "my_approvals" integer, "my_tasks" integer, "my_overdue" integer, "my_drafts" integer, "my_returned" integer,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "unit_id")
);
CREATE INDEX IF NOT EXISTS "user_work_counters_unit_idx" ON "user_work_counters" ("unit_id");
