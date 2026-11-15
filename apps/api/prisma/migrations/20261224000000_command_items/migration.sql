-- Command Center (V40 page command-center): items a person adds by hand to the control tower (issue, owner, severity, due date).
-- Open department movements are shown next to them on the page; these rows are the manually added ones. Plant scoped.
CREATE SEQUENCE IF NOT EXISTS command_item_seq;

CREATE TABLE IF NOT EXISTS command_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       uuid NOT NULL REFERENCES units(id),
  number        text NOT NULL,
  department_id uuid REFERENCES departments(id),
  issue         text NOT NULL,
  owner_name    text,
  severity      text NOT NULL DEFAULT 'Medium' CHECK (severity IN ('Critical', 'High', 'Medium', 'Low')),
  due_date      date,
  status        text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Closed')),
  closed_at     timestamptz,
  closed_by_id  uuid REFERENCES users(id),
  created_by_id uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT command_items_number_uq UNIQUE (number)
);

CREATE INDEX IF NOT EXISTS command_items_unit_status_idx ON command_items (unit_id, status);
CREATE INDEX IF NOT EXISTS command_items_created_by_idx ON command_items (created_by_id);
CREATE INDEX IF NOT EXISTS command_items_closed_by_idx ON command_items (closed_by_id);
CREATE INDEX IF NOT EXISTS command_items_department_idx ON command_items (department_id);
