// apps/api/src/kit/schema.ts
// Kit schema helper (docs/plans/07-ENGINE-KIT.md §2.1 & T-KIT-02)

import type { TypedSchema } from '../modules/inventory/definitions';

type Overridable = 'readOnly' | 'master' | 'filters' | 'totals' | 'views' | 'transitions' | 'listColumns' | 'actions';

export type KitSchemaInput = Omit<TypedSchema, 'kind' | Overridable> &
  Partial<Pick<TypedSchema, Overridable>>;

/**
 * Creates a TypedSchema for a kit module page.
 * Sets kind: 'typed', defaults overridables to empty arrays/objects/false,
 * and derives listColumns as the first 11 non-status fields plus the status field if not explicitly given.
 */
export function defineKitSchema(def: KitSchemaInput): TypedSchema {
  const nonStatusKeys = def.fields
    .filter((f) => f.key !== 'status' && f.type !== 'status')
    .map((f) => f.key);
  const statusKey = def.fields.find((f) => f.key === 'status' || f.type === 'status')?.key ?? 'status';
  const defaultListColumns = [...nonStatusKeys.slice(0, 11), statusKey];

  return {
    readOnly: false,
    master: false,
    filters: [],
    totals: [],
    views: [],
    transitions: {},
    actions: [],
    ...def,
    kind: 'typed',
    listColumns: def.listColumns ?? defaultListColumns,
  };
}
