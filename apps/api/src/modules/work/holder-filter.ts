// "Department Filter" of a register: which records are with a department right now. A record is with the department its open
// Move Forward is addressed to; a record that has no open movement is with the department that owns the page.
import { createHash } from 'node:crypto';
import { prisma } from '../../core/db/prisma';
import { OPEN_STATES } from './calc';

export interface HolderScope {
  /** Show only these records. */
  only?: string[];
  /** Show every record except these. */
  except?: string[];
}

export async function holderScope(docType: string, department: string, owner: string): Promise<HolderScope> {
  // unpaginated: the open movements of one page (at most one per record that is travelling)
  const rows = await prisma.$queryRaw<{ id: string; dept: string }[]>`
    SELECT m.doc_id::text AS id, d.name AS dept
    FROM work_movements m JOIN departments d ON d.id = m.to_department_id
    WHERE m.doc_type = ${docType} AND m.state = ANY(${[...OPEN_STATES]}::text[])`;
  return department === owner
    ? { except: rows.filter((r) => r.dept !== owner).map((r) => r.id) }
    : { only: rows.filter((r) => r.dept === department).map((r) => r.id) };
}

export interface Holder {
  doc_id: string;
  department: string;
  state: string;
}

/** The records of one page that are travelling between departments now, with who holds each. */
export async function openHolders(docType: string, unitIds: string[]): Promise<Holder[]> {
  return prisma.$queryRaw<Holder[]>`
    SELECT DISTINCT ON (m.doc_id) m.doc_id::text AS doc_id, d.name AS department, m.state
    FROM work_movements m JOIN departments d ON d.id = m.to_department_id
    WHERE m.doc_type = ${docType} AND m.state = ANY(${[...OPEN_STATES]}::text[])
      AND m.unit_id = ANY(${unitIds}::uuid[])
    ORDER BY m.doc_id, m.sent_at DESC
    LIMIT 2000`;
}

/** The id of a Stock Balance row, the same value the view stock_balance_records derives: md5 of "item:warehouse". */
export function stockRecordId(itemId: string, warehouseId: string): string {
  const h = createHash('md5').update(`${itemId}:${warehouseId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
