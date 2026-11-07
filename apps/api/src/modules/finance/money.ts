// Finance money helpers (05c §6 conventions). Money is Decimal inside the services and a decimal STRING on the
// wire ("1234.50"); never a JS number. More than two decimals is refused, never rounded (AMOUNT_PRECISION).
import { Prisma } from '@prisma/client';
import { AppError } from '../../core/http/errors';

export type Dec = Prisma.Decimal;
export const D = (v: Prisma.Decimal.Value): Dec => new Prisma.Decimal(v);
export const ZERO: Dec = D(0);
export const round2 = (v: Dec): Dec => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const money = (v: Dec | string | number | null | undefined): string =>
  v === null || v === undefined ? '0.00' : D(v).toFixed(2);

const MONEY = /^-?\d+(\.\d+)?$/;

/** Parse a money string; > 2 decimals -> 422 AMOUNT_PRECISION, junk -> 422 VALIDATION_ERROR. */
export function parseMoney(value: string | number, field = 'amount'): Dec {
  const s = typeof value === 'number' ? String(value) : value.trim();
  if (!MONEY.test(s)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', {
      [field]: 'Enter an amount like 1234.50.',
    });
  }
  const d = D(s);
  if (d.decimalPlaces() > 2) {
    throw new AppError(422, 'AMOUNT_PRECISION', 'An amount can have at most 2 decimal places.', {
      [field]: 'Use at most 2 decimals.',
    });
  }
  return d;
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
export const dayOf = (s: string): Date => new Date(`${s}T00:00:00Z`);
