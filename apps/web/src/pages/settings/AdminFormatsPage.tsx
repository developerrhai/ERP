// admin-formats (Administration): every format and rule set of every page, with versions and the
// history of who changed what (docs/phases/PHASE-06B.md §2).
import { useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { formatDateTime } from '../../lib/format';
import { lookupPage } from '../../lib/registry';
import {
  listAll,
  listChanges,
  versionsOf,
  type SettingsVersion,
  type VersionStatus,
} from '../../lib/settingsApi';
import { useLoad } from '../../lib/useLoad';
import { statusClass, statusLabel } from './shared';

type Tab = 'all' | 'changes';
const titleOf = (pageId: string): string => lookupPage(pageId)?.item.title ?? pageId;

export function AdminFormatsPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | 'format' | 'rule'>('');
  const [status, setStatus] = useState<'' | VersionStatus>('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<SettingsVersion | null>(null);
  const [changePage, setChangePage] = useState(1);
  const list = useLoad(
    () =>
      listAll({
        ...(q ? { q } : {}),
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        page,
      }),
    [q, type, status, page],
  );
  const changes = useLoad(() => listChanges(undefined, changePage), [changePage]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Formats &amp; Rules</h1>
          <p>
            All document formats and calculation rule sets, their versions, and who changed what.
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Formats and rules">
        {(
          [
            ['all', 'Formats and rule sets'],
            ['changes', 'Who changed what'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'tab active' : 'tab'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'all' ? (
        <>
          <div className="filters">
            <div className="field">
              <label htmlFor="af-q">Search</label>
              <input
                id="af-q"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="af-type">Type</label>
              <select
                id="af-type"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as typeof type);
                  setPage(1);
                }}
              >
                <option value="">Formats and rule sets</option>
                <option value="format">Formats</option>
                <option value="rule">Rule sets</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="af-status">Status</label>
              <select
                id="af-status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as typeof status);
                  setPage(1);
                }}
              >
                <option value="">Any status</option>
                <option value="ACTIVE">Active</option>
                <option value="DRAFT">Draft</option>
                <option value="PENDING_APPROVAL">Waiting for approval</option>
                <option value="RETIRED">Retired</option>
              </select>
            </div>
          </div>
          {list.error ? <ErrorMessage onReload={list.reload}>{list.error}</ErrorMessage> : null}
          {list.loading ? <p role="status">Loading…</p> : null}
          {!list.loading && (list.data?.items.length ?? 0) === 0 ? (
            <p className="empty">
              No formats or rule sets yet. Open a module page and click Settings to add one.
            </p>
          ) : null}
          {(list.data?.items.length ?? 0) > 0 ? (
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Page</th>
                    <th scope="col">Name</th>
                    <th scope="col">Type</th>
                    <th scope="col">For</th>
                    <th scope="col">Version</th>
                    <th scope="col">Status</th>
                    <th scope="col">Last change</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data?.items.map((v) => (
                    <tr key={v.id}>
                      <td>{titleOf(v.pageId)}</td>
                      <td>{v.name}</td>
                      <td>
                        {v.target === 'FORMAT' ? `Format (${v.kind})` : `Rule set (${v.code})`}
                      </td>
                      <td>{v.customer ? v.customer.name : 'Everyone'}</td>
                      <td>v{v.versionNo}</td>
                      <td>
                        <span className={`status ${statusClass(v.status)}`}>
                          {statusLabel(v.status)}
                        </span>
                      </td>
                      <td>
                        {(v.publishedBy ?? v.createdBy)?.name ?? '—'}
                        <br />
                        <small>{formatDateTime(v.publishedAt ?? v.updatedAt)}</small>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`Versions of ${v.name}`}
                          onClick={() => setOpen(v)}
                        >
                          Versions
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="v8-sub">
            {list.data ? `${list.data.total} in total.` : ''}{' '}
            <button
              type="button"
              className="btn sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>{' '}
            <button
              type="button"
              className="btn sm"
              disabled={!list.data || page * list.data.size >= list.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </p>
        </>
      ) : (
        <>
          {changes.error ? (
            <ErrorMessage onReload={changes.reload}>{changes.error}</ErrorMessage>
          ) : null}
          {(changes.data?.items.length ?? 0) === 0 && !changes.loading ? (
            <p className="empty">Nothing has been changed yet.</p>
          ) : (
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Who</th>
                    <th scope="col">Page</th>
                    <th scope="col">What</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.data?.items.map((c) => (
                    <tr key={c.id}>
                      <td>{formatDateTime(c.at)}</td>
                      <td>{c.changedBy?.name ?? '—'}</td>
                      <td>{titleOf(c.pageId)}</td>
                      <td>
                        {c.targetType === 'FORMAT' ? 'Format' : 'Rule set'} v{c.versionNo}{' '}
                        {c.action.toLowerCase()}
                      </td>
                      <td>{c.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="v8-sub">
            <button
              type="button"
              className="btn sm"
              disabled={changePage <= 1}
              onClick={() => setChangePage((p) => p - 1)}
            >
              Previous
            </button>{' '}
            <button
              type="button"
              className="btn sm"
              disabled={!changes.data || changePage * 20 >= changes.data.total}
              onClick={() => setChangePage((p) => p + 1)}
            >
              Next
            </button>
          </p>
        </>
      )}

      {open ? <VersionsModal row={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function VersionsModal({ row, onClose }: { row: SettingsVersion; onClose: () => void }) {
  const versions = useLoad(() => versionsOf(row.id), [row.id]);
  return (
    <Modal
      title={`Versions — ${row.name}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      {versions.error ? (
        <ErrorMessage onReload={versions.reload}>{versions.error}</ErrorMessage>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Status</th>
              <th scope="col">Published by</th>
              <th scope="col">When</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {versions.data?.map((v) => (
              <tr key={v.id}>
                <td>v{v.versionNo}</td>
                <td>
                  <span className={`status ${statusClass(v.status)}`}>{statusLabel(v.status)}</span>
                </td>
                <td>{v.publishedBy?.name ?? '—'}</td>
                <td>{formatDateTime(v.publishedAt ?? v.createdAt)}</td>
                <td>{v.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
