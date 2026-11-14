// Phase 12 quality forms on the template engine: 8D problem solving, quality alert, minutes of meeting and continuous
// improvement (SQDCPE). The template says which fields exist and which must be filled before the form can be closed.
import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { qget, qlist, qpatch, qpost } from '../../lib/qmsApi';
import type { Row, Template } from '../../lib/qmsApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, PageHead, Pill, todayIso } from '../finance/shared';
import { DynamicFields, STATUS_TONE, Tabs, s } from './Shared';
import { DateField } from '../../ui/components';

export type FormKind = 'EIGHT_D' | 'ALERT' | 'MOM' | 'CI';
export const FORM_LABEL: Record<FormKind, string> = {
  EIGHT_D: '8D problem solving',
  ALERT: 'Quality alert',
  MOM: 'Minutes of meeting',
  CI: 'Continuous improvement',
};

function FormEditor({
  kind,
  id,
  actions,
  onClose,
  onChanged,
}: {
  kind: FormKind;
  id: string | null;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [doc, setDoc] = useState<Row | null>(null);
  const [tpl, setTpl] = useState<Pick<
    Template,
    'name' | 'version' | 'headerFields' | 'closeRequires'
  > | null>(null);
  const [title, setTitle] = useState('');
  const [docDate, setDocDate] = useState(todayIso());
  const [capaRef, setCapaRef] = useState('');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const status = doc ? s(doc.status) : 'Open';
  const editable = doc ? status === 'Open' && actions.edit : actions.add;

  useEffect(() => {
    let alive = true;
    const load = id
      ? qget(`/forms/${id}`).then((d) => {
          if (!alive) return;
          const snap = d.templateSnapshot as {
            name: string;
            version: number;
            headerFields: Template['headerFields'];
            closeRequires: string[];
          };
          setDoc(d);
          setTpl(snap);
          setTitle(s(d.title));
          setDocDate(s(d.docDate));
          setCapaRef(s(d.capaRef));
          setData((d.data as Record<string, unknown>) ?? {});
          setLabels((d.headerLabels as Record<string, string>) ?? {});
        })
      : qget<Template>('/templates/resolve', { kind }).then((t) => {
          if (alive) setTpl(t);
        });
    load.catch((e: unknown) => alive && setMsg(toUiError(e).message));
    return () => {
      alive = false;
    };
  }, [id, kind]);

  const bad = (e: unknown) => {
    const u = toUiError(e);
    setMsg(u.message);
    setErrors(u.fields);
  };
  async function save() {
    setMsg('');
    setErrors({});
    setBusy(true);
    try {
      const body = { title, docDate, data, ...(capaRef ? { capaRef } : {}) };
      const d = doc
        ? await qpatch(`/forms/${s(doc.id)}`, Number(doc.version), body)
        : await qpost('/forms', { kind, ...body });
      setDoc(d);
      setLabels((d.headerLabels as Record<string, string>) ?? labels);
      toast(`Saved ${s(d.number)}`);
      onChanged();
    } catch (e) {
      bad(e);
    } finally {
      setBusy(false);
    }
  }
  async function act(verb: 'close' | 'cancel') {
    if (!doc) return;
    setMsg('');
    setErrors({});
    setBusy(true);
    try {
      const out = await qpost(
        `/forms/${s(doc.id)}/${verb}`,
        verb === 'cancel' ? { reason } : {},
        Number(doc.version),
      );
      setDoc(out);
      toast(`${verb === 'close' ? 'Closed' : 'Cancelled'} ${s(out.number)}`);
      onChanged();
    } catch (e) {
      bad(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        doc ? `${FORM_LABEL[kind]} · ${s(doc.number)}` : `New ${FORM_LABEL[kind].toLowerCase()}`
      }
      sub={tpl ? `${tpl.name} · version ${tpl.version}` : 'Loading the form…'}
      onClose={onClose}
      footer={
        <>
          {editable ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy || !tpl || title.trim() === ''}
              onClick={() => void save()}
            >
              Save
            </button>
          ) : null}
          {doc && status === 'Open' && actions.edit ? (
            <button type="button" className="btn" disabled={busy} onClick={() => void act('close')}>
              Close this {FORM_LABEL[kind].toLowerCase()}
            </button>
          ) : null}
        </>
      }
    >
      <ErrorBox message={msg} />
      {doc ? (
        <p>
          <Pill tone={STATUS_TONE[status]}>{status}</Pill>
        </p>
      ) : null}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="qf-title">Title *</label>
          <input
            id="qf-title"
            value={title}
            disabled={!editable}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="qf-date">Date *</label>
          <DateField
            id="qf-date"
            value={docDate}
            disabled={!editable}
            onChange={(e) => setDocDate(e.target.value)}
          />
        </div>
        {kind === 'EIGHT_D' ? (
          <div className="field">
            <label htmlFor="qf-capa">CAPA reference</label>
            <input
              id="qf-capa"
              value={capaRef}
              disabled={!editable}
              onChange={(e) => setCapaRef(e.target.value)}
            />
            {errors.capaRef ? <div className="field-error">{errors.capaRef}</div> : null}
          </div>
        ) : null}
      </div>
      {tpl ? (
        <DynamicFields
          idPrefix="qf"
          fields={tpl.headerFields}
          values={data}
          labels={labels}
          errors={errors}
          readOnly={!editable}
          onChange={(k, v, l) => {
            setData((x) => ({ ...x, [k]: v }));
            if (l !== undefined) setLabels((x) => ({ ...x, [k]: l }));
          }}
        />
      ) : null}
      {doc && status === 'Open' && actions.cancel ? (
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
            onClick={() => void act('cancel')}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </Modal>
  );
}

export function FormList({ kind, actions }: { kind: FormKind; actions: ActionSet }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const list = useLoad(() => qlist('/forms', { kind, status, q }), [kind, status, q]);
  return (
    <>
      <div className="toolbar">
        <label htmlFor={`fl-q-${kind}`}>Search</label>
        <input
          id={`fl-q-${kind}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Number or title"
        />
        <label htmlFor={`fl-s-${kind}`}>Status</label>
        <select id={`fl-s-${kind}`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {['Open', 'Closed', 'Cancelled'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setEditing({ id: null })}>
            + New {FORM_LABEL[kind].toLowerCase()}
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              <th>Title</th>
              <th>Customer / supplier</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={5}>Nothing here yet.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() => setEditing({ id: s(r.id) })}
                  >
                    {s(r.number)}
                  </button>
                </td>
                <td>{dmy(s(r.docDate))}</td>
                <td>{s(r.title)}</td>
                <td>{s(r.customerName) || s(r.supplierName)}</td>
                <td>
                  <Pill tone={STATUS_TONE[s(r.status)]}>{s(r.status)}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? (
        <FormEditor
          kind={kind}
          id={editing.id}
          actions={actions}
          onClose={() => setEditing(null)}
          onChanged={list.reload}
        />
      ) : null}
    </>
  );
}

/** Quality Alert is its own tab on the NCR page; 8D, continuous improvement and meetings share the CAPA page. */
export function CapaPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<FormKind>('EIGHT_D');
  return (
    <>
      <PageHead
        title="CAPA, 8D and improvement"
        sub="8D problem solving with Why-Why and CAPA reference, continuous improvement projects (SQDCPE) and minutes of meetings."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['EIGHT_D', '8D problem solving'],
          ['CI', 'Continuous improvement'],
          ['MOM', 'Minutes of meeting'],
        ]}
      />
      <FormList key={tab} kind={tab} actions={actions} />
    </>
  );
}
