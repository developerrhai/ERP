// Small shared pieces of the Phase 14 screens: status colours, option lists for assets / people / units / accounts.
import { alist, aget } from '../../lib/assetApi';
import type { Option, Row } from '../../lib/assetApi';
import { useLoad } from '../../lib/useLoad';
import { OptionSelect, s } from '../mfg/Kit';

export { s };
export { Act, Dialog, Grid, ReasonAct, addDays, hhmm, num } from '../mfg/Ui';
export { FormModal } from '../mfg/Kit';

export const TONE: Record<string, string> = {
  CWIP: 'draft',
  ACTIVE: 'approved',
  IDLE: 'pending',
  UNDER_MAINT: 'pending',
  DISPOSED: 'cancelled',
  OPEN: 'pending',
  ACK: 'pending',
  IN_REPAIR: 'pending',
  RESOLVED: 'approved',
  CLOSED: 'approved',
  CANCELLED: 'cancelled',
  PLANNED: 'draft',
  APPROVED: 'approved',
  IN_PROGRESS: 'pending',
  COMPLETED: 'approved',
  DRAFT: 'draft',
  POSTED: 'approved',
  REVERSED: 'cancelled',
  ALLOCATED: 'pending',
  RETURNED: 'approved',
  PENDING: 'pending',
  REJECTED: 'cancelled',
  WO_CREATED: 'pending',
  DONE: 'approved',
  SKIPPED: 'cancelled',
  COMPLETED_: 'approved',
  GOOD: 'approved',
  WATCH: 'pending',
  DOWN: 'cancelled',
};

const asOptions = (rows: Row[] | null, label: (r: Row) => string): Option[] =>
  (rows ?? []).map((r) => ({ id: s(r.id), label: label(r) }));

export function useAssetOptions(maintainable?: boolean) {
  return useLoad(
    async () =>
      asOptions(
        (await alist('/assets/lookup', { size: 200, ...(maintainable ? { maintainable } : {}) }))
          .rows,
        (r) => `${s(r.assetNo)} · ${s(r.name)}`,
      ),
    [maintainable],
  );
}
export function useUserOptions() {
  return useLoad(
    async () => asOptions(await aget<Row[]>('/assets/lookup-users'), (r) => s(r.name)),
    [],
  );
}
export function useUnitOptions() {
  return useLoad(
    async () =>
      asOptions(await aget<Row[]>('/assets/lookup-units'), (r) => `${s(r.code)} · ${s(r.name)}`),
    [],
  );
}
export function useCostCentreOptions() {
  return useLoad(
    async () =>
      asOptions(
        await aget<Row[]>('/assets/lookup-cost-centres'),
        (r) => `${s(r.code)} · ${s(r.name)}`,
      ),
    [],
  );
}
export function useAccountOptions() {
  return useLoad(
    async () =>
      (await aget<Row[]>('/assets/lookup-accounts')).map((r) => ({
        id: s(r.code),
        label: `${s(r.code)} · ${s(r.name)}`,
      })),
    [],
  );
}

export function AssetSelect({
  id,
  value,
  onChange,
  maintainable,
  blank,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  maintainable?: boolean;
  blank?: string;
}) {
  const opts = useAssetOptions(maintainable);
  return (
    <OptionSelect
      id={id}
      value={value}
      options={opts.data ?? []}
      onChange={onChange}
      {...(blank ? { blank } : {})}
    />
  );
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10);
export const isoNow = (): string => new Date().toISOString();
/** A datetime-local value (no zone) as an ISO instant. */
export const localToIso = (v: string): string => new Date(v).toISOString();
