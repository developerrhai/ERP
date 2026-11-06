// Permission Master model: null cells mean inherit (orchestrator decision), rows ⇄ draft
// round-trip, inherit → allow → deny cycling, and the rows sent to PUT /permissions/:role.
import { describe, expect, it } from 'vitest';
import { ACTIONS, type Action, type PermissionRow } from '../../types';
import {
  cellState,
  changedOverrideCells,
  draftFromRows,
  effective,
  nextState,
  overrideCount,
  rowsFromDraft,
  withCell,
  withStar,
} from './permissionModel';

/** cells: action → true/false; actions not listed are null (inherit) unless `fill` is given. */
function row(
  resource: string,
  cells: Partial<Record<Action, boolean>>,
  scope: PermissionRow['scope'],
  version = 1,
  fill: boolean | null = null,
): PermissionRow {
  const r = { resource, scope, version } as PermissionRow;
  for (const a of ACTIONS) r[a] = cells[a] ?? fill;
  return r;
}

const manager: PermissionRow[] = [
  row('*', { controls: false }, 'DEPARTMENT', 3, true),
  row('family:Administration', {}, 'DEPARTMENT', 4, false),
  row('family:Sales', { delete: false }, null, 5),
];

const strip = (rows: PermissionRow[]) =>
  rows.map((r) => {
    const copy: Partial<PermissionRow> = { ...r };
    delete copy.version;
    return copy;
  });

describe('permissionModel', () => {
  it('reads null cells as inherit and booleans as explicit allow/deny', () => {
    const d = draftFromRows(manager);
    expect(cellState(d, 'Administration', 'view')).toBe('deny');
    expect(cellState(d, 'Administration', 'controls')).toBe('deny');
    expect(cellState(d, 'Sales', 'delete')).toBe('deny');
    expect(cellState(d, 'Sales', 'view')).toBe('inherit');
    expect(cellState(d, 'CRM', 'view')).toBe('inherit');
    expect(effective(d, 'Sales', 'view')).toBe(true);
    expect(effective(d, 'Sales', 'delete')).toBe(false);
    expect(overrideCount(d)).toBe(13);
  });

  it('an explicit value equal to * stays explicit (no "equals * means inherit" guess)', () => {
    const d = draftFromRows([
      row('*', {}, 'ALL', 1, true),
      row('family:CRM', { view: true }, null),
    ]);
    expect(cellState(d, 'CRM', 'view')).toBe('allow');
  });

  it('round-trips without changes, nulls included', () => {
    expect(rowsFromDraft(draftFromRows(manager))).toEqual(strip(manager));
  });

  it('cycles inherit → allow → deny → inherit', () => {
    expect(nextState('inherit')).toBe('allow');
    expect(nextState('allow')).toBe('deny');
    expect(nextState('deny')).toBe('inherit');
  });

  it('sends inherited cells as null and omits family rows that are all null', () => {
    let d = draftFromRows(manager);
    d = withCell(d, 'CRM', 'approve', 'allow');
    const crm = rowsFromDraft(d).find((r) => r.resource === 'family:CRM');
    expect(crm).toMatchObject({ approve: true, view: null, delete: null, scope: null });
    d = withCell(d, 'Sales', 'delete', 'inherit');
    expect(rowsFromDraft(d).find((r) => r.resource === 'family:Sales')).toBeUndefined();
  });

  it('keeps a family row scope when it has explicit cells', () => {
    const rows = rowsFromDraft(draftFromRows(manager));
    expect(rows.find((r) => r.resource === 'family:Administration')?.scope).toBe('DEPARTMENT');
  });

  it('edits the * row (actions and scope); * never has nulls', () => {
    const d = withStar(draftFromRows(manager), { delete: false, scope: 'OWN' });
    const star = rowsFromDraft(d)[0];
    expect(star).toMatchObject({ resource: '*', delete: false, scope: 'OWN' });
    expect(ACTIONS.every((a) => typeof star?.[a] === 'boolean')).toBe(true);
  });

  it('passes page-level rows through untouched, nulls included', () => {
    const page = row('page:crm-leads', { view: true }, null, 2);
    const out = rowsFromDraft(draftFromRows([...manager, page])).at(-1);
    expect(out).toEqual(strip([page])[0]);
  });
});

describe('permissionModel review fixes', () => {
  it('keeps a scope-only family row (all action cells null, scope set)', () => {
    const rows = [row('*', {}, 'DEPARTMENT', 1, true), row('family:CRM', {}, 'OWN', 2)];
    expect(rowsFromDraft(draftFromRows(rows)).find((r) => r.resource === 'family:CRM')).toEqual({
      ...strip([rows[1] as PermissionRow])[0],
    });
  });

  it('drops a family row only when cells and scope are all null', () => {
    let d = draftFromRows(manager);
    d = withCell(d, 'Sales', 'delete', 'inherit');
    expect(rowsFromDraft(d).some((r) => r.resource === 'family:Sales')).toBe(false);
  });

  it('counts unsaved family-override cells against the saved state', () => {
    const original = draftFromRows(manager);
    let d = withCell(original, 'CRM', 'view', 'deny');
    d = withCell(d, 'Sales', 'delete', 'inherit');
    expect(changedOverrideCells(d, original)).toBe(2);
    expect(changedOverrideCells(withStar(original, { add: false }), original)).toBe(0);
  });
});
