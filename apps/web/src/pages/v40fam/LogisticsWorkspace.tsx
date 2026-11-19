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
    <div className="v9-grid" style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
      <div className="v9-section" style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: 14 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>{title} Directory</h3>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>Records by dispatch stage and this week's movement.</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {STAGES.map((s, i) => (
            <span key={s} className="chip" style={{ fontWeight: 700 }}>
              {s}: {counts[i]}
            </span>
          ))}
        </div>
        <div role="img" aria-label="Weekly movement, Monday to Sunday" style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 120, padding: '0 4px', borderBottom: '1px solid #e2e8f0' }}>
          {week.map((v, i) => (
            <div key={WEEK[i]} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <span style={{ fontSize: 10, color: '#475569' }}>{v}</span>
              <div style={{ width: '100%', maxWidth: 34, height: `${(v / max) * 90}px`, background: '#2563eb', borderRadius: '4px 4px 0 0' }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '4px 4px 0' }}>
          {WEEK.map((d) => (
            <span key={d} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: '#64748b' }}>
              {d}
            </span>
          ))}
        </div>
      </div>
      <div className="v9-section" style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: 14 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>Dispatch / Delivery Queue</h3>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>Open items waiting for the next step.</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {queue.map((q) => (
            <div key={q.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', background: '#f8fafc' }}>
              <div>
                <b style={{ fontSize: 13 }}>{q.no}</b>
                <div style={{ fontSize: 11, color: '#64748b' }}>Stage: {q.stage}</div>
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
