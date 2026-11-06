// apps/api/src/modules/currencies/service.ts
// Business logic and audit logging for currencies (Phase 03 Order 3)
import { Prisma } from '@prisma/client';
import type { Currency } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { currencyRepository } from './repository';
import type { CreateCurrencyInput, ListCurrenciesQuery, UpdateCurrencyInput } from './schemas';

export interface CurrencyDto {
  id: string;
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  isBase: boolean;
  exchangeRate: number;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toCurrencyDto(c: Currency): CurrencyDto {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    symbol: c.symbol,
    decimalPlaces: c.decimalPlaces,
    isBase: c.isBase,
    exchangeRate: Number(c.exchangeRate),
    status: c.status as 'ACTIVE' | 'INACTIVE',
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const currencyService = {
  list: async (query: ListCurrenciesQuery = {}): Promise<CurrencyDto[]> => {
    const rows = await currencyRepository.findMany(query);
    return rows.map(toCurrencyDto);
  },

  get: async (id: string): Promise<CurrencyDto> => {
    const row = await currencyRepository.findById(id);
    if (!row) throw Errors.notFound('Currency not found.');
    return toCurrencyDto(row);
  },

  create: async (
    auth: AuthContext,
    input: CreateCurrencyInput,
    meta: RequestMeta,
  ): Promise<CurrencyDto> => {
    const existing = await currencyRepository.findByCode(input.code);
    if (existing) {
      throw Errors.duplicate({ code: `Currency code ${input.code} already exists.` });
    }

    const rate = input.isBase ? 1.0 : input.exchangeRate;

    const created = await prisma.$transaction(async (tx) => {
      const row = await currencyRepository.create(
        {
          code: input.code,
          name: input.name,
          symbol: input.symbol,
          decimalPlaces: input.decimalPlaces,
          isBase: input.isBase,
          exchangeRate: new Prisma.Decimal(rate),
          status: 'ACTIVE',
          createdById: auth.userId,
        },
        tx,
      );

      if (input.isBase) {
        await currencyRepository.unsetOtherBases(row.id, tx);
      }
      return row;
    });

    await recordAudit({
      action: 'CURRENCY_CREATED',
      actorId: auth.userId,
      targetType: 'Currency',
      targetId: created.id,
      meta,
      detail: { code: created.code, name: created.name, isBase: created.isBase },
    });

    return toCurrencyDto(created);
  },

  update: async (
    auth: AuthContext,
    id: string,
    version: number,
    input: UpdateCurrencyInput,
    meta: RequestMeta,
  ): Promise<CurrencyDto> => {
    const current = await currencyRepository.findById(id);
    if (!current) throw Errors.notFound('Currency not found.');

    if (current.isBase && input.status === 'INACTIVE') {
      throw Errors.conflict('The base currency cannot be deactivated.');
    }
    if (current.isBase && input.exchangeRate !== undefined && input.exchangeRate !== 1.0) {
      throw Errors.validation({ exchangeRate: 'Base currency exchange rate must always be 1.0.' });
    }

    const becomesBase = input.isBase === true;
    const rate = becomesBase ? 1.0 : input.exchangeRate;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await currencyRepository.updateIfVersion(
        id,
        version,
        {
          ...(input.name ? { name: input.name } : {}),
          ...(input.symbol ? { symbol: input.symbol } : {}),
          ...(input.decimalPlaces !== undefined ? { decimalPlaces: input.decimalPlaces } : {}),
          ...(input.isBase !== undefined ? { isBase: input.isBase } : {}),
          ...(rate !== undefined ? { exchangeRate: new Prisma.Decimal(rate) } : {}),
          ...(input.status ? { status: input.status } : {}),
          updatedById: auth.userId,
        },
        tx,
      );

      if (!row) {
        const fresh = await currencyRepository.findById(id, tx);
        if (!fresh) throw Errors.notFound('Currency not found.');
        throw Errors.conflict('This currency was modified by another request.');
      }

      if (becomesBase) {
        await currencyRepository.unsetOtherBases(id, tx);
      }
      return row;
    });

    await recordAudit({
      action: 'CURRENCY_UPDATED',
      actorId: auth.userId,
      targetType: 'Currency',
      targetId: id,
      meta,
      detail: { changes: input },
    });

    return toCurrencyDto(updated);
  },

  remove: async (
    auth: AuthContext,
    id: string,
    version?: number,
    meta?: RequestMeta,
  ): Promise<void> => {
    const current = await currencyRepository.findById(id);
    if (!current) throw Errors.notFound('Currency not found.');

    if (current.isBase) {
      throw Errors.conflict('The base currency cannot be deleted.');
    }

    const deleted = await currencyRepository.softDelete(id, auth.userId, version);
    if (!deleted) {
      throw Errors.conflict('This currency was modified by another request.');
    }

    if (meta) {
      await recordAudit({
        action: 'CURRENCY_DELETED',
        actorId: auth.userId,
        targetType: 'Currency',
        targetId: id,
        meta,
        detail: { code: current.code, name: current.name },
      });
    }
  },
};
