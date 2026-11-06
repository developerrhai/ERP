// Approval Center (/approvals): Waiting for me · Submitted by me · All (in my scope) · Delegations.
// KPIs come from GET /approvals/counts; Approve / Reject / Return show only for the assignees; a click
// on a row opens the approval journey. Prototype look (head, kpis, tabs, card table, drawer).
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Drawer } from '../../components/Drawer';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import {
  STATUS_LABEL,
  getApprovalCounts,
  getInbox,
  getRequest,
  getRequests,
  inr,
  type ApprovalRequest,
  type Page,
} from '../../lib/approvalsApi';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import type { User } from '../../types';
import { ApprovalJourney, statusClass } from './ApprovalJourney';
import { DecisionButtons } from './DecisionButtons';
import { DelegationsTab } from './DelegationsTab';
import { ReassignControl } from './ReassignControl';

type Tab = 'waiting' | 'submitted' | 'all' | 'delegations';
const TABS: { key: Tab; label: string }[] = [
  { key: 'waiting', label: 'Waiting for me' },
  { key: 'submitted', label: 'Submitted by me' },
  { key: 'all', label: 'All (in my scope)' },
  { key: 'delegations', label: 'Delegations' },
];

export function ApprovalCenterPage({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : 'waiting';
  const openId = params.get('request');
  const toast = useToast();
  const counts = useLoad(getApprovalCounts, [tab]);
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => {
    setReloadToken((n) => n + 1);
    counts.reload();
  }, [counts]);

  const setTab = (next: Tab): void =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('tab', next);
      n.delete('request');
      return n;
    });
  const openRequest = (id: string | null): void =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set('request', id);
      else n.delete('request');
      return n;
    });

  const c = counts.data;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approval Center</h1>
          <p>Requests that need your decision, and the requests you raised.</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/m/admin-approval">
            Approval Matrix
          </Link>
        </div>
      </div>
      <div className="kpis">
        <div className="card kpi">
          <small>Waiting for me</small>
          <b>{c ? c.waitingForMe : '…'}</b>
        </div>
        <div className="card kpi">
          <small>Submitted by me</small>
          <b>{c ? c.submittedPending : '…'}</b>
        </div>
        <div className="card kpi">
          <small>Overdue</small>
          <b>{c ? c.overdue : '…'}</b>
        </div>
        <div className="card kpi">
          <small>My Role / Limit</small>
          <b>{user.roleLabel}</b>
          <small>{user.approvalLimit ? inr(user.approvalLimit) : 'No approval limit'}</small>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Approval views">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            className={t.key === tab ? 'tab active' : 'tab'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TABS.find((t) => t.key === tab)?.label}>
        {tab === 'delegations' ? (
          <DelegationsTab user={user} />
        ) : (
          <RequestTable
            key={tab}
            tab={tab}
            reloadToken={reloadToken}
            onOpen={(r) => openRequest(r.id)}
            onChanged={(msg) => {
              if (msg) toast(msg);
              refresh();
            }}
          />
        )}
      </div>
      {openId ? (
        <JourneyDrawer
          id={openId}
          user={user}
          onClose={() => openRequest(null)}
          onChanged={(msg) => {
            if (msg) toast(msg);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

const DONE_MESSAGE: Record<string, string> = {
  approve: 'Approved.',
  reject: 'Rejected.',
  return: 'Returned for changes.',
  withdraw: 'Withdrawn.',
};

function RequestTable({
  tab,
  reloadToken,
  onOpen,
  onChanged,
}: {
  tab: Exclude<Tab, 'delegations'>;
  reloadToken: number;
  onOpen: (r: ApprovalRequest) => void;
  onChanged: (message?: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const load = useLoad<Page<ApprovalRequest>>(
    () =>
      tab === 'waiting'
        ? getInbox({ page, ...(q ? { q } : {}) })
        : getRequests({
            page,
            mine: tab === 'submitted',
            ...(q ? { q } : {}),
            ...(status ? { status } : {}),
          }),
    [tab, page, q, status, reloadToken],
  );
  const rows = load.data?.rows ?? [];
  return (
    <>
      <div className="recordbar">
        <input
          type="search"
          placeholder="Search by document number or title…"
          aria-label="Search requests"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        {tab !== 'waiting' ? (
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {load.error ? (
        <div className="msg error show static" role="alert">
          {load.error}
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Request</th>
              <th scope="col">Department</th>
              <th scope="col">Module</th>
              <th scope="col">Record</th>
              <th scope="col">Amount</th>
              <th scope="col">Level</th>
              <th scope="col">Waiting on</th>
              <th scope="col">Due</th>
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
                    onClick={() => onOpen(r)}
                  >
                    {r.requestedBy.name}
                  </button>
                  <div className="v8-sub">{formatDateTime(r.requestedAt)}</div>
                </td>
                <td>{r.department}</td>
                <td>{r.moduleTitle}</td>
                <td>
                  <strong>{r.docCode}</strong>
                </td>
                <td>{inr(r.amount)}</td>
                <td>{r.status === 'PENDING' ? `${r.currentLevel}/${r.totalLevels}` : '—'}</td>
                <td>{r.waitingOn ?? '—'}</td>
                <td>
                  {r.dueAt ? (
                    <span className={r.overdue ? 'status overdue' : undefined}>
                      {formatDateTime(r.dueAt)}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <span className={`status ${statusClass(r.status)}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td>
                  <div className="actions">
                    <DecisionButtons
                      request={r}
                      small
                      onDone={(_updated, verb) => onChanged(DONE_MESSAGE[verb])}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {load.loading && !load.data ? (
              <tr className="empty-row">
                <td colSpan={10}>Loading…</td>
              </tr>
            ) : null}
            {load.data && rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={10}>
                  {tab === 'waiting'
                    ? 'Nothing is waiting for you. New requests appear here and in the bell.'
                    : tab === 'submitted'
                      ? 'You have not submitted anything yet. Open a module and click Submit for Approval.'
                      : 'No requests in your scope yet.'}
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
    </>
  );
}

function JourneyDrawer({
  id,
  user,
  onClose,
  onChanged,
}: {
  id: string;
  user: User;
  onClose: () => void;
  onChanged: (message?: string) => void;
}) {
  const load = useLoad(() => getRequest(id), [id]);
  useEffect(() => {
    load.reload();
    // reload when the id changes only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const req = load.data;
  return (
    <Drawer
      title={req ? `${req.moduleTitle} ${req.docCode}` : 'Approval journey'}
      onClose={onClose}
    >
      {load.error ? (
        <div className="msg error show static" role="alert">
          {load.error}
        </div>
      ) : null}
      {!req && load.loading ? <p className="v8-sub">Loading…</p> : null}
      {req ? (
        <>
          <ApprovalJourney request={req} />
          <div className="drawer-actions">
            <DecisionButtons
              request={req}
              onDone={(updated, verb) => {
                load.setData(updated);
                onChanged(DONE_MESSAGE[verb]);
              }}
            />
            {user.roleLevel >= 95 && req.status === 'PENDING' ? (
              <ReassignControl
                request={req}
                onDone={(updated) => {
                  load.setData(updated);
                  onChanged('Level reassigned.');
                }}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </Drawer>
  );
}
