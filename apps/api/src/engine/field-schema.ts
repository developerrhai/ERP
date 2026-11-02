// Turns a registry page profile into typed field metadata (docs/phase3-4 B1): label -> type
// (classify.ts), keys, constraints, enum options, lookup targets, plus the page-level data the
// schema endpoint returns (tabs, statuses, status transitions, list columns). Built once per page.
import { pageInfo, profileOf } from '../core/registry';
import { classifyFields, isMasterPage } from './classify';
import { FIELD_TYPES } from './field-types';
import type { FieldMeta, FieldType } from './field-types';
import { uniqueKeys } from './keys';
import { kindOf } from './kinds';
import type { PageKind } from './kinds';
import { enumOptionsFor } from './overrides';
import { AADHAAR_RE, DATE_RE, HSN_RE, IFSC_RE, PAN_RE, PHONE_RE, UAN_RE } from './validators';

export interface SchemaAction {
  key: string;
  label: string;
  variant: string;
  confirm: string | null;
  allowedFrom: string[];
  /** The page permission the action needs: `edit` for most, `delete` for undoing stock that moved. */
  requires: 'edit' | 'delete';
  /** If set, `requires` applies only from these statuses; from the others `edit` is enough. */
  requiresFrom?: string[];
}

export interface PageSchema {
  pageId: string;
  title: string;
  family: string;
  purpose: string;
  kind: PageKind;
  /** Masters start Active, transactional pages start Draft. */
  master: boolean;
  tabs: string[];
  fields: FieldMeta[];
  statuses: string[];
  /** Statuses in which a record can still be edited (Cancelled and Completed are locked). */
  editableStatuses: string[];
  /** Allowed status changes: from -> [to, ...] (POST /records/:id/status). */
  transitions: Record<string, string[]>;
  actions: SchemaAction[];
  listColumns: string[];
}

export const MASTER_STATUSES = ['Active', 'Inactive'];
export const EDITABLE_STATUSES = ['Draft', 'Active', 'Inactive', 'Open', 'Pending'];
export const TRANSACTIONAL_STATUSES = ['Draft', 'Active', 'Inactive', 'Cancelled'];

/**
 * Status changes the generic engine allows (docs/phase3-4 B3). Approved / Rejected belong to the
 * approval workflow (Phase 6) and are never a target here. Pending and Open are never set by this
 * engine; they are listed so rows created by later phases can still move on.
 */
export const STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  Draft: ['Active', 'Cancelled'],
  Active: ['Inactive'],
  Inactive: ['Active'],
  Open: ['Completed'],
  Pending: ['Open', 'Cancelled'],
};

/** Max stored size of one text value; a short text is 200 characters, a long one 4000. */
export const TEXT_MAX = 200;
export const LONGTEXT_MAX = 4000;
export const MONEY_MAX = 99_999_999_999_999;
export const QTY_MAX = 99_999_999_999_999;

/** Money fields that may be negative (adjustments and variances). */
const SIGNED_LABEL = /variance|adjust|difference|movement|profit|savings/i;

/** Master pages that `ref` fields can point at, by the label's last word(s). */
const REF_PAGES: readonly (readonly [RegExp, string])[] = [
  [/customer( name| id)?$/i, 'crm-customer360'],
  [/(vendor|supplier)( name| id)?$/i, 'scm-suppliers'],
  [/item( name| id)?$/i, 'inv-items'],
  [/warehouse( name| id)?$/i, 'wms-warehouses'],
  [/employee( name| id)?$/i, 'hr-employees'],
  [/department( name)?$/i, 'admin-departments'],
  [/(branch|unit)( name)?$/i, 'admin-branches'],
];

function constraintsFor(type: FieldType, label: string): Partial<FieldMeta> {
  switch (type) {
    case 'code':
      return { maxLength: 60 };
    case 'date':
      return { pattern: DATE_RE.source };
    case 'money':
      return { min: SIGNED_LABEL.test(label) ? -MONEY_MAX : 0, max: MONEY_MAX };
    case 'pct':
      return { min: 0, max: 100 };
    case 'qty':
      return { min: 0, max: QTY_MAX };
    case 'email':
      return { maxLength: 254 };
    case 'phone':
      return { pattern: PHONE_RE.source };
    case 'gstin':
      return { pattern: '^\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$', maxLength: 15 };
    case 'pan':
      return { pattern: PAN_RE.source, maxLength: 10 };
    case 'ifsc':
      return { pattern: IFSC_RE.source, maxLength: 11 };
    case 'hsn':
      return { pattern: HSN_RE.source };
    case 'aadhaar':
      return { pattern: AADHAAR_RE.source, maxLength: 12 };
    case 'uan':
      return { pattern: UAN_RE.source, maxLength: 12 };
    case 'longtext':
      return { maxLength: LONGTEXT_MAX };
    case 'status':
    case 'datetime':
    case 'bool':
      return {};
    default:
      return { maxLength: TEXT_MAX };
  }
}

function buildFields(pageId: string, labels: readonly string[], statuses: string[]): FieldMeta[] {
  const classified = classifyFields(pageId, labels);
  const keys = uniqueKeys(labels);
  return classified.map((field, index): FieldMeta => {
    const meta: FieldMeta = {
      key: keys[index] ?? `field${index}`,
      label: field.label,
      type: field.type,
      required: field.required,
      readOnly: field.type === 'code' || field.type === 'status',
      ...constraintsFor(field.type, field.label),
    };
    if (field.type === 'status') {
      // Only the field labelled exactly "Status" has this type: it is the record.status column,
      // changed by status actions, never typed in the form.
      meta.options = [...statuses];
      meta.required = false;
    }
    if (field.type === 'enum') {
      const options = enumOptionsFor(pageId, field.label);
      if (options) {
        meta.options = options;
        delete meta.maxLength;
      }
    }
    if (field.type === 'ref') {
      const target = REF_PAGES.find(([pattern]) => pattern.test(field.label))?.[1];
      if (target) meta.refPage = target;
    }
    return meta;
  });
}

const cache = new Map<string, PageSchema | null>();

/** The schema of a page, or null when the page does not exist. Pages without a profile get no fields. */
export function buildPageSchema(pageId: string): PageSchema | null {
  if (cache.has(pageId)) return cache.get(pageId) ?? null;
  const page = pageInfo(pageId);
  const kind = kindOf(pageId);
  if (!page || !kind) {
    cache.set(pageId, null);
    return null;
  }
  const profile = profileOf(pageId);
  const labels = profile?.fields ?? [];
  const master = isMasterPage(labels[0]);
  const statuses = master ? MASTER_STATUSES : TRANSACTIONAL_STATUSES;
  const fields = buildFields(pageId, labels, statuses);
  const schema: PageSchema = {
    pageId,
    title: page.title,
    family: page.family,
    purpose: profile?.purpose ?? '',
    kind,
    master,
    tabs: [...(profile?.tabs ?? [])],
    fields,
    statuses: [...statuses],
    editableStatuses: [...EDITABLE_STATUSES],
    transitions: Object.fromEntries(
      Object.entries(STATUS_TRANSITIONS).map(([from, to]) => [from, [...to]]),
    ),
    actions: [],
    listColumns: fields.slice(0, 12).map((f) => f.key),
  };
  cache.set(pageId, schema);
  return schema;
}

export function fieldTypeCounts(schemas: readonly PageSchema[]): Record<FieldType, number> {
  const counts = Object.fromEntries(FIELD_TYPES.map((t) => [t, 0])) as Record<FieldType, number>;
  for (const schema of schemas) for (const f of schema.fields) counts[f.type] += 1;
  return counts;
}

/** `PFX` of a code: the first 3 letters of the page title, upper case, letters only. */
export function codePrefix(title: string): string {
  const letters = title.replace(/[^A-Za-z]/g, '').toUpperCase();
  return (letters.slice(0, 3) || 'REC').padEnd(3, 'X');
}
