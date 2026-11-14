// Phase 12 set-up and calibration screens: inspection plans, the form templates (versioned data, R-16), targets, and the
// instruments list with the history card and calibration entries.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { qget, qlist, qpatch, qpost, qput } from '../../lib/qmsApi';
import type { FieldDef, Row } from '../../lib/qmsApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, PageHead, Pill, todayIso } from '../finance/shared';
import { KIND_LABEL } from './InspectionPages';
import type { Kind } from './InspectionPages';
import { RefPicker, Tabs, s } from './Shared';
import { DateField } from '../../ui/components';

// ------------------------------------------------------------------------------------------------ plans
interface CharState {
  name: string;
  spec: string;
  method: string;
  unit: string;
  type: 'NUMERIC' | 'ATTRIBUTE';
  lsl: string;
  usl: string;
}
function PlanDialog({
  plan,
  onClose,
  onDone,
}: {
  plan: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState(s(plan?.code));
  const [name, setName] = useState(s(plan?.name));
  const [kind, setKind] = useState<Kind>((s(plan?.kind) || 'INCOMING') as Kind);
  const [itemId, setItemId] = useState(s(plan?.itemId));
  const [itemLabel, setItemLabel] = useState(s(plan?.itemName));
  const [status, setStatus] = useState(s(plan?.status) || 'ACTIVE');
  const [chars, setChars] = useState<CharState[]>(
    ((plan?.characteristics as Row[] | undefined) ?? []).map((c) => ({
      name: s(c.name),
      spec: s(c.spec),
      method: s(c.method),
      unit: s(c.unit),
      type: s(c.type) === 'ATTRIBUTE' ? 'ATTRIBUTE' : 'NUMERIC',
      lsl: s(c.lsl),
      usl: s(c.usl),
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const setC = (i: number, p: Partial<CharState>) =>
    setChars((c) => c.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const body = () => ({
    name,
    characteristics: chars
      .filter((c) => c.name.trim())
      .map((c) => ({
        name: c.name,
        spec: c.spec || undefined,
        method: c.method || undefined,
        unit: c.unit || undefined,
        type: c.type,
        lsl: c.type === 'NUMERIC' && c.lsl !== '' ? c.lsl : null,
        usl: c.type === 'NUMERIC' && c.usl !== '' ? c.usl : null,
      })),
  });
  return (
    <Modal
      title={plan ? `Inspection plan ${s(plan.code)}` : 'New inspection plan'}
      sub="The characteristics a sheet starts with when its item is chosen."
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setMsg('');
            setErrors({});
            const p = plan
              ? qpatch(`/plans/${s(plan.id)}`, Number(plan.version), {
                  ...body(),
                  status,
                  itemId: itemId || null,
                })
              : qpost('/plans', { code, kind, ...(itemId ? { itemId } : {}), ...body() });
            p.then((r) => {
              toast(`Saved plan ${s(r.code)}`);
              onDone();
            }).catch((e: unknown) => {
              const u = toUiError(e);
              setMsg(u.message);
              setErrors(u.fields);
            });
          }}
        >
          Save plan
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="pl-code">Plan code *</label>
          <input
            id="pl-code"
            value={code}
            disabled={!!plan}
            onChange={(e) => setCode(e.target.value)}
          />
          {errors.code ? <div className="field-error">{errors.code}</div> : null}
        </div>
        <div className="field">
          <label htmlFor="pl-name">Name *</label>
          <input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pl-kind">Inspection type *</label>
          <select
            id="pl-kind"
            value={kind}
            disabled={!!plan}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pl-item">Item</label>
          <RefPicker
            id="pl-item"
            kind="item"
            value={itemId}
            label={itemLabel}
            onChange={(id, l) => {
              setItemId(id);
              setItemLabel(l);
            }}
          />
        </div>
        {plan ? (
          <div className="field">
            <label htmlFor="pl-status">Status</label>
            <select id="pl-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        ) : null}
      </div>
      <h3>Characteristics</h3>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Specification</th>
              <th>Method</th>
              <th>Unit</th>
              <th>Type</th>
              <th>Lower</th>
              <th>Upper</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {chars.length === 0 ? <Empty cols={8}>No characteristics yet.</Empty> : null}
            {chars.map((c, i) => (
              <tr key={i}>
                <td>
                  <input
                    aria-label={`Name ${i + 1}`}
                    value={c.name}
                    onChange={(e) => setC(i, { name: e.target.value })}
                  />
                  {errors[`characteristics.${i}.name`] ? (
                    <div className="field-error">{errors[`characteristics.${i}.name`]}</div>
                  ) : null}
                </td>
                <td>
                  <input
                    aria-label={`Specification ${i + 1}`}
                    value={c.spec}
                    onChange={(e) => setC(i, { spec: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Method ${i + 1}`}
                    value={c.method}
                    onChange={(e) => setC(i, { method: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Unit ${i + 1}`}
                    size={5}
                    value={c.unit}
                    onChange={(e) => setC(i, { unit: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`Type ${i + 1}`}
                    value={c.type}
                    onChange={(e) => setC(i, { type: e.target.value as CharState['type'] })}
                  >
                    <option value="NUMERIC">Measured</option>
                    <option value="ATTRIBUTE">OK / NOT OK</option>
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`Lower ${i + 1}`}
                    size={6}
                    value={c.lsl}
                    disabled={c.type === 'ATTRIBUTE'}
                    onChange={(e) => setC(i, { lsl: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Upper ${i + 1}`}
                    size={6}
                    value={c.usl}
                    disabled={c.type === 'ATTRIBUTE'}
                    onChange={(e) => setC(i, { usl: e.target.value })}
                  />
                  {errors[`characteristics.${i}.lsl`] ? (
                    <div className="field-error">{errors[`characteristics.${i}.lsl`]}</div>
                  ) : null}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setChars((x) => x.filter((_, k) => k !== i))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn"
        onClick={() =>
          setChars((x) => [
            ...x,
            { name: '', spec: '', method: '', unit: '', type: 'NUMERIC', lsl: '', usl: '' },
          ])
        }
      >
        + Add characteristic
      </button>
    </Modal>
  );
}

function Plans({ actions }: { actions: ActionSet }) {
  const [editing, setEditing] = useState<{ plan: Row | null } | null>(null);
  const list = useLoad(() => qget<{ rows: Row[] }>('/plans'), []);
  return (
    <>
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setEditing({ plan: null })}>
            + New inspection plan
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
              <th>Item</th>
              <th>Characteristics</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={6}>No plans yet. Click “+ New inspection plan”.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((p) => (
              <tr key={s(p.id)}>
                <td>
                  <button type="button" className="link" onClick={() => setEditing({ plan: p })}>
                    {s(p.code)}
                  </button>
                </td>
                <td>{s(p.name)}</td>
                <td>{KIND_LABEL[s(p.kind) as Kind]}</td>
                <td>{s(p.itemName) || 'Any item'}</td>
                <td>{((p.characteristics as unknown[]) ?? []).length}</td>
                <td>
                  <Pill>{s(p.status)}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? (
        <PlanDialog
          plan={editing.plan}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ templates
function TemplateDialog({
  tpl,
  onClose,
  onDone,
}: {
  tpl: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(s(tpl.name));
  const [customerId, setCustomerId] = useState(s(tpl.customerId));
  const [fields, setFields] = useState<FieldDef[]>((tpl.headerFields as FieldDef[]) ?? []);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const setF = (i: number, p: Partial<FieldDef>) =>
    setFields((c) => c.map((x, k) => (k === i ? { ...x, ...p } : x)));
  return (
    <Modal
      title={`Form ${s(tpl.name)}`}
      sub="Publishing creates a new version. Sheets already made keep the version they were made with."
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={reason.trim().length < 3}
          onClick={() => {
            setMsg('');
            qpost('/templates', {
              kind: s(tpl.kind),
              name,
              ...(customerId ? { customerId } : {}),
              headerFields: fields.map((f) => ({
                ...f,
                options: f.type === 'select' ? f.options : undefined,
              })),
              rowConfig: tpl.rowConfig,
              closeRequires: tpl.closeRequires,
              reason,
            })
              .then((r) => {
                toast(`Published version ${s(r.version)}`);
                onDone();
              })
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Publish new version
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="tp-name">Name *</label>
          <input id="tp-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tp-cust">Only for customer (leave empty for everybody)</label>
          <RefPicker
            id="tp-cust"
            kind="customer"
            value={customerId}
            label={s(tpl.customerName)}
            onChange={(id) => setCustomerId(id)}
          />
        </div>
        <div className="field">
          <label htmlFor="tp-reason">Reason for this version *</label>
          <input id="tp-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <h3>Fields</h3>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Label</th>
              <th>Type</th>
              <th>Required</th>
              <th>Choices (comma separated)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i}>
                <td>
                  <input
                    aria-label={`Key ${i + 1}`}
                    value={f.key}
                    onChange={(e) => setF(i, { key: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Label ${i + 1}`}
                    value={f.label}
                    onChange={(e) => setF(i, { label: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`Field type ${i + 1}`}
                    value={f.type ?? 'text'}
                    onChange={(e) => setF(i, { type: e.target.value as FieldDef['type'] })}
                  >
                    {[
                      'text',
                      'textarea',
                      'date',
                      'number',
                      'select',
                      'item',
                      'customer',
                      'supplier',
                      'instrument',
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`Required ${i + 1}`}
                    type="checkbox"
                    checked={!!f.required}
                    onChange={(e) => setF(i, { required: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Choices ${i + 1}`}
                    disabled={f.type !== 'select'}
                    value={(f.options ?? []).join(',')}
                    onChange={(e) =>
                      setF(i, {
                        options: e.target.value
                          .split(',')
                          .map((x) => x.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setFields((x) => x.filter((_, k) => k !== i))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => setFields((x) => [...x, { key: '', label: '', type: 'text' }])}
      >
        + Add field
      </button>
    </Modal>
  );
}

function Templates({ actions }: { actions: ActionSet }) {
  const [editing, setEditing] = useState<Row | null>(null);
  const list = useLoad(() => qget<{ rows: Row[] }>('/templates', { status: 'ACTIVE' }), []);
  return (
    <>
      <p>
        Every client form is a template on the same inspection engine.{' '}
        {actions.controls
          ? 'Open one to publish a new version or a customer-specific format.'
          : 'Only the department head can publish a new version.'}
      </p>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Form</th>
              <th>Type</th>
              <th>Version</th>
              <th>Customer</th>
              <th>Fields</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows ?? []).map((t) => (
              <tr key={s(t.id)}>
                <td>
                  {actions.controls ? (
                    <button type="button" className="link" onClick={() => setEditing(t)}>
                      {s(t.name)}
                    </button>
                  ) : (
                    s(t.name)
                  )}
                </td>
                <td>{s(t.kind)}</td>
                <td>{s(t.version)}</td>
                <td>{s(t.customerName) || 'All'}</td>
                <td>{((t.headerFields as unknown[]) ?? []).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? (
        <TemplateDialog
          key={s(editing.id)}
          tpl={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function Targets({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => qget<{ rows: Row[] }>('/settings'), []);
  const [msg, setMsg] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const KEYS: [string, string][] = [
    ['INTERNAL_PPM_TARGET', 'Internal PPM target'],
    ['CUSTOMER_PPM_TARGET', 'Customer PPM target'],
    ['QUALITY_COST_PCT_TARGET', 'Quality cost target (% of sales)'],
    ['CAL_REMINDER_DAYS', 'Calibration reminder (days before it runs out)'],
  ];
  const current = (k: string) => {
    const unit = list.data?.rows.find((r) => s(r.key) === k && r.unitId);
    const all = list.data?.rows.find((r) => s(r.key) === k && !r.unitId);
    return unit ?? all;
  };
  return (
    <>
      <p>
        These are your numbers. Nothing is assumed: with no target, the monitors show the value
        without a verdict. They apply to the unit chosen in the top bar.
      </p>
      <ErrorBox message={msg || list.error} />
      <div className="form-grid">
        {KEYS.map(([k, label]) => (
          <div className="field" key={k}>
            <label htmlFor={`tg-${k}`}>{label}</label>
            <input
              id={`tg-${k}`}
              disabled={!actions.controls}
              value={vals[k] ?? s(current(k)?.value)}
              onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
            />
            {current(k)?.needsReview ? (
              <small>Starting value, not yet confirmed by the quality head.</small>
            ) : null}
          </div>
        ))}
      </div>
      {actions.controls ? (
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setMsg('');
            (async () => {
              for (const [k] of KEYS)
                if (vals[k] !== undefined && vals[k] !== '')
                  await qput('/settings', { key: k, value: vals[k], scope: 'UNIT' });
            })()
              .then(() => {
                toast('Targets saved');
                setVals({});
                list.reload();
              })
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Save targets
        </button>
      ) : null}
    </>
  );
}

export function PlansPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'plans' | 'tpl' | 'targets'>('plans');
  return (
    <>
      <PageHead
        title="Inspection plans and forms"
        sub="Plans pre-fill the sheets. Forms are templates on one engine. Targets drive the PPM and quality-cost monitors."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['plans', 'Inspection plans'],
          ['tpl', 'Form templates'],
          ['targets', 'Targets'],
        ]}
      />
      {tab === 'plans' ? <Plans actions={actions} /> : null}
      {tab === 'tpl' ? <Templates actions={actions} /> : null}
      {tab === 'targets' ? <Targets actions={actions} /> : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ instruments
const CAL_WORDS: Record<string, string> = {
  NOT_CALIBRATED: 'Not calibrated',
  EXPIRED: 'Expired',
  DUE_SOON: 'Due soon',
  VALID: 'In calibration',
};
const CAL_TONE: Record<string, string> = {
  NOT_CALIBRATED: 'rejected',
  EXPIRED: 'rejected',
  DUE_SOON: 'pending',
  VALID: 'approved',
};

function HistoryCard({
  id,
  actions,
  onClose,
  onChanged,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const card = useLoad(() => qget(`/instruments/${id}`), [id]);
  const [f, setF] = useState({
    calibratedOn: todayIso(),
    validUntil: '',
    certificateNo: '',
    agency: '',
    result: 'PASS',
    errorFound: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const d = card.data;
  return (
    <Modal
      title={d ? `History card ${s(d.historyCardNo)}` : 'History card'}
      sub={d ? `${s(d.name)} · ${s(d.equipmentNo)}` : ''}
      onClose={onClose}
      footer={null}
    >
      <ErrorBox message={msg || card.error} />
      {d ? (
        <>
          <div className="form-grid">
            <div>
              Unit: <b>{s(d.unitName)}</b>
            </div>
            <div>
              Division: <b>{s(d.division) || '—'}</b>
            </div>
            <div>
              Range: <b>{s(d.measuringRange) || '—'}</b>
            </div>
            <div>
              Least count: <b>{s(d.leastCount) || '—'}</b>
            </div>
            <div>
              Frequency: <b>{s(d.frequencyMonths)} months</b>
            </div>
            <div>
              Valid until: <b>{d.validUntil ? dmy(s(d.validUntil)) : '—'}</b>{' '}
              <Pill tone={CAL_TONE[s(d.calibrationStatus)]}>
                {CAL_WORDS[s(d.calibrationStatus)]}
              </Pill>
            </div>
          </div>
          <h3>Calibrations</h3>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Valid until</th>
                  <th>Certificate</th>
                  <th>Agency</th>
                  <th>Result</th>
                  <th>Error found</th>
                </tr>
              </thead>
              <tbody>
                {((d.calibrations as Row[]) ?? []).length === 0 ? (
                  <Empty cols={6}>Not calibrated yet.</Empty>
                ) : null}
                {((d.calibrations as Row[]) ?? []).map((c) => (
                  <tr key={s(c.id)}>
                    <td>{dmy(s(c.calibratedOn))}</td>
                    <td>{dmy(s(c.validUntil))}</td>
                    <td>{s(c.certificateNo)}</td>
                    <td>{s(c.agency)}</td>
                    <td>
                      <Pill tone={s(c.result) === 'PASS' ? 'approved' : 'rejected'}>
                        {s(c.result)}
                      </Pill>
                    </td>
                    <td>{s(c.errorFound)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {actions.edit && s(d.status) !== 'RETIRED' ? (
            <>
              <h3>Record a calibration</h3>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="cal-on">Calibrated on *</label>
                  <DateField
                    id="cal-on"
                    value={f.calibratedOn}
                    onChange={(e) => setF({ ...f, calibratedOn: e.target.value })}
                  />
                  {errors.calibratedOn ? (
                    <div className="field-error">{errors.calibratedOn}</div>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="cal-until">Valid until (empty = frequency from the card)</label>
                  <DateField
                    id="cal-until"
                    value={f.validUntil}
                    onChange={(e) => setF({ ...f, validUntil: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="cal-res">Result *</label>
                  <select
                    id="cal-res"
                    value={f.result}
                    onChange={(e) => setF({ ...f, result: e.target.value })}
                  >
                    <option value="PASS">Pass</option>
                    <option value="FAIL">Fail (take out of service)</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="cal-cert">Certificate no</label>
                  <input
                    id="cal-cert"
                    value={f.certificateNo}
                    onChange={(e) => setF({ ...f, certificateNo: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="cal-ag">Agency</label>
                  <input
                    id="cal-ag"
                    value={f.agency}
                    onChange={(e) => setF({ ...f, agency: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="cal-err">Error found {f.result === 'FAIL' ? '*' : ''}</label>
                  <input
                    id="cal-err"
                    value={f.errorFound}
                    onChange={(e) => setF({ ...f, errorFound: e.target.value })}
                  />
                  {errors.errorFound ? (
                    <div className="field-error">{errors.errorFound}</div>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setMsg('');
                  setErrors({});
                  qpost(`/instruments/${id}/calibrate`, {
                    calibratedOn: f.calibratedOn,
                    result: f.result,
                    ...(f.validUntil ? { validUntil: f.validUntil } : {}),
                    ...(f.certificateNo ? { certificateNo: f.certificateNo } : {}),
                    ...(f.agency ? { agency: f.agency } : {}),
                    ...(f.errorFound ? { errorFound: f.errorFound } : {}),
                  })
                    .then(() => {
                      toast('Calibration recorded');
                      card.reload();
                      onChanged();
                    })
                    .catch((e: unknown) => {
                      const u = toUiError(e);
                      setMsg(u.message);
                      setErrors(u.fields);
                    });
                }}
              >
                Save calibration
              </button>
            </>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}

function InstrumentDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    historyCardNo: '',
    name: '',
    equipmentNo: '',
    division: '',
    measuringRange: '',
    leastCount: '',
    make: '',
    location: '',
    frequencyMonths: '12',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const fields: [keyof typeof f, string, boolean][] = [
    ['historyCardNo', 'History card no', true],
    ['equipmentNo', 'Equipment no', true],
    ['name', 'Equipment name', true],
    ['division', 'Division / unit', false],
    ['measuringRange', 'Range', false],
    ['leastCount', 'Least count', false],
    ['make', 'Make', false],
    ['location', 'Location', false],
    ['frequencyMonths', 'Calibration every (months)', true],
  ];
  return (
    <Modal
      title="Add an instrument"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setMsg('');
            setErrors({});
            qpost('/instruments', {
              ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')),
              frequencyMonths: Number(f.frequencyMonths),
            })
              .then((r) => {
                toast(`Added ${s(r.equipmentNo)}`);
                onDone();
              })
              .catch((e: unknown) => {
                const u = toUiError(e);
                setMsg(u.message);
                setErrors(u.fields);
              });
          }}
        >
          Save
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        {fields.map(([k, label, req]) => (
          <div className="field" key={k}>
            <label htmlFor={`in-${k}`}>
              {label}
              {req ? ' *' : ''}
            </label>
            <input
              id={`in-${k}`}
              value={f[k]}
              onChange={(e) => setF({ ...f, [k]: e.target.value })}
            />
            {errors[k] ? <div className="field-error">{errors[k]}</div> : null}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function CalibrationPage({ actions }: { actions: ActionSet }) {
  const [due, setDue] = useState(false);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [card, setCard] = useState<string | null>(null);
  const list = useLoad(() => qlist('/instruments', { due, q }), [due, q]);
  return (
    <>
      <PageHead
        title="Instruments and calibration"
        sub="The instruments list with each history card. The quality team is reminded before a calibration runs out."
      >
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + Add instrument
          </button>
        ) : null}
      </PageHead>
      <div className="toolbar">
        <label htmlFor="ci-q">Search</label>
        <input
          id="ci-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, equipment no, card no"
        />
        <label htmlFor="ci-due">
          <input
            id="ci-due"
            type="checkbox"
            checked={due}
            onChange={(e) => setDue(e.target.checked)}
          />{' '}
          Only due or expired
        </label>
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>History card</th>
              <th>Equipment no</th>
              <th>Name</th>
              <th>Range</th>
              <th>Least count</th>
              <th>Valid until</th>
              <th>Calibration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={8}>No instruments. Click “+ Add instrument”.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr
                key={s(r.id)}
                className={s(r.calibrationStatus) === 'EXPIRED' ? 'row-red' : undefined}
              >
                <td>
                  <button type="button" className="link" onClick={() => setCard(s(r.id))}>
                    {s(r.historyCardNo)}
                  </button>
                </td>
                <td>{s(r.equipmentNo)}</td>
                <td>{s(r.name)}</td>
                <td>{s(r.measuringRange)}</td>
                <td>{s(r.leastCount)}</td>
                <td>{r.validUntil ? dmy(s(r.validUntil)) : '—'}</td>
                <td>
                  <Pill tone={CAL_TONE[s(r.calibrationStatus)]}>
                    {CAL_WORDS[s(r.calibrationStatus)]}
                  </Pill>
                </td>
                <td>{s(r.status).replace(/_/g, ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding ? (
        <InstrumentDialog
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
      {card ? (
        <HistoryCard
          id={card}
          actions={actions}
          onClose={() => setCard(null)}
          onChanged={list.reload}
        />
      ) : null}
    </>
  );
}
