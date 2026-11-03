// apps/web/src/pages/generic/kit/lineKinds.test.ts
// Unit tests for line-kind registry (docs/plans/07-ENGINE-KIT.md §12 T-KIT-09)

import { beforeEach, describe, expect, it } from 'vitest';
import type { LineKindSpec } from './lineKinds';
import { getLineKind, registerLineKind, resetLineKindsForTest } from './lineKinds';

describe('T-KIT-09: lineKinds registry', () => {
  beforeEach(() => {
    resetLineKindsForTest();
  });

  const dummySpec: LineKindSpec = {
    kind: 'test-line',
    columns: [
      { key: 'item', label: 'Item', type: 'lookup', lookup: 'items' },
      { key: 'qty', label: 'Quantity', type: 'qty' },
    ],
    newLine: () => ({ item: '', qty: 1 }),
    isEditable: (status: string) => status === 'Draft',
  };

  it('registers and retrieves a line kind specification', () => {
    registerLineKind(dummySpec);
    const spec = getLineKind('test-line');
    expect(spec).toBeDefined();
    expect(spec?.kind).toBe('test-line');
    expect(spec?.columns).toHaveLength(2);
  });

  it('throws when registering a duplicate line kind', () => {
    registerLineKind(dummySpec);
    expect(() => registerLineKind(dummySpec)).toThrow('KIT: Line kind "test-line" is already registered.');
  });

  it('clears registry on resetLineKindsForTest', () => {
    registerLineKind(dummySpec);
    resetLineKindsForTest();
    expect(getLineKind('test-line')).toBeUndefined();
  });
});
