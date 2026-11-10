-- Phase 15 Part C: Time, Shifts and Attendance (Biometric files and automatic sync)

CREATE TABLE "shifts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(20) NOT NULL UNIQUE,
  "name" varchar(60) NOT NULL,
  "start_time" time NOT NULL,
  "end_time" time NOT NULL,
  "break_minutes" integer NOT NULL DEFAULT 30,
  "grace_in_minutes" integer NOT NULL DEFAULT 10,
  "grace_out_minutes" integer NOT NULL DEFAULT 0,
  "half_day_minutes" integer NOT NULL DEFAULT 240,
  "absent_below_minutes" integer NOT NULL DEFAULT 240,
  "full_day_minutes" integer NOT NULL DEFAULT 450,
  "ot_start_after_minutes" integer,
  "ot_block_minutes" integer NOT NULL DEFAULT 15,
  "ot_min_minutes" integer NOT NULL DEFAULT 30,
  "is_night" boolean NOT NULL DEFAULT false,
  "crosses_midnight" boolean NOT NULL DEFAULT false,
  "window_before_minutes" integer NOT NULL DEFAULT 120,
  "window_after_minutes" integer NOT NULL DEFAULT 120,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now()
);

-- Seed standard shifts
INSERT INTO "shifts" ("code","name","start_time","end_time","break_minutes","grace_in_minutes","grace_out_minutes","half_day_minutes","absent_below_minutes","full_day_minutes","is_night","crosses_midnight") VALUES
  ('GEN', 'General Shift', '09:00', '17:30', 30, 15, 0, 240, 240, 480, false, false),
  ('MORNING', 'Morning Shift', '07:00', '15:30', 30, 10, 0, 240, 240, 450, false, false),
  ('EVENING', 'Evening Shift', '15:00', '23:30', 30, 10, 0, 240, 240, 450, false, false),
  ('NIGHT', 'Night Shift', '23:00', '07:30', 30, 10, 0, 240, 240, 450, true, true);

CREATE TABLE "shift_rotation_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL,
  "pattern" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "shift_rosters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "roster_date" date NOT NULL,
  "shift_id" uuid REFERENCES "shifts"("id") ON DELETE SET NULL,
  "is_off" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "shift_rosters_emp_date_uq" ON "shift_rosters"("employee_id", "roster_date");

CREATE TABLE "weekly_off_patterns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(60) NOT NULL,
  "days" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "employee_weekly_off" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL UNIQUE REFERENCES "employees"("id") ON DELETE CASCADE,
  "pattern_id" uuid REFERENCES "weekly_off_patterns"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "holiday_calendars" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "year" integer NOT NULL,
  "name" varchar(100) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "holiday_cal_unit_year_uq" ON "holiday_calendars"("unit_id", "year");

CREATE TABLE "holidays" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "calendar_id" uuid NOT NULL REFERENCES "holiday_calendars"("id") ON DELETE CASCADE,
  "holiday_date" date NOT NULL,
  "name" varchar(100) NOT NULL,
  "type" varchar(20) NOT NULL DEFAULT 'MANDATORY',
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "holidays_cal_date_uq" ON "holidays"("calendar_id", "holiday_date");

CREATE TABLE "attendance_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(30) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "vendor" varchar(30) NOT NULL,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "location" varchar(100),
  "serial_no" varchar(60),
  "base_url" varchar(255),
  "api_key_ref" varchar(60),
  "poll_interval_sec" integer NOT NULL DEFAULT 60,
  "overlap_min" integer NOT NULL DEFAULT 15,
  "timeout_ms" integer NOT NULL DEFAULT 10000,
  "fail_limit" integer NOT NULL DEFAULT 5,
  "offline_alert_min" integer NOT NULL DEFAULT 30,
  "cursor_at" timestamptz(3),
  "last_ok_at" timestamptz(3),
  "last_error" text,
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "att_dev_vendor_chk" CHECK ("vendor" IN ('FILE_ZKTECO','FILE_ESSL','API_SMART_OFFICE'))
);

CREATE TABLE "attendance_import_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "vendor" varchar(30) NOT NULL,
  "source_kind" varchar(10) NOT NULL,
  "mapping" jsonb NOT NULL,
  "delimiter" varchar(5),
  "timezone" varchar(40) NOT NULL DEFAULT 'Asia/Kolkata',
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "attendance_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "file_sha256" varchar(64) NOT NULL UNIQUE,
  "original_name" varchar(255) NOT NULL,
  "profile_id" uuid REFERENCES "attendance_import_profiles"("id") ON DELETE SET NULL,
  "imported_count" integer NOT NULL DEFAULT 0,
  "unknown_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "attendance_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "device_id" uuid NOT NULL REFERENCES "attendance_devices"("id") ON DELETE CASCADE,
  "window_from" timestamptz(3) NOT NULL,
  "window_to" timestamptz(3) NOT NULL,
  "trigger" varchar(20) NOT NULL DEFAULT 'SCHEDULE',
  "started_at" timestamptz(3) NOT NULL DEFAULT now(),
  "finished_at" timestamptz(3),
  "fetched" integer NOT NULL DEFAULT 0,
  "inserted" integer NOT NULL DEFAULT 0,
  "duplicates" integer NOT NULL DEFAULT 0,
  "unknown_codes" integer NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'OK',
  "error" text,
  "triggered_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "attendance_punches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "device_id" uuid REFERENCES "attendance_devices"("id") ON DELETE SET NULL,
  "biometric_code" varchar(40) NOT NULL,
  "punch_at" timestamptz(3) NOT NULL,
  "direction" varchar(5),
  "source" varchar(20) NOT NULL DEFAULT 'DEVICE',
  "import_id" uuid REFERENCES "attendance_imports"("id") ON DELETE SET NULL,
  "sync_run_id" uuid REFERENCES "attendance_sync_runs"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "att_punch_source_chk" CHECK ("source" IN ('DEVICE','API','ESS_GEO','MANUAL'))
);
CREATE UNIQUE INDEX "att_punch_uq" ON "attendance_punches"("device_id", "biometric_code", "punch_at");

CREATE TABLE "attendance_punch_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "punch_id" uuid NOT NULL REFERENCES "attendance_punches"("id") ON DELETE CASCADE,
  "device_id" uuid REFERENCES "attendance_devices"("id") ON DELETE SET NULL,
  "biometric_code" varchar(40) NOT NULL,
  "punch_at" timestamptz(3) NOT NULL,
  "sync_run_id" uuid REFERENCES "attendance_sync_runs"("id") ON DELETE SET NULL,
  "resolved_employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "resolved_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "attendance_days" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "attendance_date" date NOT NULL,
  "shift_id" uuid REFERENCES "shifts"("id") ON DELETE SET NULL,
  "first_in" timestamptz(3),
  "last_out" timestamptz(3),
  "worked_minutes" integer NOT NULL DEFAULT 0,
  "late_minutes" integer NOT NULL DEFAULT 0,
  "early_minutes" integer NOT NULL DEFAULT 0,
  "ot_candidate_minutes" integer NOT NULL DEFAULT 0,
  "ot_approved_minutes" integer NOT NULL DEFAULT 0,
  "status" varchar(10) NOT NULL DEFAULT 'A',
  "flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "locked" boolean NOT NULL DEFAULT false,
  "regularized" boolean NOT NULL DEFAULT false,
  "regularized_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "regularized_at" timestamptz(3),
  "regularize_reason" varchar(300),
  "rule_snapshot" jsonb,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "att_day_status_chk" CHECK ("status" IN ('P','HD','A','WO','H','L','LHD','MIS','WOP','HP'))
);
CREATE UNIQUE INDEX "att_day_emp_date_uq" ON "attendance_days"("employee_id", "attendance_date");

CREATE TABLE "attendance_regularisations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "attendance_date" date NOT NULL,
  "requested_status" varchar(10) NOT NULL,
  "requested_in" timestamptz(3),
  "requested_out" timestamptz(3),
  "reason" varchar(300) NOT NULL,
  "approval_request_id" uuid,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING_APPROVAL',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "ot_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "attendance_date" date NOT NULL,
  "minutes" integer NOT NULL,
  "decision" varchar(20) NOT NULL DEFAULT 'OT_PAY',
  "approval_request_id" uuid,
  "status" varchar(20) NOT NULL DEFAULT 'APPROVED',
  "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ot_decision_chk" CHECK ("decision" IN ('OT_PAY','COMP_OFF'))
);

CREATE TABLE "attendance_period_summary" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "payable_days" numeric(5,2) NOT NULL DEFAULT 0,
  "present_days" numeric(5,2) NOT NULL DEFAULT 0,
  "wo_days" numeric(5,2) NOT NULL DEFAULT 0,
  "holiday_days" numeric(5,2) NOT NULL DEFAULT 0,
  "paid_leave_days" numeric(5,2) NOT NULL DEFAULT 0,
  "lop_days" numeric(5,2) NOT NULL DEFAULT 0,
  "ot_minutes" integer NOT NULL DEFAULT 0,
  "night_shifts" integer NOT NULL DEFAULT 0,
  "late_marks" integer NOT NULL DEFAULT 0,
  "locked" boolean NOT NULL DEFAULT false,
  "locked_at" timestamptz(3),
  "locked_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "att_summary_emp_period_uq" ON "attendance_period_summary"("employee_id", "period_start", "period_end");

