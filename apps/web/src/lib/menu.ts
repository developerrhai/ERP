// Server-driven sidebar menu (GET /me/menu, Phase 2 §4). One shared store so any admin save
// that affects access can call refreshMenu() and the sidebar updates immediately.
import { useSyncExternalStore } from 'react';
import type { MenuFamily } from '../types';
import { api, ApiError } from './api';

export interface MenuState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  families: MenuFamily[];
  error: string;
}

let state: MenuState = { status: 'idle', families: [], error: '' };
let generation = 0;
const listeners = new Set<() => void>();

function emit(next: MenuState): void {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getMenu(): MenuState {
  return state;
}

/** (Re)loads the menu; a newer call always wins over an older in-flight one. */
export async function refreshMenu(): Promise<void> {
  const mine = ++generation;
  emit({ ...state, status: state.status === 'ready' ? 'ready' : 'loading', error: '' });
  try {
    const data = await api<{ families: MenuFamily[] }>('/me/menu');
    if (mine === generation) emit({ status: 'ready', families: data.families, error: '' });
  } catch (err) {
    if (mine !== generation) return;
    emit({
      status: 'error',
      families: state.families,
      error: err instanceof ApiError ? err.message : 'Could not load the menu.',
    });
  }
}

export function resetMenu(): void {
  generation += 1;
  emit({ status: 'idle', families: [], error: '' });
}

export function useMenu(): MenuState {
  return useSyncExternalStore(subscribe, getMenu, getMenu);
}

export function resetMenuForTests(): void {
  generation += 1;
  state = { status: 'idle', families: [], error: '' };
  listeners.clear();
}
