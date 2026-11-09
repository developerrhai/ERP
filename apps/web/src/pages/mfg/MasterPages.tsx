// Phase 13 masters: work centres, bills of materials and routings. A BOM and a routing are versioned: a Draft is edited,
// Activate makes it the working version (the old one is retired), an Active one is never edited: make a new version.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { mget, mlist, mpatch, mpost } from '../../lib/mfgApi';
import type { Row } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { Empty, ErrorBox, PageHead, Pill } from '../finance/shared';
import { RefPicker } from '../qms/Shared';
import { FileButton, FormModal, ORDER_TONE, OptionSelect, s, useWorkCentres } from './Kit';

const KINDS = ['MACHINE', 'LINE', 'MANUAL', 'OUTSIDE'];

// ------------------------------------------------------------------------------------------------ work centres
export function WorkCentresPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const list = useLoad(() => mlist('/work-centres', { status }), [status]);
  const cur = edit && edit !== 'new' ? edit : null;
  return (
    <>
      <PageHead
        title="Work Centers"
        sub="Machines, lines and manual stations. The hourly rate is copied onto an order when it is released, for the costing figures."
      />
      <div className="toolbar">
        <label htmlFor="wc-status">Status</label>
        <select id="wc-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setEdit('new')}>
            + Add work center
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Type</th>
              <th>Hours per day</th>
              <th>Rate per hour</th>
              <th>Machine / asset</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={8}>No work centers yet.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>{s(r.code)}</td>
                <td>{s(r.name)}</td>
                <td>{s(r.kind)}</td>
                <td>{s(r.capacityHours)}</td>
                <td>{s(r.costPerHour)}</td>
                <td>{s(r.assetRef) || '—'}</td>
                <td>
                  <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill>
                </td>
                <td>
                  {actions.edit ? (
                    <button type="button" className="btn" onClick={() => setEdit(r)}>
                      Edit
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit ? (
        <FormModal
          title={cur ? `Edit ${s(cur.code)}` : 'Add a work center'}
          fields={[
            ...(cur ? [] : [{ key: 'code', label: 'Code', required: true }]),
            { key: 'name', label: 'Name', required: true },
            { key: 'kind', label: 'Type', type: 'select' as const, options: KINDS },
            { key: 'capacityHours', label: 'Hours per day', type: 'number' as const },
            { key: 'costPerHour', label: 'Rate per hour', type: 'number' as const },
            { key: 'assetRef', label: 'Machine / asset no. (free text)' },
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
            { key: 'notes', label: 'Notes' },
          ]}
          initial={
            cur
              ? {
                  name: s(cur.name),
                  kind: s(cur.kind),
                  capacityHours: s(cur.capacityHours),
                  costPerHour: s(cur.costPerHour),
                  assetRef: s(cur.assetRef),
                  status: s(cur.status),
                  notes: s(cur.notes),
                }
              : { kind: 'MACHINE', capacityHours: '8', costPerHour: '0' }
          }
          onClose={() => setEdit(null)}
          onSubmit={async (v) => {
            if (cur) await mpatch(`/work-centres/${s(cur.id)}`, Number(cur.version), v);
            else await mpost('/work-centres', v);
            toast('Saved');
            setEdit(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ BOM
interface BomLine {
  itemId: string;
  label: string;
  qtyPer: string;
  scrapPct: string;
}

function BomEditor({
  id,
  actions,
  onClose,
  onChanged,
}: {
  id: string | null;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [doc, setDoc] = useState<Row | null>(null);
  const [itemId, setItemId] = useState('');
  const [itemLabel, setItemLabel] = useState('');
  const [baseQty, setBaseQty] = useState('1');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<BomLine[]>([
    { itemId: '', label: '', qtyPer: '', scrapPct: '0' },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const loaded = useLoad(async () => {
    if (!id) return null;
    const d = await mget(`/boms/${id}`);
    setDoc(d);
    setItemId(s(d.itemId));
    setItemLabel(`${s(d.itemCode)} · ${s(d.itemName)}`);
    setBaseQty(s(d.baseQty));
    setNotes(s(d.notes));
    setLines(
      (d.lines as Row[]).map((l) => ({
        itemId: s(l.itemId),
        label: `${s(l.itemCode)} · ${s(l.itemName)}`,
        qtyPer: s(l.qtyPer),
        scrapPct: s(l.scrapPct),
      })),
    );
    return d;
  }, [id]);
  const status = doc ? s(doc.status) : 'DRAFT';
  const editable = doc ? status === 'DRAFT' && actions.edit : actions.add;
  const fail = (e: unknown) => {
    const u = toUiError(e);
    setMsg(u.message);
    setErrors(u.fields);
  };
  const body = () => ({
    ...(doc ? {} : { itemId }),
    baseQty,
    notes: notes || undefined,
    lines: lines
      .filter((l) => l.itemId)
      .map((l) => ({ itemId: l.itemId, qtyPer: l.qtyPer, scrapPct: l.scrapPct || '0' })),
  });
  const run = (fn: () => Promise<unknown>, ok: string) => {
    setMsg('');
    setErrors({});
    fn()
      .then(() => {
        toast(ok);
        onChanged();
      })
      .catch(fail);
  };
  const setLine = (i: number, p: Partial<BomLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <Modal
      title={doc ? `${s(doc.number)} · version ${s(doc.versionNo)}` : 'New bill of materials'}
      sub={
        doc
          ? `${s(doc.itemCode)} · ${s(doc.itemName)} (${status})`
          : 'What goes into one base quantity of the item.'
      }
      onClose={onClose}
      footer={
        <>
          {editable ? (
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                run(
                  () =>
                    doc
                      ? mpatch(`/boms/${s(doc.id)}`, Number(doc.version), body())
                      : mpost('/boms', body()),
                  'Saved',
                )
              }
            >
              Save
            </button>
          ) : null}
          {doc && status === 'DRAFT' && actions.approve ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                run(
                  () => mpost(`/boms/${s(doc.id)}/activate`, {}, Number(doc.version)),
                  'Activated',
                )
              }
            >
              Activate
            </button>
          ) : null}
          {doc && status === 'ACTIVE' && actions.approve ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                run(() => mpost(`/boms/${s(doc.id)}/retire`, {}, Number(doc.version)), 'Retired')
              }
            >
              Retire
            </button>
          ) : null}
          {doc && status !== 'DRAFT' && actions.add ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                run(() => mpost(`/boms/${s(doc.id)}/new-version`, {}), 'New draft version made')
              }
            >
              New version
            </button>
          ) : null}
          {doc && actions.print ? (
            <FileButton
              path={`/boms/${s(doc.id)}/print`}
              name="bill-of-materials.pdf"
              label="Print"
            />
          ) : null}
        </>
      }
    >
      <ErrorBox message={msg || loaded.error} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="bom-item">Item to make *</label>
          <RefPicker
            id="bom-item"
            kind="item"
            value={itemId}
            label={itemLabel}
            disabled={!!doc || !editable}
            onChange={(nid, nl) => {
              setItemId(nid);
              setItemLabel(nl);
            }}
          />
          {errors.itemId ? <div className="field-error">{errors.itemId}</div> : null}
        </div>
        <div className="field">
          <label htmlFor="bom-base">Base quantity *</label>
          <input
            id="bom-base"
            type="number"
            step="any"
            value={baseQty}
            disabled={!editable}
            onChange={(e) => setBaseQty(e.target.value)}
          />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="bom-notes">Notes</label>
          <input
            id="bom-notes"
            value={notes}
            disabled={!editable}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      <h4>Components (per base quantity)</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th>Quantity</th>
              <th>Scrap %</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <RefPicker
                    id={`bom-l${i}`}
                    kind="item"
                    value={l.itemId}
                    label={l.label}
                    disabled={!editable}
                    onChange={(nid, nl) => setLine(i, { itemId: nid, label: nl })}
                  />
                  {errors[`lines.${i}`] ? (
                    <div className="field-error">{errors[`lines.${i}`]}</div>
                  ) : null}
                </td>
                <td>
                  <input
                    aria-label={`Quantity ${i + 1}`}
                    type="number"
                    step="any"
                    value={l.qtyPer}
                    disabled={!editable}
                    onChange={(e) => setLine(i, { qtyPer: e.target.value })}
                  />
                  {errors[`lines.${i}.qtyPer`] ? (
                    <div className="field-error">{errors[`lines.${i}.qtyPer`]}</div>
                  ) : null}
                </td>
                <td>
                  <input
                    aria-label={`Scrap ${i + 1}`}
                    type="number"
                    step="any"
                    value={l.scrapPct}
                    disabled={!editable}
                    onChange={(e) => setLine(i, { scrapPct: e.target.value })}
                  />
                </td>
                <td>
                  {editable && lines.length > 1 ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable ? (
        <button
          type="button"
          className="btn"
          onClick={() =>
            setLines((ls) => [...ls, { itemId: '', label: '', qtyPer: '', scrapPct: '0' }])
          }
        >
          + Add component
        </button>
      ) : null}
      {errors.lines ? <div className="field-error">{errors.lines}</div> : null}
    </Modal>
  );
}

export function BomPage({ actions }: { actions: ActionSet }) {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => mlist('/boms', { status }), [status]);
  return (
    <>
      <PageHead
        title="Bill of Materials"
        sub="What each finished or semi-finished item is made of, with the scrap allowance. One Active version per item."
      />
      <div className="toolbar">
        <label htmlFor="bom-status">Status</label>
        <select id="bom-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="RETIRED">Retired</option>
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setOpen('new')}>
            + New BOM
          </button>
        ) : null}
        {actions.print ? (
          <FileButton path="/export/boms" name="mfg-boms.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Item</th>
              <th>Version</th>
              <th>Base qty</th>
              <th>Components</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={6}>No bills of materials yet.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>
                  <button type="button" className="link" onClick={() => setOpen(s(r.id))}>
                    {s(r.number)}
                  </button>
                </td>
                <td>
                  {s(r.itemCode)} · {s(r.itemName)}
                </td>
                <td>{s(r.versionNo)}</td>
                <td>
                  {s(r.baseQty)} {s(r.uom)}
                </td>
                <td>{s(r.lineCount)}</td>
                <td>
                  <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <BomEditor
          id={open === 'new' ? null : open}
          actions={actions}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ routing
interface OpLine {
  seq: string;
  name: string;
  workCentreId: string;
  setupMinutes: string;
  runMinutes: string;
  inspectionRequired: boolean;
}
const blankOp = (n: number): OpLine => ({
  seq: String(n * 10),
  name: '',
  workCentreId: '',
  setupMinutes: '0',
  runMinutes: '0',
  inspectionRequired: false,
});

function RoutingEditor({
  id,
  actions,
  onClose,
  onChanged,
}: {
  id: string | null;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const wcs = useWorkCentres();
  const [doc, setDoc] = useState<Row | null>(null);
  const [itemId, setItemId] = useState('');
  const [itemLabel, setItemLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [ops, setOps] = useState<OpLine[]>([blankOp(1)]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const loaded = useLoad(async () => {
    if (!id) return null;
    const d = await mget(`/routings/${id}`);
    setDoc(d);
    setItemId(s(d.itemId));
    setItemLabel(`${s(d.itemCode)} · ${s(d.itemName)}`);
    setNotes(s(d.notes));
    setOps(
      (d.ops as Row[]).map((o) => ({
        seq: s(o.seq),
        name: s(o.name),
        workCentreId: s(o.workCentreId),
        setupMinutes: s(o.setupMinutes),
        runMinutes: s(o.runMinutes),
        inspectionRequired: o.inspectionRequired === true,
      })),
    );
    return d;
  }, [id]);
  const status = doc ? s(doc.status) : 'DRAFT';
  const editable = doc ? status === 'DRAFT' && actions.edit : actions.add;
  const body = () => ({
    ...(doc ? {} : { itemId }),
    notes: notes || undefined,
    ops: ops.map((o) => ({
      seq: Number(o.seq),
      name: o.name,
      workCentreId: o.workCentreId,
      setupMinutes: o.setupMinutes || '0',
      runMinutes: o.runMinutes || '0',
      inspectionRequired: o.inspectionRequired,
    })),
  });
  const run = (fn: () => Promise<unknown>, ok: string) => {
    setMsg('');
    setErrors({});
    fn()
      .then(() => {
        toast(ok);
        onChanged();
      })
      .catch((e: unknown) => {
        const u = toUiError(e);
        setMsg(u.message);
        setErrors(u.fields);
      });
  };
  const setOp = (i: number, p: Partial<OpLine>) =>
    setOps((a) => a.map((o, j) => (j === i ? { ...o, ...p } : o)));
  return (
    <Modal
      title={doc ? `${s(doc.number)} · version ${s(doc.versionNo)}` : 'New routing'}
      sub={
        doc
          ? `${s(doc.itemCode)} · ${s(doc.itemName)} (${status})`
          : 'The operations an item goes through, in order.'
      }
      onClose={onClose}
      footer={
        <>
          {editable ? (
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                run(
                  () =>
                    doc
                      ? mpatch(`/routings/${s(doc.id)}`, Number(doc.version), body())
                      : mpost('/routings', body()),
                  'Saved',
                )
              }
            >
              Save
            </button>
          ) : null}
          {doc && status === 'DRAFT' && actions.approve ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                run(
                  () => mpost(`/routings/${s(doc.id)}/activate`, {}, Number(doc.version)),
                  'Activated',
                )
              }
            >
              Activate
            </button>
          ) : null}
          {doc && status === 'ACTIVE' && actions.approve ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                run(
                  () => mpost(`/routings/${s(doc.id)}/retire`, {}, Number(doc.version)),
                  'Retired',
                )
              }
            >
              Retire
            </button>
          ) : null}
          {doc && status !== 'DRAFT' && actions.add ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                run(() => mpost(`/routings/${s(doc.id)}/new-version`, {}), 'New draft version made')
              }
            >
              New version
            </button>
          ) : null}
          {doc && actions.print ? (
            <FileButton path={`/routings/${s(doc.id)}/print`} name="routing.pdf" label="Print" />
          ) : null}
        </>
      }
    >
      <ErrorBox message={msg || loaded.error} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="rt-item">Item *</label>
          <RefPicker
            id="rt-item"
            kind="item"
            value={itemId}
            label={itemLabel}
            disabled={!!doc || !editable}
            onChange={(nid, nl) => {
              setItemId(nid);
              setItemLabel(nl);
            }}
          />
          {errors.itemId ? <div className="field-error">{errors.itemId}</div> : null}
        </div>
        <div className="field">
          <label htmlFor="rt-notes">Notes</label>
          <input
            id="rt-notes"
            value={notes}
            disabled={!editable}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      <h4>Operations</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Operation</th>
              <th>Work center</th>
              <th>Setup min</th>
              <th>Run min / piece</th>
              <th>Inspection first</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ops.map((o, i) => (
              <tr key={i}>
                <td>
                  <input
                    aria-label={`Number ${i + 1}`}
                    type="number"
                    value={o.seq}
                    disabled={!editable}
                    onChange={(e) => setOp(i, { seq: e.target.value })}
                  />
                  {errors[`ops.${i}.seq`] ? (
                    <div className="field-error">{errors[`ops.${i}.seq`]}</div>
                  ) : null}
                </td>
                <td>
                  <input
                    aria-label={`Operation ${i + 1}`}
                    value={o.name}
                    disabled={!editable}
                    onChange={(e) => setOp(i, { name: e.target.value })}
                  />
                </td>
                <td>
                  <OptionSelect
                    id={`rt-wc${i}`}
                    value={o.workCentreId}
                    options={wcs.data ?? []}
                    onChange={(x) => setOp(i, { workCentreId: x })}
                  />
                  {errors[`ops.${i}.workCentreId`] ? (
                    <div className="field-error">{errors[`ops.${i}.workCentreId`]}</div>
                  ) : null}
                </td>
                <td>
                  <input
                    aria-label={`Setup ${i + 1}`}
                    type="number"
                    step="any"
                    value={o.setupMinutes}
                    disabled={!editable}
                    onChange={(e) => setOp(i, { setupMinutes: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Run ${i + 1}`}
                    type="number"
                    step="any"
                    value={o.runMinutes}
                    disabled={!editable}
                    onChange={(e) => setOp(i, { runMinutes: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Inspection ${i + 1}`}
                    type="checkbox"
                    checked={o.inspectionRequired}
                    disabled={!editable}
                    onChange={(e) => setOp(i, { inspectionRequired: e.target.checked })}
                  />
                </td>
                <td>
                  {editable && ops.length > 1 ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setOps((a) => a.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable ? (
        <button
          type="button"
          className="btn"
          onClick={() => setOps((a) => [...a, blankOp(a.length + 1)])}
        >
          + Add operation
        </button>
      ) : null}
      {errors.ops ? <div className="field-error">{errors.ops}</div> : null}
    </Modal>
  );
}

export function RoutingPage({ actions }: { actions: ActionSet }) {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => mlist('/routings', { status }), [status]);
  return (
    <>
      <PageHead
        title="Routing"
        sub="The operations of an item, each at a work center. An operation can require an inspection before the order moves on."
      />
      <div className="toolbar">
        <label htmlFor="rt-status">Status</label>
        <select id="rt-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="RETIRED">Retired</option>
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setOpen('new')}>
            + New routing
          </button>
        ) : null}
        {actions.print ? (
          <FileButton path="/export/routings" name="mfg-routings.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Item</th>
              <th>Version</th>
              <th>Operations</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={5}>No routings yet.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>
                  <button type="button" className="link" onClick={() => setOpen(s(r.id))}>
                    {s(r.number)}
                  </button>
                </td>
                <td>
                  {s(r.itemCode)} · {s(r.itemName)}
                </td>
                <td>{s(r.versionNo)}</td>
                <td>{s(r.opCount)}</td>
                <td>
                  <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <RoutingEditor
          id={open === 'new' ? null : open}
          actions={actions}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}
