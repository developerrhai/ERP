// CRM -> Lead Sources, V40 layout: record strip, KPI cards, Department Filter, the Source Master panel with its
// Validation Controls and the Detailed Table (V40Register). Leads, Qualified, Won and Revenue are counted from the real
// leads of each source and their won opportunities, so they are shown but never typed in.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSession } from '../../auth/session';
import { ContextChips } from '../../components/ContextChips';
import { Modal } from '../../components/Modal';
import { MoveForwardDialog } from '../../components/MoveForward';
import { useToast } from '../../components/Toast';
import { saveCsvTable } from '../../components/workspace/csv';
import { RecordToolbar } from '../../components/workspace/RecordToolbar';
import { DepartmentFilter, ValidationControls, WorkspaceKpis, useWorkspaceSummary } from '../../components/workspace/Workspace';
import { api } from '../../lib/api';
import { toUiError } from '../../lib/errors';
import { getJson, post, putJson, type Row } from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, ErrorBox, inr, PageHead, Pill } from '../finance/shared';
import { useFrame } from '../frame/V40TabFrame';
import { V40Register } from './V40Register';

const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const dash = (v: unknown): string => text(v) || '—';
const money = (v: unknown): string => (text(v) === '' ? '—' : inr(text(v)));

const CHANNELS = ['Website', 'Referral', 'Exhibition', 'Cold Call', 'Social Media', 'Email Campaign', 'Search Ads', 'Partner', 'Walk-in'];

type FormKey =
  | 'code'
  | 'name'
  | 'channel'
  | 'campaign'
  | 'utmSource'
  | 'utmMedium'
  | 'monthlyCost'
  | 'effectiveFrom'
  | 'status'
  | 'projectNumber';

export function SourcesPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const frame = useFrame();
  // outside the tab strip (a bare render) the page shows its first tab
  const master = !frame || frame.index === 0;
  const [department, setDepartment] = useState('');
  const [token, setToken] = useState(0);
  const list = useLoad(
    () => getJson<Row[]>(`/crm/sources${department ? `?department=${encodeURIComponent(department)}` : ''}`),
    [department, token],
  );
  const rows = useMemo(() => (Array.isArray(list.data) ? list.data : []), [list.data]);
  const changed = useCallback(() => setToken((n) => n + 1), []);
  const summary = useWorkspaceSummary('crm-sources', token);
  const [activeId, setActiveId] = useState('');
  const [viewing, setViewing] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [moving, setMoving] = useState<Row | null>(null);
  const current = rows.find((r) => text(r.id) === activeId) ?? rows[0];
  const user = getSession().user;

  // the full record: the Detailed Table's buttons only know the row id (the master list may be filtered)
  const open = async (id: string, then: (row: Row) => void): Promise<void> => {
    try {
      then(await getJson<Row>(`/crm/sources/${encodeURIComponent(id)}`));
    } catch (e) {
      toast(toUiError(e).message);
    }
  };

  // the top bar's "＋ Add New" opens the same form
  useEffect(() => {
    const onAdd = (e: Event): void => {
      const detail = (e as CustomEvent<{ pageId?: string; handled: boolean }>).detail;
      if (detail.pageId !== 'crm-sources') return;
      detail.handled = true;
      if (actions.add) setEditing('new');
      else toast('You need the Add right on Lead Sources to create one.');
    };
    window.addEventListener('v40-add-record', onAdd);
    return () => window.removeEventListener('v40-add-record', onAdd);
  }, [actions.add, toast]);

  // the top bar's Excel / Export: every source of the list (Department Filter applied) with all its attributes
  useEffect(() => {
    const onExport = (e: Event): void => {
      const { detail } = e as CustomEvent<{ pageId?: string; handled: boolean }>;
      if (detail.pageId !== 'crm-sources' || !actions.export) return;
      detail.handled = true;
      const cols: [string, string][] = [
        ['code', 'Source Code'],
        ['name', 'Source Name'],
        ['channel', 'Channel'],
        ['campaign', 'Campaign'],
        ['utmSource', 'UTM Source'],
        ['utmMedium', 'UTM Medium'],
        ['monthlyCost', 'Monthly Cost'],
        ['effectiveFrom', 'Effective Date'],
        ['leads', 'Leads'],
        ['qualified', 'Qualified'],
        ['won', 'Won'],
        ['revenue', 'Revenue'],
        ['projectNumber', 'Project Number'],
        ['status', 'Status'],
      ];
      saveCsvTable(
        'crm-sources.csv',
        cols.map(([, label]) => label),
        rows.map((r) => cols.map(([key]) => (key === 'effectiveFrom' ? text(r[key]).slice(0, 10) : text(r[key])))),
      );
    };
    window.addEventListener('v40-export-register', onExport);
    return () => window.removeEventListener('v40-export-register', onExport);
  }, [actions.export, rows]);

  const table = (
    <V40Register
      pageId="crm-sources"
      actions={actions}
      query={department ? { department } : undefined}
      onOpen={(id) => void open(id, setViewing)}
      onEdit={actions.edit ? (id) => void open(id, setEditing) : undefined}
      canEditRow={() => true}
      rowExtra={
        actions.delete
          ? (row) => (
              <button type="button" className="btn sm danger" onClick={() => void open(row.id, setDeleting)}>
                Delete
              </button>
            )
          : undefined
      }
      reloadKey={token}
      onChanged={changed}
      fallback={null}
    />
  );

  return (
    <>
      <PageHead title="Lead Sources" sub="Where enquiries come from: channel, campaign, UTM tracking, cost and results." />
      {user ? <ContextChips user={user} owner="Sales" /> : null}
      <ErrorBox message={list.error} />
      <RecordToolbar
        pageId="crm-sources"
        records={rows.map((r) => ({
          key: text(r.id),
          label: `${text(r.code)} · ${text(r.name)}`,
          docId: text(r.id),
          docNo: text(r.code),
          status: text(r.status),
        }))}
        activeKey={text(current?.id)}
        onSelect={setActiveId}
        canEdit={actions.edit}
        onChanged={changed}
        onLoad={{ run: () => current && setViewing(current) }}
        onAdd={actions.add ? { run: () => setEditing('new') } : undefined}
        onEdit={actions.edit ? { run: () => current && setEditing(current) } : undefined}
        onDelete={actions.delete ? { run: () => current && setDeleting(current) } : undefined}
      />
      {master ? (
        <>
          <WorkspaceKpis summary={summary} noun="Lead Sources" />
          <DepartmentFilter value={department} onChange={setDepartment} />
          <div className="ws-split">
            <section className="card" aria-label="Source Master">
              <div className="ws-section-head">
                <h3>Source Master</h3>
                <small>Maintain each source and its tracking set-up.</small>
              </div>
              <div className="table-wrap">
                <table className="register-table ws-detail ws-lined">
                  <thead>
                    <tr>
                      <th scope="col">Source Code</th>
                      <th scope="col">Source Name</th>
                      <th scope="col">Channel</th>
                      <th scope="col">Campaign</th>
                      <th scope="col">UTM Source</th>
                      <th scope="col" className="sticky-actions">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={text(r.id)}>
                        <td>{text(r.code)}</td>
                        <td>{text(r.name)}</td>
                        <td>{dash(r.channel)}</td>
                        <td>{dash(r.campaign)}</td>
                        <td>{dash(r.utmSource)}</td>
                        <td className="sticky-actions">
                          <div className="actions row-actions ws-actions compact">
                            {actions.edit ? (
                              <button type="button" className="btn sm" aria-label={`Edit source ${text(r.code)}`} onClick={() => setEditing(r)}>
                                Edit
                              </button>
                            ) : null}
                            {actions.delete ? (
                              <button type="button" className="btn sm danger" aria-label={`Delete source ${text(r.code)}`} onClick={() => setDeleting(r)}>
                                Delete
                              </button>
                            ) : null}
                            <button type="button" className="btn sm primary" aria-label={`Forward source ${text(r.code)}`} onClick={() => setMoving(r)}>
                              Move Forward
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!list.loading && rows.length === 0 ? (
                      <tr className="empty-row">
                        <td colSpan={6}>
                          {department ? `No source is with ${department} right now.` : 'No lead sources yet.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {actions.add ? (
                <button type="button" className="btn primary ws-add" onClick={() => setEditing('new')}>
                  ＋ Add source
                </button>
              ) : null}
            </section>
            <ValidationControls rules={summary?.controls ?? []} />
          </div>
          <section className="ws-section" aria-label="Source Master – Detailed Table">
            <div className="ws-section-head">
              <h3>Source Master – Detailed Table</h3>
              <small>Every attribute with View, Edit, Docs, Email, Word, PDF, Delete and Move Forward.</small>
            </div>
            {table}
          </section>
        </>
      ) : (
        table
      )}
      {viewing ? (
        <SourceView
          source={viewing}
          onClose={() => setViewing(null)}
          onEdit={
            actions.edit
              ? () => {
                  setEditing(viewing);
                  setViewing(null);
                }
              : undefined
          }
        />
      ) : null}
      {editing ? (
        <SourceForm
          source={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(code) => {
            toast(editing === 'new' ? `Source ${code} added` : `Source ${code} saved`);
            setEditing(null);
            changed();
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteSource
          source={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            toast(`Source ${text(deleting.code)} deleted`);
            setDeleting(null);
            changed();
          }}
        />
      ) : null}
      {moving ? (
        <MoveForwardDialog
          docType="crm-sources"
          docId={text(moving.id)}
          docNo={text(moving.code)}
          onClose={() => setMoving(null)}
          onMoved={() => {
            toast(`${text(moving.code)} moved forward.`);
            setMoving(null);
            changed();
          }}
        />
      ) : null}
    </>
  );
}

function SourceView({ source, onClose, onEdit }: { source: Row; onClose: () => void; onEdit?: (() => void) | undefined }) {
  const project = text(source.projectNumber);
  const facts: [string, React.ReactNode][] = [
    ['Source Code', text(source.code)],
    ['Source Name', text(source.name)],
    ['Status', <Pill key="s">{text(source.status)}</Pill>],
    ['Channel', dash(source.channel)],
    ['Campaign', dash(source.campaign)],
    ['UTM Source', dash(source.utmSource)],
    ['UTM Medium', dash(source.utmMedium)],
    ['Monthly Cost', money(source.monthlyCost)],
    ['Effective Date', source.effectiveFrom ? dmy(text(source.effectiveFrom)) : '—'],
    ['Leads', dash(source.leads)],
    ['Qualified', dash(source.qualified)],
    ['Won', dash(source.won)],
    ['Revenue', money(source.revenue)],
    ['Project Number', project || '—'],
  ];
  return (
    <Modal
      title={`Lead source ${text(source.code)}`}
      sub="Record details"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn"
            disabled={!project}
            title={project ? undefined : 'This source has no Project Number'}
            onClick={() => window.open(`/m/project-global-history?project=${encodeURIComponent(project)}`, '_blank', 'noopener')}
          >
            Load Project History
          </button>
          {onEdit ? (
            <button type="button" className="btn primary" onClick={onEdit}>
              Edit
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="drawer-grid">
        {facts.map(([label, value]) => (
          <div className="v8-mini" key={label}>
            <small>{label}</small>
            <b>{value}</b>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function SourceForm({ source, onClose, onSaved }: { source: Row | null; onClose: () => void; onSaved: (code: string) => void }) {
  const [values, setValues] = useState<Record<FormKey, string>>(() => ({
    code: text(source?.code),
    name: text(source?.name),
    channel: text(source?.channel),
    campaign: text(source?.campaign),
    utmSource: text(source?.utmSource),
    utmMedium: text(source?.utmMedium),
    monthlyCost: source?.monthlyCost === null || source?.monthlyCost === undefined ? '' : String(Number(source.monthlyCost)),
    effectiveFrom: text(source?.effectiveFrom).slice(0, 10),
    status: text(source?.status) || 'Active',
    projectNumber: text(source?.projectNumber),
  }));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key: FormKey, value: string): void => {
    setValues((v) => ({ ...v, [key]: value }));
    setFields((f) => {
      const next = { ...f };
      delete next[key];
      return next;
    });
  };

  const save = async (): Promise<void> => {
    const problems: Record<string, string> = {};
    if (!source && !/^[A-Za-z0-9_-]{2,20}$/.test(values.code.trim())) problems.code = 'Use 2-20 letters or digits.';
    if (values.name.trim().length < 2) problems.name = 'Enter at least 2 characters.';
    if (values.monthlyCost.trim() !== '' && !(Number(values.monthlyCost) >= 0)) problems.monthlyCost = 'Enter a number, 0 or more.';
    setFields(problems);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    setError('');
    const { code, ...attrs } = values;
    try {
      if (source) await putJson(`/crm/sources/${text(source.id)}`, attrs);
      else await post('/crm/sources', { code: code.trim(), ...attrs });
      onSaved(source ? text(source.code) : code.trim().toUpperCase());
    } catch (e) {
      const u = toUiError(e);
      setFields(u.fields);
      setError(u.message);
      setBusy(false);
    }
  };

  const field = (key: FormKey, label: string, input: React.ReactNode) => (
    <div className="field">
      <label htmlFor={`src-${key}`}>{label}</label>
      {input}
      {fields[key] ? <span className="field-error">{fields[key]}</span> : null}
    </div>
  );
  const box = (key: FormKey, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    field(
      key,
      label,
      <input id={`src-${key}`} value={values[key]} onChange={(e) => set(key, e.target.value)} {...extra} />,
    );
  const counted = (label: string, value: string) => (
    <div className="field">
      <label htmlFor={`src-${label}`}>{label}</label>
      <input id={`src-${label}`} value={value} readOnly disabled />
    </div>
  );

  return (
    <Modal
      title={source ? `Edit lead source ${text(source.code)}` : 'Add Lead Source'}
      sub={source ? 'Update the record and its tracking set-up' : 'Create a new source record'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : source ? 'Update Record' : 'Save Record'}
          </button>
        </>
      }
    >
      <ErrorBox message={error} />
      <div className="form-grid">
        {box('code', 'Source Code *', {
          maxLength: 20,
          readOnly: !!source,
          disabled: !!source,
          onChange: (e) => set('code', e.target.value.toUpperCase()),
        })}
        {box('name', 'Source Name *', { maxLength: 80 })}
        {field(
          'channel',
          'Channel',
          <>
            <input id="src-channel" list="src-channels" maxLength={40} value={values.channel} onChange={(e) => set('channel', e.target.value)} />
            <datalist id="src-channels">
              {CHANNELS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>,
        )}
        {box('campaign', 'Campaign', { maxLength: 120 })}
        {box('utmSource', 'UTM Source', { maxLength: 80, placeholder: 'e.g. google' })}
        {box('utmMedium', 'UTM Medium', { maxLength: 80, placeholder: 'e.g. cpc' })}
        {box('monthlyCost', 'Monthly Cost (₹)', { type: 'number', min: 0, step: '0.01' })}
        {box('effectiveFrom', 'Effective Date', { type: 'date' })}
        {field(
          'status',
          'Status',
          <select id="src-status" value={values.status} onChange={(e) => set('status', e.target.value)}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>,
        )}
        {source ? (
          <>
            {counted('Leads', dash(source.leads))}
            {counted('Qualified', dash(source.qualified))}
            {counted('Won', dash(source.won))}
            {counted('Revenue', money(source.revenue))}
          </>
        ) : null}
        {field(
          'projectNumber',
          'Project Number',
          <div className="ws-inline">
            <input
              id="src-projectNumber"
              maxLength={50}
              placeholder="Project Number"
              title="The same number links the record across every department"
              value={values.projectNumber}
              onChange={(e) => set('projectNumber', e.target.value.toUpperCase())}
            />
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                window.open(
                  values.projectNumber.trim()
                    ? `/m/project-global-history?project=${encodeURIComponent(values.projectNumber.trim())}`
                    : '/m/project-global-history',
                  '_blank',
                  'noopener',
                )
              }
            >
              Load Project History
            </button>
          </div>,
        )}
      </div>
      <p className="ws-form-hint">Leads, Qualified, Won and Revenue are counted from this source&apos;s leads and won opportunities.</p>
    </Modal>
  );
}

function DeleteSource({ source, onClose, onDone }: { source: Row; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await api<undefined>(`/crm/sources/${encodeURIComponent(text(source.id))}`, { method: 'DELETE' });
      onDone();
    } catch (e) {
      setError(toUiError(e).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      size="sm"
      title="Delete lead source"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => void run()}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <ErrorBox message={error} />
      <p className="confirm-text">
        Delete {text(source.code)} · {text(source.name)}? A source that leads already use cannot be deleted; set it to Inactive instead.
      </p>
    </Modal>
  );
}
