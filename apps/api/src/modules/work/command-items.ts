// Command Center items added by hand (V40 page command-center). Plant scoped; every change is audited.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';

export interface CommandItemInput {
  issue: string;
  owner?: string | null;
  severity?: 'Critical' | 'High' | 'Medium' | 'Low';
  dueDate?: string | null;
  departmentId?: string | null;
}

const SEL = `SELECT c.id::text AS id, c.number, c.issue, c.owner_name, c.severity, c.due_date::text AS due_date, c.status, c.created_at,
                    c.department_id::text AS department_id, d.name AS department, c.closed_at
               FROM command_items c LEFT JOIN departments d ON d.id = c.department_id`;

export const commandItems = {
  /** Open items of the caller's plants, newest first (closed ones too when `all`). */
  async list(caller: Caller, all: boolean): Promise<Row[]> {
    return query(prisma, `${SEL} WHERE c.unit_id = ANY($1::uuid[]) AND ($2 OR c.status = 'Open') ORDER BY c.created_at DESC LIMIT 200`, caller.ctx.unitIds, all);
  },

  async create(caller: Caller, input: CommandItemInput): Promise<Row> {
    const issue = input.issue.trim();
    if (!issue) throw Errors.validation({ issue: 'Write what needs action.' });
    const unitId = caller.ctx.unitId ?? caller.ctx.unitIds[0];
    if (!unitId) throw Errors.contextInvalid('Choose a plant first.');
    return prisma.$transaction(async (tx) => {
      const seq = Number((await query(tx, `SELECT nextval('command_item_seq')::int AS n`))[0]?.n ?? 1);
      const number = `CMD-${new Date().toISOString().slice(2, 4)}${new Date().toISOString().slice(5, 7)}-${String(seq).padStart(4, '0')}`;
      const row = (
        await query(
          tx,
          `INSERT INTO command_items (unit_id, number, department_id, issue, owner_name, severity, due_date, created_by_id)
           VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::date, $8::uuid) RETURNING id::text AS id`,
          unitId,
          number,
          input.departmentId ?? null,
          issue,
          input.owner?.trim() || null,
          input.severity ?? 'Medium',
          input.dueDate ?? null,
          caller.auth.user.id,
        )
      )[0]!;
      await recordAudit({ action: 'command_item.created', actorId: caller.auth.user.id, targetType: 'command_item', targetId: String(row.id), detail: { number, severity: input.severity ?? 'Medium' } }, tx);
      return (await query(tx, `${SEL} WHERE c.id = $1::uuid`, String(row.id)))[0]!;
    });
  },

  async close(caller: Caller, id: string): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const cur = (await query(tx, `SELECT unit_id::text AS unit_id, number, status FROM command_items WHERE id = $1::uuid FOR UPDATE`, id))[0];
      if (!cur || !caller.ctx.unitIds.includes(String(cur.unit_id))) throw Errors.notFound('Command item not found.');
      if (String(cur.status) === 'Closed') throw Errors.conflict('This item is already closed.');
      await query(tx, `UPDATE command_items SET status = 'Closed', closed_at = now(), closed_by_id = $2::uuid, updated_at = now() WHERE id = $1::uuid`, id, caller.auth.user.id);
      await recordAudit({ action: 'command_item.closed', actorId: caller.auth.user.id, targetType: 'command_item', targetId: id, detail: { number: String(cur.number) } }, tx);
      return (await query(tx, `${SEL} WHERE c.id = $1::uuid`, id))[0]!;
    });
  },
};
