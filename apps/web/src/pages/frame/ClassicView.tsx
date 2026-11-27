// The "Classic view" of a V40-framed page: the page's own screen (its "+ New" button, create forms, row actions such as
// Submit / Post / Release / Run MRP / inspection decisions, record dialogs). The V40 register of the Manufacturing,
// Quality, Maintenance and Finance pages draws the V40 columns and nothing else, so without this the page had no way to
// create a record, act on a row or open a record (V40 40-case report: TC-11, 12, 17, 20, 23, 26, 39).
//   - a button in the toolbar switches between the V40 register and the page's own screen;
//   - the top bar's "＋ Add New" switches to the page's screen and presses its own "+ New" button;
//   - View / Load Selected in the register open that record on the page's screen.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { findAddButton } from '../../lib/ownAddButton';

export interface ClassicApi {
  /**
   * Open this record (by number) on the page's own screen. In host mode its dialog opens over the register and false
   * means the page's screen has no Open button for it.
   */
  open: (recordNo: string) => boolean;
  /** Show the page's own screen and start its "+ New" form. */
  add: () => void;
  /**
   * Host mode: the page's own screen stays mounted (hidden) behind the V40 register, so its dialogs (create, edit, delete,
   * allocate ...) work from the register. `actionsOf` lists the buttons the page's own row for this record offers;
   * `press` clicks one of them. Both answer "nothing" when there is no host or no such row.
   */
  actionsOf: (recordNo: string) => string[];
  press: (recordNo: string, label: string) => boolean;
  /** Text of the page's own "＋ New ..." button inside the host ('' when it has none) and a way to press it. */
  addLabel: () => string;
  pressAdd: () => boolean;
  /** Where a record of this register is entered when the page has no entry form of its own (null when it has one). */
  elsewhere: () => string | null;
}

const Ctx = createContext<ClassicApi | null>(null);
export const useClassic = (): ClassicApi | null => useContext(Ctx);

/**
 * Registers that no record is entered on (a ledger view, a report, a payable / receivable list): their "＋ Add New" opens
 * the screen where the matching entry is made, and presses its own "＋ New" button there.
 */
const ADD_ELSEWHERE: Record<string, { page: string; label: string }> = {
  'fin-gl': { page: 'fin-journal', label: 'journal entry' },
  'fin-ap': { page: 'fin-bankbook', label: 'payment entry' },
  'fin-ar': { page: 'fin-bankbook', label: 'receipt entry' },
  'fin-trial': { page: 'fin-journal', label: 'journal entry' },
  'fin-pnl': { page: 'fin-journal', label: 'journal entry' },
  'fin-bs': { page: 'fin-journal', label: 'journal entry' },
  'fin-cashflow': { page: 'fin-journal', label: 'journal entry' },
  'fin-ageing': { page: 'fin-bankbook', label: 'receipt entry' },
  'qms-inspections': { page: 'qms-incoming', label: 'inspection sheet' },
  'maint-schedule': { page: 'maint-preventive', label: 'PM plan' },
  'maint-downtime': { page: 'maint-breakdown', label: 'breakdown' },
  'maint-mtbf': { page: 'maint-breakdown', label: 'breakdown' },
  'maint-alerts': { page: 'maint-breakdown', label: 'breakdown' },
  'maint-spares': { page: 'inv-items', label: 'spare item' },
  'mfg-mrp': { page: 'mfg-plan', label: 'production plan' },
  'mfg-workorders': { page: 'mfg-orders', label: 'production order' },
  'mfg-material-issue': { page: 'mfg-orders', label: 'production order' },
  'mfg-wip': { page: 'mfg-orders', label: 'production order' },
  'mfg-fg': { page: 'mfg-orders', label: 'production order' },
  'mfg-costing': { page: 'mfg-orders', label: 'production order' },
  'mfg-rework': { page: 'mfg-scrap', label: 'scrap entry' },
};
export const PENDING_ADD = 'v40-add-after-nav';
/** True once, on the page another register sent the person to for adding a record. Only a page id is kept. */
export function takePendingAdd(pageId: string): boolean {
  try {
    /* eslint-disable no-restricted-properties */
    if (window.sessionStorage.getItem(PENDING_ADD) !== pageId) return false;
    window.sessionStorage.removeItem(PENDING_ADD);
    /* eslint-enable no-restricted-properties */
    return true;
  } catch {
    return false;
  }
}

const OPEN_LABEL = /^(open|view|edit|details)$/i;
type Job = { kind: 'add' } | { kind: 'open'; no: string };

const textOf = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

function findOpen(scope: ParentNode, no: string): HTMLElement | null {
  const rows = Array.from(scope.querySelectorAll('tr'));
  // the exact record number first ("…/0001" must not open "…/00011"), then a cell that merely contains it
  const exact = rows.filter((row) => Array.from(row.querySelectorAll('td')).some((c) => textOf(c) === no));
  const loose = rows.filter((row) => Array.from(row.querySelectorAll('td')).some((c) => textOf(c).includes(no)));
  for (const row of exact.length > 0 ? exact : loose) {
    const buttons = Array.from(row.querySelectorAll<HTMLElement>('button, a')).filter(
      (b) => !b.hasAttribute('disabled') && !b.closest('.actionbar'),
    );
    const hit = buttons.find((b) => OPEN_LABEL.test(textOf(b))) ?? buttons.find((b) => textOf(b) === no);
    if (hit) return hit;
  }
  return null;
}

/** The buttons of the row that shows this record number, and the row itself. */
function rowOf(scope: ParentNode, no: string): HTMLElement | null {
  const rows = Array.from(scope.querySelectorAll<HTMLElement>('tr'));
  const exact = rows.filter((row) => Array.from(row.querySelectorAll('td')).some((c) => textOf(c) === no));
  const loose = rows.filter((row) => Array.from(row.querySelectorAll('td')).some((c) => textOf(c).includes(no)));
  return (exact.length > 0 ? exact : loose)[0] ?? null;
}

export function ClassicViewSwitch({
  pageId,
  fallback,
  children,
  host = false,
}: {
  pageId: string;
  /** the page's own screen */
  fallback: ReactNode;
  /** the V40 register */
  children: ReactNode;
  /** keep the page's own screen mounted but hidden behind the register (see ClassicApi.actionsOf / press) */
  host?: boolean;
}) {
  const [classic, setClassic] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const hostBox = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // arrived from a register that has no entry form of its own: press this page's own "＋ New" once it has drawn
  useEffect(() => {
    if (!host) return undefined;
    let pending = '';
    try {
      pending = window.sessionStorage.getItem(PENDING_ADD) ?? '';
    } catch {
      pending = '';
    }
    if (pending !== pageId) return undefined;
    // the flag is cleared only when the button is pressed (a dev-mode double mount must not lose it)
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const el = findAddButton(document.getElementById('main') ?? document.body);
      if (el) {
        clearInterval(timer);
        try {
          window.sessionStorage.removeItem(PENDING_ADD);
        } catch {
          /* nothing to clear */
        }
        el.click();
      } else if (tries >= 20) {
        clearInterval(timer);
        try {
          window.sessionStorage.removeItem(PENDING_ADD);
        } catch {
          /* nothing to clear */
        }
      }
    }, 200);
    return () => clearInterval(timer);
  }, [host, pageId]);

  useEffect(() => {
    const onAdd = (e: Event) => {
      const ce = e as CustomEvent<{ pageId?: string; handled?: boolean }>;
      if (!ce.detail || ce.detail.pageId !== pageId || ce.detail.handled) return;
      if (host && !classic) {
        // the page's own "+ New" button is on screen next to the register and its dialog lives in the hidden host:
        // press it in place instead of switching the user to the classic screen
        const own = findAddButton(document.getElementById('main') ?? document.body);
        if (own) {
          ce.detail.handled = true;
          own.click();
          return;
        }
        const elsewhere = ADD_ELSEWHERE[pageId];
        if (elsewhere) {
          ce.detail.handled = true;
          try {
            window.sessionStorage.setItem(PENDING_ADD, elsewhere.page);
          } catch {
            /* the target screen still opens; the user presses its own button */
          }
          navigate(`/m/${elsewhere.page}`);
          return;
        }
      }
      ce.detail.handled = true;
      setClassic(true);
      setJob({ kind: 'add' });
    };
    window.addEventListener('v40-add-record', onAdd);
    return () => window.removeEventListener('v40-add-record', onAdd);
  }, [pageId, host, classic, navigate]);

  // press the page's own button once its screen has drawn (its rows load first); give up after ~3 s
  useEffect(() => {
    if (!classic || !job) return undefined;
    let tries = 0;
    const main = () => document.getElementById('main') ?? document.body;
    const timer = setInterval(() => {
      tries += 1;
      const el =
        job.kind === 'add'
          ? (box.current && findAddButton(box.current)) || findAddButton(main())
          : box.current && findOpen(box.current, job.no);
      if (el) {
        clearInterval(timer);
        setJob(null);
        el.click();
      } else if (tries >= 20) {
        clearInterval(timer);
        setJob(null);
      }
    }, 150);
    return () => clearInterval(timer);
  }, [classic, job]);

  const api: ClassicApi = {
    open: (recordNo) => {
      if (host) {
        const hit = hostBox.current ? findOpen(hostBox.current, recordNo) : null;
        hit?.click();
        return Boolean(hit);
      }
      setClassic(true);
      setJob({ kind: 'open', no: recordNo });
      return true;
    },
    add: () => {
      setClassic(true);
      setJob({ kind: 'add' });
    },
    actionsOf: (no) => {
      const row = hostBox.current ? rowOf(hostBox.current, no) : null;
      if (!row) return [];
      return Array.from(row.querySelectorAll<HTMLElement>('button'))
        .filter((b) => !b.hasAttribute('disabled'))
        .map(textOf)
        .filter(Boolean);
    },
    addLabel: () => {
      const b = hostBox.current ? findAddButton(hostBox.current) : null;
      return b ? textOf(b) : '';
    },
    pressAdd: () => {
      const b = hostBox.current ? findAddButton(hostBox.current) : null;
      if (!b) return false;
      b.click();
      return true;
    },
    elsewhere: () => ADD_ELSEWHERE[pageId]?.label ?? null,
    press: (no, label) => {
      const row = hostBox.current ? rowOf(hostBox.current, no) : null;
      const hit = row
        ? Array.from(row.querySelectorAll<HTMLElement>('button')).find((b) => !b.hasAttribute('disabled') && textOf(b) === label)
        : null;
      if (!hit) return false;
      hit.click();
      return true;
    },
  };

  return (
    <Ctx.Provider value={api}>
      {host ? null : (
      <div className="classic-switch x-d-flex x-jc-flex-end x-m-0-0-8px">
        <button
          type="button"
          className="btn sm"
          aria-pressed={classic}
          title={
            classic
              ? 'Back to the V40 register'
              : "Open this page's own screen: create a record, act on a row, open a record"
          }
          onClick={() => {
            setJob(null);
            setClassic((c) => !c);
          }}
        >
          {classic ? '← V40 view' : 'Classic view (create & actions)'}
        </button>
      </div>
      )}
      {classic ? <div ref={box}>{fallback}</div> : children}
      {host && !classic ? (
        <div ref={hostBox} hidden aria-hidden="true" data-classic-host="">
          {fallback}
        </div>
      ) : null}
    </Ctx.Provider>
  );
}
