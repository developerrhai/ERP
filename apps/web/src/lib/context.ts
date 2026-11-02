// Working-context store (company / unit / FY, Phase 3 A3): loaded from GET /me/context when the
// shell mounts, changed via PUT /me/context; `epoch` bumps on a change so the page refetches.
import { useSyncExternalStore } from 'react';
import type { CurrentContext, MeContext } from '../types';
import { api, ApiError } from './api';
import { setContextHeaders } from './context-headers';

export interface ContextState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: MeContext | null;
  error: string;
  /** Incremented after every successful context change; the shell remounts the page on it. */
  epoch: number;
}

const INITIAL: ContextState = { status: 'idle', data: null, error: '', epoch: 0 };
let state: ContextState = INITIAL;
let generation = 0;
const listeners = new Set<() => void>();

function emit(next: ContextState): void {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getState(): ContextState {
  return state;
}

const isContextError = (err: unknown): boolean =>
  err instanceof ApiError && (err.code === 'CONTEXT_FORBIDDEN' || err.code === 'CONTEXT_INVALID');

/**
 * (Re)loads the context. If the headers we send became invalid (unit deactivated, FY removed),
 * retry once without them so the server falls back to the preference / default.
 */
export async function loadContext(): Promise<void> {
  const mine = ++generation;
  emit({ ...state, status: state.data ? 'ready' : 'loading', error: '' });
  try {
    let data: MeContext;
    try {
      data = await api<MeContext>('/me/context');
    } catch (err) {
      if (!isContextError(err)) throw err;
      setContextHeaders(null);
      data = await api<MeContext>('/me/context');
    }
    if (mine !== generation) return;
    setContextHeaders(data.current);
    emit({ ...state, status: 'ready', data, error: '' });
  } catch (err) {
    if (mine !== generation) return;
    emit({
      ...state,
      status: 'error',
      error: err instanceof ApiError ? err.message : 'Could not load the working context.',
    });
  }
}

/**
 * Saves the chosen unit / FY (PUT /me/context), switches the request headers and bumps the
 * epoch so the current page refetches. Throws the ApiError when the server refuses.
 */
export async function changeContext(next: CurrentContext): Promise<void> {
  const res = await api<Partial<MeContext> & Partial<CurrentContext>>('/me/context', {
    method: 'PUT',
    body: next,
  });
  // The API may answer with the full context, just the current pair, or nothing (204).
  const current: CurrentContext =
    res?.current ??
    (res && typeof res.fyId === 'string' ? { unitId: res.unitId ?? null, fyId: res.fyId } : next);
  generation += 1; // an older in-flight load must not overwrite this choice
  setContextHeaders(current);
  const full = res?.units && res.fys && res.company ? (res as MeContext) : null;
  const base = full ?? state.data;
  emit({
    status: 'ready',
    data: base ? { ...base, current } : null,
    error: '',
    epoch: state.epoch + 1,
  });
}

export function resetContext(): void {
  generation += 1;
  setContextHeaders(null);
  emit(INITIAL);
}

export function useAppContext(): ContextState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export const ALL_UNITS_LABEL = 'All Units';

/** Display names of the current unit and FY ("All Units" for null), or null before loading. */
export function contextLabels(data: MeContext | null): { unit: string; fy: string } | null {
  if (!data) return null;
  const { unitId, fyId } = data.current;
  const unit = unitId ? (data.units.find((u) => u.id === unitId)?.name ?? '—') : ALL_UNITS_LABEL;
  const fy = data.fys.find((f) => f.id === fyId)?.label ?? '—';
  return { unit, fy };
}

export function resetContextForTests(): void {
  generation += 1;
  setContextHeaders(null);
  state = INITIAL;
  listeners.clear();
}
