// Phase 13 masters: work centres (with calendars and the downtime / scrap reasons), bills of materials (draft -> pending
// approval -> released, revisions, tree, cost roll-up, import) and routings. Every rule is checked on the server.
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { mget, mlist, mpatch, mpost, mput } from '../../lib/mfgApi';
import type { Option, Row } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { Empty, ErrorBox, PageHead, Pill } from '../finance/shared';
import { RefPicker, Tabs } from '../qms/Shared';
import { FileButton, FormModal, ORDER_TONE, OptionSelect, s, useWorkCentres } from './Kit';
import { Act, Dialog, Grid, ReasonAct, num } from './Ui';

const KINDS = ['Machine', 'Assembly', 'Manual', 'Inspection', 'Outside', 'Other'];

// ------------------------------------------------------------------------------------------------ work centres
export function WorkCentresPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'wc' | 'cal' | 'dt' | 'sc'>('wc');
  return (
    <>
      <PageHead
        title="Work Centers"
        sub="Where work is done: rates, shifts, calendar and OEE target. Finance sets the labour and overhead rates; the order cannot be released without them."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['wc', 'Work centers'],
          ['cal', 'Calendars'],
          ['dt', 'Downtime reasons'],
          ['sc', 'Scrap reasons'],
        ]}
      />
      {tab === 'wc' ? <WcList actions={actions} /> : null}
      {tab === 'cal' ? <Calendars actions={actions} /> : null}
      {tab === 'dt' ? <Reasons kind="downtime" actions={actions} /> : null}
      {tab === 'sc' ? <Reasons kind="scrap" actions={actions} /> : null}
    </>
  );
}

function WcList({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const list = useLoad(() => mlist('/work-centers'), []);
  const cals = useLoad(() => mget<Row[]>('/calendars'), []);
  const ccs = useLoad(() => mget<Row[]>('/cost-centers'), []);
  const cur = edit && edit !== 'new' ? edit : null;
  const opts = (r: Row[] | null, label: (x: Row) => string): Option[] =>
    (r ?? []).map((x) => ({ id: s(x.id), label: label(x) }));
  return (
    <>
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setEdit('new')}>
            + New work center
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No work centers yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Code', r: (r) => s(r.code) },
          { h: 'Name', r: (r) => s(r.name) },
          { h: 'Kind', r: (r) => s(r.kind) },
          { h: 'Shifts × hours', r: (r) => `${s(r.shiftsPerDay)} × ${s(r.hoursPerShift)}` },
          { h: 'Labour / hr', r: (r) => num(r.labourRatePerHr) },
          { h: 'Overhead / hr', r: (r) => num(r.overheadRatePerHr) },
          { h: 'OEE target %', r: (r) => num(r.oeeTargetPct) },
          {
            h: 'Status',
            r: (r) => <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill>,
          },
          {
            h: '',
            r: (r) =>
              actions.edit ? (
                <button type="button" className="btn" onClick={() => setEdit(r)}>
                  Edit
                </button>
              ) : null,
          },
        ]}
      />
      {edit ? (
        <FormModal
          title={cur ? `Edit ${s(cur.code)}` : 'New work center'}
          fields={[
            ...(cur ? [] : [{ key: 'code', label: 'Code', required: true }]),
            { key: 'name', label: 'Name', required: true },
            { key: 'kind', label: 'Kind', type: 'select' as const, options: KINDS },
            { key: 'department', label: 'Department' },
            {
              key: 'costCentreId',
              label: 'Cost center',
              type: 'select' as const,
              options: opts(ccs.data, (x) => `${s(x.code)} · ${s(x.name)}`),
            },
            {
              key: 'calendarId',
              label: 'Calendar',
              type: 'select' as const,
              options: opts(cals.data, (x) => s(x.name)),
            },
            { key: 'machineCount', label: 'Machines', type: 'number' as const },
            { key: 'labourCount', label: 'Operators', type: 'number' as const },
            { key: 'shiftsPerDay', label: 'Shifts per day', type: 'number' as const },
            { key: 'hoursPerShift', label: 'Hours per shift', type: 'number' as const },
            { key: 'labourRatePerHr', label: 'Labour rate per hour', type: 'number' as const },
            { key: 'overheadRatePerHr', label: 'Overhead rate per hour', type: 'number' as const },
            { key: 'oeeTargetPct', label: 'OEE target %', type: 'number' as const },
            { key: 'efficiencyPct', label: 'Efficiency %', type: 'number' as const },
            ...(cur
              ? [
                  {
                    key: 'status',
                    label: 'Status',
                    type: 'select' as const,
                    options: ['ACTIVE', 'INACTIVE'],
                  },
                ]
              : []),
          ]}
          initial={
            cur
              ? Object.fromEntries(
                  [
                    'name',
                    'kind',
                    'department',
                    'costCentreId',
                    'calendarId',
                    'machineCount',
                    'labourCount',
                    'shiftsPerDay',
                    'hoursPerShift',
                    'labourRatePerHr',
                    'overheadRatePerHr',
                    'oeeTargetPct',
                    'efficiencyPct',
                    'status',
                  ]
                    .filter((k) => cur[k] !== null && cur[k] !== undefined)
                    .map((k) => [k, s(cur[k])]),
                )
              : {}
          }
          onClose={() => setEdit(null)}
          onSubmit={async (v) => {
            const body: Record<string, unknown> = { ...v };
            for (const k of ['machineCount', 'labourCount', 'shiftsPerDay'])
              if (v[k] !== undefined) body[k] = Number(v[k]);
            if (cur) await mpatch(`/work-centers/${s(cur.id)}`, Number(cur.version), body);
            else await mpost('/work-centers', body);
            toast('Saved');
            setEdit(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function Calendars({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => mget<Row[]>('/calendars'), []);
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const [name, setName] = useState('');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [msg, setMsg] = useState('');
  const open = (c: Row | 'new') => {
    setEdit(c);
    setMsg('');
    setName(c === 'new' ? '' : s(c.name));
    setDays(c === 'new' ? [1, 2, 3, 4, 5] : ((c.workDays as number[] | undefined) ?? []));
  };
  return (
    <>
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => open('new')}>
            + New calendar
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data ?? []}
        loading={list.loading}
        empty="No calendars yet. A work center without one works Monday to Saturday."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Name', r: (r) => s(r.name) },
          {
            h: 'Working days',
            r: (r) => ((r.workDays as number[] | undefined) ?? []).map((d) => DAYS[d]).join(', '),
          },
          {
            h: '',
            r: (r) =>
              actions.edit ? (
                <button type="button" className="btn" onClick={() => open(r)}>
                  Edit
                </button>
              ) : null,
          },
        ]}
      />
      {edit ? (
        <Dialog
          title={edit === 'new' ? 'New calendar' : 'Edit calendar'}
          onClose={() => setEdit(null)}
          error={msg}
          footer={
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setMsg('');
                (edit === 'new'
                  ? mpost('/calendars', { name, workDays: days })
                  : mput(`/calendars/${s(edit.id)}`, { name, workDays: days })
                )
                  .then(() => {
                    toast('Saved');
                    setEdit(null);
                    list.reload();
                  })
                  .catch((e: unknown) => setMsg(toUiError(e).message));
              }}
            >
              Save
            </button>
          }
        >
          <div className="field">
            <label htmlFor="cal-name">Name</label>
            <input id="cal-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <span>Working days</span>
            <div>
              {DAYS.map((d, i) => (
                <label key={d} style={{ marginRight: 12 }}>
                  <input
                    type="checkbox"
                    checked={days.includes(i)}
                    onChange={(e) =>
                      setDays((o) =>
                        e.target.checked ? [...o, i].sort() : o.filter((x) => x !== i),
                      )
                    }
                  />{' '}
                  {d}
                </label>
              ))}
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

function Reasons({ kind, actions }: { kind: 'downtime' | 'scrap'; actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => mget<Row[]>(`/${kind}-reasons`), [kind]);
  const [add, setAdd] = useState(false);
  return (
    <>
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdd(true)}>
            + New reason
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data ?? []}
        loading={list.loading}
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Code', r: (r) => s(r.code) },
          { h: 'Name', r: (r) => s(r.name) },
          kind === 'downtime'
            ? { h: 'Planned?', r: (r) => s(r.category) }
            : {
                h: 'Normal loss?',
                r: (r) => (r.normal === true ? 'Yes (in the cost)' : 'No (abnormal)'),
              },
          { h: 'Status', r: (r) => s(r.status) },
        ]}
      />
      {add ? (
        <FormModal
          title="New reason"
          fields={[
            { key: 'code', label: 'Code', required: true },
            { key: 'name', label: 'Name', required: true },
            ...(kind === 'downtime'
              ? [
                  {
                    key: 'category',
                    label: 'Planned or unplanned',
                    type: 'select' as const,
                    options: ['PLANNED', 'UNPLANNED'],
                  },
                ]
              : [
                  {
                    key: 'normal',
                    label: 'Normal loss (goes into the cost)',
                    type: 'check' as const,
                  },
                ]),
          ]}
          onClose={() => setAdd(false)}
          onSubmit={async (v) => {
            const body: Record<string, unknown> = { ...v };
            if (kind === 'scrap') body.normal = v.normal === 'true';
            await mpost(`/${kind}-reasons`, body);
            toast('Saved');
            setAdd(false);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ BOM
interface LineDraft {
  itemId: string;
  itemLabel: string;
  qtyPer: string;
  uom: string;
  scrapPct: string;
  issueMethod: string;
  operationSeq: string;
  isPhantom: boolean;
  /** what the form does not edit but must send back, or the server would erase it */
  keep: Record<string, unknown>;
}
const blankLine = (): LineDraft => ({
  itemId: '',
  itemLabel: '',
  qtyPer: '',
  uom: '',
  scrapPct: '',
  issueMethod: 'MANUAL',
  operationSeq: '',
  isPhantom: false,
  keep: {},
});

export function BomPage({ actions }: { actions: ActionSet }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [imp, setImp] = useState(false);
  const list = useLoad(() => mlist('/boms', { status, q }), [status, q]);
  return (
    <>
      <PageHead
        title="Bill of Materials"
        sub="What goes into one piece. A BOM is drafted, sent for approval and released; a released BOM is locked and changed only by a new revision."
      />
      <div className="toolbar">
        <input
          aria-label="Search BOM"
          placeholder="Search item or BOM number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'OBSOLETE'].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        {actions.add ? (
          <>
            <button type="button" className="btn primary" onClick={() => setEdit('new')}>
              + New BOM
            </button>
            <button type="button" className="btn" onClick={() => setImp(true)}>
              Import
            </button>
          </>
        ) : null}
        {actions.print ? (
          <FileButton path="/export/boms" name="mfg-boms.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No bills of materials yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'BOM', r: (r) => s(r.number) },
          { h: 'Item', r: (r) => `${s(r.itemCode)} · ${s(r.itemName)}` },
          { h: 'Revision', r: (r) => s(r.revision ?? r.versionNo) },
          { h: 'Default', r: (r) => (r.isDefault === true ? 'Yes' : '') },
          { h: 'Components', r: (r) => s(r.lineCount) },
          { h: 'Status', r: (r) => <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill> },
          {
            h: '',
            r: (r) => (
              <button type="button" className="btn" onClick={() => setView(s(r.id))}>
                Open
              </button>
            ),
          },
        ]}
      />
      {view ? (
        <BomView
          id={view}
          actions={actions}
          onClose={() => setView(null)}
          onChanged={() => list.reload()}
          onEdit={(r) => {
            setView(null);
            setEdit(r);
          }}
        />
      ) : null}
      {edit ? (
        <BomForm
          bom={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            list.reload();
          }}
        />
      ) : null}
      {imp ? (
        <BomImport
          onClose={() => setImp(false)}
          onDone={() => {
            setImp(false);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function BomView({
  id,
  actions,
  onClose,
  onChanged,
  onEdit,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (r: Row) => void;
}) {
  const doc = useLoad(() => mget(`/boms/${id}`), [id]);
  const [qty, setQty] = useState('1');
  const [tree, setTree] = useState<Row | null>(null);
  const [msg, setMsg] = useState('');
  const b = doc.data;
  const after = () => {
    doc.reload();
    onChanged();
  };
  const st = s(b?.status);
  const ver = Number(b?.version ?? 0);
  return (
    <Dialog
      title={b ? `${s(b.number)} · ${s(b.itemName)}` : 'Bill of materials'}
      sub={b ? `Revision ${s(b.revision ?? b.versionNo)} · ${st}` : ''}
      onClose={onClose}
      error={msg || doc.error}
      footer={
        b ? (
          <>
            {st === 'DRAFT' && actions.edit ? (
              <>
                <button type="button" className="btn" onClick={() => onEdit(b)}>
                  Edit
                </button>
                <Act
                  label="Send for approval"
                  primary
                  run={() => mpost(`/boms/${id}/submit`, {}, ver)}
                  done={after}
                />
              </>
            ) : null}
            {st === 'PENDING_APPROVAL' && actions.approve ? (
              <>
                <Act
                  label="Release"
                  primary
                  run={() => mpost(`/boms/${id}/release`, {}, ver)}
                  done={after}
                />
                <ReasonAct
                  label="Send back"
                  question="Why is it sent back?"
                  run={(reason) => mpost(`/boms/${id}/reject`, { reason }, ver)}
                  done={after}
                />
              </>
            ) : null}
            {st === 'RELEASED' && actions.add ? (
              <Act label="New revision" run={() => mpost(`/boms/${id}/revise`, {})} done={after} />
            ) : null}
            {st === 'RELEASED' && actions.approve ? (
              <>
                {b.isDefault === true ? null : (
                  <Act
                    label="Make default"
                    run={() => mpost(`/boms/${id}/set-default`, {}, ver)}
                    done={after}
                  />
                )}
                <Act
                  label="Make obsolete"
                  sure="Make this BOM obsolete? New orders will not use it."
                  run={() => mpost(`/boms/${id}/obsolete`, {}, ver)}
                  done={after}
                />
              </>
            ) : null}
            <Act label="Cost roll-up" run={() => mget(`/boms/${id}/cost-rollup`)} done={after} />
            {actions.print ? (
              <FileButton path={`/boms/${id}/print`} name="bom.pdf" label="Print" />
            ) : null}
          </>
        ) : null
      }
    >
      {b ? (
        <>
          <p>
            Base quantity <b>{num(b.baseQty)}</b> {s(b.uom)}
            {b.notes ? ` · ${s(b.notes)}` : ''}
          </p>
          <Grid
            rows={(b.lines as Row[] | undefined) ?? []}
            rowKey={(r) => s(r.id)}
            cols={[
              { h: 'No.', r: (r) => s(r.lineNo) },
              { h: 'Component', r: (r) => `${s(r.itemCode)} · ${s(r.itemName)}` },
              { h: 'Qty per base', r: (r) => `${num(r.qtyPerBase)} ${s(r.uom)}` },
              { h: 'Scrap %', r: (r) => num(r.scrapPct) },
              { h: 'Issue', r: (r) => s(r.issueMethod) },
              { h: 'Op', r: (r) => s(r.operationSeq) || '—' },
              { h: 'Phantom', r: (r) => (r.isPhantom === true ? 'Yes' : '') },
            ]}
          />
          {b.costSnapshot ? (
            <p>
              Last cost roll-up: material <b>{num((b.costSnapshot as Row).material)}</b>, labour{' '}
              <b>{num((b.costSnapshot as Row).labour)}</b>, overhead{' '}
              <b>{num((b.costSnapshot as Row).overhead)}</b>, total{' '}
              <b>{num((b.costSnapshot as Row).total)}</b>
            </p>
          ) : null}
          <div className="toolbar">
            <label htmlFor="bom-tree-qty">Show the tree for</label>
            <input
              id="bom-tree-qty"
              type="number"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              onClick={() => {
                setMsg('');
                mget(`/boms/${id}/tree`, { qty })
                  .then(setTree)
                  .catch((e: unknown) => setMsg(toUiError(e).message));
              }}
            >
              Show tree
            </button>
          </div>
          {tree ? <TreeNode node={tree} depth={0} /> : null}
        </>
      ) : (
        <p>Loading…</p>
      )}
    </Dialog>
  );
}

function TreeNode({ node, depth }: { node: Row; depth: number }) {
  const kids = (node.children as Row[] | undefined) ?? [];
  return (
    <div style={{ marginLeft: depth * 18 }}>
      <div>
        {depth ? '└ ' : ''}
        <b>{s(node.itemCode)}</b> {s(node.itemName)} — {num(node.qty)} {s(node.uom)}
        {node.isPhantom === true ? ' (phantom)' : ''}
      </div>
      {kids.map((k, i) => (
        <TreeNode key={`${s(k.itemId)}-${i}`} node={k} depth={depth + 1} />
      ))}
    </div>
  );
}

function BomForm({
  bom,
  onClose,
  onSaved,
}: {
  bom: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [itemId, setItemId] = useState(bom ? s(bom.itemId) : '');
  const [itemLabel, setItemLabel] = useState(bom ? `${s(bom.itemCode)} · ${s(bom.itemName)}` : '');
  const [baseQty, setBaseQty] = useState(bom ? s(bom.baseQty) : '1');
  const [lines, setLines] = useState<LineDraft[]>(
    bom
      ? ((bom.lines as Row[]) ?? []).map((l) => ({
          itemId: s(l.itemId),
          itemLabel: `${s(l.itemCode)} · ${s(l.itemName)}`,
          qtyPer: s(l.qtyPerBase),
          uom: s(l.uom),
          scrapPct: s(l.scrapPct),
          issueMethod: s(l.issueMethod) || 'MANUAL',
          operationSeq: l.operationSeq ? s(l.operationSeq) : '',
          isPhantom: l.isPhantom === true,
          keep: {
            ...(l.conversionFactor && s(l.conversionFactor) !== '1'
              ? { conversionFactor: s(l.conversionFactor) }
              : {}),
            ...(l.effectiveFrom ? { effectiveFrom: s(l.effectiveFrom).slice(0, 10) } : {}),
            ...(l.effectiveTo ? { effectiveTo: s(l.effectiveTo).slice(0, 10) } : {}),
            ...(l.referenceDesignator ? { referenceDesignator: s(l.referenceDesignator) } : {}),
            ...(l.remarks ? { remarks: s(l.remarks) } : {}),
            ...(((l.alternates as Row[] | undefined) ?? []).length
              ? {
                  alternates: ((l.alternates as Row[]) ?? []).map((a) => ({
                    altItemId: s(a.altItemId),
                    priority: Number(a.priority),
                    ratio: s(a.ratio),
                  })),
                }
              : {}),
          },
        }))
      : [blankLine()],
  );
  const [msg, setMsg] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (i: number, p: Partial<LineDraft>) =>
    setLines((o) => o.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = () => {
    setMsg('');
    setErrors({});
    const body = {
      ...(bom ? {} : { itemId }),
      baseQty,
      lines: lines
        .filter((l) => l.itemId)
        .map((l) => ({
          ...l.keep,
          itemId: l.itemId,
          qtyPer: l.qtyPer,
          ...(l.uom ? { uom: l.uom } : {}),
          ...(l.scrapPct ? { scrapPct: l.scrapPct } : {}),
          issueMethod: l.issueMethod,
          ...(l.operationSeq ? { operationSeq: Number(l.operationSeq) } : {}),
          isPhantom: l.isPhantom,
        })),
    };
    (bom ? mpatch(`/boms/${s(bom.id)}`, Number(bom.version), body) : mpost('/boms', body))
      .then(() => {
        toast('Saved');
        onSaved();
      })
      .catch((e: unknown) => {
        const u = toUiError(e);
        setMsg(u.message);
        setErrors(u.fields);
      });
  };
  return (
    <Dialog
      title={bom ? `Edit ${s(bom.number)}` : 'New bill of materials'}
      onClose={onClose}
      error={msg}
      footer={
        <button type="button" className="btn primary" onClick={save}>
          Save draft
        </button>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label htmlFor="bf-item">Finished or semi-finished item *</label>
          <RefPicker
            id="bf-item"
            kind="item"
            value={itemId}
            label={itemLabel}
            disabled={!!bom}
            onChange={(i, l) => {
              setItemId(i);
              setItemLabel(l);
            }}
          />
          {errors.itemId ? <div className="field-error">{errors.itemId}</div> : null}
        </div>
        <div className="field">
          <label htmlFor="bf-base">Base quantity *</label>
          <input
            id="bf-base"
            type="number"
            min={0}
            step="any"
            value={baseQty}
            onChange={(e) => setBaseQty(e.target.value)}
          />
        </div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th>Qty per base</th>
              <th>Scrap %</th>
              <th>Issue</th>
              <th>Op no.</th>
              <th>Phantom</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <RefPicker
                    id={`bf-line-${i}`}
                    kind="item"
                    value={l.itemId}
                    label={l.itemLabel}
                    onChange={(x, lab) => set(i, { itemId: x, itemLabel: lab })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Quantity ${i + 1}`}
                    type="number"
                    min={0}
                    step="any"
                    value={l.qtyPer}
                    onChange={(e) => set(i, { qtyPer: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Scrap ${i + 1}`}
                    type="number"
                    min={0}
                    max={50}
                    step="any"
                    value={l.scrapPct}
                    onChange={(e) => set(i, { scrapPct: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`Issue ${i + 1}`}
                    value={l.issueMethod}
                    onChange={(e) => set(i, { issueMethod: e.target.value })}
                  >
                    <option value="MANUAL">Manual</option>
                    <option value="BACKFLUSH">Backflush</option>
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`Operation ${i + 1}`}
                    type="number"
                    min={1}
                    value={l.operationSeq}
                    onChange={(e) => set(i, { operationSeq: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Phantom ${i + 1}`}
                    type="checkbox"
                    checked={l.isPhantom}
                    onChange={(e) => set(i, { isPhantom: e.target.checked })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setLines((o) => (o.length > 1 ? o.filter((_, j) => j !== i) : o))
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn" onClick={() => setLines((o) => [...o, blankLine()])}>
        + Add component
      </button>
    </Dialog>
  );
}

/** Paste a sheet: item code, component code, quantity per base, unit (optional), scrap % (optional). One BOM per item code. */
function BomImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [res, setRes] = useState<Row | null>(null);
  const parse = () => {
    const by = new Map<string, Row[]>();
    for (const raw of text.split(/\r?\n/)) {
      const c = raw.split(/[,\t]/).map((x) => x.trim());
      if (c.length < 3 || !c[0] || /^item/i.test(c[0])) continue;
      by.set(c[0], [
        ...(by.get(c[0]) ?? []),
        {
          componentCode: c[1],
          qtyPerBase: c[2],
          ...(c[3] ? { uom: c[3] } : {}),
          ...(c[4] ? { scrapPct: c[4] } : {}),
        },
      ]);
    }
    return [...by.entries()].map(([itemCode, lines]) => ({ itemCode, lines }));
  };
  return (
    <Dialog
      title="Import bills of materials"
      sub="One row per component: item code, component code, quantity per base, unit, scrap %"
      onClose={onClose}
      error={msg}
      footer={
        <Act
          label="Import"
          primary
          run={async () => {
            setMsg('');
            const rows = parse();
            if (!rows.length) throw new Error('Paste at least one row.');
            const r = await mpost('/boms/import', { rows });
            setRes(r);
            if (((r.failed as unknown[]) ?? []).length === 0) onDone();
          }}
          ok="Imported"
        />
      }
    >
      <textarea
        aria-label="Rows to import"
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'FG-100, RM-1, 2, Kg, 5\nFG-100, RM-2, 1'}
        style={{ width: '100%' }}
      />
      {res ? (
        <>
          <p>
            Created: {((res.created as Row[]) ?? []).map((x) => s(x.number)).join(', ') || 'none'}
          </p>
          {((res.failed as Row[]) ?? []).map((f) => (
            <p key={s(f.itemCode)} role="alert">
              {s(f.itemCode)}: {s(f.error)}
            </p>
          ))}
        </>
      ) : null}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ routing
interface OpDraft {
  name: string;
  workCentreId: string;
  setupMinutes: string;
  runMinutes: string;
  queueMinutes: string;
  moveMinutes: string;
  qcRequired: boolean;
}
const blankOp = (): OpDraft => ({
  name: '',
  workCentreId: '',
  setupMinutes: '',
  runMinutes: '',
  queueMinutes: '',
  moveMinutes: '',
  qcRequired: false,
});

export function RoutingPage({ actions }: { actions: ActionSet }) {
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const [view, setView] = useState<string | null>(null);
  const list = useLoad(() => mlist('/routings', { status }), [status]);
  return (
    <>
      <PageHead
        title="Routing"
        sub="The steps to make an item, in order, with the work center, setup and run minutes of each. A released routing is changed only by a new revision."
      />
      <div className="toolbar">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['DRAFT', 'RELEASED', 'OBSOLETE'].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setEdit('new')}>
            + New routing
          </button>
        ) : null}
        {actions.print ? (
          <FileButton path="/export/routings" name="mfg-routings.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No routings yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Routing', r: (r) => s(r.number) },
          { h: 'Item', r: (r) => `${s(r.itemCode)} · ${s(r.itemName)}` },
          { h: 'Revision', r: (r) => s(r.revision ?? r.versionNo) },
          { h: 'Operations', r: (r) => s(r.opCount) },
          { h: 'Status', r: (r) => <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill> },
          {
            h: '',
            r: (r) => (
              <button type="button" className="btn" onClick={() => setView(s(r.id))}>
                Open
              </button>
            ),
          },
        ]}
      />
      {view ? (
        <RoutingView
          id={view}
          actions={actions}
          onClose={() => setView(null)}
          onChanged={() => list.reload()}
          onEdit={(r) => {
            setView(null);
            setEdit(r);
          }}
        />
      ) : null}
      {edit ? (
        <RoutingForm
          routing={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function RoutingView({
  id,
  actions,
  onClose,
  onChanged,
  onEdit,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (r: Row) => void;
}) {
  const doc = useLoad(() => mget(`/routings/${id}`), [id]);
  const r = doc.data;
  const st = s(r?.status);
  const ver = Number(r?.version ?? 0);
  const after = () => {
    doc.reload();
    onChanged();
  };
  return (
    <Dialog
      title={r ? `${s(r.number)} · ${s(r.itemName)}` : 'Routing'}
      sub={r ? `Revision ${s(r.revision ?? r.versionNo)} · ${st}` : ''}
      onClose={onClose}
      error={doc.error}
      footer={
        r ? (
          <>
            {st === 'DRAFT' && actions.edit ? (
              <button type="button" className="btn" onClick={() => onEdit(r)}>
                Edit
              </button>
            ) : null}
            {st === 'DRAFT' && actions.approve ? (
              <Act
                label="Release"
                primary
                run={() => mpost(`/routings/${id}/release`, {}, ver)}
                done={after}
              />
            ) : null}
            {st === 'RELEASED' && actions.add ? (
              <Act
                label="New revision"
                run={() => mpost(`/routings/${id}/revise`, {})}
                done={after}
              />
            ) : null}
            {st === 'RELEASED' && actions.approve ? (
              <Act
                label="Make obsolete"
                sure="Make this routing obsolete?"
                run={() => mpost(`/routings/${id}/obsolete`, {}, ver)}
                done={after}
              />
            ) : null}
            {actions.print ? (
              <FileButton path={`/routings/${id}/print`} name="routing.pdf" label="Print" />
            ) : null}
          </>
        ) : null
      }
    >
      {r ? (
        <Grid
          rows={(r.ops as Row[] | undefined) ?? []}
          rowKey={(o) => s(o.id)}
          cols={[
            { h: 'No.', r: (o) => s(o.seq) },
            { h: 'Operation', r: (o) => s(o.name) },
            { h: 'Work center', r: (o) => s(o.workCentreCode) },
            { h: 'Setup min', r: (o) => num(o.setupMinutes) },
            { h: 'Run min / pc', r: (o) => num(o.runMinutes) },
            { h: 'Queue / move', r: (o) => `${num(o.queueMinutes)} / ${num(o.moveMinutes)}` },
            { h: 'Inspection', r: (o) => (o.qcRequired === true ? 'Yes' : '') },
          ]}
        />
      ) : (
        <p>Loading…</p>
      )}
    </Dialog>
  );
}

function RoutingForm({
  routing,
  onClose,
  onSaved,
}: {
  routing: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const wcs = useWorkCentres();
  const [itemId, setItemId] = useState(routing ? s(routing.itemId) : '');
  const [itemLabel, setItemLabel] = useState(
    routing ? `${s(routing.itemCode)} · ${s(routing.itemName)}` : '',
  );
  const [ops, setOps] = useState<OpDraft[]>(
    routing
      ? ((routing.ops as Row[]) ?? []).map((o) => ({
          name: s(o.name),
          workCentreId: s(o.workCentreId),
          setupMinutes: s(o.setupMinutes),
          runMinutes: s(o.runMinutes),
          queueMinutes: s(o.queueMinutes),
          moveMinutes: s(o.moveMinutes),
          qcRequired: o.qcRequired === true,
        }))
      : [blankOp()],
  );
  const [msg, setMsg] = useState('');
  const set = (i: number, p: Partial<OpDraft>) =>
    setOps((o) => o.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = () => {
    setMsg('');
    const body = {
      ...(routing ? {} : { itemId }),
      ops: ops.map((o, i) => ({
        seq: (i + 1) * 10,
        name: o.name,
        workCentreId: o.workCentreId,
        ...(o.setupMinutes ? { setupMinutes: o.setupMinutes } : {}),
        ...(o.runMinutes ? { runMinutes: o.runMinutes } : {}),
        ...(o.queueMinutes ? { queueMinutes: o.queueMinutes } : {}),
        ...(o.moveMinutes ? { moveMinutes: o.moveMinutes } : {}),
        qcRequired: o.qcRequired,
      })),
    };
    (routing
      ? mpatch(`/routings/${s(routing.id)}`, Number(routing.version), body)
      : mpost('/routings', body)
    )
      .then(() => {
        toast('Saved');
        onSaved();
      })
      .catch((e: unknown) => setMsg(toUiError(e).message));
  };
  return (
    <Dialog
      title={routing ? `Edit ${s(routing.number)}` : 'New routing'}
      onClose={onClose}
      error={msg}
      footer={
        <button type="button" className="btn primary" onClick={save}>
          Save draft
        </button>
      }
    >
      <div className="field">
        <label htmlFor="rf-item">Item *</label>
        <RefPicker
          id="rf-item"
          kind="item"
          value={itemId}
          label={itemLabel}
          disabled={!!routing}
          onChange={(i, l) => {
            setItemId(i);
            setItemLabel(l);
          }}
        />
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Operation</th>
              <th>Work center</th>
              <th>Setup min</th>
              <th>Run min / pc</th>
              <th>Queue</th>
              <th>Move</th>
              <th>Inspect</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ops.length === 0 ? <Empty cols={8}>Add an operation.</Empty> : null}
            {ops.map((o, i) => (
              <tr key={i}>
                <td>
                  <input
                    aria-label={`Operation name ${i + 1}`}
                    value={o.name}
                    onChange={(e) => set(i, { name: e.target.value })}
                  />
                </td>
                <td>
                  <OptionSelect
                    id={`rf-wc-${i}`}
                    value={o.workCentreId}
                    options={wcs.data ?? []}
                    onChange={(v) => set(i, { workCentreId: v })}
                  />
                </td>
                {(['setupMinutes', 'runMinutes', 'queueMinutes', 'moveMinutes'] as const).map(
                  (k) => (
                    <td key={k}>
                      <input
                        aria-label={`${k} ${i + 1}`}
                        type="number"
                        min={0}
                        step="any"
                        value={o[k]}
                        onChange={(e) => set(i, { [k]: e.target.value })}
                      />
                    </td>
                  ),
                )}
                <td>
                  <input
                    aria-label={`Inspection ${i + 1}`}
                    type="checkbox"
                    checked={o.qcRequired}
                    onChange={(e) => set(i, { qcRequired: e.target.checked })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setOps((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : x))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn" onClick={() => setOps((o) => [...o, blankOp()])}>
        + Add operation
      </button>
    </Dialog>
  );
}
