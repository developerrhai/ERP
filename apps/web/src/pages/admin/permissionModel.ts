// Pure model behind Permission Master: turns a role's API rows into an editable draft (the `*`
// row plus per-family tri-state cells, null = inherit) and back into the PUT /permissions rows.
import { ACTIONS, type Action, type ActionSet, type PermissionRow, type Scope } from '../../types';
import type { PermissionRowInput } from './adminApi';

export type CellState = 'inherit' | 'allow' | 'deny';

/** The role default row: every cell and the scope are always set. */
export type StarRow = ActionSet & { resource: '*'; scope: Scope };

export interface RoleDraft {
  star: StarRow;
  /** family name → only the explicitly set actions (absent = inherit = null on the server). */
  overrides: Record<string, Partial<ActionSet>>;
  /** scope stored on each family row (null = inherit; not edited by this UI). */
  familyScopes: Record<string, Scope | null>;
  /** rows this UI does not edit (e.g. page:<id>), passed through unchanged, nulls included. */
  passthrough: PermissionRowInput[];
}

const FAMILY_PREFIX = 'family:';

function strip(row: PermissionRow): PermissionRowInput {
  const out = { resource: row.resource, scope: row.scope } as PermissionRowInput;
  for (const a of ACTIONS) out[a] = row[a];
  return out;
}

export function emptyStar(): StarRow {
  const out = { resource: '*', scope: 'OWN' } as StarRow;
  for (const a of ACTIONS) out[a] = false;
  return out;
}

function toStar(row: PermissionRow | undefined): StarRow {
  if (!row) return emptyStar();
  const out = { resource: '*', scope: row.scope ?? 'OWN' } as StarRow;
  for (const a of ACTIONS) out[a] = row[a] === true;
  return out;
}

export function draftFromRows(rows: PermissionRow[]): RoleDraft {
  const star = toStar(rows.find((r) => r.resource === '*'));
  const overrides: RoleDraft['overrides'] = {};
  const familyScopes: RoleDraft['familyScopes'] = {};
  const passthrough: PermissionRowInput[] = [];
  for (const row of rows) {
    if (row.resource === '*') continue;
    if (!row.resource.startsWith(FAMILY_PREFIX)) {
      passthrough.push(strip(row));
      continue;
    }
    const family = row.resource.slice(FAMILY_PREFIX.length);
    familyScopes[family] = row.scope;
    const set: Partial<ActionSet> = {};
    for (const a of ACTIONS) {
      const v = row[a];
      if (v !== null) set[a] = v;
    }
    overrides[family] = set;
  }
  return { star, overrides, familyScopes, passthrough };
}

export function cellState(draft: RoleDraft, family: string, action: Action): CellState {
  const v = draft.overrides[family]?.[action];
  if (v === undefined) return 'inherit';
  return v ? 'allow' : 'deny';
}

export function nextState(state: CellState): CellState {
  return state === 'inherit' ? 'allow' : state === 'allow' ? 'deny' : 'inherit';
}

/** Effective value of a cell (what the user actually gets for that family). */
export function effective(draft: RoleDraft, family: string, action: Action): boolean {
  return draft.overrides[family]?.[action] ?? draft.star[action];
}

export function withCell(
  draft: RoleDraft,
  family: string,
  action: Action,
  state: CellState,
): RoleDraft {
  const current = { ...(draft.overrides[family] ?? {}) };
  if (state === 'inherit') delete current[action];
  else current[action] = state === 'allow';
  return { ...draft, overrides: { ...draft.overrides, [family]: current } };
}

export function withStar(draft: RoleDraft, patch: Partial<StarRow>): RoleDraft {
  return { ...draft, star: { ...draft.star, ...patch } };
}

export function overrideCount(draft: RoleDraft): number {
  return Object.values(draft.overrides).reduce((n, o) => n + Object.keys(o).length, 0);
}

/**
 * Rows for PUT /permissions/:role. Inherited cells are sent as null; a family row whose action
 * cells are all null is omitted (orchestrator decision), even if it carried a scope.
 */
export function rowsFromDraft(draft: RoleDraft): PermissionRowInput[] {
  const rows: PermissionRowInput[] = [{ ...draft.star }];
  for (const [family, set] of Object.entries(draft.overrides)) {
    if (Object.keys(set).length === 0) continue;
    const scope = draft.familyScopes[family] ?? null;
    const row = { resource: `${FAMILY_PREFIX}${family}`, scope } as PermissionRowInput;
    for (const a of ACTIONS) row[a] = set[a] ?? null;
    rows.push(row);
  }
  return [...rows, ...draft.passthrough];
}
