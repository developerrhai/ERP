// Drawer sections: the child rows of the open record (EMI schedule, pick tasks, why chain).
import { useEffect, useState } from 'react';
import { getDetails, type DetailSectionData } from '../../lib/screensApi';
import { Pill } from '../finance/shared';
import { formatCell } from './ScreenPage';

export function DetailSections({ pageId, id }: { pageId: string; id: string }) {
  const [sections, setSections] = useState<DetailSectionData[]>([]);

  useEffect(() => {
    let alive = true;
    getDetails(pageId, id)
      .then((s) => alive && setSections(s))
      .catch(() => alive && setSections([]));
    return () => {
      alive = false;
    };
  }, [pageId, id]);

  return (
    <>
      {sections.map((s) => (
        <section key={s.title} aria-label={s.title}>
          <h3>{s.title}</h3>
          <table>
            <thead>
              <tr>
                {s.columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={s.columns.length}>Nothing here yet.</td>
                </tr>
              ) : (
                s.rows.map((row, i) => (
                  <tr key={i}>
                    {s.columns.map((c) => (
                      <td key={c.key}>
                        {c.type === 'status' && typeof row[c.key] === 'string' ? (
                          <Pill>{String(row[c.key])}</Pill>
                        ) : (
                          formatCell(row[c.key], c.type)
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
