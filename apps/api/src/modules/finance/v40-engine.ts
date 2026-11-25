// V40 tab views of the Finance & Accounts and Indian Taxation pages (page-by-page build). Same idea as the Sales engine
// (apps/api/src/modules/sales/v40-views.ts): one endpoint per family, GET /finance/v40/:pageId?tab=<V40 tab name> and
// GET /tax/v40/:pageId?tab=..., answers every tab of a page with the columns V40 shows on that tab and values from the
// real tables (open_items, gl_entries, payments, journals, tax_documents, gst_returns ...):
//   * each page has one FROM and a map "V40 column label -> SQL expression";
//   * each tab is a list of labels plus an optional side panel (settlement, ledger, allocation, exceptions, validation);
//   * a column with no real source returns NULL (the screen shows a dash) and is listed in noSource. Nothing is invented.
// Plant scope is applied exactly like the registers (unit_id of the document / ledger row).
import { prisma } from '../../core/db/prisma';
import { scopeFor, accessUserOf } from '../../core/rbac/access';
import type { Caller } from '../records/service';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';

export type ColType = 'text' | 'date' | 'inr' | 'num' | 'pill' | 'docs' | 'actions' | 'time';
export interface Col {
  /** SQL expression (text-castable); absent = no real source yet */
  e?: string;
  type: ColType;
}
export interface PanelDef {
  title: string;
  /** FROM ... (alias p) - may carry {SCOPE:alias[:nosoft]} markers */
  from: string;
  unit: string | null;
  soft: string | null;
  where?: string[];
  /** SQL of the row id the panel buttons act on */
  id?: string;
  order: string;
  cols: [label: string, expr: string | undefined, type: ColType][];
}
export interface Kpi {
  label: string;
  e: string;
  type: 'inr' | 'num' | 'text';
}
export interface ViewDef {
  match: RegExp;
  labels: string[];
  from?: string;
  where?: string[];
  order?: string;
  panel?: PanelDef;
  kpis?: Kpi[];
  audit?: boolean;
}
export interface PageDef {
  from: string;
  unit?: string | null;
  soft?: string | null;
  /** SQL of the row id (default t.id) */
  id?: string;
  number: string;
  status: string;
  search: string[];
  /** always applied */
  base?: string[];
  /** applied on tabs that do not set their own `where` */
  dflt?: string[];
  order: string;
  cols: Record<string, Col>;
  register: string[];
  compact: string[];
  views: ViewDef[];
  /** the money column the Analytics tab totals */
  metric?: { label: string; e: string };
  /** the date the Calendar tab orders by */
  calendar?: string;
  /** fills columns whose value comes from a service (e.g. the GSTR-3B build) after the rows are read; keys = label -> column key */
  enrich?: (rows: Row[], keys: Record<string, string>) => Promise<void>;
}

/** approval join for pages whose rows are not approval documents: it never matches, so the Approvals tab is empty and truthful */
export const NOAP = `LEFT JOIN LATERAL (SELECT NULL::uuid AS id, NULL::text AS status, NULL::numeric AS amount, NULL::uuid AS department_id WHERE false) ap ON true`;

export const t = (e?: string): Col => (e ? { e, type: 'text' } : { type: 'text' });
export const d = (e: string): Col => ({ e, type: 'date' });
export const m = (e: string): Col => ({ e, type: 'inr' });
export const n = (e: string): Col => ({ e, type: 'num' });
export const pill = (e: string): Col => ({ e, type: 'pill' });
export const none = (type: ColType = 'text'): Col => ({ type });
export const ACTIONS: Col = { type: 'actions' };
export const DOCS = (page: string): Col => ({
  e: `(SELECT count(*)::int FROM record_documents rd WHERE rd.page_id='${page}' AND rd.record_id=t.id AND rd.deleted_at IS NULL)`,
  type: 'docs',
});

/** Latest approval request of the row (approval_requests.doc_type = page id) and the role it waits on. */
export const apJoin = (page: string, idCol = 't.id'): string =>
  `LEFT JOIN LATERAL (SELECT ar.id, ar.status, ar.amount, ar.department_id FROM approval_requests ar WHERE ar.doc_type='${page}' AND ar.doc_id=${idCol} ORDER BY ar.cycle DESC LIMIT 1) ap ON true`;
export const approvalCols = (record: string): Record<string, Col> => ({
  Request: t(`upper(left(ap.id::text,8))`),
  Record: t(record),
  Department: t(`(SELECT dp.name FROM departments dp WHERE dp.id=ap.department_id)`),
  Amount: m('ap.amount'),
  'Current Role': t(
    `(SELECT COALESCE(ro.name,us.name) FROM approval_steps st LEFT JOIN roles ro ON ro.id=st.approver_role_id LEFT JOIN users us ON us.id=st.approver_user_id WHERE st.request_id=ap.id AND st.status='PENDING' ORDER BY st.level LIMIT 1)`,
  ),
  'Approval Status': t('ap.status'),
});
const APPROVAL_LABELS = ['Request', 'Record', 'Department', 'Amount', 'Current Role', 'Status', 'Actions'];

// ------------------------------------------------------------------------------------------------ panel factories
const PARTY_NAME = (alias: string, typeCol: string, idCol: string): string =>
  `(CASE ${typeCol} WHEN 'CUSTOMER' THEN (SELECT x.name FROM customers x WHERE x.id=${idCol}) WHEN 'SUPPLIER' THEN (SELECT x.name FROM suppliers x WHERE x.id=${idCol}) WHEN 'EMPLOYEE' THEN (SELECT trim(x.first_name||' '||COALESCE(x.last_name,'')) FROM employees x WHERE x.id=${idCol}) END)`.replace(
    /\balias\b/g,
    alias,
  );
export const partyName = PARTY_NAME;

/** "Reference | Due | Amount | Allocated | Balance | Action": open items still to be settled. */
export const settlePanel = (
  title: string,
  side: 'RECEIVABLE' | 'PAYABLE',
  types: string[],
  credit = false,
): PanelDef => ({
  title,
  from: 'open_items p',
  unit: 'p.unit_id',
  soft: null,
  id: 'COALESCE(p.doc_id,p.id)',
  where: [
    `p.side='${side}'`,
    `p.item_type IN (${types.map((x) => `'${x}'`).join(',')})`,
    `p.status<>'Cancelled'`,
    credit ? 'p.outstanding<0' : 'p.outstanding>0',
  ],
  order: 'p.due_date NULLS LAST, p.doc_no',
  cols: [
    ['Reference', 'p.doc_no', 'text'],
    ['Due', 'p.due_date', 'date'],
    ['Amount', 'abs(p.amount)', 'inr'],
    ['Allocated', 'p.settled_amount', 'inr'],
    ['Balance', 'abs(p.outstanding)', 'inr'],
    ['Action', `CASE WHEN p.outstanding<>0 THEN 'Allocate' END`, 'actions'],
  ],
});

/** "Date | Reference | Particulars | Debit | Credit | Balance | Action": ledger lines with a running balance. */
export const ledgerPanel = (title: string, where: string[], extraFrom = ''): PanelDef => ({
  title,
  from: `gl_entries p JOIN accounts pa ON pa.id=p.account_id ${extraFrom}`,
  unit: 'p.unit_id',
  soft: null,
  where,
  order: 'p.posting_date DESC, p.seq DESC',
  cols: [
    ['Date', 'p.posting_date', 'date'],
    ['Reference', 'p.voucher_no', 'text'],
    ['Particulars', `COALESCE(NULLIF(p.narration,''), pa.name)`, 'text'],
    ['Debit', 'p.debit', 'inr'],
    ['Credit', 'p.credit', 'inr'],
    ['Balance', 'sum(p.debit-p.credit) OVER (ORDER BY p.posting_date, p.seq)', 'inr'],
    ['Action', undefined, 'actions'],
  ],
});

/** "Record | Demand | Available | Allocated | Short | Location | Action": V40's allocation table; only what has a real meaning is filled. */
export const allocPanel = (
  title: string,
  from: string,
  unit: string | null,
  order: string,
  v: {
    record: string;
    demand?: string;
    available?: string;
    allocated?: string;
    short?: string;
    where?: string[];
    id?: string;
    action?: string;
    soft?: string | null;
  },
): PanelDef => {
  const p: PanelDef = {
    title,
    from,
    unit,
    soft: v.soft ?? null,
    order,
    cols: [
      ['Record', v.record, 'text'],
      ['Demand', v.demand, 'inr'],
      ['Available', v.available, 'inr'],
      ['Allocated', v.allocated, 'inr'],
      ['Short', v.short, 'inr'],
      ['Location', undefined, 'text'],
      ['Action', v.action, 'actions'],
    ],
  };
  if (v.where) p.where = v.where;
  if (v.id) p.id = v.id;
  return p;
};

/** "Exception | Record | Severity | Age | Root Cause | Owner | Action": one SELECT per exception rule (rows come from the real tables). */
export const exceptionPanel = (title: string, selects: string[]): PanelDef => ({
  title,
  from: `(${selects.join(' UNION ALL ')}) p`,
  unit: null,
  soft: null,
  order: 'p.sev_no DESC, p.age DESC NULLS LAST, p.record',
  cols: [
    ['Exception', 'p.exception', 'text'],
    ['Record', 'p.record', 'text'],
    ['Severity', 'p.severity', 'pill'],
    ['Age', 'p.age', 'num'],
    ['Root Cause', 'p.cause', 'text'],
    ['Owner', undefined, 'text'],
    ['Action', undefined, 'actions'],
  ],
});
/** One row of an exception select. Scope markers inside `fromWhere` are expanded by the engine. */
export const exc = (
  exception: string,
  record: string,
  severity: string,
  age: string,
  cause: string,
  fromWhere: string,
): string =>
  `SELECT '${exception}'::text AS exception, (${record})::text AS record, '${severity}'::text AS severity, ${severity === 'High' ? 3 : severity === 'Medium' ? 2 : 1} AS sev_no, (${age})::int AS age, (${cause})::text AS cause ${fromWhere}`;

/** "Validation Rule | Pass | Warning | Fail | Action": each rule is [name, pass SQL, warning SQL, fail SQL] (counts). */
export const validationPanel = (
  title: string,
  rules: [rule: string, pass: string, warn: string, fail: string][],
): PanelDef => ({
  title,
  from: `(${rules
    .map(
      ([r, p, w, f], i) =>
        `SELECT ${i} AS ord, '${r.replace(/'/g, "''")}'::text AS rule, (${p})::int AS pass, (${w})::int AS warn, (${f})::int AS fail`,
    )
    .join(' UNION ALL ')}) p`,
  unit: null,
  soft: null,
  order: 'p.ord',
  cols: [
    ['Validation Rule', 'p.rule', 'text'],
    ['Pass', 'p.pass', 'num'],
    ['Warning', 'p.warn', 'num'],
    ['Fail', 'p.fail', 'num'],
    ['Action', undefined, 'actions'],
  ],
});

// ------------------------------------------------------------------------------------------------ engine
export interface V40Query {
  tab: string;
  first: boolean;
  q?: string | undefined;
  status?: string | undefined;
  page: number;
  size: number;
}
export interface V40Column {
  key: string;
  label: string;
  type: ColType;
  /** false = V40 shows this column but the database has no source for it (dash) */
  source: boolean;
}
export interface V40Card {
  label: string;
  value: string | null;
  type: 'inr' | 'num' | 'text';
}
export interface V40Result {
  columns: V40Column[];
  rows: Row[];
  total: number;
  panel?: { title: string; columns: V40Column[]; rows: Row[] };
  cards: V40Card[];
  distribution: { label: string; count: number }[];
  audit: boolean;
  calendar: boolean;
  view: string;
}

function resolveView(def: PageDef, q: V40Query): { labels: string[]; view: ViewDef | null; approvals: boolean } {
  const name = q.tab.trim();
  const hit = def.views.find((v) => v.match.test(name));
  if (hit) return { labels: hit.labels, view: hit, approvals: false };
  if (q.first) return { labels: def.register, view: null, approvals: false };
  if (/approval/i.test(name))
    return {
      labels: [...APPROVAL_LABELS, ...def.compact.filter((l) => l !== 'Status' && l !== 'Actions')],
      view: null,
      approvals: true,
    };
  return { labels: def.compact, view: null, approvals: false };
}

const cast = (c: Col): string => {
  if (!c.e) return 'NULL::text';
  if (c.type === 'date') return `to_char((${c.e})::date,'YYYY-MM-DD')`;
  return `(${c.e})::text`;
};

async function scopeParts(
  caller: Caller,
  pageId: string,
  unit: string | null,
  soft: string | null,
  owner: string | null,
  args: unknown[],
): Promise<string[]> {
  const parts: string[] = [];
  if (soft) parts.push(`${soft} IS NULL`);
  if (unit) {
    if (caller.ctx.unitId) {
      args.push(caller.ctx.unitId);
      parts.push(`${unit} = $${args.length}::uuid`);
    } else if (!caller.ctx.allUnits) parts.push('false');
  }
  if (owner && (await scopeFor(accessUserOf(caller.auth.user), pageId)) === 'OWN') {
    args.push(caller.auth.userId);
    parts.push(`${owner} = $${args.length}::uuid`);
  }
  return parts;
}

/** Replaces {SCOPE[:alias[:nosoft]]} with the plant scope of that alias (and pushes its argument). */
async function expandScope(caller: Caller, pageId: string, sql: string, args: unknown[]): Promise<string> {
  if (!sql.includes('{SCOPE')) return sql;
  const re = /\{SCOPE(?::(\w+))?(?::(nosoft))?\}/g;
  let out = sql;
  for (const mt of [...sql.matchAll(re)]) {
    const alias = mt[1] ?? 'p';
    const sc = await scopeParts(caller, pageId, `${alias}.unit_id`, mt[2] ? null : `${alias}.deleted_at`, null, args);
    out = out.replace(mt[0], sc.length ? sc.join(' AND ') : 'true');
  }
  return out;
}

export async function runV40(
  caller: Caller,
  defs: Record<string, PageDef>,
  pageId: string,
  q: V40Query,
): Promise<V40Result> {
  const def = defs[pageId];
  if (!def) throw new Error(`No V40 views for ${pageId}`);
  const { labels, view, approvals } = resolveView(def, q);
  // the Approvals tab shows the approving department and the approval amount; every other tab keeps the page's own columns
  const cols: Record<string, Col> = approvals
    ? { ...def.cols, Department: approvalCols('').Department as Col, Amount: approvalCols('').Amount as Col }
    : def.cols;
  const columns: V40Column[] = labels.map((label, i) => {
    const c = cols[label] ?? none();
    return {
      key: `c${i}`,
      label,
      type: c.type,
      source: Boolean(c.e) || c.type === 'actions' || c.type === 'docs',
    };
  });
  const args: unknown[] = [];
  const from = await expandScope(caller, pageId, view?.from ?? def.from, args);
  const where = await scopeParts(
    caller,
    pageId,
    def.unit === undefined ? 't.unit_id' : def.unit,
    def.soft === undefined ? 't.deleted_at' : def.soft,
    null,
    args,
  );
  where.push(...(def.base ?? []));
  if (approvals) where.push('ap.id IS NOT NULL');
  else where.push(...(view?.where ?? def.dflt ?? []));
  if (q.q) {
    args.push(`%${q.q}%`);
    where.push(`(${def.search.map((s) => `${s}::text ILIKE $${args.length}`).join(' OR ')})`);
  }
  if (q.status) {
    args.push(q.status);
    where.push(`${def.status} = $${args.length}`);
  }
  const w = where.length ? where.join(' AND ') : 'true';
  const total = Number(
    (await query(prisma, `SELECT count(*)::int AS n FROM ${from} WHERE ${w}`, ...args))[0]?.n ?? 0,
  );
  const sel = labels.map((label, i) => `${cast(cols[label] ?? none())} AS c${i}`).join(', ');
  const calendar = /calendar/i.test(q.tab) && def.calendar ? `${def.calendar} NULLS LAST, ` : '';
  const rows = await query(
    prisma,
    `SELECT ${def.id ?? 't.id'}::text AS id, ${def.number}::text AS number, ${def.status}::text AS status, ${sel} FROM ${from} WHERE ${w}
      ORDER BY ${calendar}${view?.order ?? def.order} LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
    ...args,
  );
  if (def.enrich) {
    const keys: Record<string, string> = {};
    for (const c of columns) keys[c.label] = c.key;
    await def.enrich(rows, keys);
  }
  const out: V40Result = {
    columns,
    rows: rows.map((r) => ({ ...r })),
    total,
    cards: [],
    distribution: [],
    audit: Boolean(view?.audit) || /audit/i.test(q.tab),
    calendar: calendar !== '',
    view: view ? q.tab : q.first ? 'register' : 'compact',
  };

  // KPI cards: the tab's own, or (Analytics) the record count and the page's money column; all computed over the whole filtered set
  const kpis: Kpi[] = [...(view?.kpis ?? [])];
  const analytics = /analytics/i.test(q.tab);
  if (analytics && def.metric)
    kpis.push(
      { label: `Total ${def.metric.label}`, e: `sum(${def.metric.e})`, type: 'inr' },
      { label: `Average ${def.metric.label}`, e: `avg(${def.metric.e})`, type: 'inr' },
    );
  if (kpis.length || analytics) {
    const k = await query(
      prisma,
      `SELECT count(*)::text AS records${kpis.map((x, i) => `, (${x.e})::text AS k${i}`).join('')} FROM ${from} WHERE ${w}`,
      ...args,
    );
    if (analytics) out.cards.push({ label: 'Records', value: String(k[0]?.records ?? '0'), type: 'num' });
    kpis.forEach((x, i) => out.cards.push({ label: x.label, value: (k[0]?.[`k${i}`] as string | null) ?? null, type: x.type }));
  }
  if (analytics) {
    const dist = await query(
      prisma,
      `SELECT ${def.status}::text AS label, count(*)::int AS count FROM ${from} WHERE ${w} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12`,
      ...args,
    );
    out.distribution = dist.map((r) => ({ label: String(r.label ?? '-'), count: Number(r.count) }));
  }

  const p = view?.panel;
  if (p) {
    const pargs: unknown[] = [];
    const pfrom = await expandScope(caller, pageId, p.from, pargs);
    const pw = await scopeParts(caller, pageId, p.unit, p.soft, null, pargs);
    pw.push(...(p.where ?? []));
    const pcols = p.cols.map(([label, e, type], i): [V40Column, string] => [
      { key: `p${i}`, label, type, source: Boolean(e) || type === 'actions' },
      e ? (type === 'date' ? `to_char((${e})::date,'YYYY-MM-DD')` : `(${e})::text`) : 'NULL::text',
    ]);
    const prows = await query(
      prisma,
      `SELECT ${p.id ? `${p.id}::text AS id, ` : ''}${pcols.map(([c, e]) => `${e} AS ${c.key}`).join(', ')} FROM ${pfrom} WHERE ${pw.length ? pw.join(' AND ') : 'true'} ORDER BY ${p.order} LIMIT 50`,
      ...pargs,
    );
    out.panel = { title: p.title, columns: pcols.map(([c]) => c), rows: prows.map((r) => ({ ...r })) };
  }
  return out;
}

/** Columns V40 shows that this ERP cannot fill from any table yet (dash on screen, listed for the owner), per tab. */
export function noSourceColumns(def: PageDef | undefined): string[] {
  if (!def) return [];
  const used = new Set<string>([...def.register, ...def.compact, ...def.views.flatMap((v) => v.labels)]);
  return [...used].filter((label) => {
    const c = def.cols[label];
    return !c || (!c.e && c.type !== 'actions');
  });
}
