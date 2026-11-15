// Helpers shared by the V40 tab views of the Warehouse / WMS, Logistics / Fleet / Gate and Assets pages. The engine is
// runV40View in sales/v40-views.ts (one FROM per page, a "V40 column label -> SQL expression" map, one label list per tab).
// A label with no expression has no source in the database: the screen shows a dash and the owner sees it listed.
import { ACTIONS, DOCS, apJoin, approvalCols, d, m, n, none, t } from '../sales/v40-views';
import type { Col, ColType, PageDef, PanelDef, ViewDef } from '../sales/v40-views';

export { ACTIONS, DOCS, apJoin, approvalCols, d, m, n, none, t };
export type { Col, ColType, PageDef, PanelDef, ViewDef };

export const pill = (e: string): Col => ({ e, type: 'pill' });
export const tm = (e: string): Col => ({ e, type: 'time' });

/** Columns every page has: the approval tab columns, Docs and Actions. `record` is the SQL of the row's number. */
export const common = (page: string, record: string): Record<string, Col> => ({
  ...approvalCols(record),
  Docs: DOCS(page),
  Actions: ACTIONS,
});

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);

/** A tab: its label list and what is different about it. */
export const view = (name: string | RegExp, labels: string[], extra: Partial<ViewDef> = {}): ViewDef => ({
  match: typeof name === 'string' ? new RegExp('^' + escapeRe(name) + '$', 'i') : name,
  labels,
  ...extra,
});

interface AllocSpec {
  title: string;
  from: string;
  unit: string | null;
  soft: string | null;
  where?: string[];
  id: string;
  order: string;
  record: string;
  demand: string;
  available: string;
  allocated: string;
  short: string;
  location: string;
  action: string;
}
/** The V40 "Record / Demand / Available / Allocated / Short / Location / Action" workspace, each cell computed from real rows. */
export const allocPanel = (s: AllocSpec): PanelDef => ({
  title: s.title,
  from: s.from,
  unit: s.unit,
  soft: s.soft,
  ...(s.where ? { where: s.where } : {}),
  id: s.id,
  order: s.order,
  cols: [
    ['Record', s.record, 'text'],
    ['Demand', s.demand, 'num'],
    ['Available', s.available, 'num'],
    ['Allocated', s.allocated, 'num'],
    ['Short', s.short, 'num'],
    ['Location', s.location, 'text'],
    ['Action', s.action, 'actions'],
  ],
});

/** The V40 "Role / View / Add / Edit / Delete / Approve / Export" panel: the real role_permissions row of each role for the page. */
export const securityPanel = (page: string): PanelDef => ({
  title: 'Who can do what on this page',
  from: `roles p LEFT JOIN LATERAL (SELECT rp.* FROM role_permissions rp WHERE rp.role_id = p.id AND rp.resource IN ('${page}', '*') ORDER BY (rp.resource = '*') LIMIT 1) rp ON true`,
  unit: null,
  soft: null,
  where: [`p.status = 'ACTIVE'`],
  order: 'p.level, p.name',
  cols: [
    ['Role', 'p.name', 'text'],
    ['View', `CASE WHEN rp.view THEN 'Yes' ELSE 'No' END`, 'text'],
    ['Add', `CASE WHEN rp.add THEN 'Yes' ELSE 'No' END`, 'text'],
    ['Edit', `CASE WHEN rp.edit THEN 'Yes' ELSE 'No' END`, 'text'],
    ['Delete', `CASE WHEN rp.delete THEN 'Yes' ELSE 'No' END`, 'text'],
    ['Approve', `CASE WHEN rp.approve THEN 'Yes' ELSE 'No' END`, 'text'],
    ['Export', `CASE WHEN rp.export THEN 'Yes' ELSE 'No' END`, 'text'],
  ],
});

/** The V40 "Validation Rule / Pass / Warning / Fail / Action" panel: one row per rule, counts over the page's real rows. */
export const rulePanel = (
  title: string,
  rules: { rule: string; pass: string; warn: string; fail: string }[],
  base: string,
  /** SQL after WHERE; may hold {SCOPE:alias} for the plant / soft-delete scope of a table that has unit_id and deleted_at */
  where: string,
): PanelDef => ({
  title,
  from: `(SELECT rl.rule, count(*) FILTER (WHERE rl.pass) AS pass, count(*) FILTER (WHERE rl.warn) AS warn, count(*) FILTER (WHERE rl.fail) AS fail
    FROM ${base} CROSS JOIN LATERAL (VALUES ${rules
      .map((r) => `('${r.rule}', ${r.pass}, ${r.warn}, ${r.fail})`)
      .join(', ')}) rl(rule, pass, warn, fail) WHERE ${where} GROUP BY rl.rule) p`,
  unit: null,
  soft: null,
  order: 'p.rule',
  cols: [
    ['Validation Rule', 'p.rule', 'text'],
    ['Pass', 'p.pass', 'num'],
    ['Warning', 'p.warn', 'num'],
    ['Fail', 'p.fail', 'num'],
    ['Action', `CASE WHEN p.fail > 0 THEN 'Fix' END`, 'actions'],
  ],
});

/** The V40 "Exception / Record / Severity / Age / Root Cause / Owner / Action" panel. */
export const exceptionPanel = (s: {
  title: string;
  from: string;
  unit: string | null;
  soft: string | null;
  where: string[];
  id: string;
  order: string;
  exception: string;
  record: string;
  severity: string;
  age: string;
  cause: string;
  owner: string;
}): PanelDef => ({
  title: s.title,
  from: s.from,
  unit: s.unit,
  soft: s.soft,
  where: s.where,
  id: s.id,
  order: s.order,
  cols: [
    ['Exception', s.exception, 'text'],
    ['Record', s.record, 'text'],
    ['Severity', s.severity, 'text'],
    ['Age', s.age, 'text'],
    ['Root Cause', s.cause, 'text'],
    ['Owner', s.owner, 'text'],
    ['Action', `'Review'`, 'actions'],
  ],
});

/** Age in days since a timestamp, as text. */
export const ageDays = (e: string): string => `GREATEST(CURRENT_DATE - (${e})::date, 0)::text || ' d'`;
