// apps/web/src/pages/generic/kit/sections/CalendarSection.tsx
// Monthly calendar view for schedule and delivery dates (docs/plans/07-ENGINE-KIT.md §2.3)

import type { Kpi } from '../panelTypes';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarSection({
  title,
  month,
  days,
}: {
  title?: string;
  month: string; // YYYY-MM
  days: {
    date: string;
    items: { label: string; tone?: Kpi['tone']; ref?: string }[];
  }[];
}) {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);

  const daysInMonth = !isNaN(year) && !isNaN(monthNum) ? new Date(year, monthNum, 0).getDate() : 30;
  const startDay = !isNaN(year) && !isNaN(monthNum) ? new Date(year, monthNum - 1, 1).getDay() : 0;

  const dayMap = new Map<string, { label: string; tone?: Kpi['tone']; ref?: string }[]>();
  for (const d of days) {
    dayMap.set(d.date, d.items);
  }

  return (
    <div className="v9-section calendar-section">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
        }}
      >
        {title ? <h3>{title}</h3> : <span />}
        <b style={{ fontSize: '12px' }}>{month}</b>
      </div>

      {days.length === 0 ? (
        <p className="v9-muted">No calendar events for {month}.</p>
      ) : (
        <div
          className="calendar"
          role="grid"
          aria-label={title ?? `Calendar for ${month}`}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '4px',
            fontSize: '9px',
          }}
        >
          {WEEKDAYS.map((wd) => (
            <div
              key={wd}
              style={{
                textAlign: 'center',
                fontWeight: 'bold',
                padding: '4px',
                color: 'var(--muted)',
              }}
            >
              {wd}
            </div>
          ))}

          {Array.from({ length: startDay }).map((_, i) => (
            <div key={`empty-${i}`} style={{ minHeight: '48px', opacity: 0.2 }} />
          ))}

          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const dateStr = `${month}-${String(dayNum).padStart(2, '0')}`;
            const items = dayMap.get(dateStr) ?? [];

            return (
              <div
                key={dateStr}
                className="day"
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '4px',
                  minHeight: '48px',
                  background: items.length > 0 ? 'var(--card2)' : 'var(--card)',
                }}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>{dayNum}</div>
                {items.map((it, itemIdx) => {
                  const bg =
                    it.tone === 'good'
                      ? '#dcfce7'
                      : it.tone === 'warn'
                        ? '#fef9c3'
                        : it.tone === 'bad'
                          ? '#fee2e2'
                          : '#e0e7ff';
                  const fg =
                    it.tone === 'good'
                      ? '#166534'
                      : it.tone === 'warn'
                        ? '#854d0e'
                        : it.tone === 'bad'
                          ? '#991b1b'
                          : '#3730a3';

                  return (
                    <div
                      key={`${it.label}-${itemIdx}`}
                      style={{
                        fontSize: '8px',
                        background: bg,
                        color: fg,
                        borderRadius: '3px',
                        padding: '1px 3px',
                        marginBottom: '2px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={it.label}
                    >
                      {it.label}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
