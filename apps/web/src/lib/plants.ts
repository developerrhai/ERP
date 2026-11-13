// Phase 23: the plants the signed-in user may work in, and the ones chosen to view right now.
// GET /me/plants on sign-in, PUT /me/plants from the picker and the top bar. The chosen plants are sent
// as X-Units on every call (lib/context-headers.ts) and the open page is re-fetched (context epoch).
import { useSyncExternalStore } from 'react';
import { api } from './api';
import { bumpContextEpoch, loadContext } from './context';
import { setSelectedUnits } from './context-headers';

export interface PlantDto {
  id: string;
  code: string;
  name: string;
  city: string | null;
}

export interface MyPlants {
  allowed: PlantDto[];
  selected: string[];
  default: string | null;
  remember: boolean;
  needsPicker: boolean;
  accessType: 'Single plant' | 'Multi-plant';
  pending: Record<string, number | null>;
}

export interface PlantsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: MyPlants | null;
  /** true once the picker was answered (or skipped) in this browser session */
  chosen: boolean;
}

const CHOSEN_KEY = 'rhai.plants.chosen';
const readChosen = (): boolean => {
  try {
    return sessionStorage.getItem(CHOSEN_KEY) === '1';
  } catch {
    return false;
  }
};
const writeChosen = (v: boolean): void => {
  try {
    if (v) sessionStorage.setItem(CHOSEN_KEY, '1');
    else sessionStorage.removeItem(CHOSEN_KEY);
  } catch {
    /* private window: the picker just shows again on the next load */
  }
};

let state: PlantsState = { status: 'idle', data: null, chosen: readChosen() };
const listeners = new Set<() => void>();
const emit = (next: PlantsState): void => {
  state = next;
  for (const l of listeners) l();
};

/** The X-Units header only matters when 2+ plants are selected; one plant keeps using X-Unit-Id. */
function applyHeaders(data: MyPlants | null): void {
  setSelectedUnits(data && data.selected.length > 1 ? data.selected : []);
}

export async function loadPlants(): Promise<void> {
  emit({ ...state, status: state.data ? 'ready' : 'loading' });
  try {
    const data = await api<MyPlants>('/me/plants');
    applyHeaders(data);
    emit({ ...state, status: 'ready', data });
  } catch {
    emit({ ...state, status: 'error' });
  }
}

/** Saves the chosen plants; the page reloads its data (epoch) and the picker is not shown again this session. */
export async function choosePlants(selected: string[], remember: boolean): Promise<void> {
  const data = await api<MyPlants>('/me/plants', { method: 'PUT', body: { selected, remember } });
  applyHeaders(data);
  writeChosen(true);
  emit({ status: 'ready', data, chosen: true });
  await loadContext();
  bumpContextEpoch();
}

/** Admin changed this user's plants (SSE session.context_changed): re-read everything. */
export async function refreshPlantsAfterAdminChange(): Promise<void> {
  await loadPlants();
  await loadContext();
  bumpContextEpoch();
}

export function resetPlants(): void {
  writeChosen(false);
  applyHeaders(null);
  emit({ status: 'idle', data: null, chosen: false });
}

export function usePlants(): PlantsState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => state,
    () => state,
  );
}

/** True when the picker must be shown now: 2+ plants, not remembered, not answered yet this session. */
export function pickerNeeded(s: PlantsState): boolean {
  return s.status === 'ready' && !!s.data && s.data.needsPicker && !s.chosen;
}
