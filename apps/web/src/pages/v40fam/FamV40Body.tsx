// Wraps the body of a Warehouse / WMS, Logistics / Fleet / Gate or Assets page inside the V40 tab frame: the open V40 tab shows the
// columns V40 shows there with real values (V40Register over GET /fam/v40/:pageId). The page's own screen (add, edit, actions) stays one
// click away in "Standard screen" and is the fallback outside the tab frame, exactly like the Sales wrapper.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoveForwardDialog } from '../../components/MoveForward';
import { useToast } from '../../components/Toast';
import { docsMailApi, saveFile } from '../../lib/docsMailApi';
import { request } from '../../lib/api';
import { toUiError } from '../../lib/errors';
import type { ActionSet } from '../../types';
import { useFrame } from '../frame/V40TabFrame';
import { V40Register } from '../sales/V40Register';
import { getSalesV40 } from '../sales/salesV40Api';
import { FAM_V40_IDS } from './famIds';
import './fam-v40.css';

/** Where the Allocate / Reallocate button of a page leads when it is not the warehouse stock allocator. */
const ALLOCATE_TARGET: Record<string, string> = {
  'wms-zones': 'wms-putaway',
  'wms-racks': 'wms-putaway',
  'wms-shelves': 'wms-putaway',
  'wms-bins': 'wms-putaway',
  'wms-putaway': 'wms-putaway',
  'wms-pick': 'wms-pick',
  'wms-packing': 'wms-packing',
  'log-shipments': 'log-shipments',
  'container-track': 'container-track',
  'asset-allocation': 'asset-allocation',
  'asset-transfer': 'asset-transfer',
};

export function FamV40Body({
  pageId,
  actions,
  children,
}: {
  pageId: string;
  actions: ActionSet;
  /** the page's own body */
  children: ReactNode;
}) {
  const frame = useFrame();
  const toast = useToast();
  const navigate = useNavigate();
  const [standard, setStandard] = useState(false);
  const [tick, setTick] = useState(0);
  const [moving, setMoving] = useState<{ id: string; number: string } | null>(null);
  const [cards, setCards] = useState<{ scope: number; done: number; open: number; partial: boolean } | null>(null);
  const framed = !!frame && FAM_V40_IDS.has(pageId);
  // summary cards: Records in Scope (real total), Completion and Open / Pending counted over the first 200 rows
  useEffect(() => {
    if (!framed) return;
    let live = true;
    void getSalesV40(pageId, { tab: '', first: true, page: 1, size: 200 })
      .then((r) => {
        if (!live) return;
        const closed = /^(done|completed|closed|posted|approved|active|delivered|exited|returned|pod_received|received|picked|packed|dispatched|printed)$/i;
        const done = r.rows.filter((x) => closed.test(x.status ?? '')).length;
        setCards({ scope: r.total, done, open: r.rows.length - done, partial: r.total > r.rows.length });
      })
      .catch(() => setCards(null));
    return () => {
      live = false;
    };
  }, [framed, pageId, tick]);
  if (!frame || !FAM_V40_IDS.has(pageId)) return <>{children}</>;

  const allocate = (id: string): void => {
    if (pageId === 'wms-warehouses') {
      void request('/fam/v40/allocate', { method: 'POST', body: { warehouseId: id } })
        .then(() => {
          toast('Stock allocated to the waiting reservations');
          setTick((n) => n + 1);
        })
        .catch((e: unknown) => toast(toUiError(e).message));
      return;
    }
    const target = ALLOCATE_TARGET[pageId];
    if (target && target !== pageId) navigate(`/m/${target}`);
    else setStandard(true);
  };

  const word = async (id: string, no: string): Promise<void> => {
    try {
      saveFile(await docsMailApi.print(pageId, id, 'word'), `${no || 'document'}.docx`);
    } catch (e) {
      toast(toUiError(e).message);
    }
  };

  return (
    <>
      {cards ? (
        <div className="fam-cards" role="group" aria-label="Summary">
          <div className="fam-card">
            <span>Records in Scope</span>
            <strong>{cards.scope}</strong>
          </div>
          <div className="fam-card">
            <span>Completion</span>
            <strong>{cards.scope === 0 ? '-' : `${Math.round((cards.done / Math.max(cards.done + cards.open, 1)) * 100)}%`}</strong>
          </div>
          <div className="fam-card">
            <span>Open / Pending</span>
            <strong>{cards.open}</strong>
          </div>
          {cards.partial ? <p className="v8-sub">Completion and Open / Pending count the latest 200 records.</p> : null}
        </div>
      ) : null}
      <V40Register
        pageId={pageId}
        actions={actions}
        onOpen={() => setStandard(true)}
        onAllocate={allocate}
        reloadKey={tick}
        rowExtra={(row) => (
          <>
            <button type="button" className="btn sm" onClick={() => setStandard(true)}>
              Edit
            </button>
            <button type="button" className="btn sm" onClick={() => void word(row.id, row.number)}>
              Word
            </button>
            <button type="button" className="btn sm" onClick={() => setMoving({ id: row.id, number: row.number })}>
              Move Forward
            </button>
            <button type="button" className="btn sm danger" onClick={() => setStandard(true)}>
              Delete
            </button>
          </>
        )}
        fallback={null}
      />
      {moving ? (
        <MoveForwardDialog
          docType={pageId}
          docId={moving.id}
          docNo={moving.number}
          onClose={() => setMoving(null)}
          onMoved={() => setMoving(null)}
        />
      ) : null}
      <details
        className="fam-standard"
        open={standard}
        onToggle={(e) => setStandard((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>Standard screen (add, edit, delete and the page actions)</summary>
        {standard ? children : null}
      </details>
    </>
  );
}
