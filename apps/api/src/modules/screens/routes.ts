// Phase 22: GET /screens/:pageId (list), /screens/:pageId/:id (record) and /:id/actions.
// One keyset-paginated, scope-checked read for the screens that moved off the generic record
// engine (configs.ts). Every list row carries `_a`, the ActionBar bitmask computed in SQL.
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../../core/auth/auth-context';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { prisma } from '../../core/db/prisma';
import { actionMaskSql, actionsFor, decodeMask, type PagePerms } from '../../core/actions';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { escapeLike } from '../../core/http/query-safety';
import { validate, validated } from '../../core/http/validate';
import {
  cappedTotal,
  keysetAfter,
  orderBySql,
  paginateKeyset,
  parseLimit,
  parseSort,
} from '../../core/pagination';
import { accessUserOf, can, requireParamPageAction, scopeFor } from '../../core/rbac/access';
import { parseIfMatch, parseOptionalIfMatch } from '../../core/http/if-match';
import { SCREENS, type FormConfig, type ScreenConfig } from './configs';
import { binsOnShelf, placeBin, removeBin, shelfBinBody } from './shelf-bins';
import { createRecord, deleteRecord, loadForEdit, updateRecord, type Actor } from './forms';

const listQuery = z
  .object({
    q: z.string().trim().max(60).optional(),
    status: z.string().trim().max(40).optional(),
    sort: z.string().max(40).optional(),
    cursor: z.string().max(400).optional(),
    size: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
const idParams = z.object({ pageId: z.string().max(64), id: z.string().uuid('Invalid id.') }).strict();
const pageParams = z.object({ pageId: z.string().max(64) }).strict();

async function permsOf(req: Parameters<typeof requireAuth>[0], pageId: string): Promise<PagePerms> {
  const user = accessUserOf(requireAuth(req));
  const [view, edit, del, submit, approve, print, exp] = await Promise.all([
    can(user, pageId, 'view'),
    can(user, pageId, 'edit'),
    can(user, pageId, 'delete'),
    can(user, pageId, 'submit'),
    can(user, pageId, 'approve'),
    can(user, pageId, 'print'),
    can(user, pageId, 'export'),
  ]);
  return { view, edit, delete: del, submit, approve, print, export: exp };
}

/** count(*) and sum() come back as bigint, which JSON cannot carry. */
function plain(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'bigint' ? Number(v) : v;
  return out;
}

function configOf(pageId: string): ScreenConfig {
  const cfg = SCREENS[pageId];
  if (!cfg) throw Errors.notFound('Unknown screen.');
  return cfg;
}

/** WHERE for the caller: base filter, unit, data scope, search, status. */
async function whereOf(
  req: Parameters<typeof requireAuth>[0],
  cfg: ScreenConfig,
  q: { q?: string | undefined; status?: string | undefined },
): Promise<Prisma.Sql> {
  const auth = requireAuth(req);
  const parts: Prisma.Sql[] = [Prisma.sql`true`];
  if (cfg.baseWhere) parts.push(Prisma.raw(`(${cfg.baseWhere})`));
  const unitId = req.ctx?.unitId ?? null;
  if (unitId !== null && cfg.unitSql) parts.push(Prisma.sql`${Prisma.raw(cfg.unitSql)} = ${unitId}::uuid`);
  const scope = await scopeFor(accessUserOf(auth), cfg.pageId);
  if (scope === 'OWN' || scope === 'DEPARTMENT') {
    // No per-row department column on these tables: a narrow scope sees its own records only,
    // and a table without an owner column shows nothing (fail closed).
    if (cfg.ownerSql) parts.push(Prisma.sql`${Prisma.raw(cfg.ownerSql)} = ${auth.userId}::uuid`);
    else parts.push(Prisma.sql`false`);
  }
  if (q.status && cfg.statusSql) parts.push(Prisma.sql`${Prisma.raw(cfg.statusSql)} = ${q.status}`);
  if (q.q) {
    const like = `%${escapeLike(q.q)}%`;
    parts.push(
      Prisma.sql`(${Prisma.join(
        cfg.searchSql.map((s) => Prisma.sql`${Prisma.raw(s)}::text ILIKE ${like}`),
        ' OR ',
      )})`,
    );
  }
  return Prisma.join(parts, ' AND ');
}

function selectList(cfg: ScreenConfig, extra: Prisma.Sql, mask: Prisma.Sql): Prisma.Sql {
  const cols = cfg.columns.map((c) => `${c.sql} AS "${c.key}"`).join(', ');
  return Prisma.sql`SELECT t.id, ${Prisma.raw(cols)}, ${mask} AS _a ${extra}`;
}

const saveBody = z
  .object({
    values: z.record(z.unknown()),
    lines: z.array(z.record(z.unknown())).max(500).optional(),
  })
  .strict();
const lookupParams = z.object({ pageId: z.string().max(64), name: z.string().max(40) }).strict();
const lookupQuery = z
  .object({
    q: z.string().trim().max(60).optional(),
    parent: z.string().uuid().optional(),
    id: z.string().uuid().optional(),
  })
  .strict();

function describeForm(f: FormConfig) {
  const field = (x: FormConfig['fields'][number]) => ({
    key: x.key,
    label: x.label,
    type: x.type,
    required: x.required ?? false,
    options: x.options ?? null,
    lookup: x.lookup ?? null,
    parent: x.parent ?? null,
    min: x.min ?? null,
    max: x.max ?? null,
    maxLength: x.maxLength ?? null,
    default: x.default ?? null,
    editable: x.editable !== false,
    help: x.help ?? null,
  });
  return {
    title: f.title,
    needsPlant: Boolean(f.unitColumn || f.unitOf),
    editStatuses: f.editStatuses ?? null,
    noEdit: f.noEdit ?? null,
    noDelete: f.noDelete ?? null,
    fields: f.fields.map(field),
    lines: f.lines
      ? { label: f.lines.label, min: f.lines.min, max: f.lines.max, fields: f.lines.fields.map(field) }
      : null,
  };
}

function actorOf(req: Parameters<typeof requireAuth>[0]): Actor {
  const auth = requireAuth(req);
  const ctx = req.ctx;
  if (!ctx) throw Errors.badRequest('Missing plant / year context.');
  return { userId: auth.userId, unitId: ctx.unitId, fyId: ctx.fyId };
}

export function createScreensRouter(): Router {
  const router = Router();
  router.use('/screens', authenticate, requirePasswordChanged);
  const r = Router();
  r.use(resolveContext);
  router.use('/screens', r);

  r.get(
    '/:pageId',
    validate({ params: pageParams, query: listQuery }),
    requireParamPageAction('view'),
    asyncHandler(async (req, res) => {
      const { pageId } = validated(res, 'params', pageParams);
      const q = validated(res, 'query', listQuery);
      const cfg = configOf(pageId);
      const perms = await permsOf(req, pageId);
      const limit = parseLimit(q.size);
      const { sortKey, spec } = parseSort(q.sort, cfg.sorts, cfg.defaultSort);
      const sortName = sortKey.replace(/^-/, '');
      const cast = cfg.sortCast[sortName] ?? 'text';
      const where = await whereOf(req, cfg, q);
      const mask = actionMaskSql(cfg.statusSql ?? "'Active'", perms);

      const result = await paginateKeyset<Record<string, unknown>>({
        sortKey,
        limit,
        cursor: q.cursor,
        valueOf: (row) => row._k as string,
        idOf: (row) => row.id as string,
        fetch: async ({ take, after }) => {
          const fromWhere = Prisma.sql`FROM ${Prisma.raw(cfg.from)} WHERE ${where} ${keysetAfter(spec, after, cast)}`;
          const sel = selectList(
            cfg,
            Prisma.sql`, ${Prisma.raw(spec.column)}::text AS _k ${fromWhere} ${orderBySql(spec, 't.id')} LIMIT ${take}`,
            mask,
          );
          return prisma.$queryRaw<Record<string, unknown>[]>(sel);
        },
        total: () => cappedTotal(prisma, cfg.table, Prisma.sql`FROM ${Prisma.raw(cfg.from)} WHERE ${where}`),
      });
      res.json({
        data: result.data.map((row) => {
          const { _k: _drop, ...rest } = row;
          void _drop;
          return plain(rest);
        }),
        meta: {
          ...result.meta,
          columns: cfg.columns.map((c) => ({ key: c.key, label: c.label, type: c.type ?? 'text' })),
          sort: sortKey,
          sorts: Object.keys(cfg.sorts),
          things: cfg.things,
          form: cfg.form ? describeForm(cfg.form) : null,
          can: perms,
        },
      });
    }),
  );

  const formOf = (cfg: ScreenConfig): FormConfig => {
    if (!cfg.form) throw Errors.notFound('This screen has no entry form.');
    return cfg.form;
  };

  /** 404 when the record is not visible to the caller (outside plant / scope), like every other read. */
  const assertVisible = async (req: Parameters<typeof requireAuth>[0], cfg: ScreenConfig, id: string) => {
    const where = await whereOf(req, cfg, {});
    const rows = await prisma.$queryRaw<{ ok: number }[]>(
      Prisma.sql`SELECT 1 AS ok FROM ${Prisma.raw(cfg.from)} WHERE ${where} AND t.id = ${id}::uuid LIMIT 1`,
    );
    if (!rows[0]) throw Errors.notFound('Record not found.');
  };

  r.get(
    '/:pageId/form',
    validate({ params: pageParams }),
    requireParamPageAction('view'),
    asyncHandler((req, res) => {
      const { pageId } = validated(res, 'params', pageParams);
      res.json({ data: describeForm(formOf(configOf(pageId))) });
      return Promise.resolve();
    }),
  );

  r.get(
    '/:pageId/lookup/:name',
    validate({ params: lookupParams, query: lookupQuery }),
    requireParamPageAction('view'),
    asyncHandler(async (req, res) => {
      const { pageId, name } = validated(res, 'params', lookupParams);
      const q = validated(res, 'query', lookupQuery);
      const form = formOf(configOf(pageId));
      const lk = form.lookups[name];
      if (!lk) throw Errors.notFound('Unknown list.');
      const parts: Prisma.Sql[] = [Prisma.raw(lk.where ?? 'true')];
      const unitId = req.ctx?.unitId ?? null;
      if (unitId !== null && lk.unitSql) parts.push(Prisma.sql`${Prisma.raw(lk.unitSql)} = ${unitId}::uuid`);
      if (q.parent && lk.parentSql) parts.push(Prisma.sql`${Prisma.raw(lk.parentSql)} = ${q.parent}::uuid`);
      if (q.id) parts.push(Prisma.sql`x.id = ${q.id}::uuid`);
      if (q.q) {
        const like = `%${escapeLike(q.q)}%`;
        parts.push(
          Prisma.sql`(${Prisma.join(lk.searchSql.map((c) => Prisma.sql`${Prisma.raw(c)}::text ILIKE ${like}`), ' OR ')})`,
        );
      }
      const rows = await prisma.$queryRaw<{ id: string; label: string }[]>(
        Prisma.sql`SELECT x.id::text AS id, ${Prisma.raw(lk.label)} AS label FROM ${Prisma.raw(lk.from)} WHERE ${Prisma.join(parts, ' AND ')} ORDER BY 2 LIMIT 20`,
      );
      res.json({ data: rows });
    }),
  );

  r.get(
    '/:pageId/:id/edit',
    validate({ params: idParams }),
    requireParamPageAction('edit'),
    asyncHandler(async (req, res) => {
      const { pageId, id } = validated(res, 'params', idParams);
      const cfg = configOf(pageId);
      const form = formOf(cfg);
      await assertVisible(req, cfg, id);
      const rec = await loadForEdit(form, id);
      if (!rec) throw Errors.notFound('Record not found.');
      res.setHeader('ETag', `"${rec.version}"`);
      res.json({ data: rec });
    }),
  );

  r.post(
    '/:pageId',
    validate({ params: pageParams, body: saveBody }),
    requireParamPageAction('add'),
    asyncHandler(async (req, res) => {
      const { pageId } = validated(res, 'params', pageParams);
      const body = validated(res, 'body', saveBody);
      const cfg = configOf(pageId);
      const out = await createRecord(pageId, formOf(cfg), actorOf(req), body);
      res.status(201).json({ data: out });
    }),
  );

  r.patch(
    '/:pageId/:id',
    validate({ params: idParams, body: saveBody }),
    requireParamPageAction('edit'),
    asyncHandler(async (req, res) => {
      const { pageId, id } = validated(res, 'params', idParams);
      const body = validated(res, 'body', saveBody);
      const cfg = configOf(pageId);
      const version = parseIfMatch(req.header('If-Match'));
      await assertVisible(req, cfg, id);
      await updateRecord(pageId, formOf(cfg), actorOf(req), id, version, body);
      res.json({ data: { id } });
    }),
  );

  r.delete(
    '/:pageId/:id',
    validate({ params: idParams }),
    requireParamPageAction('delete'),
    asyncHandler(async (req, res) => {
      const { pageId, id } = validated(res, 'params', idParams);
      const cfg = configOf(pageId);
      const version = parseOptionalIfMatch(req.header('If-Match'));
      await assertVisible(req, cfg, id);
      await deleteRecord(pageId, formOf(cfg), actorOf(req), id, version);
      res.json({ data: { id } });
    }),
  );

  const shelfParams = z.object({ id: z.string().uuid('Invalid id.') }).strict();
  const shelfBinParams = z.object({ id: z.string().uuid('Invalid id.'), binId: z.string().uuid('Invalid id.') }).strict();

  r.get(
    '/wms-shelves/:id/bins',
    validate({ params: shelfParams }),
    requireParamPageAction('view'),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', shelfParams);
      await assertVisible(req, configOf('wms-shelves'), id);
      res.json({ data: await binsOnShelf(id) });
    }),
  );
  r.post(
    '/wms-shelves/:id/bins',
    validate({ params: shelfParams, body: shelfBinBody }),
    asyncHandler(async (req, res, next) => {
      const user = accessUserOf(requireAuth(req));
      if (!(await can(user, 'wms-shelves', 'edit'))) throw Errors.forbidden();
      next();
    }),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', shelfParams);
      const { binId } = validated(res, 'body', shelfBinBody);
      await assertVisible(req, configOf('wms-shelves'), id);
      await placeBin(requireAuth(req).userId, id, binId);
      res.status(201).json({ data: await binsOnShelf(id) });
    }),
  );
  r.delete(
    '/wms-shelves/:id/bins/:binId',
    validate({ params: shelfBinParams }),
    asyncHandler(async (req, res, next) => {
      const user = accessUserOf(requireAuth(req));
      if (!(await can(user, 'wms-shelves', 'edit'))) throw Errors.forbidden();
      next();
    }),
    asyncHandler(async (req, res) => {
      const { id, binId } = validated(res, 'params', shelfBinParams);
      await assertVisible(req, configOf('wms-shelves'), id);
      await removeBin(requireAuth(req).userId, id, binId);
      res.json({ data: await binsOnShelf(id) });
    }),
  );

  r.get(
    '/:pageId/:id/details',
    validate({ params: idParams }),
    requireParamPageAction('view'),
    asyncHandler(async (req, res) => {
      const { pageId, id } = validated(res, 'params', idParams);
      const cfg = configOf(pageId);
      await assertVisible(req, cfg, id);
      const sections = [];
      for (const d of cfg.details ?? []) {
        // unpaginated: child rows of one record, capped below
        const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`${d.sql} LIMIT 500`, id);
        sections.push({
          title: d.title,
          columns: d.columns.map((c) => ({ key: c.key, label: c.label, type: c.type ?? 'text' })),
          rows: rows.map(plain),
        });
      }
      res.json({ data: sections });
    }),
  );

  const oneRow = async (req: Parameters<typeof requireAuth>[0], cfg: ScreenConfig, id: string) => {
    const where = await whereOf(req, cfg, {});
    const perms = await permsOf(req, cfg.pageId);
    const sel = selectList(
      cfg,
      Prisma.sql`, ${Prisma.raw(cfg.statusSql ?? "'Active'")}::text AS _status FROM ${Prisma.raw(cfg.from)} WHERE ${where} AND t.id = ${id}::uuid LIMIT 1`,
      actionMaskSql(cfg.statusSql ?? "'Active'", perms),
    );
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>(sel);
    const first = rows[0];
    if (!first) throw Errors.notFound('Record not found.'); // also out of scope
    return { row: plain(first), perms };
  };

  r.get(
    '/:pageId/:id',
    validate({ params: idParams }),
    requireParamPageAction('view'),
    asyncHandler(async (req, res) => {
      const { pageId, id } = validated(res, 'params', idParams);
      const cfg = configOf(pageId);
      const { row, perms } = await oneRow(req, cfg, id);
      const { _status, ...rest } = row;
      res.json({
        data: { ...rest, actions: actionsFor(perms, _status as string | null) },
        meta: {
          fields: cfg.columns.map((c) => ({ key: c.key, label: c.label, type: c.type ?? 'text' })),
        },
      });
    }),
  );

  r.get(
    '/:pageId/:id/actions',
    validate({ params: idParams }),
    requireParamPageAction('view'),
    asyncHandler(async (req, res) => {
      const { pageId, id } = validated(res, 'params', idParams);
      const cfg = configOf(pageId);
      const { row, perms } = await oneRow(req, cfg, id);
      const set = actionsFor(perms, row._status as string | null);
      res.json({ data: { ...set, mask: decodeMask(Number(row._a)).allowed } });
    }),
  );

  return router;
}
