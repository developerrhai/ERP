// DuplicateService.check (docs/phases/PHASE-06.md §5): finds likely duplicate customers / suppliers while the
// user types. BLOCK stops the save, WARN needs "This is a different party", INFO offers a link.
import { prisma } from '../../core/db/prisma';
import { gstinDuplicate, normaliseGstin, normaliseName } from './party-rules';
import { accountHash } from './bank-crypto';

export type PartyKind = 'CUSTOMER' | 'SUPPLIER';
export type DupLevel = 'BLOCK' | 'WARN' | 'INFO';

export interface DupHit {
  level: DupLevel;
  field: string;
  message: string;
  matchId: string;
  matchKind: PartyKind;
  matchCode: string;
}

export interface DupInput {
  kind: PartyKind;
  gstin?: string | null;
  pan?: string | null;
  name?: string | null;
  city?: string | null;
  mobile?: string | null;
  email?: string | null;
  accountNo?: string | null;
  excludeId?: string | null;
  /** The caller may override a bank-account BLOCK (permission "approve"). */
  canOverrideBank?: boolean;
}

interface PartyRow {
  id: string;
  code: string;
  name: string;
}

const SIMILARITY = 0.8;

export const duplicateService = {
  async check(input: DupInput): Promise<DupHit[]> {
    const hits: DupHit[] = [];
    const same = input.kind;
    const other: PartyKind = same === 'CUSTOMER' ? 'SUPPLIER' : 'CUSTOMER';
    const exclude = input.excludeId ?? '00000000-0000-0000-0000-000000000000';
    const table = (k: PartyKind) => (k === 'CUSTOMER' ? 'customers' : 'suppliers');
    const contactTable = (k: PartyKind) =>
      k === 'CUSTOMER' ? 'customer_contacts' : 'supplier_contacts';
    const addressTable = (k: PartyKind) =>
      k === 'CUSTOMER' ? 'customer_addresses' : 'supplier_addresses';
    const fk = (k: PartyKind) => (k === 'CUSTOMER' ? 'customer_id' : 'supplier_id');

    const byGstin = async (kind: PartyKind): Promise<PartyRow[]> => {
      if (!input.gstin) return [];
      return prisma.$queryRawUnsafe<PartyRow[]>(
        `SELECT id, code, name FROM ${table(kind)} WHERE gstin = $1 AND deleted_at IS NULL AND id <> $2::uuid`,
        normaliseGstin(input.gstin),
        exclude,
      );
    };

    for (const m of await byGstin(same)) {
      hits.push({
        level: 'BLOCK',
        field: 'gstin',
        message: gstinDuplicate(m.code, m.name),
        matchId: m.id,
        matchKind: same,
        matchCode: m.code,
      });
    }
    for (const m of await byGstin(other)) {
      hits.push({
        level: 'INFO',
        field: 'gstin',
        message: `${other === 'CUSTOMER' ? 'Customer' : 'Supplier'} ${m.code} – ${m.name} has this GSTIN. You can link them.`,
        matchId: m.id,
        matchKind: other,
        matchCode: m.code,
      });
    }

    if (input.pan) {
      const rows = await prisma.$queryRawUnsafe<PartyRow[]>(
        `SELECT id, code, name FROM ${table(same)} WHERE pan = $1 AND deleted_at IS NULL AND id <> $2::uuid
           AND ($3::text IS NULL OR gstin IS DISTINCT FROM $3)`,
        input.pan.toUpperCase(),
        exclude,
        input.gstin ? normaliseGstin(input.gstin) : null,
      );
      for (const m of rows) {
        hits.push({
          level: 'WARN',
          field: 'pan',
          message: `Same PAN as ${m.code} – ${m.name}.`,
          matchId: m.id,
          matchKind: same,
          matchCode: m.code,
        });
      }
    }

    if (input.name && input.city) {
      const key = normaliseName(input.name);
      if (key.length >= 3) {
        const rows = await prisma.$queryRawUnsafe<PartyRow[]>(
          `SELECT DISTINCT p.id, p.code, p.name
             FROM ${table(same)} p
             JOIN ${addressTable(same)} a ON a.${fk(same)} = p.id
            WHERE p.deleted_at IS NULL AND p.id <> $1::uuid
              AND similarity(p.name_key, $2) >= $3 AND lower(a.city) = lower($4)`,
          exclude,
          key,
          SIMILARITY,
          input.city,
        );
        for (const m of rows) {
          hits.push({
            level: 'WARN',
            field: 'name',
            message: `Similar name in the same city: ${m.code} – ${m.name}.`,
            matchId: m.id,
            matchKind: same,
            matchCode: m.code,
          });
        }
      }
    }

    for (const [field, value] of [
      ['mobile', input.mobile],
      ['email', input.email?.toLowerCase()],
    ] as const) {
      if (!value) continue;
      const rows = await prisma.$queryRawUnsafe<PartyRow[]>(
        `SELECT DISTINCT p.id, p.code, p.name
           FROM ${table(same)} p JOIN ${contactTable(same)} c ON c.${fk(same)} = p.id
          WHERE p.deleted_at IS NULL AND p.id <> $1::uuid AND lower(c.${field}) = lower($2)`,
        exclude,
        value,
      );
      for (const m of rows) {
        hits.push({
          level: 'WARN',
          field,
          message: `Same ${field} as ${m.code} – ${m.name}.`,
          matchId: m.id,
          matchKind: same,
          matchCode: m.code,
        });
      }
    }

    if (same === 'SUPPLIER' && input.accountNo) {
      const rows = await prisma.$queryRawUnsafe<PartyRow[]>(
        `SELECT DISTINCT s.id, s.code, s.name
           FROM suppliers s JOIN supplier_bank_accounts b ON b.supplier_id = s.id
          WHERE s.deleted_at IS NULL AND s.id <> $1::uuid AND b.account_hash = $2`,
        exclude,
        accountHash(input.accountNo),
      );
      for (const m of rows) {
        hits.push({
          level: input.canOverrideBank ? 'WARN' : 'BLOCK',
          field: 'accountNo',
          message: `This bank account belongs to supplier ${m.code}. Ask an approver.`,
          matchId: m.id,
          matchKind: 'SUPPLIER',
          matchCode: m.code,
        });
      }
    }
    return hits;
  },
};

/** DUP_WARN text for the UI / API when WARN items are present and not acknowledged. */
export function dupWarnMessage(hits: readonly DupHit[]): string {
  const list = hits
    .filter((h) => h.level === 'WARN')
    .map((h) => h.matchCode)
    .filter((c, i, a) => a.indexOf(c) === i)
    .join(', ');
  return `Possible duplicate: ${list}. Tick 'This is a different party' to continue.`;
}
