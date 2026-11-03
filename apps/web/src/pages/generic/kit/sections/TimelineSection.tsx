// apps/web/src/pages/generic/kit/sections/TimelineSection.tsx
// Event timeline section (docs/plans/07-ENGINE-KIT.md §2.3)

import type { Kpi } from '../panelTypes';

export function TimelineSection({
  title,
  events,
}: {
  title?: string;
  events: {
    at: string;
    title: string;
    detail?: string;
    by?: string;
    tone?: Kpi['tone'];
  }[];
}) {
  return (
    <div className="v9-section timeline-section">
      {title ? <h3>{title}</h3> : null}
      {events.length === 0 ? (
        <p className="v9-muted">No timeline events.</p>
      ) : (
        <div className="v9-timeline" role="list" aria-label={title ?? 'Timeline'}>
          {events.map((e, idx) => {
            const dotColor =
              e.tone === 'good'
                ? '#16a34a'
                : e.tone === 'warn'
                  ? '#ca8a04'
                  : e.tone === 'bad'
                    ? '#dc2626'
                    : '#2563eb';

            return (
              <div key={`${e.at}-${idx}`} className="v9-event" role="listitem">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <b style={{ color: dotColor }}>{e.title}</b>
                  <small style={{ fontSize: '9px', color: 'var(--muted)', marginLeft: '8px' }}>{e.at}</small>
                </div>
                {e.detail ? <p style={{ margin: '4px 0 0', fontSize: '10px' }}>{e.detail}</p> : null}
                {e.by ? <small style={{ display: 'block', color: 'var(--muted)', marginTop: '4px' }}>by {e.by}</small> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
