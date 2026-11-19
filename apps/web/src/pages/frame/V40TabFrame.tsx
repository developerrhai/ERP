// The V40 tab strip (V36) around a page body: the tab names are the ones V40 really shows (tabs-map.json, built by tools/parity/build-tabs-map.mjs),
// the open tab is in the URL (?tab=<index>), ← → scroll the strip when it overflows. The first tab is the page's own register.
// Tabs named Audit / History / Log show the real audit rows of the page; tabs named Approval(s) show the page's real
// approval requests; every other tab shows the same register (a filtered view of the same data, never an invented number).
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import tabsMap from './tabs-map.json';
import { TabStrip } from '../../components/TabStrip';
import { getRequests, type ApprovalRequest } from '../../lib/approvalsApi';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { listPageAudit } from '../generic/engineApi';
import { CLAIMED_PAGES } from '../inventory/v40/pages';
import { SALES_V40_IDS } from '../sales/salesV40Api';
import { FINANCE_V40_IDS, TAX_V40_IDS } from '../finance/finV40Api';
import { PLANT_V40_IDS } from '../plant/plantV40Api';
import { FAM_V40_IDS } from '../v40fam/famIds';

const SCM_V40_IDS = [
  'scm-po',
  'scm-grn',
  'scm-pr',
  'scm-purchaseinvoice',
  'scm-suppliers',
  'scm-rfq',
  'scm-vendorquote',
  'scm-comparison',
  'scm-evaluation',
  'scm-contracts',
  'scm-approval',
];

const ALL_CLAIMED_PAGES = new Set<string>([
  ...CLAIMED_PAGES,
  ...SALES_V40_IDS,
  ...SCM_V40_IDS,
  ...FINANCE_V40_IDS,
  ...TAX_V40_IDS,
  ...PLANT_V40_IDS,
  ...FAM_V40_IDS,
  'process-exceptions',
]);

/** Page-wide claimed set: once a page claims its tabs or is recognized as owning its tabs, it stays claimed across deep links and tab switches. */
const pageWideClaimed = new Set<string>(ALL_CLAIMED_PAGES);

/** What a framed page body needs: which V40 tab is open, and a way to say "I show my own tab panels" (generic module pages do). */
export interface FrameState {
  tabName: string;
  index: number;
  claim: () => void;
}
const FrameCtx = createContext<FrameState | null>(null);
export const useFrame = (): FrameState | null => useContext(FrameCtx);

/** The generic module page's own tab for a V40 tab name ('register' = its register / directory tab). */
export function genericTabFor(name: string, index: number): 'register' | 'dashboard' | string {
  if (index === 0) return 'register';
  const n = name.trim();
  if (/^analytics/i.test(n)) return 'dashboard';
  if (/^documents$/i.test(n)) return 'Documents';
  if (/^approvals?$/i.test(n)) return 'Approvals';
  if (/^reports?$/i.test(n)) return 'Reports';
  if (/audit trail/i.test(n) || /^audit$/i.test(n)) return 'Audit Trail';
  return 'register';
}

/** Pages that own their V40 layout (built page by page) and must not get the strip on top. */
const OWN_LAYOUT: ReadonlySet<string> = new Set(['my-approvals', 'document-movement-center', 'dms-movement-center', 'dept-movement-inbox', 'ops-order-360', 'project-global-history', 'dashboard']);

const TABS = new Map<string, string[]>(Object.entries(tabsMap as Record<string, string[]>));

export function v40TabsFor(pageId: string): string[] {
  if (OWN_LAYOUT.has(pageId) || /^dept-(inbox|work)-/.test(pageId)) return [];
  return TABS.get(pageId) ?? [];
}

type Kind = 'audit' | 'approvals' | 'register';
export function tabKind(name: string, index: number): Kind {
  if (index === 0) return 'register';
  const n = name.trim();
  if (/audit trail|activity log|^audit$|^history$|^timeline$|^log$/i.test(n)) return 'audit';
  if (/approval/i.test(n)) return 'approvals';
  return 'register';
}

export function AuditPanel({ pageId }: { pageId: string }) {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useLoad(() => listPageAudit(pageId, page, 20), [pageId, page]);
  if (error) return <p role="alert">{error}</p>;
  if (loading) return <p className="muted">Loading…</p>;
  const rows = data?.rows ?? [];
  return (
    <div className="table-wrap">
      <table className="register-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Person</th>
            <th>Action</th>
            <th>Record</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDateTime(r.at)}</td>
              <td>{r.actorName ?? '—'}</td>
              <td>{r.action}</td>
              <td>{r.targetId ?? '—'}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4}>No audit entries for this page yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="actions">
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <button type="button" className="btn" disabled={rows.length < 20} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function ApprovalsPanel({ pageId }: { pageId: string }) {
  const { data, loading, error } = useLoad(() => getRequests({ docType: pageId, page: 1, size: 25 }), [pageId]);
  if (error) return <p role="alert">{error}</p>;
  if (loading) return <p className="muted">Loading…</p>;
  const rows: ApprovalRequest[] = data?.rows ?? [];
  return (
    <div className="table-wrap">
      <table className="register-table">
        <thead>
          <tr>
            <th>Document</th>
            <th>Department</th>
            <th>Amount</th>
            <th>Level</th>
            <th>Waiting on</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.docCode}</td>
              <td>{r.department}</td>
              <td>{r.amount ?? '—'}</td>
              <td>{`${r.currentLevel} of ${r.totalLevels}`}</td>
              <td>{r.waitingOn ?? '—'}</td>
              <td>{r.status}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6}>No approval requests for this page yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function V40TabFrame({ pageId, tabs, children }: { pageId: string; tabs: string[]; children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get('tab') ?? 0);
  const active = Number.isInteger(raw) && raw >= 0 && raw < tabs.length ? raw : 0;
  const open = (i: number): void =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (i === 0) n.delete('tab');
      else n.set('tab', String(i));
      return n;
    });
  const kind = tabKind(tabs[active] ?? '', active);
  // pages that always draw their own tab panels start claimed, so a deep link to Audit Trail works too
  const [claimed, setClaimed] = useState(() => pageWideClaimed.has(pageId));
  const claim = (): void => {
    pageWideClaimed.add(pageId);
    setClaimed(true);
  };
  const isClaimed = claimed || pageWideClaimed.has(pageId);
  const frameState: FrameState = { tabName: tabs[active] ?? '', index: active, claim };

  return (
    <>
      <div className="v40-tabbar">
        <TabStrip id="moduleTabs" label="Module tabs" watch={`${pageId}:${active}:${tabs.length}`}>
          {tabs.map((t, i) => (
            <button key={`${t}-${i}`} type="button" role="tab" aria-selected={i === active} className={`tab${i === active ? ' active' : ''}`} data-tab-index={i} onClick={() => open(i)}>
              {t}
            </button>
          ))}
        </TabStrip>
      </div>
      <FrameCtx.Provider value={frameState}>
        {!isClaimed && kind === 'audit' ? (
          <AuditPanel pageId={pageId} />
        ) : !isClaimed && kind === 'approvals' ? (
          <ApprovalsPanel pageId={pageId} />
        ) : (
          children
        )}
      </FrameCtx.Provider>
    </>
  );
}
