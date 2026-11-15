// Move Forward pressed on the page bar with no row selected: choose which record of this page to move, then the normal
// Move Forward dialog opens for it. Records come from the document catalogue (sales, purchase, stores... documents)
// or, for other pages, from the page's own register. Nothing is invented: an empty page says so.
import { useEffect, useState } from 'react';
import { workApi } from '../lib/workApi';
import { Modal } from './Modal';

interface Item { id: string; number: string; status: string | null }

async function load(pageId: string, q: string): Promise<Item[]> {
  try {
    return await workApi.docPicker(pageId, q);
  } catch {
    return [];
  }
}

export function PickDocumentDialog({ pageId, onPick, onClose }: { pageId: string; onPick: (r: Item) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => void load(pageId, q).then((r) => alive && setItems(r)), 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pageId, q]);
  return (
    <Modal
      title="Move Forward"
      sub="Choose the document to move to the next department."
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <label>
        Search document number
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Document number" />
      </label>
      {items === null ? <p className="muted">Loading…</p> : null}
      {items?.length === 0 ? <p className="muted">There is no record on this page to move yet.</p> : null}
      {items && items.length > 0 ? (
        <table className="register-table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>{r.number}</td>
                <td>{r.status ?? '—'}</td>
                <td>
                  <button type="button" className="btn sm primary" aria-label={`Move Forward ${r.number}`} onClick={() => onPick(r)}>
                    Move Forward
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Modal>
  );
}
