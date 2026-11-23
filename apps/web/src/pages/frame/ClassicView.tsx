// The "Classic view" of a V40-framed page: the page's own screen (its "+ New" button, create forms, row actions such as
// Submit / Post / Release / Run MRP / inspection decisions, record dialogs). The V40 register of the Manufacturing,
// Quality, Maintenance and Finance pages draws the V40 columns and nothing else, so without this the page had no way to
// create a record, act on a row or open a record (V40 40-case report: TC-11, 12, 17, 20, 23, 26, 39).
//   - a button in the toolbar switches between the V40 register and the page's own screen;
//   - the top bar's "＋ Add New" switches to the page's screen and presses its own "+ New" button;
//   - View / Load Selected in the register open that record on the page's screen.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { findAddButton } from '../../lib/ownAddButton';

export interface ClassicApi {
  /** Show the page's own screen and open this record (by number) there. */
  open: (recordNo: string) => void;
  /** Show the page's own screen and start its "+ New" form. */
  add: () => void;
}

const Ctx = createContext<ClassicApi | null>(null);
export const useClassic = (): ClassicApi | null => useContext(Ctx);

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

export function ClassicViewSwitch({
  pageId,
  fallback,
  children,
}: {
  pageId: string;
  /** the page's own screen */
  fallback: ReactNode;
  /** the V40 register */
  children: ReactNode;
}) {
  const [classic, setClassic] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onAdd = (e: Event) => {
      const ce = e as CustomEvent<{ pageId?: string; handled?: boolean }>;
      if (!ce.detail || ce.detail.pageId !== pageId || ce.detail.handled) return;
      ce.detail.handled = true;
      setClassic(true);
      setJob({ kind: 'add' });
    };
    window.addEventListener('v40-add-record', onAdd);
    return () => window.removeEventListener('v40-add-record', onAdd);
  }, [pageId]);

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
      setClassic(true);
      setJob({ kind: 'open', no: recordNo });
    },
    add: () => {
      setClassic(true);
      setJob({ kind: 'add' });
    },
  };

  return (
    <Ctx.Provider value={api}>
      <div className="classic-switch" style={{ display: 'flex', justifyContent: 'flex-end', margin: '0 0 8px' }}>
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
      {classic ? <div ref={box}>{fallback}</div> : children}
    </Ctx.Provider>
  );
}
