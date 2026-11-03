// The field vocabulary of the metadata engine (docs/phase3-4 B1, docs/plan/04-modules.md §4.0.2):
// the 20 field types and the metadata shape the schema endpoint returns for each field.
export const FIELD_TYPES = [
  'code',
  'status',
  'date',
  'datetime',
  'money',
  'pct',
  'qty',
  'ref',
  'email',
  'phone',
  'gstin',
  'pan',
  'ifsc',
  'hsn',
  'aadhaar',
  'uan',
  'bool',
  'enum',
  'text',
  'longtext',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldMeta {
  /** camelCase key used in the record's `data` object (unique within the page). */
  key: string;
  /** The label exactly as the registry profile has it. */
  label: string;
  type: FieldType;
  required: boolean;
  /** code and status are never typed in a form. */
  readOnly: boolean;
  options?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  /** For `ref` fields that point to a known master page (later phases make these real lookups). */
  refPage?: string;
  /**
   * Typed pages: the value is the id of a referenced entity, found with
   * GET /lookups/<lookup>?q=. Without it a `ref` is free text.
   */
  lookup?: string;
  /** Display-only suffix shown next to input, e.g. '/10'. */
  suffix?: string;
}

/** Types stored as numbers in `data`. */
export const NUMERIC_TYPES: ReadonlySet<FieldType> = new Set(['money', 'pct', 'qty']);
