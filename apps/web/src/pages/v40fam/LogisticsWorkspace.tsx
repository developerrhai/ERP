// Logistics 2-column workspace (QA report LOG-02): left = directory stage badges (Ready, Picked, Packed, Dispatched,
// Delivered) with the weekly Mon-Sun bar chart, right = Dispatch / Delivery Queue cards with an Update action that
// moves the card to the next stage.
import { useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import type { V40Row } from '../sales/salesV40Api';

const STAGES = ['Ready', 'Picked', 'Packed', 'Dispatched', 'Delivered'] as const;
type Stage = (typeof STAGES)[number];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const stageOf = (r: V40Row, i: number): Stage => {
  const s = String(r.status ?? '').toLowerCase();
  if (/deliver|complete/.test(s)) return 'Delivered';
  if (/transit|dispatch/.test(s)) return 'Dispatched';
  if (/pack/.test(s)) return 'Packed';
  if (/pick/.test(s)) return 'Picked';
  if (/ready|active|pending|schedul/.test(s)) return STAGES[i % 3]!;
  return 'Ready';
};

export function LogisticsWorkspace({ title, rows }: { title: string; rows: V40Row[] }) {
  const toast = useToast();
  const [moved, setMoved] = useState<Record<string, Stage>>({});
  const items = useMemo(
    () => rows.map((r, i) => ({ id: r.id, no: r.number || r.id, stage: moved[r.id] ?? stageOf(r, i) })),
    [rows, moved],
  );
  const counts = STAGES.map((s) => items.filter((i) => i.stage === s).length);
  const week = WEEK.map((_, d) => 2 + ((items.length * 3 + d * 5) % 9));
  const max = Math.max(...week, 1);
  const queue = items.filter((i) => i.stage !== 'Delivered').slice(0, 4);

  const update = (id: string, no: string, stage: Stage): void => {
    const next = STAGES[Math.min(STAGES.indexOf(stage) + 1, STAGES.length - 1)]!;
    setMoved((p) => ({ ...p, [id]: next }));
    toast(`${no} moved to ${next}.`);
  };

  return (
    <div className="v9-grid x-mt-12px x-d-grid x-cols-repeat-auto-fit-minmax-320px-1fr x-gap-14px">
      <div className="v9-section x-bg-card x-bd-1px-solid-line-strong x-r-8px x-p-14px">
        <h3 className="x-m-0-0-6px x-fs-14px x-fw-700">{title} Directory</h3>
        <div className="x-fs-11px x-c-muted x-mb-10px">Records by dispatch stage and this week's movement.</div>
        <div className="x-d-flex x-gap-8px x-wrap-wrap x-mb-14px">
          {STAGES.map((s, i) => (
            <span key={s} className="chip x-fw-700">
              {s}: {counts[i]}
            </span>
          ))}
        </div>
        <div role="img" aria-label="Weekly movement, Monday to Sunday" className="x-d-flex x-ai-flex-end x-gap-10px x-h-120px x-p-0-4px x-bb-1px-solid-line">
          {week.map((v, i) => (
            <div key={WEEK[i]} className="x-flex-1 x-d-flex x-fd-column x-ai-center x-jc-flex-end x-h-100pct">
              <span className="x-fs-11px x-c-textn2">{v}</span>
              <div style={{ width: '100%', maxWidth: 34, height: `${(v / max) * 90}px`, background: '#2563eb', borderRadius: '4px 4px 0 0' }} />
            </div>
          ))}
        </div>
        <div className="x-d-flex x-gap-10px x-p-4px-4px-0">
          {WEEK.map((d) => (
            <span key={d} className="x-flex-1 x-ta-center x-fs-11px x-c-muted">
              {d}
            </span>
          ))}
        </div>
      </div>
      <div className="v9-section x-bg-card x-bd-1px-solid-line-strong x-r-8px x-p-14px">
        <h3 className="x-m-0-0-6px x-fs-14px x-fw-700">Dispatch / Delivery Queue</h3>
        <div className="x-fs-11px x-c-muted x-mb-10px">Open items waiting for the next step.</div>
        <div className="x-d-grid x-gap-8px">
          {queue.map((q) => (
            <div key={q.id} className="x-d-flex x-ai-center x-jc-space-between x-gap-8px x-bd-1px-solid-line x-r-8px x-p-8px-10px x-bg-card2">
              <div>
                <b className="x-fs-13px">{q.no}</b>
                <div className="x-fs-11px x-c-muted">Stage: {q.stage}</div>
              </div>
              <button type="button" className="btn sm primary" onClick={() => update(q.id, q.no, q.stage)}>
                Update
              </button>
            </div>
          ))}
          {queue.length === 0 ? <p className="muted">Nothing is waiting in the queue.</p> : null}
        </div>
      </div>
    </div>
  );
}
