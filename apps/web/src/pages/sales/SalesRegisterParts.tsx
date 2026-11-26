// The parts V40 draws around a CRM / Sales register that the plain table did not have: the KPI cards, the record action
// strip (Record dropdown, Load Selected, Add, Edit, Delete, Documents, Submit Approval, Approval Queue, Move Forward,
// Project History), the Planner + Add Activity panel of Follow-ups / Meetings / Feedback and the Customer 360 workspace.
// Every number and row comes from the records the page loads; nothing is invented.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HistoryDrawer, MoveForwardDialog } from '../../components/MoveForward';
import { useToast } from '../../components/Toast';
import { findAddButton } from '../../lib/ownAddButton';
import { toUiMessage } from '../../lib/errors';
import { lookupCustomers, post } from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import { Combobox } from '../../ui/components';
import { dmy, Pill } from '../finance/shared';
import { v40TabsFor } from '../frame/V40TabFrame';
import { getSalesV40Summary, type V40Column, type V40Row } from './salesV40Api';

/** The status that means "finished" on each page (Completion = those records over all records). */
const DONE: Record<string, string[]> = {
  'crm-leads': ['Converted'],
  'crm-opportunities': ['Won'],
  'crm-followups': ['Done'],
  'crm-meetings': ['Held'],
  'crm-feedback': ['Closed'],
  'master-customers': ['ACTIVE'],
  'crm-customer360': ['ACTIVE'],
};
const RISK_NOTE: Record<string, string> = {
  'crm-leads': 'Unqualified leads',
  'crm-opportunities': 'open deals past their expected close date',
  'crm-followups': 'open follow-ups past their due time',
  'crm-meetings': 'planned meetings whose start time has passed',
  'crm-feedback': 'feedback scored 6 or less that is not closed',
  'master-customers': 'customers that are not active',
  'crm-customer360': 'customers that are not active',
};

/** The CRM / customer pages that carry the KPI cards, record strip and Detailed Table. */
export const CRM_PAGES: ReadonlySet<string> = new Set(Object.keys(DONE));

export function RegisterKpis({ pageId, reloadKey }: { pageId: string; reloadKey: unknown }) {
  const { data } = useLoad(() => getSalesV40Summary(pageId), [pageId, reloadKey]);
  if (!DONE[pageId]) return null;
  const total = data?.total ?? 0;
  const done = (data?.byStatus ?? [])
    .filter((s) => (DONE[pageId] ?? []).includes(s.status))
    .reduce((n, s) => n + s.count, 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const cards: [string, string, string][] = [
    ['Records in Scope', data ? String(total) : '…', 'All records you can see on this page'],
    [
      'Completion',
      data ? `${pct}%` : '…',
      `${(DONE[pageId] ?? []).join(' / ')} records over all records`,
    ],
    ['Open / Pending', data ? String(total - done) : '…', 'Records that are not finished yet'],
    [
      'At Risk',
      data ? (data.atRisk === null || data.atRisk === undefined ? '—' : String(data.atRisk)) : '…',
      RISK_NOTE[pageId] ?? '',
    ],
  ];
  return (
    <div className="sv40-kpis" role="group" aria-label="Summary">
      {cards.map(([label, value, hint]) => (
        <div className="sv40-kpi" key={label} title={hint}>
          <small>{label}</small>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

export interface StripProps {
  pageId: string;
  rows: V40Row[];
  actions: { add?: boolean; edit?: boolean; delete?: boolean; submit?: boolean };
  canSubmitDoc: boolean;
  canDelete: (status: string) => boolean;
  canEdit: (status: string) => boolean;
  onLoad?: ((id: string) => void) | undefined;
  onEdit?: ((id: string) => void) | undefined;
  onDelete: (id: string) => void;
  onSubmit: (id: string) => void;
}

export function RecordStrip(p: StripProps) {
  const [, setParams] = useSearchParams();
  const [activeId, setActiveId] = useState('');
  const [drawer, setDrawer] = useState<'move' | 'history' | null>(null);
  const row = p.rows.find((r) => r.id === activeId) ?? p.rows[0];
  const tabs = v40TabsFor(p.pageId);
  const goTab = (re: RegExp): void => {
    const i = tabs.findIndex((t) => re.test(t));
    if (i < 0) return;
    setParams((cur) => {
      const n = new URLSearchParams(cur);
      n.set('tab', String(i));
      if (row && re.test('documents')) n.set('doc', row.id);
      return n;
    });
  };
  const add = (): void => {
    const detail = { pageId: p.pageId, handled: false };
    window.dispatchEvent(new CustomEvent('v40-add-record', { detail }));
    if (!detail.handled) findAddButton(document.getElementById('main') ?? document.body)?.click();
  };
  return (
    <div className="recordbar" role="group" aria-label="Record actions">
      <b style={{ fontSize: 11 }}>Record:</b>
      <select
        aria-label="Select Record"
        value={row?.id ?? ''}
        onChange={(e) => setActiveId(e.target.value)}
      >
        {p.rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.number}
          </option>
        ))}
        {p.rows.length === 0 ? <option value="">No records available</option> : null}
      </select>
      <button
        type="button"
        className="btn sm"
        disabled={!row || !p.onLoad}
        title={!row ? 'There is no record to load.' : !p.onLoad ? 'These records have no separate form: press View in the table.' : undefined}
        onClick={() => row && p.onLoad?.(row.id)}
      >
        Load Selected
      </button>
      <button type="button" className="btn sm" data-add-proxy="" disabled={!p.actions.add} onClick={add}>
        ＋ Add
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={!row || !p.actions.edit || !p.onEdit || !p.canEdit(row.status)}
        title={
          !row
            ? 'There is no record to edit.'
            : !p.actions.edit
              ? 'You do not have the right to edit here.'
              : !p.onEdit
                ? 'These records are not edited on this page.'
                : !p.canEdit(row.status)
                  ? `A ${row.status} record can no longer be edited.`
                  : undefined
        }
        onClick={() => row && p.onEdit?.(row.id)}
      >
        Edit
      </button>
      <button
        type="button"
        className="btn sm danger"
        disabled={!row || !p.actions.delete || !p.canDelete(row.status)}
        title={
          row && !p.canDelete(row.status)
            ? 'This record is past the stage where it can be deleted.'
            : undefined
        }
        onClick={() => row && p.onDelete(row.id)}
      >
        Delete
      </button>
      <button type="button" className="btn sm" onClick={() => goTab(/^documents$/i)}>
        Documents
      </button>
      <button
        type="button"
        className="btn sm primary"
        disabled={!row || !p.canSubmitDoc || !p.actions.submit}
        title={
          !row
            ? 'There is no record to submit.'
            : !p.canSubmitDoc
              ? 'These records need no approval.'
              : !p.actions.submit
                ? 'You do not have the right to submit here.'
                : undefined
        }
        onClick={() => row && p.onSubmit(row.id)}
      >
        Submit Approval
      </button>
      <button type="button" className="btn sm success" onClick={() => goTab(/^approvals?$/i)}>
        Approval Queue
      </button>
      <button type="button" className="btn sm" disabled={!row} onClick={() => setDrawer('move')}>
        Move Forward
      </button>
      <button type="button" className="btn sm" disabled={!row} onClick={() => setDrawer('history')}>
        Project History
      </button>
      {drawer === 'move' && row ? (
        <MoveForwardDialog
          docType={p.pageId}
          docId={row.id}
          docNo={row.number}
          onClose={() => setDrawer(null)}
          onMoved={() => setDrawer(null)}
        />
      ) : null}
      {drawer === 'history' && row ? (
        <HistoryDrawer
          docType={p.pageId}
          docId={row.id}
          title={row.number}
          onClose={() => setDrawer(null)}
        />
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------------- Planner and Add Activity
const CHANNELS: Record<string, string[]> = {
  'crm-followups': ['Call', 'Email', 'Meeting', 'Visit', 'WhatsApp'],
  'crm-meetings': ['Meeting', 'Call', 'Email', 'WhatsApp'],
};
const TIMELINE_TITLE: Record<string, string> = {
  'crm-followups': 'Follow-up Planner',
  'crm-meetings': 'Meeting Calendar',
  'crm-feedback': 'Feedback Inbox',
};

const isoOf = (local: string): string => new Date(local).toISOString();

export function ActivityPanel({
  pageId,
  rows,
  columns,
  canAdd,
  onSaved,
}: {
  pageId: string;
  rows: V40Row[];
  columns: V40Column[];
  canAdd: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const channels = CHANNELS[pageId];
  const feedback = pageId === 'crm-feedback';
  const [channel, setChannel] = useState(channels?.[0] ?? '');
  const [category, setCategory] = useState('Delivery');
  const [rating, setRating] = useState('8');
  const [notes, setNotes] = useState('');
  const [next, setNext] = useState('');
  const [cust, setCust] = useState<{ value: string; label: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // the planner: the records of this page in date order, with the first date column of the register as their time
  const when = columns.find((c) => c.type === 'date' || c.type === 'time');
  const text = columns.filter((c) => c.type === 'text' && c.source);
  const items = [...rows]
    .sort((a, b) =>
      String(a[when?.key ?? 'number'] ?? '').localeCompare(String(b[when?.key ?? 'number'] ?? '')),
    )
    .slice(0, 12);

  async function save(): Promise<void> {
    setError('');
    if (notes.trim().length < 2) return setError('Write the notes first (at least 2 characters).');
    if (feedback && !cust) return setError('Pick the customer this feedback is from.');
    if (!feedback && !next) return setError('Set the date and time for the next step.');
    setBusy(true);
    try {
      if (pageId === 'crm-followups')
        await post('/crm/followups', {
          title: notes.trim(),
          kind: channel,
          dueAt: isoOf(next),
          ...(cust ? { customerId: cust.value } : {}),
        });
      else if (pageId === 'crm-meetings')
        await post('/crm/meetings', {
          subject: notes.trim(),
          kind: channel,
          startsAt: isoOf(next),
          ...(cust ? { customerId: cust.value } : {}),
        });
      else
        await post('/crm/feedback', {
          customerId: cust?.value,
          rating: Number(rating),
          category,
          comment: notes.trim(),
        });
      toast(feedback ? 'Feedback saved' : 'Activity saved');
      setNotes('');
      setNext('');
      onSaved();
    } catch (e) {
      setError(toUiMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sv40-activity">
      <section className="sv40-panel" aria-label={TIMELINE_TITLE[pageId] ?? 'Timeline'}>
        <h3>{TIMELINE_TITLE[pageId] ?? 'Timeline'}</h3>
        {items.length === 0 ? <p className="v8-sub">Nothing planned yet.</p> : null}
        <ol className="sv40-timeline">
          {items.map((r) => (
            <li key={r.id}>
              <b>{r.number}</b>
              {when ? <span className="muted"> · {dmy(r[when.key] ?? null)}</span> : null}
              <div>
                {text
                  .slice(0, 2)
                  .map((c) => r[c.key])
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </div>
              <Pill>{r.status}</Pill>
            </li>
          ))}
        </ol>
      </section>
      {canAdd ? (
        <section className="sv40-panel" aria-label="Add Activity">
          <h3>{feedback ? 'Add Feedback' : 'Add Activity'}</h3>
          {channels ? (
            <div className="field">
              <label htmlFor="act-channel">Channel</label>
              <select id="act-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {channels.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="act-cat">Category</label>
                <select id="act-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {['Delivery', 'Quality', 'Price', 'Service', 'Other'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="act-rating">Rating (0 to 10)</label>
                <input
                  id="act-rating"
                  type="number"
                  min={0}
                  max={10}
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                />
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="act-cust">Customer{feedback ? ' *' : ''}</label>
            <Combobox
              id="act-cust"
              value={cust}
              placeholder="Search customer"
              search={async (q) =>
                (await lookupCustomers(q)).map((c) => ({ value: c.id, label: c.label }))
              }
              onPick={setCust}
            />
          </div>
          <div className="field">
            <label htmlFor="act-notes">Notes</label>
            <textarea
              id="act-notes"
              rows={3}
              maxLength={feedback ? 1000 : 200}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {feedback ? null : (
            <div className="field">
              <label htmlFor="act-next">Next Follow-up</label>
              <input
                id="act-next"
                type="datetime-local"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </div>
          )}
          {error ? (
            <p role="alert" className="msg error show static">
              {error}
            </p>
          ) : null}
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {feedback ? 'Save Feedback' : 'Save Activity'}
          </button>
        </section>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------------- Customer 360 workspace
const pick = (row: V40Row, columns: V40Column[], re: RegExp): string => {
  const c = columns.find((x) => re.test(x.label) && x.type !== 'actions');
  return (c ? row[c.key] : null) ?? '';
};

export function Customer360Workspace({
  rows,
  columns,
  onOpen,
}: {
  rows: V40Row[];
  columns: V40Column[];
  /** the full record pop-up, for "Open" on the customer already shown */
  onOpen?: ((id: string) => void) | undefined;
}): ReactNode {
  const [selId, setSelId] = useState('');
  const [moving, setMoving] = useState(false);
  const sel = rows.find((r) => r.id === selId) ?? rows[0];
  if (!sel) return null;
  const checks: [string, boolean, string][] = [
    [
      'Information complete',
      Boolean(pick(sel, columns, /company|customer/i) && sel.number),
      'Company name and record number are filled',
    ],
    ['Owner assigned', Boolean(pick(sel, columns, /owner/i)), 'The customer has an owner'],
    [
      'Dependency clear',
      sel.status === 'ACTIVE',
      'The customer is Active (nothing blocks work for it)',
    ],
    ['Date commitment', Boolean(pick(sel, columns, /due/i)), 'A due date is set'],
    ['Approval state', sel.status === 'ACTIVE', `Status: ${sel.status}`],
    ['Next action', Boolean(pick(sel, columns, /stage/i)), 'A stage is set'],
  ];
  const details = columns
    .filter((c) => c.type !== 'actions' && c.type !== 'docs' && c.source)
    .map((c) => [c.label, sel[c.key] ?? '—'] as const);
  return (
    <div className="sv40-c360-split">
    <section className="sv40-panel sv40-c360" aria-label="Customer 360 Workspace">
      <h3>Customer 360° Workspace</h3>
      <div className="detail-grid">
        {details.map(([k, v]) => (
          <div className="detail" key={k}>
            <small>{k}</small>
            <b>{v || '—'}</b>
          </div>
        ))}
      </div>
      <div className="sv40-cards">
        {rows.slice(0, 8).map((r) => (
          <div className={`sv40-card${r.id === sel.id ? ' on' : ''}`} key={r.id}>
            <b>{pick(r, columns, /company|customer/i) || r.number}</b>
            <small>{r.number}</small>
            <div>
              <button type="button" className="btn sm" onClick={() => (r.id === sel.id ? onOpen?.(r.id) : setSelId(r.id))}>
                Open
              </button>
              <button
                type="button"
                className="btn sm primary"
                onClick={() => {
                  setSelId(r.id);
                  setMoving(true);
                }}
              >
                Move Forward
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
    <section className="sv40-panel" aria-label="Operational Readiness">
      <h3>Operational Readiness</h3>
      <ul className="sv40-checks">
        {checks.map(([label, ok, why]) => (
          <li key={label} title={why}>
            <span aria-hidden="true">{ok ? '✓' : '✕'}</span> {label}
            <small className="muted"> {ok ? 'Done' : 'Open'}</small>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn primary"
        disabled={checks.some(([, ok]) => !ok)}
        title={checks.some(([, ok]) => !ok) ? 'Close the open checks first.' : undefined}
        onClick={() => setMoving(true)}
      >
        Complete Review
      </button>
      {moving ? (
        <MoveForwardDialog
          docType="crm-customer360"
          docId={sel.id}
          docNo={sel.number}
          onClose={() => setMoving(false)}
          onMoved={() => setMoving(false)}
        />
      ) : null}
    </section>
    </div>
  );
}
