// "Where is it now?": after Move Forward a record shows, on its row, the department it is with and the step it waits for.
import { useEffect, useState } from 'react';
import { workApi, type HolderRow } from '../lib/workApi';
import './holder-note.css';

/** Said on the window after any hand-over, so every open register refreshes its badges. */
export const MOVED_EVENT = 'work-moved';

const STEP: Record<string, string> = {
  SENT: 'waiting to be received',
  RECEIVED: 'waiting to be accepted',
  ACCEPTED: 'being worked on',
  IN_WORK: 'being worked on',
  WAITING_APPROVAL: 'waiting for approval',
};

/** The records of one page that are travelling between departments, by record id. */
export function useHolders(docType: string): Map<string, HolderRow> {
  const [holders, setHolders] = useState<Map<string, HolderRow>>(() => new Map());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const moved = (): void => setTick((n) => n + 1);
    window.addEventListener(MOVED_EVENT, moved);
    return () => window.removeEventListener(MOVED_EVENT, moved);
  }, []);
  useEffect(() => {
    let alive = true;
    // a register still works without the badges, so a refusal is not shown
    Promise.resolve(workApi.holders(docType)).then(
      (rows) => {
        if (alive && Array.isArray(rows)) setHolders(new Map(rows.map((r) => [r.doc_id, r])));
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [docType, tick]);
  return holders;
}

export function HolderNote({ holder }: { holder: HolderRow | undefined }) {
  if (!holder) return null;
  const text = `With ${holder.department}: ${STEP[holder.state] ?? holder.state.toLowerCase()}`;
  return (
    <span className="holder-note" title={`Moved forward. ${text}.`}>
      ⇢ {text}
    </span>
  );
}
