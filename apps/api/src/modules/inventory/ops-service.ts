// Operations around the cut-over (Phase 8 steps 1, 9, 13): the PRE-FLIGHT job (is the data ready for the new
// rules?), the GL CUT-OVER (one opening journal per unit that brings the GL inventory accounts level with the stock
// ledger, so stock value = GL from then on) and the DAILY job (reservations that ran out, reorder suggestions,
// expiry and reorder alerts through Phase 5 notifications). Nothing here edits a posted row.
import { Prisma } from '@prisma/client';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { logger } from '../../core/logger';
import type { Caller } from '../records/service';
import { notificationService } from '../notifications/service';
import { PostingService } from '../finance/posting-service';
import type { EventLine } from '../finance/posting-service';
import { D, ZERO, round2, str } from './money';
import { expiry, integrity, reorderService } from './reports-service';
import { reservationService } from './reservations-service';

const todayIso = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------------------------
export interface PreflightCheck {
  id: string;
  name: string;
  /** blocker = migration D / go-live must wait; warning = fix when convenient; info = nothing to fix */
  level: 'blocker' | 'warning' | 'info';
  count: number;
  sample: string[];
}

export async function preflight(
  db: Db = prisma,
): Promise<{ ready: boolean; checks: PreflightCheck[] }> {
  const rows = async (s: Prisma.Sql) => db.$queryRaw<{ ref: string }[]>(s);
  const mk = (
    id: string,
    name: string,
    level: PreflightCheck['level'],
    r: { ref: string }[],
  ): PreflightCheck => ({
    id,
    name,
    level,
    count: r.length,
    sample: r.slice(0, 10).map((x) => x.ref),
  });
  const checks: PreflightCheck[] = [
    mk(
      'P-01',
      'Vouchers with no lines (the lines backfill must cover every voucher)',
      'blocker',
      await rows(
        Prisma.sql`SELECT v.number AS ref FROM stock_vouchers v WHERE v.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stock_voucher_lines l WHERE l.voucher_id = v.id)`,
      ),
    ),
    mk(
      'P-02',
      'Ledger voucher types missing from the voucher-type lookup',
      'blocker',
      await rows(
        Prisma.sql`SELECT DISTINCT l.voucher_type AS ref FROM stock_ledger l LEFT JOIN stock_voucher_types t ON t.code = l.voucher_type WHERE t.code IS NULL`,
      ),
    ),
    mk(
      'P-03',
      'Items that are both batch- and serial-tracked (items_one_tracking cannot be validated)',
      'blocker',
      await rows(Prisma.sql`SELECT code AS ref FROM items WHERE batch_tracked AND serial_tracked`),
    ),
    mk(
      'P-04',
      'Items with no HSN / SAC (items_hsn_required cannot be validated)',
      'warning',
      await rows(
        Prisma.sql`SELECT code AS ref FROM items WHERE hsn_id IS NULL AND deleted_at IS NULL`,
      ),
    ),
    mk(
      'P-05',
      'Batch-tracked items that hold stock without a batch (receive it into a batch with an adjustment)',
      'warning',
      await rows(
        Prisma.sql`SELECT i.code AS ref FROM items i JOIN stock_slices s ON s.item_id = i.id AND s.batch_id = '00000000-0000-0000-0000-000000000000' WHERE i.batch_tracked AND s.qty > 0 GROUP BY i.code`,
      ),
    ),
    mk(
      'P-06',
      'Serial-tracked items that hold stock without serial numbers',
      'warning',
      await rows(
        Prisma.sql`SELECT i.code AS ref FROM items i JOIN stock_balances b ON b.item_id = i.id WHERE i.serial_tracked AND b.on_hand > 0 AND NOT EXISTS (SELECT 1 FROM serial_numbers s WHERE s.item_id = i.id AND s.status IN ('In Stock','Reserved')) GROUP BY i.code`,
      ),
    ),
    mk(
      'P-07',
      'Units with no cost centre (issues and adjustments cannot post to the GL)',
      'blocker',
      await rows(
        Prisma.sql`SELECT u.code AS ref FROM units u WHERE u.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM cost_centers c WHERE c.unit_id = u.id AND NOT c.is_group)`,
      ),
    ),
    mk(
      'P-08',
      'Old event-queue rows still PENDING (replaced by inline GL posting)',
      'warning',
      await rows(
        Prisma.sql`SELECT event || ' ' || doc_id::text AS ref FROM accounting_event_queue WHERE status = 'PENDING'`,
      ),
    ),
    mk(
      'P-09',
      'Units whose stock value differs from the GL (run the GL cut-over)',
      'info',
      await rows(Prisma.sql`
        SELECT u.code AS ref FROM units u
        WHERE COALESCE((SELECT sum(l.value) FROM stock_ledger l WHERE l.unit_id = u.id), 0) <>
              COALESCE((SELECT sum(g.debit - g.credit) FROM gl_entries g JOIN account_defaults d ON d.account_id = g.account_id
                        WHERE g.unit_id = u.id AND d.key IN ('INVENTORY_RM','INVENTORY_WIP','INVENTORY_FG','STOCK_IN_TRANSIT')), 0)`),
    ),
    mk(
      'P-10',
      'Units without a GSTIN (transfers between units compare GSTINs)',
      'info',
      await rows(
        Prisma.sql`SELECT code AS ref FROM units WHERE gstin IS NULL AND status = 'ACTIVE'`,
      ),
    ),
  ];
  const integ = await integrity(db);
  for (const c of integ.checks.filter((x) => ['INV-1', 'INV-2', 'INV-3', 'INV-4'].includes(x.id))) {
    checks.push({
      id: `P-${c.id}`,
      name: c.name,
      level: 'blocker',
      count: c.mismatches.length,
      sample: c.mismatches.slice(0, 10).map((m) => m.ref),
    });
  }
  return { ready: checks.every((c) => c.level !== 'blocker' || c.count === 0), checks };
}

// ---------------------------------------------------------------------------------------------
// GL cut-over
// ---------------------------------------------------------------------------------------------
const INVENTORY_KEYS = [
  'INVENTORY_RM',
  'INVENTORY_WIP',
  'INVENTORY_FG',
  'STOCK_IN_TRANSIT',
] as const;

export const cutoverService = {
  /** What the cut-over would post for a unit: stock value minus GL balance, per inventory key. */
  async plan(unitId: string, asOf = todayIso(), db: Db = prisma) {
    const stock = await db.$queryRaw<{ k: string; v: string }[]>`
      SELECT CASE WHEN w.is_transit THEN 'STOCK_IN_TRANSIT' ELSE COALESCE(m.inventory_key, 'INVENTORY_RM') END AS k, COALESCE(sum(l.value),0)::text AS v
      FROM stock_ledger l JOIN warehouses w ON w.id = l.warehouse_id JOIN items i ON i.id = l.item_id
      LEFT JOIN item_type_accounts m ON m.item_type = i.item_type
      WHERE w.unit_id = ${unitId}::uuid AND l.posting_date <= ${asOf}::date GROUP BY k`;
    const defaults = await db.accountDefault.findMany({
      where: { key: { in: [...INVENTORY_KEYS] } },
    });
    const lines: {
      key: string;
      stock: Prisma.Decimal;
      gl: Prisma.Decimal;
      diff: Prisma.Decimal;
    }[] = [];
    for (const key of INVENTORY_KEYS) {
      const def = defaults.find((d) => d.key === key);
      if (!def) continue;
      const g = await db.glEntry.aggregate({
        where: {
          unitId,
          accountId: def.accountId,
          postingDate: { lte: new Date(`${asOf}T00:00:00Z`) },
        },
        _sum: { debit: true, credit: true },
      });
      const gl = D(g._sum.debit ?? 0).minus(g._sum.credit ?? 0);
      const st = D(stock.find((s) => s.k === key)?.v ?? '0');
      lines.push({ key, stock: st, gl, diff: round2(st.minus(gl)) });
    }
    return { unitId, asOf, lines, needed: lines.some((l) => !l.diff.isZero()) };
  },

  /** One opening journal for the unit: Dr / Cr each inventory account by its difference, the balance on OPENING_BALANCE_EQUITY. */
  async run(caller: Caller, unitId: string, asOf: string) {
    if (await prisma.inventoryGlCutover.findUnique({ where: { unitId } })) {
      throw Errors.conflict(
        'The GL cut-over was already done for this unit. Stock now posts to the GL as it moves.',
      );
    }
    const unit = await prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit) throw Errors.notFound('Unit not found.');
    return prisma.$transaction(async (tx) => {
      const plan = await cutoverService.plan(unitId, asOf, tx);
      let journalId: string | null = null;
      let total = ZERO;
      if (plan.needed) {
        const lines: EventLine[] = [];
        let net = ZERO;
        for (const l of plan.lines) {
          if (l.diff.isZero()) continue;
          lines.push({
            account: l.key,
            debit: l.diff.greaterThan(0) ? str(l.diff) : '0.00',
            credit: l.diff.lessThan(0) ? str(l.diff.abs()) : '0.00',
            unitId,
          });
          net = net.plus(l.diff);
          total = total.plus(l.diff.abs());
        }
        lines.push({
          account: 'OPENING_BALANCE_EQUITY',
          debit: net.lessThan(0) ? str(net.abs()) : '0.00',
          credit: net.greaterThan(0) ? str(net) : '0.00',
          unitId,
        });
        const j = await PostingService.postJournal(
          tx,
          {
            unitId,
            docDate: asOf,
            voucherType: 'Opening',
            source: 'EVENT',
            narration: `Inventory GL cut-over ${unit.code} as of ${asOf}`,
            sourceDocType: 'inventory_cutover',
            sourceDocId: unitId,
            sourceDocNo: `CUTOVER-${unit.code}`,
            event: 'INVENTORY_GL_CUTOVER',
            payload: { docNo: `CUTOVER-${unit.code}`, lines },
          },
          { userId: caller.auth.userId },
        );
        journalId = j.id;
      }
      const row = await tx.inventoryGlCutover.create({
        data: {
          unitId,
          asOf: new Date(`${asOf}T00:00:00Z`),
          stockValue: str(plan.lines.reduce((a, l) => a.plus(l.stock), ZERO)),
          journalId,
          status: plan.needed ? 'Done' : 'Skipped',
          createdById: caller.auth.userId,
        },
      });
      const drained =
        await tx.$executeRaw`UPDATE accounting_event_queue SET status = 'FAILED', error = 'Replaced by inline GL posting (Phase 8 cut-over)', processed_at = now() WHERE status = 'PENDING' AND (unit_id = ${unitId}::uuid OR unit_id IS NULL)`;
      await recordAudit(
        {
          action: 'JOB_RUN',
          actorId: caller.auth.userId,
          targetType: 'Policy',
          targetId: row.id,
          meta: caller.meta,
          detail: {
            pageId: 'inv-valuation',
            job: 'gl-cutover',
            unitId,
            asOf,
            journalId,
            drainedQueueRows: Number(drained),
          },
        },
        tx,
      );
      return {
        id: row.id,
        status: row.status,
        journalId,
        asOf,
        lines: plan.lines.map((l) => ({
          key: l.key,
          stock: l.stock.toNumber(),
          gl: l.gl.toNumber(),
          posted: l.diff.toNumber(),
        })),
      };
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Daily job
// ---------------------------------------------------------------------------------------------
async function recipients(tx: Db, pageId: string): Promise<string[]> {
  const control = await tx.moduleControl.findUnique({
    where: { pageId },
    select: { ownerDepartment: true },
  });
  const dept = control?.ownerDepartment;
  const ids = dept
    ? (
        await tx.user.findMany({
          where: { status: 'ACTIVE', department: dept },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [];
  const admins = await notificationService.usersAtLevel(tx, 95);
  return [...new Set([...ids, ...admins])];
}

export async function runInventoryDaily(): Promise<{
  expiredReservations: number;
  reorderOpen: number;
  expiryAlerts: number;
}> {
  const expired = await reservationService.expireDue();
  const re = await reorderService.recalculate(prisma);
  const asOf = todayIso();
  let alerts = 0;
  const caller = { ctx: { unitId: null, allUnits: true } } as unknown as Caller;
  const near = await expiry(caller, { asOf, page: 1, size: 500 });
  const due = near.rows.filter((r) => r.band === 'Expired' || r.band === 'Critical');
  if (due.length > 0) {
    await prisma.$transaction(async (tx) => {
      const to = await recipients(tx, 'inv-expiry');
      await notificationService.notify(tx, to, {
        type: 'STOCK_EXPIRING',
        title: `${due.length} batch(es) expired or expiring within 30 days`,
        body: due
          .slice(0, 5)
          .map((r) => `${r.itemCode} ${r.batchNo} (${r.expiryDate})`)
          .join(', '),
        link: '/m/inv-expiry',
        dedupeKey: `stock-expiry:${asOf}`,
      });
    });
    alerts = due.length;
  }
  if (re.open > 0) {
    await prisma.$transaction(async (tx) => {
      const to = await recipients(tx, 'inv-reorder');
      await notificationService.notify(tx, to, {
        type: 'STOCK_REORDER',
        title: `${re.open} item(s) need re-ordering`,
        link: '/m/inv-reorder',
        dedupeKey: `stock-reorder:${asOf}`,
      });
    });
  }
  logger.info({ expired, reorderOpen: re.open, alerts }, 'inventory.daily done');
  return { expiredReservations: expired, reorderOpen: re.open, expiryAlerts: alerts };
}
