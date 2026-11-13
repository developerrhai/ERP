// Phase 22: the generic Add / Edit / Delete engine behind GET/POST/PATCH/DELETE /screens/:pageId.
// It is driven by FormConfig (forms-config.ts): validates the values, keeps the record inside the chosen
// plant (R-37), numbers documents through the NumberingService, writes with optimistic locking and audits.
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { AppError, Errors, type FieldErrors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering/numbering-service';
import type { FormConfig, FormField, FormLines } from './configs';

export interface Actor {
  userId: string;
  unitId: string | null;
  fyId: string;
}

const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CAST: Record<FormField['type'], string> = {
  text: '',
  textarea: '',
  select: '',
  number: '::numeric',
  int: '::int',
  date: '::date',
  bool: '::boolean',
  lookup: '::uuid',
};

/** DB constraint -> the message a person should read. */
const CONSTRAINT_MESSAGES: Record<string, [string, string]> = {
  five_why_closed_needs_cause: ['root', 'Write the root cause before closing the case.'],
  hsn_sac_codes_code_chk: ['code', 'Enter 4, 6 or 8 digits.'],
  gst_rates_pct_chk: ['igst', 'IGST must be between 0 and 100.'],
  gst_rates_dates_chk: ['to', 'Effective To cannot be before Effective From.'],
  price_lists_dates_chk: ['to', 'Valid To cannot be before Valid From.'],
};

function fieldSchema(f: FormField): z.ZodTypeAny {
  const req = (s: z.ZodTypeAny) => s;
  let s: z.ZodTypeAny;
  switch (f.type) {
    case 'text':
    case 'textarea':
      s = z.string().trim().max(f.maxLength ?? (f.type === 'textarea' ? 4000 : 200), 'That is too long.');
      break;
    case 'select':
      s = z.string().refine((v) => (f.options ?? []).includes(v), 'Choose one of the listed values.');
      break;
    case 'number':
      s = z
        .union([z.string(), z.number()])
        .transform((v) => String(v).trim())
        .refine((v) => NUMBER_RE.test(v), 'Enter a number like 12.5.')
        .refine((v) => f.min === undefined || Number(v) >= f.min, `Enter ${f.min} or more.`)
        .refine((v) => f.max === undefined || Number(v) <= f.max, `Enter ${f.max} or less.`);
      break;
    case 'int':
      s = z
        .union([z.string(), z.number()])
        .transform((v) => String(v).trim())
        .refine((v) => /^-?\d+$/.test(v), 'Enter a whole number.')
        .refine((v) => f.min === undefined || Number(v) >= f.min, `Enter ${f.min} or more.`)
        .refine((v) => f.max === undefined || Number(v) <= f.max, `Enter ${f.max} or less.`);
      break;
    case 'date':
      s = z.string().refine((v) => DATE_RE.test(v) && !Number.isNaN(Date.parse(v)), 'Use a date like 2026-11-30.');
      break;
    case 'bool':
      s = z.boolean();
      break;
    case 'lookup':
      s = z.string().refine((v) => UUID_RE.test(v), 'Pick one from the list.');
      break;
  }
  return req(s);
}

/** Normalises and checks a values object; returns clean values or throws a field-by-field VALIDATION error. */
export function cleanValues(
  fields: readonly FormField[],
  input: Record<string, unknown>,
  mode: 'create' | 'edit',
  prefix = '',
): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  const errors: FieldErrors = {};
  for (const f of fields) {
    if (mode === 'edit' && f.editable === false) continue;
    let raw = input[f.key];
    if (typeof raw === 'string' && raw.trim() === '') raw = undefined;
    if (raw === undefined || raw === null) {
      if (mode === 'create' && raw === undefined && f.default !== undefined && f.type !== 'bool') raw = f.default;
      else if (mode === 'create' && f.type === 'bool') raw = f.default ?? false;
    }
    if (raw === undefined || raw === null) {
      if (f.required && (mode === 'create' || input[f.key] !== undefined)) {
        errors[prefix + f.key] = `${f.label} is required.`;
      } else if (mode === 'edit' && input[f.key] === null) {
        if (f.required) errors[prefix + f.key] = `${f.label} is required.`;
        else out[f.key] = null;
      }
      continue;
    }
    const r = fieldSchema(f).safeParse(raw);
    if (!r.success) errors[prefix + f.key] = r.error.issues[0]?.message ?? 'Check this value.';
    else out[f.key] = r.data as string | boolean;
  }
  if (Object.keys(errors).length > 0) throw Errors.validation(errors);
  return out;
}

function param(f: FormField, i: number): Prisma.Sql {
  return Prisma.raw(`$${i}${CAST[f.type]}`);
}

async function plantOf(cfg: FormConfig, values: Record<string, unknown>): Promise<string | null> {
  if (!cfg.unitOf) return null;
  const v = values[cfg.unitOf.fromKey];
  if (typeof v !== 'string') return null;
  const rows = await prisma.$queryRawUnsafe<{ unit_id: string | null }[]>(cfg.unitOf.sql, v);
  if (!rows[0]) throw Errors.validation({ [cfg.unitOf.fromKey]: 'This choice no longer exists.' });
  return rows[0].unit_id;
}

function mapDbError(err: unknown, cfg: FormConfig): never {
  const msg = err instanceof Error ? err.message : String(err);
  const code = /Code: `(\w+)`/.exec(msg)?.[1] ?? (err as { code?: string }).code;
  if (code === '23505') {
    const key = cfg.fields.find((f) => f.editable === false && f.type !== 'lookup')?.key ?? cfg.fields[0]?.key ?? 'code';
    throw Errors.duplicate({ [key]: 'This one already exists. Use a different value.' });
  }
  if (code === '23514') {
    for (const [name, [field, text]] of Object.entries(CONSTRAINT_MESSAGES)) {
      if (msg.includes(name)) throw Errors.validation({ [field]: text });
    }
  }
  if (code === '23503') throw Errors.inUse('This record is linked to other records.');
  throw err;
}

async function writeLines(
  tx: Prisma.TransactionClient,
  spec: FormLines,
  headerId: string,
  lines: Record<string, unknown>[],
): Promise<void> {
  if (lines.length < spec.min) throw Errors.validation({ lines: `Add at least ${spec.min} line${spec.min === 1 ? '' : 's'}.` });
  if (lines.length > spec.max) throw Errors.validation({ lines: `At most ${spec.max} lines.` });
  const cleaned = lines.map((l, i) => cleanValues(spec.fields, l, 'create', `lines.${i}.`));
  await tx.$executeRawUnsafe(`DELETE FROM "${spec.table}" WHERE "${spec.fk}" = $1::uuid`, headerId);
  for (let i = 0; i < cleaned.length; i += 1) {
    const row = cleaned[i] ?? {};
    const cols: string[] = [spec.fk, spec.lineNoColumn];
    const exprs: string[] = ['$1::uuid', '$2::int'];
    const args: unknown[] = [headerId, i + 1];
    if (spec.seqColumn) {
      cols.push(spec.seqColumn);
      args.push(i + 1);
      exprs.push(`$${args.length}::int`);
    }
    for (const f of spec.fields) {
      const v = row[f.key];
      if (v === undefined) continue;
      cols.push(f.column);
      args.push(v);
      exprs.push(`$${args.length}${CAST[f.type]}`);
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO "${spec.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${exprs.join(', ')})`,
      ...args,
    );
  }
}

export interface SaveInput {
  values: Record<string, unknown>;
  lines?: Record<string, unknown>[] | undefined;
}

export async function createRecord(
  pageId: string,
  cfg: FormConfig,
  actor: Actor,
  input: SaveInput,
): Promise<{ id: string; number: string | null }> {
  const values = cleanValues(cfg.fields, input.values, 'create');
  // R-37: creating needs exactly one plant, and the chosen warehouse / zone / rack must be in it.
  if (cfg.unitColumn || cfg.unitOf) {
    if (actor.unitId === null) throw Errors.validation({ unit: 'Choose one plant at the top first, then add the record.' });
    const recordUnit = await plantOf(cfg, values);
    if (recordUnit !== null && recordUnit !== actor.unitId) {
      throw Errors.validation({
        [cfg.unitOf?.fromKey ?? 'unit']: 'That belongs to another plant. Switch the plant at the top, or pick one from this plant.',
      });
    }
  }
  const spec = cfg.lines;
  if (spec && (input.lines === undefined || input.lines.length === 0)) {
    throw Errors.validation({ lines: `Add at least ${spec.min} line${spec.min === 1 ? '' : 's'}.` });
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const cols: string[] = [];
      const exprs: string[] = [];
      const args: unknown[] = [];
      const push = (col: string, expr: string, val?: unknown) => {
        cols.push(col);
        if (val !== undefined) args.push(val);
        exprs.push(expr);
      };
      for (const f of cfg.fields) {
        const v = values[f.key];
        if (v === undefined) continue;
        args.push(v);
        cols.push(f.column);
        exprs.push(`$${args.length}${CAST[f.type]}`);
      }
      for (const [col, d] of Object.entries(cfg.derive ?? {})) {
        const src = values[d.fromKey];
        if (typeof src !== 'string') continue;
        args.push(src);
        cols.push(col);
        exprs.push(`(${d.sql.replace(/\$1/g, `$${args.length}`)})`);
      }
      // compute() keys may carry a SQL cast: 'emi_amount::numeric'
      for (const [key, val] of Object.entries(cfg.compute?.(values) ?? {})) {
        const [col = key, cast] = key.split('::');
        args.push(val);
        cols.push(col);
        exprs.push(`$${args.length}${cast ? `::${cast}` : ''}`);
      }
      if (cfg.unitColumn) push(cfg.unitColumn, `$${args.length + 1}::uuid`, actor.unitId);
      if (cfg.fyColumn) push(cfg.fyColumn, `$${args.length + 1}::uuid`, actor.fyId);
      let number: string | null = null;
      if (cfg.numbering) {
        number = await NumberingService.next(tx, {
          docType: cfg.numbering.docType,
          unitId: actor.unitId ?? '',
          fyId: actor.fyId,
        });
        push(cfg.numbering.column, `$${args.length + 1}`, number);
      }
      if (cfg.statusColumn && cfg.createStatus && values.status === undefined) {
        push(cfg.statusColumn, `$${args.length + 1}`, cfg.createStatus);
      }
      if (cfg.hasCreatedBy !== false) push('created_by_id', `$${args.length + 1}::uuid`, actor.userId);
      if (cfg.hasUpdatedBy !== false) push('updated_by_id', `$${args.length + 1}::uuid`, actor.userId);
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO "${cfg.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${exprs.join(', ')}) RETURNING id::text AS id`,
        ...args,
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('Insert returned no row');
      if (spec && input.lines) await writeLines(tx, spec, id, input.lines);
      if (cfg.afterCreate) await cfg.afterCreate(tx, id, values);
      await recordAudit(
        { action: 'screen.created', actorId: actor.userId, targetType: pageId, targetId: id, detail: { number } },
        tx,
      );
      return { id, number };
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    return mapDbError(e, cfg);
  }
}

function blockedBy(cfg: FormConfig, status: string | null, action: 'edit' | 'delete'): void {
  if (!cfg.editStatuses || status === null) return;
  if (!cfg.editStatuses.includes(status)) {
    const allowed = cfg.editStatuses.join(' / ');
    throw Errors.actionNotAllowed(action, `only ${allowed} records can be ${action === 'edit' ? 'edited' : 'deleted'}`);
  }
}

export async function updateRecord(
  pageId: string,
  cfg: FormConfig,
  actor: Actor,
  id: string,
  version: number,
  input: SaveInput,
): Promise<void> {
  if (cfg.noEdit) throw Errors.actionNotAllowed('edit', cfg.noEdit);
  const values = cleanValues(cfg.fields, input.values, 'edit');
  const spec = cfg.lines;
  try {
    await prisma.$transaction(async (tx) => {
      const cur = await tx.$queryRawUnsafe<{ version: number; status: string | null }[]>(
        `SELECT version, ${cfg.statusColumn ? `"${cfg.statusColumn}"::text` : 'NULL::text'} AS status FROM "${cfg.table}" WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
        id,
      );
      if (!cur[0]) throw Errors.notFound('Record not found.');
      if (cur[0].version !== version) throw Errors.versionConflict();
      blockedBy(cfg, cur[0].status, 'edit');
      const sets: string[] = [];
      const args: unknown[] = [];
      for (const f of cfg.fields) {
        if (f.editable === false || !(f.key in values)) continue;
        args.push(values[f.key]);
        sets.push(`"${f.column}" = $${args.length}${CAST[f.type]}`);
      }
      args.push(actor.userId);
      sets.push(`"updated_by_id" = $${args.length}::uuid`, '"updated_at" = now()', '"version" = "version" + 1');
      args.push(id, version);
      const n = await tx.$executeRawUnsafe(
        `UPDATE "${cfg.table}" SET ${sets.join(', ')} WHERE id = $${args.length - 1}::uuid AND version = $${args.length}::int AND deleted_at IS NULL`,
        ...args,
      );
      if (n !== 1) throw Errors.versionConflict();
      if (spec && input.lines) await writeLines(tx, spec, id, input.lines);
      await recordAudit(
        { action: 'screen.updated', actorId: actor.userId, targetType: pageId, targetId: id, detail: { fields: Object.keys(values) } },
        tx,
      );
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapDbError(e, cfg);
  }
}

export async function deleteRecord(
  pageId: string,
  cfg: FormConfig,
  actor: Actor,
  id: string,
  version: number | undefined,
): Promise<void> {
  if (cfg.noDelete) throw Errors.actionNotAllowed('delete', cfg.noDelete);
  await prisma.$transaction(async (tx) => {
    const cur = await tx.$queryRawUnsafe<{ version: number; status: string | null }[]>(
      `SELECT version, ${cfg.statusColumn ? `"${cfg.statusColumn}"::text` : 'NULL::text'} AS status FROM "${cfg.table}" WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
      id,
    );
    if (!cur[0]) throw Errors.notFound('Record not found.');
    if (version !== undefined && cur[0].version !== version) throw Errors.versionConflict();
    blockedBy(cfg, cur[0].status, 'delete');
    if (cfg.deleteGuard) {
      const g = await tx.$queryRawUnsafe<{ n: number }[]>(cfg.deleteGuard.sql, id);
      if (Number(g[0]?.n ?? 0) > 0) throw Errors.inUse(cfg.deleteGuard.message);
    }
    await tx.$executeRawUnsafe(
      `UPDATE "${cfg.table}" SET deleted_at = now(), updated_at = now(), updated_by_id = $2::uuid, version = version + 1 WHERE id = $1::uuid`,
      id,
      actor.userId,
    );
    await recordAudit({ action: 'screen.deleted', actorId: actor.userId, targetType: pageId, targetId: id }, tx);
  });
}

/** Raw values by form-field key (for the Edit form), plus the lines and the version. */
export async function loadForEdit(
  cfg: FormConfig,
  id: string,
): Promise<{ values: Record<string, unknown>; lines: Record<string, unknown>[]; version: number; status: string | null } | null> {
  const sel = cfg.fields.map((f, i) => `t."${f.column}"::text AS f${i}`).join(', ');
  const rows = await prisma.$queryRawUnsafe<Record<string, string | null>[]>(
    `SELECT t.version, ${cfg.statusColumn ? `t."${cfg.statusColumn}"::text` : 'NULL::text'} AS _status, ${sel} FROM "${cfg.table}" t WHERE t.id = $1::uuid AND t.deleted_at IS NULL`,
    id,
  );
  const r = rows[0];
  if (!r) return null;
  const values: Record<string, unknown> = {};
  cfg.fields.forEach((f, i) => {
    const raw = r[`f${i}`] ?? null;
    values[f.key] = f.type === 'bool' ? raw === 'true' : f.type === 'date' && raw ? raw.slice(0, 10) : raw;
  });
  let lines: Record<string, unknown>[] = [];
  if (cfg.lines) {
    const lsel = cfg.lines.fields.map((f, i) => `l."${f.column}"::text AS f${i}`).join(', ');
    const lrows = await prisma.$queryRawUnsafe<Record<string, string | null>[]>(
      `SELECT ${lsel} FROM "${cfg.lines.table}" l WHERE l."${cfg.lines.fk}" = $1::uuid ORDER BY l."${cfg.lines.lineNoColumn}"`,
      id,
    );
    lines = lrows.map((lr) => {
      const o: Record<string, unknown> = {};
      cfg.lines?.fields.forEach((f, i) => {
        o[f.key] = lr[`f${i}`] ?? null;
      });
      return o;
    });
  }
  return { values, lines, version: Number(r.version), status: (r._status as string | null) ?? null };
}
