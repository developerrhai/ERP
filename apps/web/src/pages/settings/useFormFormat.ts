// The "customer-wise format" of a data-entry form (PHASE-06B §3.2): when the operator picks or changes
// the customer, the form asks the server for that customer's published FORM format and re-renders.
// A format header entry whose key matches a form field changes that field's label, required flag
// and visibility. No format, or any error, simply leaves the standard form alone.
import { useEffect, useState } from 'react';
import { listCustomers } from '../../lib/mastersApi';
import { resolveFormat, type ResolvedFormat } from '../../lib/settingsApi';

export interface FieldOverride {
  label?: string;
  required?: boolean;
  hidden?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUSTOMER_KEY = /^customer(Id|Name)?$/i;

export function customerFieldKey(fields: { key: string }[]): string | undefined {
  return fields.find((f) => CUSTOMER_KEY.test(f.key))?.key;
}

async function customerIdOf(value: string): Promise<string | null> {
  if (UUID.test(value)) return value;
  const { rows } = await listCustomers({ q: value, size: 5 });
  const hit = rows.find((c) => c.name.trim().toLowerCase() === value.trim().toLowerCase());
  return hit ? hit.id : null;
}

export function overridesOf(format: ResolvedFormat | null): Record<string, FieldOverride> {
  const out: Record<string, FieldOverride> = {};
  for (const h of format?.schema.header ?? []) {
    out[h.key] = {
      ...(h.label ? { label: h.label } : {}),
      required: h.required,
      hidden: h.hidden === true,
    };
  }
  return out;
}

export function useFormFormat(
  pageId: string,
  fields: { key: string }[],
  values: Record<string, unknown>,
): { format: ResolvedFormat | null; overrides: Record<string, FieldOverride> } {
  const key = customerFieldKey(fields);
  const raw = key ? values[key] : undefined;
  const customer = typeof raw === 'string' ? raw.trim() : '';
  const [format, setFormat] = useState<ResolvedFormat | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const customerId = customer ? await customerIdOf(customer) : null;
            const resolved = await resolveFormat(pageId, 'FORM', { customerId });
            if (alive) setFormat(resolved);
          } catch {
            if (alive) setFormat(null);
          }
        })();
      },
      customer ? 300 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [pageId, customer]);

  return { format, overrides: overridesOf(format) };
}
