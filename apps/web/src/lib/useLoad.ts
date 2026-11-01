// Tiny data-loading hook (loading / data / error / reload) so every admin page handles API
// state the same way without a data library; stale responses are ignored.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => void;
  setData: (next: T) => void;
}

export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    loadRef
      .current()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError('');
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass explicit deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload, setData };
}
