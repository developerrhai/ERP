// The three inner tabs of Incoming Quality: Pending Acceptance (usage decision or Return with a comment), Priority
// (Minor / Major / Critical of the open sheets) and Record Doc. Format.
import { useState } from 'react';
import { useToast } from '../../../components/Toast';
import { qget, qpost } from '../../../lib/qmsApi';
import { useLoad } from '../../../lib/useLoad';
import type { ActionSet } from '../../../types';
import { dmy, Empty, ErrorBox, PageHead, Pill } from '../../finance/shared';
import { useFrame } from '../../frame/V40TabFrame';
import { InspectionPage, SheetEditor } from '../InspectionPages';
import { STATUS_TONE } from '../Shared';
import { RecordFormats } from './RecordFormats';
import { CommentDialog, messageOf, PRIORITIES, PRIORITY_LABEL, PriorityPill, PrioritySelect } from './shared';

interface QueueRow {
  id: string;
  number: string;
  docDate: string;
  status: string;
  priority: string | null;
  result: string | null;
  resultNote: string | null;
  returnComment: string | null;
  version: number;
  lotQty: string | null;
  supplierName: string | null;
  itemName: string | null;
  inspectorName: string | null;
}

function Queue({ mode, actions }: { mode: 'pending' | 'priority'; actions: ActionSet }) {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState('');
  const [sheet, setSheet] = useState<string | null>(null);
  const [back, setBack] = useState<QueueRow | null>(null);
  const load = useLoad(() => qget<{ rows: QueueRow[] }>('/incoming/queue'), [tick]);
  const reload = (): void => setTick((n) => n + 1);
  const all = load.data?.rows ?? [];
  const pending = mode === 'pending';
  const rows = pending ? all.filter((r) => r.status === 'Submitted') : all.filter((r) => filter === '' || (filter === 'NONE' ? !r.priority : r.priority === filter));
  const count = (p: string): number => all.filter((r) => (p === 'NONE' ? !r.priority : r.priority === p)).length;
  const setPriority = (r: QueueRow, value: string): void => {
    qpost(`/inspections/${r.id}/priority`, { priority: value || null })
      .then(() => toast(`${r.number}: priority ${value ? PRIORITY_LABEL[value] : 'cleared'}.`))
      .catch((e: unknown) => toast(messageOf(e)))
      .finally(reload);
  };
  return (
    <>
      {pending ? (
        <p className="qv-note">Submitted sheets waiting for the usage decision. Return sends one back to the inspector and needs a comment.</p>
      ) : (
        <div className="qv-switch" role="group" aria-label="Priority">
          <button type="button" className={`btn${filter === '' ? ' primary' : ''}`} aria-pressed={filter === ''} onClick={() => setFilter('')}>
            All open ({all.length})
          </button>
          {[...PRIORITIES, 'NONE'].map((p) => (
            <button key={p} type="button" className={`btn${filter === p ? ' primary' : ''}`} aria-pressed={filter === p} onClick={() => setFilter(p)}>
              {p === 'NONE' ? 'Not set' : PRIORITY_LABEL[p]} ({count(p)})
            </button>
          ))}
        </div>
      )}
      <ErrorBox message={load.error} />
      <div className="card table-wrap">
        <table className="register-table plain">
          <thead>
            <tr>
              <th>Inspection No</th>
              <th>Date</th>
              <th>Vendor</th>
              <th>Material</th>
              <th>Lot</th>
              <th>Priority</th>
              <th>{pending ? 'Result' : 'Status'}</th>
              <th>Inspector</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <button type="button" className="link" onClick={() => setSheet(r.id)}>
                    {r.number}
                  </button>
                  {r.returnComment ? <small className="qv-sub">Returned: {r.returnComment}</small> : null}
                </td>
                <td>{dmy(r.docDate)}</td>
                <td>{r.supplierName ?? '—'}</td>
                <td>{r.itemName ?? '—'}</td>
                <td className="num">{r.lotQty === null ? '—' : Number(r.lotQty).toLocaleString('en-IN')}</td>
                <td>
                  {!pending && actions.edit ? (
                    <PrioritySelect optional label={`Priority of ${r.number}`} value={r.priority ?? ''} onChange={(v) => setPriority(r, v)} />
                  ) : (
                    <PriorityPill value={r.priority} />
                  )}
                </td>
                <td>
                  {pending ? (
                    <>
                      {r.result ? <Pill tone={STATUS_TONE[r.result]}>{r.result === 'CONDITIONAL' ? 'Conditional' : r.result === 'ACCEPTED' ? 'Accepted' : 'Rejected'}</Pill> : '—'}
                      {r.resultNote ? <small className="qv-sub">{r.resultNote}</small> : null}
                    </>
                  ) : (
                    <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>
                  )}
                </td>
                <td>{r.inspectorName ?? '—'}</td>
                <td className="row-actions">
                  <div className="qv-buttons">
                    <button type="button" className="btn sm" onClick={() => setSheet(r.id)}>
                      Open
                    </button>
                    {pending && actions.approve ? (
                      <>
                        <button type="button" className="btn sm primary" onClick={() => setSheet(r.id)}>
                          Accept / Reject
                        </button>
                        <button type="button" className="btn sm" onClick={() => setBack(r)}>
                          Return
                        </button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !load.loading ? <Empty cols={9}>{pending ? 'No sheet is waiting for acceptance.' : 'No open sheet with this priority.'}</Empty> : null}
          </tbody>
        </table>
      </div>
      {sheet ? (
        <SheetEditor
          kind="INCOMING"
          id={sheet}
          actions={actions}
          onClose={() => {
            setSheet(null);
            reload();
          }}
          onChanged={reload}
        />
      ) : null}
      {back ? (
        <CommentDialog
          title="Return"
          text={`${back.number} goes back to the inspector as a draft.`}
          label="Add Comment"
          action="Return"
          onClose={() => setBack(null)}
          onSubmit={async (comment) => {
            await qpost(`/inspections/${back.id}/return`, { comment });
            toast(`${back.number} returned.`);
            setBack(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

const INNER = new Set(['Pending Acceptance', 'Priority', 'Record Doc. Format']);

export function IncomingQuality({ actions }: { actions: ActionSet }) {
  const tab = useFrame()?.tabName ?? '';
  const sub = 'Raw-material inspection sheets. A goods receipt of an item that needs inspection creates the lot; the usage decision releases or blocks the stock.';
  if (!INNER.has(tab)) return <InspectionPage kinds={['INCOMING']} title="Incoming Quality" sub={sub} actions={actions} />;
  return (
    <div className="qv-page">
      <PageHead title={`Incoming Quality · ${tab}`} sub={sub} />
      {tab === 'Record Doc. Format' ? <RecordFormats actions={actions} /> : <Queue mode={tab === 'Priority' ? 'priority' : 'pending'} actions={actions} />}
    </div>
  );
}
