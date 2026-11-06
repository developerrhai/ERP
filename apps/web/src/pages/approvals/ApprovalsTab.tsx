// The "Approvals" tab of every module page (requests for THIS page) and the "Approval journey"
// panel inside the record drawer (chip "Pending L2/4 · Department Head", the timeline, Withdraw).
import { useState } from 'react';
import { Drawer } from '../../components/Drawer';
import { Pager } from '../../components/Pager';
import {
  STATUS_LABEL,
  getDocApprovals,
  getRequests,
  inr,
  pendingChip,
  type ApprovalRequest,
  type Page,
} from '../../lib/approvalsApi';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { ApprovalJourney, statusClass } from './ApprovalJourney';
import { DecisionButtons } from './DecisionButtons';

export function ApprovalsTab({ pageId, reloadToken }: { pageId: string; reloadToken: number }) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<ApprovalRequest | null>(null);
  const [local, setLocal] = useState(0);
  const load = useLoad<Page<ApprovalRequest>>(
    () => getRequests({ docType: pageId, page }),
    [pageId, page, reloadToken, local],
  );
  const rows = load.data?.rows ?? [];
  return (
    <>
      {load.error ? (
        <div className="msg error show static" role="alert">
          {load.error}
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Record</th>
              <th scope="col">Requested by</th>
              <th scope="col">Department</th>
              <th scope="col">Amount</th>
              <th scope="col">Waiting on</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <button
                    type="button"
                    className="link-btn"
                    aria-label={`Open journey of ${r.docCode}`}
                    onClick={() => setOpen(r)}
                  >
                    {r.docCode}
                  </button>
                  <div className="v8-sub">Attempt {r.cycle}</div>
                </td>
                <td>
                  {r.requestedBy.name}
                  <div className="v8-sub">{formatDateTime(r.requestedAt)}</div>
                </td>
                <td>{r.department}</td>
                <td>{inr(r.amount)}</td>
                <td>{r.status === 'PENDING' ? (pendingChip(r) ?? '—') : '—'}</td>
                <td>
                  <span className={`status ${statusClass(r.status)}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td>
                  <div className="actions">
                    <DecisionButtons request={r} small onDone={() => setLocal((n) => n + 1)} />
                  </div>
                </td>
              </tr>
            ))}
            {load.loading && !load.data ? (
              <tr className="empty-row">
                <td colSpan={7}>Loading…</td>
              </tr>
            ) : null}
            {load.data && rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={7}>
                  No approval requests for this page yet. Open a Draft and click Submit for
                  Approval.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {load.data ? (
        <Pager
          page={load.data.meta.page}
          size={load.data.meta.size}
          total={load.data.meta.total}
          onPage={setPage}
        />
      ) : null}
      {open ? (
        <Drawer title={`${open.moduleTitle} ${open.docCode}`} onClose={() => setOpen(null)}>
          <ApprovalJourney request={open} />
        </Drawer>
      ) : null}
    </>
  );
}

/** Inside the record drawer: the chip, the journey and Withdraw / Approve for the people who may. */
export function RecordApprovalPanel({
  pageId,
  recordId,
  version,
  onChanged,
}: {
  pageId: string;
  recordId: string;
  version: number;
  onChanged: () => void;
}) {
  const load = useLoad(() => getDocApprovals(pageId, recordId), [pageId, recordId, version]);
  const latest = load.data?.latest ?? null;
  if (!latest) return null; // no request yet (or the lookup failed): the drawer simply has no journey
  const chip = pendingChip(latest);
  return (
    <section className="drawer-section" aria-label="Approval journey">
      <h3>Approval journey</h3>
      {chip ? <span className="status pending-approval">{chip}</span> : null}
      <ApprovalJourney request={latest} />
      <div className="drawer-actions">
        <DecisionButtons
          request={latest}
          onDone={() => {
            load.reload();
            onChanged();
          }}
        />
      </div>
    </section>
  );
}
