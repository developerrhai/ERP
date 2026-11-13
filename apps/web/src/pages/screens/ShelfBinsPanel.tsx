// Shelf drawer: the bins that sit on this shelf, and a picker to place another bin on it.
import { useCallback, useEffect, useId, useState } from 'react';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import {
  getShelfBins,
  lookupOptions,
  placeShelfBin,
  removeShelfBin,
  type LookupOption,
  type ShelfBins,
} from '../../lib/screensApi';

export function ShelfBinsPanel({ shelfId, canEdit }: { shelfId: string; canEdit: boolean }) {
  const toast = useToast();
  const id = useId();
  const [data, setData] = useState<ShelfBins | null>(null);
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await getShelfBins(shelfId);
      setData(d);
      const opts = await lookupOptions('wms-shelves', 'bins', { parent: d.warehouseId });
      setOptions(opts.filter((o) => !d.bins.some((b) => b.id === o.id)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the bins.');
    }
  }, [shelfId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<ShelfBins>, done: string) {
    setError('');
    try {
      setData(await fn());
      setPick('');
      toast(done);
      void load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.binId ?? e.message) : 'Something went wrong.');
    }
  }

  return (
    <section aria-label="Bins on this shelf">
      <h3>Bins on this shelf</h3>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      {data && data.bins.length === 0 ? <p className="v8-sub">No bins on this shelf yet.</p> : null}
      <ul>
        {data?.bins.map((b) => (
          <li key={b.id}>
            {b.code} — {b.name}{' '}
            {canEdit ? (
              <button type="button" className="btn sm" onClick={() => void act(() => removeShelfBin(shelfId, b.id), 'Bin removed from the shelf.')}>
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <div className="field">
          <label htmlFor={id}>Place a bin on this shelf</label>
          <select id={id} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a bin…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>{' '}
          <button
            type="button"
            className="btn sm primary"
            disabled={pick === ''}
            onClick={() => void act(() => placeShelfBin(shelfId, pick), 'Bin placed on the shelf.')}
          >
            Place bin
          </button>
        </div>
      ) : null}
    </section>
  );
}
