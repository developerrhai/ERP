// Finance-side tax REGISTERS (05a 4.1.3 tax block, 05b M5). A producer sends the tax amounts it computed
// (its own TaxService); Finance only (a) refuses GST that is not tied to a real GSTIN, (b) checks the lines add
// up and agree with the GST ledger lines of the journal, (c) stores the sales / purchase register rows and the
// TDS register, (d) records the deposit challans. Finance computes NO rate and files NOTHING (R-11, R-12, D-21).
import { recordAudit } from '../../core/audit/audit-service';
import type { Db } from '../../core/db/prisma';
import { prisma } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import type { ErrorCode } from '../../core/http/errors';
import { knownStates } from '../masters/tax-service';
import { validateGstin } from '../masters/party-rules';
import type { Actor } from './accounts-service';
import { cashBankService } from './cash-bank-service';
import { assertJournalNotFiled } from '../tax/period-lock';
import { FinErrors } from './errors';
import { D, ZERO, isoDate, money, parseMoney } from './money';
import type { Dec } from './money';

export interface TaxLine {
  hsn: string;
  uqc?: string;
  qty?: string;
  taxable: string;
  rate: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
}
export interface TaxBlock {
  direction: 'OUTWARD' | 'INWARD';
  docKind: 'INV' | 'CRN' | 'DBN';
  partyName: string;
  partyGstin?: string;
  partyStateCode?: string;
  placeOfSupplyStateCode: string;
  reverseCharge?: boolean;
  lines: TaxLine[];
}
export interface TdsBlock {
  sectionCode: string;
  baseAmount: string;
  ratePct: string;
  tdsAmount: string;
  kind?: 'TDS' | 'TCS';
}

const OUTPUT = { cgst: '2301', sgst: '2302', igst: '2303', cess: '2304' } as const;
const INPUT = { cgst: '1401', sgst: '1402', igst: '1403', cess: '1404' } as const;
const RCM = { cgst: '2305', sgst: '2306', igst: '2307', cess: '2308' } as const;
type Head = 'cgst' | 'sgst' | 'igst' | 'cess';
const HEADS: Head[] = ['cgst', 'sgst', 'igst', 'cess'];

/** net movement of an account code inside one journal, in the natural direction asked for */
async function journalNet(
  db: Db,
  journalId: string,
  code: string,
  nature: 'debit' | 'credit',
): Promise<Dec> {
  const rows = await db.$queryRaw<{ n: string }[]>`
    SELECT COALESCE(SUM(CASE WHEN ${nature} = 'debit' THEN g.debit - g.credit ELSE g.credit - g.debit END), 0)::text AS n
      FROM gl_entries g JOIN accounts a ON a.id = g.account_id
     WHERE g.journal_id = ${journalId}::uuid AND a.code = ${code}`;
  return D(rows[0]?.n ?? 0);
}

export const taxService = {
  /** Called by PostingService right after an event journal is written. */
  async recordFromEvent(
    tx: Db,
    p: {
      unitId: string;
      journalId: string;
      docNo: string;
      docDate: string;
      partyType: 'CUSTOMER' | 'SUPPLIER' | null;
      partyId: string | null;
      tax?: TaxBlock | undefined;
      tds?: TdsBlock | undefined;
      actorId: string;
    },
  ): Promise<void> {
    if (p.tax) await recordTax(tx, p as typeof p & { tax: TaxBlock });
    if (p.tds) await recordTds(tx, p as typeof p & { tds: TdsBlock });
  },

  /** Reversal / cancel of the journal: the register rows are cancelled; a deposited TDS entry blocks it. */
  async cancelForJournal(tx: Db, journalId: string): Promise<void> {
    await assertJournalNotFiled(tx, journalId);
    const deposited = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM tds_entries WHERE journal_id = ${journalId}::uuid AND challan_id IS NOT NULL AND status = 'Active'`;
    if (Number(deposited[0]?.n ?? 0) > 0) {
      throw FinErrors.tdsAlreadyDeposited(
        'The tax deducted on this document is already deposited with a challan. Issue a note instead.',
      );
    }
    await tx.$executeRaw`UPDATE tax_documents SET status = 'Cancelled' WHERE journal_id = ${journalId}::uuid`;
    await tx.$executeRaw`UPDATE tds_entries SET status = 'Cancelled' WHERE journal_id = ${journalId}::uuid`;
  },

  async register(q: {
    direction: 'OUTWARD' | 'INWARD';
    from: string;
    to: string;
    unitId: string | null;
  }) {
    const rows = await prisma.$queryRaw<
      {
        id: string;
        doc_kind: string;
        doc_no: string;
        doc_date: Date;
        party_name: string;
        party_gstin: string | null;
        place_of_supply: string;
        reverse_charge: boolean;
        taxable: string;
        cgst: string;
        sgst: string;
        igst: string;
        cess: string;
        status: string;
      }[]
    >`
      SELECT id, doc_kind, doc_no, doc_date, party_name, party_gstin, place_of_supply, reverse_charge,
             taxable::text, cgst::text, sgst::text, igst::text, cess::text, status
        FROM tax_documents
       WHERE direction = ${q.direction} AND doc_date BETWEEN ${q.from}::date AND ${q.to}::date
         AND (${q.unitId}::uuid IS NULL OR unit_id = ${q.unitId}::uuid)
       ORDER BY doc_date, doc_no`;
    const live = rows.filter((r) => r.status === 'Active');
    const sum = (k: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'cess') =>
      money(live.reduce((s, r) => s.plus(r[k]), ZERO));
    return {
      direction: q.direction,
      from: q.from,
      to: q.to,
      totals: {
        taxable: sum('taxable'),
        cgst: sum('cgst'),
        sgst: sum('sgst'),
        igst: sum('igst'),
        cess: sum('cess'),
      },
      rows: rows.map((r) => ({
        id: r.id,
        docKind: r.doc_kind,
        docNo: r.doc_no,
        docDate: isoDate(r.doc_date),
        partyName: r.party_name,
        partyGstin: r.party_gstin,
        placeOfSupply: r.place_of_supply,
        reverseCharge: r.reverse_charge,
        taxable: money(r.taxable),
        cgst: money(r.cgst),
        sgst: money(r.sgst),
        igst: money(r.igst),
        cess: money(r.cess),
        status: r.status,
      })),
    };
  },

  async tdsRegister(q: { kind: 'TDS' | 'TCS'; from: string; to: string; unitId: string | null }) {
    const rows = await prisma.$queryRaw<
      {
        id: string;
        section_code: string;
        supplier_id: string | null;
        supplier: string | null;
        base_amount: string;
        rate_pct: string;
        tds_amount: string;
        deducted_on: Date;
        source_doc_no: string | null;
        challan_no: string | null;
        status: string;
      }[]
    >`
      SELECT e.id, e.section_code, e.supplier_id, s.name AS supplier, e.base_amount::text, e.rate_pct::text, e.tds_amount::text,
             e.deducted_on, e.source_doc_no, c.challan_no, e.status
        FROM tds_entries e LEFT JOIN suppliers s ON s.id = e.supplier_id LEFT JOIN tax_challans c ON c.id = e.challan_id
       WHERE e.kind = ${q.kind} AND e.deducted_on BETWEEN ${q.from}::date AND ${q.to}::date
         AND (${q.unitId}::uuid IS NULL OR e.unit_id = ${q.unitId}::uuid)
       ORDER BY e.deducted_on, e.id`;
    const live = rows.filter((r) => r.status === 'Active');
    return {
      kind: q.kind,
      totalDeducted: money(live.reduce((s, r) => s.plus(r.tds_amount), ZERO)),
      pendingDeposit: money(
        live.filter((r) => !r.challan_no).reduce((s, r) => s.plus(r.tds_amount), ZERO),
      ),
      rows: rows.map((r) => ({
        id: r.id,
        sectionCode: r.section_code,
        supplierId: r.supplier_id,
        supplier: r.supplier,
        baseAmount: money(r.base_amount),
        ratePct: r.rate_pct,
        tdsAmount: money(r.tds_amount),
        deductedOn: isoDate(r.deducted_on),
        docNo: r.source_doc_no,
        challanNo: r.challan_no,
        status: r.status,
      })),
    };
  },

  /** Deposit the tax deducted: posts Dr TDS Payable / Cr bank, stores the challan and tags the entries. */
  async depositChallan(
    input: {
      unitId: string;
      taxKind: 'TDS' | 'TCS';
      bankAccountId: string;
      paidOn: string;
      challanNo: string;
      bsrCode?: string;
      entryIds: string[];
    },
    actor: Actor,
  ) {
    return prisma.$transaction(
      async (tx) => {
        if (
          await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM tax_challans WHERE tax_kind = ${input.taxKind} AND challan_no = ${input.challanNo}`.then(
            (r) => r.length,
          )
        ) {
          throw Errors.duplicate({ challanNo: 'This challan number is already recorded.' });
        }
        const entries = await tx.$queryRaw<{ id: string; tds_amount: string }[]>`
          SELECT id, tds_amount::text FROM tds_entries
           WHERE id = ANY(${input.entryIds}::uuid[]) AND unit_id = ${input.unitId}::uuid AND kind = ${input.taxKind}
             AND status = 'Active' AND challan_id IS NULL FOR UPDATE`;
        if (entries.length !== input.entryIds.length || entries.length === 0) {
          throw FinErrors.challanMismatch(
            'Some entries are missing, already deposited or belong to another unit.',
            { entryIds: 'Check the selected entries.' },
          );
        }
        const amount = entries.reduce((s, e) => s.plus(e.tds_amount), ZERO);
        if (!amount.greaterThan(0))
          throw FinErrors.challanMismatch('The selected entries total nothing.');
        const payableCode = input.taxKind === 'TDS' ? '2311' : '2312';
        const payable = await tx.account.findUniqueOrThrow({ where: { code: payableCode } });
        const paid = await cashBankService.createPaymentIn(
          tx,
          {
            kind: 'PAYMENT',
            docDate: input.paidOn,
            bankAccountId: input.bankAccountId,
            counterAccountId: payable.id,
            amount: amount.toFixed(2),
            mode: 'NEFT',
            referenceNo: input.challanNo,
            narration: `${input.taxKind} challan ${input.challanNo}`,
          },
          actor,
        );
        const rows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO tax_challans (unit_id, tax_kind, challan_no, bsr_code, paid_on, amount, bank_account_id, payment_id, created_by_id)
          VALUES (${input.unitId}::uuid, ${input.taxKind}, ${input.challanNo}, ${input.bsrCode ?? null}, ${input.paidOn}::date, ${amount.toFixed(2)}::numeric,
                  ${input.bankAccountId}::uuid, ${paid.payment.id}::uuid, ${actor.userId}::uuid) RETURNING id`;
        const challanId = rows[0]?.id as string;
        await tx.$executeRaw`UPDATE tds_entries SET challan_id = ${challanId}::uuid WHERE id = ANY(${input.entryIds}::uuid[])`;
        await recordAudit(
          {
            action: 'TAX_CHALLAN_RECORDED',
            actorId: actor.userId,
            targetType: 'TaxChallan',
            targetId: challanId,
            ...(actor.meta ? { meta: actor.meta } : {}),
            detail: {
              kind: input.taxKind,
              challanNo: input.challanNo,
              amount: money(amount),
              entries: entries.length,
            },
          },
          tx,
        );
        return {
          id: challanId,
          challanNo: input.challanNo,
          amount: money(amount),
          entries: entries.length,
          paymentId: paid.payment.id,
        };
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  },

  async challans(unitId: string | null) {
    const rows = await prisma.$queryRaw<
      {
        id: string;
        tax_kind: string;
        challan_no: string;
        bsr_code: string | null;
        paid_on: Date;
        amount: string;
        entries: bigint;
      }[]
    >`
      SELECT c.id, c.tax_kind, c.challan_no, c.bsr_code, c.paid_on, c.amount::text,
             (SELECT COUNT(*) FROM tds_entries e WHERE e.challan_id = c.id)::bigint AS entries
        FROM tax_challans c WHERE (${unitId}::uuid IS NULL OR c.unit_id = ${unitId}::uuid) ORDER BY c.paid_on DESC, c.challan_no`;
    return rows.map((r) => ({
      id: r.id,
      taxKind: r.tax_kind,
      challanNo: r.challan_no,
      bsrCode: r.bsr_code,
      paidOn: isoDate(r.paid_on),
      amount: money(r.amount),
      entries: Number(r.entries),
    }));
  },
};

// ---------------------------------------------------------------------------------------------------------
async function recordTax(
  tx: Db,
  p: {
    unitId: string;
    journalId: string;
    docNo: string;
    docDate: string;
    partyType: 'CUSTOMER' | 'SUPPLIER' | null;
    partyId: string | null;
    tax: TaxBlock;
    actorId: string;
  },
): Promise<void> {
  const t = p.tax;
  if (!t.lines.length) throw FinErrors.taxPayloadMismatch('The tax block has no lines.');
  const states = await knownStates(tx);
  const unit = await tx.unit.findUniqueOrThrow({ where: { id: p.unitId } });
  const heads: Record<Head, Dec> = { cgst: ZERO, sgst: ZERO, igst: ZERO, cess: ZERO };
  let taxable = ZERO;
  const lines = t.lines.map((l, i) => {
    const f = (k: string) => `tax.lines.${i}.${k}`;
    const row = {
      taxable: parseMoney(l.taxable, f('taxable')),
      cgst: parseMoney(l.cgst, f('cgst')),
      sgst: parseMoney(l.sgst, f('sgst')),
      igst: parseMoney(l.igst, f('igst')),
      cess: parseMoney(l.cess, f('cess')),
    };
    for (const k of Object.keys(row) as (keyof typeof row)[]) {
      if (row[k].isNegative())
        throw FinErrors.taxPayloadMismatch(`Tax line ${i + 1}: ${k} cannot be negative.`);
    }
    if (!/^\d{4,8}$/.test(l.hsn))
      throw FinErrors.taxPayloadMismatch(`Tax line ${i + 1}: HSN / SAC must be 4 to 8 digits.`);
    taxable = taxable.plus(row.taxable);
    for (const h of HEADS) heads[h] = heads[h].plus(row[h]);
    return { ...row, hsn: l.hsn, uqc: l.uqc ?? null, qty: l.qty ?? '0', rate: l.rate };
  });
  const gstTotal = HEADS.reduce((s, h) => s.plus(heads[h]), ZERO);

  // (a) GST is booked only against real GSTINs: the unit's own, and the party's when it has one
  if (gstTotal.greaterThan(0)) {
    const own = unit.gstin ? validateGstin(unit.gstin, states.codes) : null;
    if (!own || !own.ok) {
      throw new AppError(
        422,
        'GSTIN_REQUIRED',
        "This unit has no valid GSTIN, so GST cannot be booked for it. Enter the unit's GSTIN first.",
        { unitId: 'No valid GSTIN.' },
      );
    }
    if (t.direction === 'INWARD' && !t.reverseCharge && !t.partyGstin) {
      throw new AppError(422, 'GSTIN_REQUIRED', "Input tax credit needs the supplier's GSTIN.", {
        partyGstin: 'Enter the supplier GSTIN.',
      });
    }
  }
  if (t.partyGstin) {
    const r = validateGstin(t.partyGstin, states.codes);
    if (!r.ok) throw new AppError(422, r.code as ErrorCode, r.message, { partyGstin: r.message });
    if (t.partyStateCode && r.stateCode !== t.partyStateCode) {
      throw new AppError(
        422,
        'GSTIN_STATE_MISMATCH',
        'The GSTIN state does not match the party state.',
        { partyStateCode: 'Does not match the GSTIN.' },
      );
    }
  }
  // (b) intra-state supplies carry CGST + SGST, inter-state supplies IGST: never both (structure, not a rate)
  const unitState = unit.stateCode ?? unit.gstin?.slice(0, 2) ?? null;
  if (unitState && gstTotal.greaterThan(0)) {
    const intra = unitState === t.placeOfSupplyStateCode;
    const bad = intra
      ? heads.igst.greaterThan(0)
      : heads.cgst.greaterThan(0) || heads.sgst.greaterThan(0);
    if (bad) {
      throw FinErrors.taxPayloadMismatch(
        intra
          ? 'A supply inside the state carries CGST and SGST, not IGST.'
          : 'A supply to another state carries IGST, not CGST / SGST.',
      );
    }
    if (intra && !heads.cgst.equals(heads.sgst))
      throw FinErrors.taxPayloadMismatch('CGST and SGST must be equal.');
  }
  // (c) the register must agree with the GST ledger lines of the same journal
  const book = t.direction === 'OUTWARD' ? OUTPUT : t.reverseCharge ? RCM : INPUT;
  const nature = t.direction === 'OUTWARD' ? 'credit' : t.reverseCharge ? 'credit' : 'debit';
  for (const h of HEADS) {
    const net = await journalNet(tx, p.journalId, book[h], nature);
    if (!net.equals(heads[h])) {
      throw FinErrors.taxPayloadMismatch(
        `The ${h.toUpperCase()} in the tax block (${money(heads[h])}) differs from the ledger line (${money(net)}).`,
        { [`tax.${h}`]: 'Does not match the journal.' },
      );
    }
  }
  const doc = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO tax_documents (unit_id, direction, doc_kind, doc_no, doc_date, party_type, party_id, party_name, party_gstin, party_state_code,
                               place_of_supply, reverse_charge, taxable, cgst, sgst, igst, cess, journal_id, created_by_id)
    VALUES (${p.unitId}::uuid, ${t.direction}, ${t.docKind}, ${p.docNo}, ${p.docDate}::date, ${p.partyType}, ${p.partyId}::uuid, ${t.partyName},
            ${t.partyGstin ?? null}, ${t.partyStateCode ?? null}, ${t.placeOfSupplyStateCode}, ${t.reverseCharge ?? false}, ${taxable.toFixed(2)}::numeric,
            ${heads.cgst.toFixed(2)}::numeric, ${heads.sgst.toFixed(2)}::numeric, ${heads.igst.toFixed(2)}::numeric, ${heads.cess.toFixed(2)}::numeric,
            ${p.journalId}::uuid, ${p.actorId}::uuid) RETURNING id`;
  const docId = doc[0]?.id as string;
  let no = 0;
  for (const l of lines) {
    no += 1;
    await tx.$executeRaw`
      INSERT INTO tax_document_lines (tax_document_id, line_no, hsn, uqc, qty, taxable, rate_pct, cgst, sgst, igst, cess)
      VALUES (${docId}::uuid, ${no}, ${l.hsn}, ${l.uqc}, ${l.qty}::numeric, ${l.taxable.toFixed(2)}::numeric, ${l.rate}::numeric,
              ${l.cgst.toFixed(2)}::numeric, ${l.sgst.toFixed(2)}::numeric, ${l.igst.toFixed(2)}::numeric, ${l.cess.toFixed(2)}::numeric)`;
  }
}

async function recordTds(
  tx: Db,
  p: {
    unitId: string;
    journalId: string;
    docNo: string;
    docDate: string;
    partyType: 'CUSTOMER' | 'SUPPLIER' | null;
    partyId: string | null;
    tds: TdsBlock;
    actorId: string;
  },
): Promise<void> {
  const b = p.tds;
  const amount = parseMoney(b.tdsAmount, 'tds.tdsAmount');
  const kind = b.kind ?? 'TDS';
  const code = kind === 'TDS' ? '2311' : '2312';
  const booked = await journalNet(tx, p.journalId, code, 'credit');
  if (!booked.equals(amount)) {
    throw FinErrors.taxPayloadMismatch(
      `The ${kind} in the tax block (${money(amount)}) differs from the ledger line (${money(booked)}).`,
      { 'tds.tdsAmount': 'Does not match the journal.' },
    );
  }
  await tx.$executeRaw`
    INSERT INTO tds_entries (unit_id, kind, supplier_id, section_code, base_amount, rate_pct, tds_amount, deducted_on, source_doc_no, journal_id, created_by_id)
    VALUES (${p.unitId}::uuid, ${kind}, ${p.partyType === 'SUPPLIER' ? p.partyId : null}::uuid, ${b.sectionCode},
            ${parseMoney(b.baseAmount, 'tds.baseAmount').toFixed(2)}::numeric, ${b.ratePct}::numeric, ${amount.toFixed(2)}::numeric,
            ${p.docDate}::date, ${p.docNo}, ${p.journalId}::uuid, ${p.actorId}::uuid)`;
}
