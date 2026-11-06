-- Phase 05 M1: approval engine (docs/phases/PHASE-05.md §4).
-- Rule sets and levels (the matrix), requests, steps, step assignees, append-only actions, delegations.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "approval_rule_sets" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "department_id" UUID NOT NULL REFERENCES "departments"("id") ON DELETE RESTRICT,
  "doc_type" VARCHAR(80),
  "unit_id" UUID REFERENCES "units"("id") ON DELETE RESTRICT,
  "no_amount_levels" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "approval_rule_sets_no_amount_chk" CHECK ("no_amount_levels" BETWEEN 1 AND 10),
  CONSTRAINT "approval_rule_sets_key_uq" UNIQUE NULLS NOT DISTINCT ("department_id", "doc_type", "unit_id")
);
CREATE INDEX "approval_rule_sets_department_idx" ON "approval_rule_sets"("department_id");
CREATE INDEX "approval_rule_sets_unit_idx" ON "approval_rule_sets"("unit_id");
CREATE INDEX "approval_rule_sets_created_by_idx" ON "approval_rule_sets"("created_by_id");
CREATE INDEX "approval_rule_sets_updated_by_idx" ON "approval_rule_sets"("updated_by_id");

CREATE TABLE "approval_rules" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "rule_set_id" UUID NOT NULL REFERENCES "approval_rule_sets"("id") ON DELETE CASCADE,
  "level" INTEGER NOT NULL,
  "threshold" NUMERIC(18,2) NOT NULL,
  "approver_role_id" UUID REFERENCES "roles"("id") ON DELETE RESTRICT,
  "approver_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "sla_hours" INTEGER NOT NULL DEFAULT 48,
  "escalate_role_id" UUID REFERENCES "roles"("id") ON DELETE RESTRICT,
  "escalate_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "approval_rules_level_chk" CHECK ("level" BETWEEN 1 AND 10),
  CONSTRAINT "approval_rules_threshold_chk" CHECK ("threshold" >= 0),
  CONSTRAINT "approval_rules_sla_chk" CHECK ("sla_hours" BETWEEN 1 AND 720),
  CONSTRAINT "approval_rules_one_approver_chk" CHECK (("approver_role_id" IS NULL) <> ("approver_user_id" IS NULL)),
  CONSTRAINT "approval_rules_level_uq" UNIQUE ("rule_set_id", "level")
);
CREATE INDEX "approval_rules_role_idx" ON "approval_rules"("approver_role_id");
CREATE INDEX "approval_rules_user_idx" ON "approval_rules"("approver_user_id");
CREATE INDEX "approval_rules_escalate_role_idx" ON "approval_rules"("escalate_role_id");
CREATE INDEX "approval_rules_escalate_user_idx" ON "approval_rules"("escalate_user_id");

CREATE TABLE "approval_requests" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "doc_type" VARCHAR(80) NOT NULL,
  "doc_id" UUID NOT NULL,
  "doc_code" VARCHAR(60) NOT NULL,
  "doc_title" VARCHAR(200) NOT NULL,
  "unit_id" UUID NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "department_id" UUID NOT NULL REFERENCES "departments"("id") ON DELETE RESTRICT,
  "amount" NUMERIC(18,2),
  "rule_set_id" UUID REFERENCES "approval_rule_sets"("id") ON DELETE SET NULL,
  "rule_set_version" INTEGER,
  "cycle" INTEGER NOT NULL DEFAULT 1,
  "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
  "current_level" INTEGER NOT NULL DEFAULT 1,
  "total_levels" INTEGER NOT NULL DEFAULT 1,
  "requested_by" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMPTZ(3),
  "doc_version" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "approval_requests_status_chk" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','RETURNED','WITHDRAWN','CANCELLED'))
);
-- One open request per document: a second submit hits this index (409 ALREADY_PENDING).
CREATE UNIQUE INDEX "approval_requests_one_pending_uq" ON "approval_requests"("doc_type", "doc_id") WHERE "status" = 'PENDING';
CREATE INDEX "approval_requests_status_dept_idx" ON "approval_requests"("status", "department_id");
CREATE INDEX "approval_requests_requester_idx" ON "approval_requests"("requested_by", "status");
CREATE INDEX "approval_requests_doc_idx" ON "approval_requests"("doc_type", "doc_id");
CREATE INDEX "approval_requests_unit_idx" ON "approval_requests"("unit_id");
CREATE INDEX "approval_requests_department_idx" ON "approval_requests"("department_id");
CREATE INDEX "approval_requests_rule_set_idx" ON "approval_requests"("rule_set_id");
CREATE INDEX "approval_requests_creator_idx" ON "approval_requests"("created_by_id");

CREATE TABLE "approval_steps" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL REFERENCES "approval_requests"("id") ON DELETE CASCADE,
  "level" INTEGER NOT NULL,
  "rule_id" UUID REFERENCES "approval_rules"("id") ON DELETE SET NULL,
  "threshold" NUMERIC(18,2) NOT NULL DEFAULT 0,
  "approver_role_id" UUID REFERENCES "roles"("id") ON DELETE RESTRICT,
  "approver_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "limit_required" NUMERIC(18,2),
  "sla_hours" INTEGER NOT NULL DEFAULT 48,
  "status" VARCHAR(12) NOT NULL DEFAULT 'WAITING',
  "activated_at" TIMESTAMPTZ(3),
  "due_at" TIMESTAMPTZ(3),
  "escalated_at" TIMESTAMPTZ(3),
  "escalate_role_id" UUID REFERENCES "roles"("id") ON DELETE RESTRICT,
  "escalate_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "acted_by" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "on_behalf_of" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "acted_at" TIMESTAMPTZ(3),
  "comment" VARCHAR(1000),
  CONSTRAINT "approval_steps_status_chk" CHECK ("status" IN ('WAITING','PENDING','APPROVED','REJECTED','RETURNED','CANCELLED')),
  CONSTRAINT "approval_steps_level_uq" UNIQUE ("request_id", "level")
);
CREATE INDEX "approval_steps_status_due_idx" ON "approval_steps"("status", "due_at");
CREATE INDEX "approval_steps_rule_idx" ON "approval_steps"("rule_id");
CREATE INDEX "approval_steps_role_idx" ON "approval_steps"("approver_role_id");
CREATE INDEX "approval_steps_user_idx" ON "approval_steps"("approver_user_id");
CREATE INDEX "approval_steps_escalate_role_idx" ON "approval_steps"("escalate_role_id");
CREATE INDEX "approval_steps_escalate_user_idx" ON "approval_steps"("escalate_user_id");
CREATE INDEX "approval_steps_acted_by_idx" ON "approval_steps"("acted_by");
CREATE INDEX "approval_steps_on_behalf_idx" ON "approval_steps"("on_behalf_of");

CREATE TABLE "approval_step_assignees" (
  "step_id" UUID NOT NULL REFERENCES "approval_steps"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "via" VARCHAR(12) NOT NULL,
  "on_behalf_of" UUID REFERENCES "users"("id") ON DELETE CASCADE,
  PRIMARY KEY ("step_id", "user_id"),
  CONSTRAINT "approval_step_assignees_via_chk" CHECK ("via" IN ('ROLE','USER','DELEGATION','ESCALATION','REASSIGN'))
);
CREATE INDEX "approval_step_assignees_user_idx" ON "approval_step_assignees"("user_id");
CREATE INDEX "approval_step_assignees_behalf_idx" ON "approval_step_assignees"("on_behalf_of");

CREATE TABLE "approval_actions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL REFERENCES "approval_requests"("id") ON DELETE CASCADE,
  "step_id" UUID REFERENCES "approval_steps"("id") ON DELETE CASCADE,
  "action" VARCHAR(16) NOT NULL,
  "actor_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "on_behalf_of" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "comment" VARCHAR(1000),
  "from_status" VARCHAR(30),
  "to_status" VARCHAR(30),
  "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotency_key" VARCHAR(128),
  CONSTRAINT "approval_actions_action_chk" CHECK ("action" IN ('SUBMIT','AUTO_APPROVED','APPROVE','REJECT','RETURN','WITHDRAW','ESCALATE','REMIND','REASSIGN','CANCEL'))
);
CREATE INDEX "approval_actions_request_idx" ON "approval_actions"("request_id", "at");
CREATE INDEX "approval_actions_step_idx" ON "approval_actions"("step_id");
CREATE INDEX "approval_actions_actor_idx" ON "approval_actions"("actor_id");
CREATE INDEX "approval_actions_behalf_idx" ON "approval_actions"("on_behalf_of");
-- A step is decided once; one user approves at most one level of a request (the last guard).
CREATE UNIQUE INDEX "approval_actions_one_decision_uq" ON "approval_actions"("step_id") WHERE "action" IN ('APPROVE','REJECT','RETURN');
CREATE UNIQUE INDEX "approval_actions_one_approve_per_user_uq" ON "approval_actions"("request_id", "actor_id") WHERE "action" = 'APPROVE';

-- approval_actions is append-only, like audit_logs (rows only disappear with their request).
CREATE FUNCTION "approval_actions_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'approval_actions is append-only (% is not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "approval_actions_no_update"
  BEFORE UPDATE ON "approval_actions" FOR EACH ROW EXECUTE FUNCTION "approval_actions_append_only"();

CREATE TABLE "approval_delegations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "from_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "to_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "department_id" UUID REFERENCES "departments"("id") ON DELETE RESTRICT,
  "from_date" DATE NOT NULL,
  "to_date" DATE NOT NULL,
  "reason" VARCHAR(300),
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "approval_delegations_status_chk" CHECK ("status" IN ('ACTIVE','REVOKED')),
  CONSTRAINT "approval_delegations_self_chk" CHECK ("to_user_id" <> "from_user_id"),
  CONSTRAINT "approval_delegations_range_chk" CHECK ("to_date" >= "from_date" AND "to_date" - "from_date" <= 90),
  CONSTRAINT "approval_delegations_no_overlap" EXCLUDE USING gist (
    "from_user_id" WITH =,
    daterange("from_date", "to_date", '[]') WITH &&
  ) WHERE ("status" = 'ACTIVE')
);
CREATE INDEX "approval_delegations_to_idx" ON "approval_delegations"("to_user_id", "status");
CREATE INDEX "approval_delegations_department_idx" ON "approval_delegations"("department_id");
CREATE INDEX "approval_delegations_created_by_idx" ON "approval_delegations"("created_by_id");
CREATE INDEX "approval_delegations_updated_by_idx" ON "approval_delegations"("updated_by_id");
