// Template & Feature and Record Document Format: categories, the standard checklists / audit forms / record formats
// filed under them, and the feature switches of the Quality module.
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { TX, audit, checkVersion, exec, insertRow, norm, query, updateRow } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { FEATURES } from './common';
import type { FeatureKey } from './common';
import { S } from './inspection-service';

export const FORMAT_TYPES = ['CHECKLIST', 'AUDIT_FORM', 'RECORD_FORMAT'] as const;
export type FormatType = (typeof FORMAT_TYPES)[number];
const PAGE = 'qms-templates';

export interface FormatInput {
  type: FormatType;
  categoryId?: string | null | undefined;
  code: string;
  title: string;
  revision?: number | undefined;
  effectiveDate?: string | null | undefined;
  points?: string[] | undefined;
  notes?: string | null | undefined;
}

const taken = async (code: string, except?: string): Promise<boolean> =>
  Boolean(
    (
      await query(
        prisma,
        `SELECT 1 FROM qms_formats WHERE lower(code)=lower($1) AND deleted_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
        code,
        except ?? null,
      )
    )[0],
  );

async function assertCategory(id: string | null | undefined): Promise<void> {
  if (!id) return;
  const c = (await query(prisma, `SELECT status FROM qms_doc_categories WHERE id=$1::uuid`, id))[0];
  if (!c) throw Errors.validation({ categoryId: 'This category does not exist.' });
  if (S(c.status) !== 'ACTIVE') throw Errors.validation({ categoryId: 'This category is switched off.' });
}

export const formatService = {
  async categories() {
    // unpaginated: the owner's short list of categories
    const rows = await query(
      prisma,
      `SELECT c.*, (SELECT count(*)::int FROM qms_formats f WHERE f.category_id=c.id AND f.deleted_at IS NULL) AS formats
         FROM qms_doc_categories c ORDER BY lower(c.name)`,
    );
    return rows.map((r) => norm(r));
  },
  async createCategory(caller: Caller, name: string, description: string | null | undefined) {
    const n = name.trim();
    if ((await query(prisma, `SELECT 1 FROM qms_doc_categories WHERE lower(name)=lower($1)`, n))[0])
      throw Errors.validation({ name: 'There is already a category with this name.' });
    const id = await insertRow(prisma, 'qms_doc_categories', {
      name: n,
      description: description?.trim() || null,
      createdById: caller.auth.userId,
    });
    await audit(prisma, caller, caller.auth.userId, 'QMS_CATEGORY_CREATED', 'qms_doc_category', { id, code: n }, PAGE);
    return { id, name: n };
  },
  async updateCategory(caller: Caller, id: string, b: { name?: string | undefined; description?: string | null | undefined; status?: 'ACTIVE' | 'INACTIVE' | undefined }) {
    const cur = (await query(prisma, `SELECT * FROM qms_doc_categories WHERE id=$1::uuid`, id))[0];
    if (!cur) throw Errors.notFound('Category not found.');
    const n = b.name?.trim();
    if (n && (await query(prisma, `SELECT 1 FROM qms_doc_categories WHERE lower(name)=lower($1) AND id <> $2::uuid`, n, id))[0])
      throw Errors.validation({ name: 'There is already a category with this name.' });
    await updateRow(prisma, 'qms_doc_categories', id, {
      name: n,
      description: b.description === undefined ? undefined : b.description?.trim() || null,
      status: b.status,
    });
    await audit(prisma, caller, caller.auth.userId, 'QMS_CATEGORY_UPDATED', 'qms_doc_category', { id, code: n ?? S(cur.name) }, PAGE);
    return { id };
  },
  async deleteCategory(caller: Caller, id: string) {
    const cur = (await query(prisma, `SELECT * FROM qms_doc_categories WHERE id=$1::uuid`, id))[0];
    if (!cur) throw Errors.notFound('Category not found.');
    if ((await query(prisma, `SELECT 1 FROM qms_formats WHERE category_id=$1::uuid LIMIT 1`, id))[0])
      throw Errors.inUse('Records are filed under this category: switch it off instead.');
    await exec(prisma, `DELETE FROM qms_doc_categories WHERE id=$1::uuid`, id);
    await audit(prisma, caller, caller.auth.userId, 'QMS_CATEGORY_DELETED', 'qms_doc_category', { id, code: S(cur.name) }, PAGE);
  },

  async list(q: { type?: FormatType | undefined; categoryId?: string | undefined; q?: string | undefined }) {
    const args: unknown[] = [];
    const where = ['t.deleted_at IS NULL'];
    if (q.type) {
      args.push(q.type);
      where.push(`t.type=$${args.length}`);
    }
    if (q.categoryId) {
      args.push(q.categoryId);
      where.push(`t.category_id=$${args.length}::uuid`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(`(t.code ILIKE $${args.length} OR t.title ILIKE $${args.length})`);
    }
    // unpaginated: the company's own short library of formats, capped
    const rows = await query(
      prisma,
      `SELECT t.*, c.name AS category_name FROM qms_formats t LEFT JOIN qms_doc_categories c ON c.id=t.category_id
        WHERE ${where.join(' AND ')} ORDER BY lower(t.code) LIMIT 500`,
      ...args,
    );
    return rows.map((r) => norm(r));
  },
  async get(id: string): Promise<Row> {
    const r = (
      await query(
        prisma,
        `SELECT t.*, c.name AS category_name FROM qms_formats t LEFT JOIN qms_doc_categories c ON c.id=t.category_id
          WHERE t.id=$1::uuid AND t.deleted_at IS NULL`,
        id,
      )
    )[0];
    if (!r) throw Errors.notFound('Format not found.');
    return norm(r);
  },
  async create(caller: Caller, b: FormatInput) {
    const code = b.code.trim();
    if (await taken(code)) throw Errors.validation({ code: 'This number is already used.' });
    await assertCategory(b.categoryId);
    if (b.type === 'RECORD_FORMAT' && !b.categoryId) throw Errors.validation({ categoryId: 'Choose a category. Use Create Category to add one.' });
    const points = (b.points ?? []).map((p) => p.trim()).filter(Boolean);
    if (b.type !== 'RECORD_FORMAT' && points.length === 0) throw Errors.validation({ points: 'Add at least one check point (one per line).' });
    const id = await insertRow(prisma, 'qms_formats', {
      type: b.type,
      categoryId: b.categoryId ?? null,
      code,
      title: b.title.trim(),
      revision: b.revision ?? 0,
      effectiveDate: b.effectiveDate || null,
      points: JSON.stringify(points),
      notes: b.notes?.trim() || null,
      createdById: caller.auth.userId,
      updatedById: caller.auth.userId,
    });
    await audit(prisma, caller, caller.auth.userId, 'QMS_FORMAT_CREATED', 'qms_format', { id, code }, PAGE, { type: b.type });
    return this.get(id);
  },
  async update(caller: Caller, id: string, ifMatch: number, b: Partial<Omit<FormatInput, 'type'>> & { status?: 'ACTIVE' | 'RETIRED' | undefined }) {
    const code = b.code?.trim();
    if (code && (await taken(code, id))) throw Errors.validation({ code: 'This number is already used.' });
    await assertCategory(b.categoryId);
    await prisma.$transaction(async (tx) => {
      const cur = (await query(tx, `SELECT * FROM qms_formats WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE`, id))[0];
      if (!cur) throw Errors.notFound('Format not found.');
      checkVersion(cur, ifMatch);
      if (S(cur.type) === 'RECORD_FORMAT' && b.categoryId === null) throw Errors.validation({ categoryId: 'Choose a category.' });
      const points = b.points === undefined ? undefined : b.points.map((p) => p.trim()).filter(Boolean);
      if (points && S(cur.type) !== 'RECORD_FORMAT' && points.length === 0)
        throw Errors.validation({ points: 'Add at least one check point (one per line).' });
      await updateRow(tx, 'qms_formats', id, {
        categoryId: b.categoryId,
        code,
        title: b.title?.trim(),
        revision: b.revision,
        effectiveDate: b.effectiveDate === undefined ? undefined : b.effectiveDate || null,
        points: points === undefined ? undefined : JSON.stringify(points),
        notes: b.notes === undefined ? undefined : b.notes?.trim() || null,
        status: b.status,
        updatedById: caller.auth.userId,
      });
      await exec(tx, `UPDATE qms_formats SET updated_at=now(), version=version+1 WHERE id=$1::uuid`, id);
      await audit(tx, caller, caller.auth.userId, 'QMS_FORMAT_UPDATED', 'qms_format', { id, code: code ?? S(cur.code) }, PAGE);
    }, TX);
    return this.get(id);
  },
  async remove(caller: Caller, id: string) {
    const cur = await this.get(id);
    await exec(prisma, `UPDATE qms_formats SET deleted_at=now(), deleted_by_id=$1::uuid WHERE id=$2::uuid`, caller.auth.userId, id);
    await audit(prisma, caller, caller.auth.userId, 'QMS_FORMAT_DELETED', 'qms_format', { id, code: S(cur.code) }, PAGE);
  },

  async features() {
    // unpaginated: three fixed switches
    const rows = await query(
      prisma,
      `SELECT f.key, f.enabled, f.updated_at, u.name AS updated_by_name FROM qms_features f LEFT JOIN users u ON u.id=f.updated_by_id`,
    );
    return (Object.keys(FEATURES) as FeatureKey[]).map((key) => {
      const r = rows.find((x) => S(x.key) === key);
      return {
        key,
        ...FEATURES[key],
        enabled: r ? r.enabled === true : true,
        updatedByName: r?.updated_by_name ? S(r.updated_by_name) : null,
      };
    });
  },
  async setFeature(caller: Caller, key: FeatureKey, enabled: boolean) {
    await exec(
      prisma,
      `INSERT INTO qms_features (key, enabled, updated_at, updated_by_id) VALUES ($1,$2::boolean,now(),$3::uuid)
       ON CONFLICT (key) DO UPDATE SET enabled=EXCLUDED.enabled, updated_at=now(), updated_by_id=EXCLUDED.updated_by_id`,
      key,
      enabled,
      caller.auth.userId,
    );
    await audit(prisma, caller, caller.auth.userId, 'QMS_FEATURE_SET', 'qms_feature', { id: caller.auth.userId, code: key }, PAGE, { enabled });
    return this.features();
  },
};
