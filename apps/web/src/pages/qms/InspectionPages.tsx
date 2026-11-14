// Phase 12 inspection screens. One list + one sheet editor serve every inspection form (incoming, in-process, pre-dispatch,
// ISIR, welding, VT): the fields and the number of readings come from the template (R-17), the plan pre-fills the rows,
// each reading is judged against its limits, and the in-charge takes the Usage Decision.
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { qget, qlist, qpatch, qpost } from '../../lib/qmsApi';
import type { FieldDef, Row, Template } from '../../lib/qmsApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, PageHead, Pill, todayIso } from '../finance/shared';
import { DynamicFields, STATUS_TONE, Tabs, s } from './Shared';
import { DateField } from '../../ui/components';

export type Kind = 'INCOMING' | 'IN_PROCESS' | 'PRE_DISPATCH' | 'ISIR' | 'WELDING' | 'VT';
export const KIND_LABEL: Record<Kind, string> = {
  INCOMING: 'Incoming (RM)',
  IN_PROCESS: 'In-process',
  PRE_DISPATCH: 'Pre-dispatch',
  ISIR: 'ISIR',
  WELDING: 'Welding',
  VT: 'Visual test (VT)',
};

interface RowState {
  label: string;
  spec: string;
  method: string;
  unit: string;
  rowType: 'NUMERIC' | 'ATTRIBUTE';
  lsl: string;
  usl: string;
  readings: string[];
  extra: Record<string, string>;
  remark: string;
  rowStatus?: string;
}
const blankRow = (n: number, attribute: boolean): RowState => ({
  label: '',
  spec: '',
  method: '',
  unit: '',
  rowType: attribute ? 'ATTRIBUTE' : 'NUMERIC',
  lsl: '',
  usl: '',
  readings: Array.from({ length: n }, () => ''),
  extra: {},
  remark: '',
});
const fromApi = (r: Row, n: number): RowState => {
  const rd = ((r.readings as unknown[] | undefined) ?? []).map((x) => s(x));
  while (rd.length < n) rd.push('');
  return {
    label: s(r.label),
    spec: s(r.spec),
    method: s(r.method),
    unit: s(r.unit),
    rowType: s(r.rowType) === 'ATTRIBUTE' ? 'ATTRIBUTE' : 'NUMERIC',
    lsl: s(r.lsl),
    usl: s(r.usl),
    readings: rd,
    extra: (r.extra as Record<string, string> | undefined) ?? {},
    remark: s(r.remark),
    rowStatus: s(r.rowStatus),
  };
};
const toApi = (r: RowState) => ({
  label: r.label,
  spec: r.spec || null,
  method: r.method || null,
  unit: r.unit || null,
  rowType: r.rowType,
  lsl: r.rowType === 'NUMERIC' && r.lsl !== '' ? r.lsl : null,
  usl: r.rowType === 'NUMERIC' && r.usl !== '' ? r.usl : null,
  readings: r.readings,
  extra: r.extra,
  remark: r.remark || null,
});
const STATUS_WORDS: Record<string, string> = {
  PENDING: 'Waiting',
  OK: 'OK',
  NOT_OK: 'NOT OK',
  NA: 'No limit',
};

function SheetEditor({
  kind,
  id,
  actions,
  onClose,
  onChanged,
}: {
  kind: Kind;
  id: string | null;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [doc, setDoc] = useState<Row | null>(null);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [header, setHeader] = useState<Record<string, unknown>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<RowState[]>([]);
  const [docDate, setDocDate] = useState(todayIso());
  const [lotQty, setLotQty] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [acc, setAcc] = useState('');
  const [rej, setRej] = useState('');
  const [dnote, setDnote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const status = doc ? s(doc.status) : 'Draft';
  const editable = doc ? status === 'Draft' && actions.edit : actions.add;
  const readings = tpl?.rowConfig.readings ?? 1;
  const attribute = tpl?.rowConfig.attribute === true;
  const customerKey = tpl?.headerFields.find((f) => f.type === 'customer')?.key;
  const itemKey = tpl?.headerFields.find((f) => f.type === 'item')?.key;
  const [custRef, setCustRef] = useState('');
  const customerId = custRef;
  const itemId = itemKey ? s(header[itemKey]) : '';

  // load an existing sheet
  useEffect(() => {
    if (!id) return;
    let alive = true;
    qget(`/inspections/${id}`)
      .then((d) => {
        if (!alive) return;
        const snap = d.templateSnapshot as {
          headerFields: FieldDef[];
          rowConfig: Template['rowConfig'];
          name: string;
          version: number;
        };
        setDoc(d);
        setTpl({
          id: s(d.templateId),
          kind,
          name: snap.name,
          version: snap.version,
          customerId: null,
          headerFields: snap.headerFields,
          rowConfig: snap.rowConfig,
          closeRequires: [],
          status: 'ACTIVE',
        });
        setHeader((d.header as Record<string, unknown>) ?? {});
        setLabels((d.headerLabels as Record<string, string>) ?? {});
        const n = snap.rowConfig.readings ?? 1;
        setRows(((d.rows as Row[]) ?? []).map((r) => fromApi(r, n)));
        setDocDate(s(d.docDate));
        setLotQty(s(d.lotQty));
        setResult(s(d.result));
        setAcc(s(d.lotQty));
        setRej('0');
      })
      .catch((e: unknown) => alive && setMsg(toUiError(e).message));
    return () => {
      alive = false;
    };
  }, [id, kind]);

  // new sheet: the template follows the customer chosen (customer-wise formats)
  useEffect(() => {
    if (id) return;
    let alive = true;
    qget<Template>('/templates/resolve', { kind, customerId: customerId || undefined })
      .then((t) => {
        if (!alive) return;
        setTpl(t);
        setHeader((h) =>
          Object.fromEntries(
            Object.entries(h).filter(([k]) => t.headerFields.some((f) => f.key === k)),
          ),
        );
      })
      .catch((e: unknown) => alive && setMsg(toUiError(e).message));
    return () => {
      alive = false;
    };
  }, [id, kind, customerId]);

  // new sheet: a plan for the chosen item pre-fills the rows
  useEffect(() => {
    if (id || !itemId || !tpl) return;
    let alive = true;
    qget('/plans/preview', { kind, itemId, customerId: customerId || undefined })
      .then((p) => {
        if (!alive) return;
        const planRows = (p.rows as Row[]) ?? [];
        if (planRows.length === 0) return;
        setRows((cur) =>
          cur.some((r) => r.label.trim() !== '')
            ? cur
            : planRows.map((r) => fromApi({ ...r, readings: [] }, tpl.rowConfig.readings ?? 1)),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, kind, itemId, customerId, tpl]);

  const bad = (e: unknown) => {
    const u = toUiError(e);
    setMsg(u.message);
    setErrors(u.fields);
  };
  const setRow = (i: number, patch: Partial<RowState>) =>
    setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  async function save(): Promise<Row | null> {
    setMsg('');
    setErrors({});
    try {
      const body = {
        docDate,
        header,
        rows: rows.filter((r) => r.label.trim() !== '').map(toApi),
        ...(lotQty ? { lotQty } : {}),
      };
      const d = doc
        ? await qpatch(`/inspections/${s(doc.id)}`, Number(doc.version), body)
        : await qpost('/inspections', { kind, ...body, templateId: tpl?.id });
      setDoc(d);
      setLabels((d.headerLabels as Record<string, string>) ?? labels);
      setRows(((d.rows as Row[]) ?? []).map((r) => fromApi(r, readings)));
      toast(`Saved ${s(d.number)}`);
      onChanged();
      return d;
    } catch (e) {
      bad(e);
      return null;
    }
  }
  async function submit() {
    setBusy(true);
    try {
      const d = await save();
      if (!d) return;
      const out = await qpost(
        `/inspections/${s(d.id)}/submit`,
        { ...(result ? { result } : {}), ...(note ? { note } : {}) },
        Number(d.version),
      );
      setDoc(out);
      toast(`Submitted ${s(out.number)}`);
      onChanged();
    } catch (e) {
      bad(e);
    } finally {
      setBusy(false);
    }
  }
  async function decide() {
    if (!doc) return;
    setBusy(true);
    setMsg('');
    setErrors({});
    try {
      const out = await qpost(`/inspections/${s(doc.id)}/decide`, {
        acceptedQty: acc || '0',
        rejectedQty: rej || '0',
        ...(dnote ? { note: dnote } : {}),
      });
      setDoc(out);
      toast(`Usage decision recorded for ${s(out.number)}`);
      onChanged();
    } catch (e) {
      bad(e);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!doc) return;
    setBusy(true);
    try {
      const out = await qpost(`/inspections/${s(doc.id)}/cancel`, { reason });
      setDoc(out);
      toast(`Cancelled ${s(out.number)}`);
      onChanged();
    } catch (e) {
      bad(e);
    } finally {
      setBusy(false);
    }
  }

  const extraCols = tpl?.rowConfig.extra ?? [];
  const title = doc ? `${KIND_LABEL[kind]} · ${s(doc.number)}` : `New ${KIND_LABEL[kind]} sheet`;
  return (
    <Modal
      title={title}
      sub={tpl ? `${tpl.name} · version ${tpl.version}` : 'Loading the form…'}
      onClose={onClose}
      footer={
        <>
          {editable ? (
            <button
              type="button"
              className="btn"
              disabled={busy || !tpl}
              onClick={() => void save()}
            >
              Save draft
            </button>
          ) : null}
          {doc && status === 'Draft' && actions.submit ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              Submit sheet
            </button>
          ) : null}
        </>
      }
    >
      <ErrorBox message={msg} />
      {doc && s(doc.sourceType) === 'GRN_LINE' ? (
        <div className="msg info show static">
          Goods receipt {s((doc.grn as Row | null)?.grnNo)} · lot of {s(doc.lotQty)}{' '}
          {s((doc.grn as Row | null)?.uom)}. The stock stays in <b>Quality Inspection</b> until the
          usage decision.
        </div>
      ) : null}
      {doc ? (
        <p>
          <Pill tone={STATUS_TONE[status]}>{status}</Pill>{' '}
          {doc.result ? <Pill tone={STATUS_TONE[s(doc.result)]}>{s(doc.result)}</Pill> : null}
        </p>
      ) : null}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="sh-date">Date *</label>
          <DateField
            id="sh-date"
            value={docDate}
            disabled={!editable}
            onChange={(e) => setDocDate(e.target.value)}
          />
        </div>
        {!doc || doc.lotQty !== null ? (
          <div className="field">
            <label htmlFor="sh-lot">Lot quantity</label>
            <input
              id="sh-lot"
              value={lotQty}
              disabled={!editable || s(doc?.sourceType) === 'GRN_LINE'}
              onChange={(e) => setLotQty(e.target.value)}
            />
          </div>
        ) : null}
      </div>
      {tpl ? (
        <DynamicFields
          idPrefix="sh"
          fields={tpl.headerFields}
          values={header}
          labels={labels}
          errors={errors}
          readOnly={!editable}
          onChange={(k, v, l) => {
            setHeader((h) => ({ ...h, [k]: v }));
            if (k === customerKey) setCustRef(v);
            if (l !== undefined) setLabels((x) => ({ ...x, [k]: l }));
          }}
        />
      ) : null}

      <h3>Readings</h3>
      {errors.rows ? <div className="field-error">{errors.rows}</div> : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>{tpl?.rowConfig.labelHeader ?? 'Characteristic'}</th>
              {extraCols.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>Specification</th>
              <th>Method</th>
              <th>Type</th>
              <th>Lower</th>
              <th>Upper</th>
              {Array.from({ length: readings }, (_, i) => (
                <th key={i}>
                  {tpl?.rowConfig.readingLabel ?? 'Reading'} {readings > 1 ? i + 1 : ''}
                </th>
              ))}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <Empty cols={8 + readings + extraCols.length}>
                No rows yet. Add a characteristic below, or pick an item that has an inspection
                plan.
              </Empty>
            ) : null}
            {rows.map((r, i) => (
              <tr key={i} className={r.rowStatus === 'NOT_OK' ? 'row-red' : undefined}>
                <td>
                  <input
                    aria-label={`Characteristic ${i + 1}`}
                    value={r.label}
                    disabled={!editable}
                    onChange={(e) => setRow(i, { label: e.target.value })}
                  />
                  {errors[`rows.${i}.label`] ? (
                    <div className="field-error">{errors[`rows.${i}.label`]}</div>
                  ) : null}
                </td>
                {extraCols.map((c) => (
                  <td key={c.key}>
                    <input
                      aria-label={`${c.label} ${i + 1}`}
                      value={r.extra[c.key] ?? ''}
                      disabled={!editable}
                      onChange={(e) =>
                        setRow(i, { extra: { ...r.extra, [c.key]: e.target.value } })
                      }
                    />
                  </td>
                ))}
                <td>
                  <input
                    aria-label={`Specification ${i + 1}`}
                    value={r.spec}
                    disabled={!editable}
                    onChange={(e) => setRow(i, { spec: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Method ${i + 1}`}
                    value={r.method}
                    disabled={!editable}
                    onChange={(e) => setRow(i, { method: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`Type ${i + 1}`}
                    value={r.rowType}
                    disabled={!editable}
                    onChange={(e) => setRow(i, { rowType: e.target.value as RowState['rowType'] })}
                  >
                    <option value="NUMERIC">Measured</option>
                    <option value="ATTRIBUTE">OK / NOT OK</option>
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`Lower limit ${i + 1}`}
                    size={6}
                    value={r.lsl}
                    disabled={!editable || r.rowType === 'ATTRIBUTE'}
                    onChange={(e) => setRow(i, { lsl: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Upper limit ${i + 1}`}
                    size={6}
                    value={r.usl}
                    disabled={!editable || r.rowType === 'ATTRIBUTE'}
                    onChange={(e) => setRow(i, { usl: e.target.value })}
                  />
                </td>
                {r.readings.slice(0, readings).map((v, k) => (
                  <td key={k}>
                    <input
                      aria-label={`Reading ${k + 1} of row ${i + 1}`}
                      size={7}
                      value={v}
                      disabled={!editable}
                      placeholder={r.rowType === 'ATTRIBUTE' ? 'OK / NOT OK' : ''}
                      onChange={(e) =>
                        setRow(i, {
                          readings: r.readings.map((x, j) => (j === k ? e.target.value : x)),
                        })
                      }
                    />
                  </td>
                ))}
                <td>
                  {r.rowStatus ? (
                    <Pill
                      tone={
                        r.rowStatus === 'NOT_OK'
                          ? 'rejected'
                          : r.rowStatus === 'OK'
                            ? 'approved'
                            : 'draft'
                      }
                    >
                      {STATUS_WORDS[r.rowStatus] ?? r.rowStatus}
                    </Pill>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errors[Object.keys(errors).find((k) => k.endsWith('.readings')) ?? ''] ? (
        <div className="field-error">
          {errors[Object.keys(errors).find((k) => k.endsWith('.readings')) ?? '']}
        </div>
      ) : null}
      {editable ? (
        <button
          type="button"
          className="btn"
          onClick={() => setRows((c) => [...c, blankRow(readings, attribute)])}
        >
          + Add characteristic
        </button>
      ) : null}

      {doc && status === 'Draft' && actions.submit ? (
        <>
          <h3>Result</h3>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="sh-result">Result of the sheet</label>
              <select id="sh-result" value={result} onChange={(e) => setResult(e.target.value)}>
                <option value="">Automatic from the readings</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="CONDITIONAL">Conditionally accepted</option>
                <option value="REJECTED">Rejected</option>
              </select>
              {errors.result ? <div className="field-error">{errors.result}</div> : null}
            </div>
            <div className="field">
              <label htmlFor="sh-note">Remark / condition</label>
              <input id="sh-note" value={note} onChange={(e) => setNote(e.target.value)} />
              {errors.note ? <div className="field-error">{errors.note}</div> : null}
            </div>
          </div>
        </>
      ) : null}

      {doc && status === 'Submitted' && actions.approve ? (
        <>
          <h3>Usage decision</h3>
          <p>
            Accepted quantity becomes <b>Unrestricted</b> stock. Rejected quantity becomes{' '}
            <b>Blocked</b> and goes to the rejection register.
          </p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="ud-acc">Accepted quantity *</label>
              <input id="ud-acc" value={acc} onChange={(e) => setAcc(e.target.value)} />
              {errors.acceptedQty ? <div className="field-error">{errors.acceptedQty}</div> : null}
            </div>
            <div className="field">
              <label htmlFor="ud-rej">Rejected quantity *</label>
              <input id="ud-rej" value={rej} onChange={(e) => setRej(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ud-note">Reason (defect or condition)</label>
              <input id="ud-note" value={dnote} onChange={(e) => setDnote(e.target.value)} />
              {errors.note ? <div className="field-error">{errors.note}</div> : null}
            </div>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void decide()}
          >
            Record usage decision
          </button>
        </>
      ) : null}
      {doc && status === 'Decided' ? (
        <p>
          Decision: <b>{s(doc.decision)}</b> · accepted {s(doc.acceptedQty)} · rejected{' '}
          {s(doc.rejectedQty)}
          {doc.decisionNote ? ` · ${s(doc.decisionNote)}` : ''}
        </p>
      ) : null}
      {doc &&
      ['Draft', 'Submitted'].includes(status) &&
      s(doc.sourceType) !== 'GRN_LINE' &&
      actions.cancel ? (
        <div className="toolbar">
          <input
            aria-label="Reason for cancelling"
            placeholder="Reason for cancelling"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void cancel()}
          >
            Cancel this sheet
          </button>
        </div>
      ) : null}
    </Modal>
  );
}

export function InspectionPage({
  kinds,
  title,
  sub,
  actions,
  allowNew = true,
}: {
  kinds: Kind[];
  title: string;
  sub: string;
  actions: ActionSet;
  allowNew?: boolean;
}) {
  const [tab, setTab] = useState<Kind | 'ALL'>(
    kinds.length === 1 ? (kinds[0] as Kind) : kinds.length ? (kinds[0] as Kind) : 'ALL',
  );
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ kind: Kind; id: string | null } | null>(null);
  const list = useLoad(
    () => qlist('/inspections', { ...(tab !== 'ALL' ? { kind: tab } : {}), status, q }),
    [tab, status, q],
  );
  const tabs = useMemo<[Kind | 'ALL', string][]>(
    () =>
      kinds.length === 0 ? [['ALL', 'All inspections']] : kinds.map((k) => [k, KIND_LABEL[k]]),
    [kinds],
  );
  const newKind = tab === 'ALL' ? null : tab;
  return (
    <>
      <PageHead title={title} sub={sub}>
        {allowNew && newKind && actions.add ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => setEditing({ kind: newKind, id: null })}
          >
            + New {KIND_LABEL[newKind]} sheet
          </button>
        ) : null}
      </PageHead>
      {tabs.length > 1 ? <Tabs tabs={tabs} value={tab} onChange={setTab} /> : null}
      <div className="toolbar">
        <label htmlFor="in-q">Search</label>
        <input
          id="in-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Number, item, party"
        />
        <label htmlFor="in-st">Status</label>
        <select id="in-st" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {['Draft', 'Submitted', 'Decided', 'Cancelled'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Number</th>
              {tab === 'ALL' ? <th>Type</th> : null}
              <th>Date</th>
              <th>Item</th>
              <th>Supplier / customer</th>
              <th>Lot</th>
              <th>Result</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={8}>
                No inspection sheets yet.{' '}
                {allowNew && newKind && actions.add
                  ? 'Click “+ New sheet”, or post a goods receipt of an item that needs inspection.'
                  : ''}
              </Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() => setEditing({ kind: s(r.kind) as Kind, id: s(r.id) })}
                  >
                    {s(r.number)}
                  </button>
                </td>
                {tab === 'ALL' ? <td>{KIND_LABEL[s(r.kind) as Kind]}</td> : null}
                <td>{dmy(s(r.docDate))}</td>
                <td>{s(r.itemName)}</td>
                <td>{s(r.supplierName) || s(r.customerName)}</td>
                <td>{s(r.lotQty)}</td>
                <td>
                  {r.result ? <Pill tone={STATUS_TONE[s(r.result)]}>{s(r.result)}</Pill> : null}
                </td>
                <td>
                  <Pill tone={STATUS_TONE[s(r.status)]}>{s(r.status)}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? (
        <SheetEditor
          kind={editing.kind}
          id={editing.id}
          actions={actions}
          onClose={() => setEditing(null)}
          onChanged={list.reload}
        />
      ) : null}
    </>
  );
}
