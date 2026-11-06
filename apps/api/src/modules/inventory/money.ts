// Exact decimal arithmetic for stock (docs/phase3-4 C2): quantities have 3 decimals, rates 6, values
// 2, all rounded half-up. Every stock number goes through Decimal (never a JS float) so the ledger
// always adds up to the balance.
import { Prisma } from '@prisma/client';

export type Dec = Prisma.Decimal;

export const D = (value: Prisma.Decimal.Value): Dec => new Prisma.Decimal(value);
export const dec = D;
export const ZERO: Dec = D(0);

export const round2 = (v: Dec): Dec => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const round3 = (v: Dec): Dec => v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
export const round6 = (v: Dec): Dec => v.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);

/** A decimal as the plain string PostgreSQL and the JSON API use (no exponent). */
export const str = (v: Dec): string => v.toFixed();

/** A decimal as a JS number for JSON responses (3 / 2 / 6 decimals fit a double). */
export const num = (v: Dec | null | undefined): number | null => (v ? Number(v.toFixed()) : null);

export const isPositive = (v: Dec): boolean => v.greaterThan(0);
