// Customers and suppliers (docs/phases/PHASE-06.md §3.10, §5, §6). D-26: two separate tables.
//  * a NEW SUPPLIER is PENDING until the Phase 5 approval engine approves it (R-06);
//  * a NEW CUSTOMER needs no approval (setting customer_create_needs_approval = false by default);
//  * RAISING a customer credit limit goes through the approval engine, lowering it applies at once;
//  * a changed supplier bank account must be verified by a SECOND person (the database also refuses it).
import { Prisma } from '@prisma/client';
import type { Customer, Supplier } from '@prisma/client';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { approvalService } from '../approvals/service';
import type { ApprovalCaller } from '../approvals/service';
import { registerApprovalHandler } from '../approvals/handlers';
import type { ApprovalDocHandler, DocSnapshot } from '../approvals/handlers';
import {
  ACCOUNT_NO_RE,
  accountHash,
  encryptAccountNo,
  maskAccountNo,
  normaliseAccountNo,
} from './bank-crypto';
import { duplicateService, dupWarnMessage } from './duplicate-service';
import type { DupHit } from './duplicate-service';
import { MESSAGES, checkPartyIdentity, isIfsc, isUdyam, normaliseName } from './party-rules';
import type { RuleError } from './party-rules';
import { knownStates } from './tax-service';

export interface PartyInput {
  name: string;
  legalName?: string | null;
  gstRegistrationType: 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED' | 'SEZ' | 'OVERSEAS';
  gstin?: string | null;
  pan?: string | null;
  stateCode?: string | null;
  groupId?: string | null;
  paymentTermId?: string | null;
  currencyCode?: string;
  city?: string | null;
  mobile?: string | null;
  email?: string | null;
  /** "This is a different party": acknowledges WARN duplicates. */
  differentParty?: boolean;
}

export interface CustomerInput extends PartyInput {
  territoryId?: string | null;
  salesPersonId?: string | null;
  priceListId?: string | null;
  creditLimit?: number | string | null;
  creditDays?: number | null;
  tier?: 'A' | 'B' | 'C' | 'D';
}

export interface SupplierInput extends PartyInput {
  supplierType?: 'MATERIAL' | 'CONTRACTOR';
  msmeUdyamNo?: string | null;
  msmeCategory?: 'MICRO' | 'SMALL' | 'MEDIUM' | null;
  msmeActivity?: 'MANUFACTURING' | 'SERVICES' | 'TRADING' | null;
  msmeAgreedDays?: number | null;
}

function toFieldErrors(errors: Record<string, RuleError>): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, v.message]));
}

/** First blocking rule error as an AppError carrying the spec code and message. */
function ruleError(errors: Record<string, RuleError>): AppError | null {
  const first = Object.values(errors)[0];
  if (!first) return null;
  const status = first.code === 'GSTIN_DUPLICATE' ? 409 : 422;
  return new AppError(status, first.code as never, first.message, toFieldErrors(errors));
}

async function identity(input: PartyInput) {
  const states = await knownStates();
  const { errors, derived } = checkPartyIdentity(
    {
      gstRegistrationType: input.gstRegistrationType,
      gstin: input.gstin ?? null,
      pan: input.pan ?? null,
      stateCode: input.stateCode ?? null,
    },
    states.codes,
    states.names,
  );
  const err = ruleError(errors);
  if (err) throw err;
  const stateCode = derived.stateCode ?? input.stateCode;
  if (!stateCode || !states.codes.has(stateCode)) {
    throw Errors.validation({ stateCode: 'Choose the state of the party.' });
  }
  const gstin = input.gstin ? input.gstin.replace(/\s+/g, '').toUpperCase() : null;
  const pan = (input.pan ? input.pan.toUpperCase() : null) ?? derived.pan ?? null;
  return { gstin, pan, stateCode };
}

function assertNoBlockingDuplicates(hits: readonly DupHit[], different: boolean | undefined): void {
  const block = hits.find((h) => h.level === 'BLOCK');
  if (block) {
    throw new AppError(
      409,
      block.field === 'gstin' ? 'GSTIN_DUPLICATE' : 'BANK_DUPLICATE',
      block.message,
      {
        [block.field]: block.message,
      },
    );
  }
  if (hits.some((h) => h.level === 'WARN') && !different) {
    throw new AppError(409, 'DUP_WARN', dupWarnMessage(hits), {
      differentParty: dupWarnMessage(hits),
    });
  }
}

async function nextCode(db: Db, prefix: 'CUS' | 'SUP'): Promise<string> {
  const seq = prefix === 'CUS' ? 'customer_code_seq' : 'supplier_code_seq';
  const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('${seq}') AS n`);
  return `${prefix}/${String(rows[0]?.n ?? 1n).padStart(5, '0')}`;
}

async function settingFlag(key: string, fallback: boolean): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return typeof row?.value === 'boolean' ? row.value : fallback;
}

function maskedBank(b: {
  accountLast4: string;
  ifsc: string;
  holderName: string;
  verifiedAt: Date | null;
}) {
  return {
    ifsc: b.ifsc,
    holder: b.holderName,
    accountNo: `XXXXXX${b.accountLast4}`,
    verified: Boolean(b.verifiedAt),
  };
}

export const partyService = {
  async createCustomer(caller: ApprovalCaller, input: CustomerInput): Promise<Customer> {
    const id = await identity(input);
    const hits = await duplicateService.check({
      kind: 'CUSTOMER',
      gstin: id.gstin,
      pan: id.pan,
      name: input.name,
      city: input.city ?? null,
      mobile: input.mobile ?? null,
      email: input.email ?? null,
    });
    assertNoBlockingDuplicates(hits, input.differentParty);
    const needsApproval = await settingFlag('customer_create_needs_approval', false);
    return prisma.$transaction(async (tx) => {
      const code = await nextCode(tx, 'CUS');
      const created = await tx.customer.create({
        data: {
          code,
          name: input.name.trim(),
          legalName: input.legalName ?? null,
          nameKey: normaliseName(input.name),
          customerGroupId: input.groupId ?? null,
          territoryId: input.territoryId ?? null,
          salesPersonId: input.salesPersonId ?? null,
          gstRegistrationType: input.gstRegistrationType,
          gstin: id.gstin,
          pan: id.pan,
          stateCode: id.stateCode,
          currencyCode: input.currencyCode ?? 'INR',
          paymentTermId: input.paymentTermId ?? null,
          priceListId: input.priceListId ?? null,
          creditLimit:
            input.creditLimit === undefined || input.creditLimit === null
              ? null
              : new Prisma.Decimal(input.creditLimit),
          creditDays: input.creditDays ?? null,
          tier: input.tier ?? 'C',
          approvalStatus: needsApproval ? 'PENDING' : 'APPROVED',
          createdById: caller.auth.userId,
          updatedById: caller.auth.userId,
        },
      });
      await recordAudit(
        {
          action: 'CUSTOMER_CREATED',
          actorId: caller.auth.userId,
          targetType: 'Customer',
          targetId: created.id,
          meta: caller.meta,
          detail: {
            code,
            name: created.name,
            gstin: id.gstin,
            duplicatesAcknowledged: hits.length,
          },
        },
        tx,
      );
      if (hits.some((h) => h.level === 'WARN')) {
        await recordAudit(
          {
            action: 'DUPLICATE_OVERRIDDEN',
            actorId: caller.auth.userId,
            targetType: 'Customer',
            targetId: created.id,
            meta: caller.meta,
            detail: { matches: hits.map((h) => h.matchCode) },
          },
          tx,
        );
      }
      return created;
    });
  },

  async createSupplier(caller: ApprovalCaller, input: SupplierInput): Promise<Supplier> {
    const id = await identity(input);
    if (input.msmeUdyamNo && !isUdyam(input.msmeUdyamNo)) {
      throw new AppError(422, 'UDYAM_FORMAT', MESSAGES.UDYAM_FORMAT, {
        msmeUdyamNo: MESSAGES.UDYAM_FORMAT,
      });
    }
    if (
      input.msmeAgreedDays !== undefined &&
      input.msmeAgreedDays !== null &&
      (input.msmeAgreedDays < 1 || input.msmeAgreedDays > 45)
    ) {
      throw new AppError(422, 'MSME_DAYS', MESSAGES.MSME_DAYS, {
        msmeAgreedDays: MESSAGES.MSME_DAYS,
      });
    }
    if (Boolean(input.msmeUdyamNo) !== Boolean(input.msmeCategory)) {
      throw Errors.validation({
        msmeCategory: 'Enter the Udyam number and the category together.',
      });
    }
    const hits = await duplicateService.check({
      kind: 'SUPPLIER',
      gstin: id.gstin,
      pan: id.pan,
      name: input.name,
      city: input.city ?? null,
      mobile: input.mobile ?? null,
      email: input.email ?? null,
    });
    assertNoBlockingDuplicates(hits, input.differentParty);
    return prisma.$transaction(async (tx) => {
      const code = await nextCode(tx, 'SUP');
      const created = await tx.supplier.create({
        data: {
          code,
          name: input.name.trim(),
          legalName: input.legalName ?? null,
          nameKey: normaliseName(input.name),
          supplierType: input.supplierType ?? 'MATERIAL',
          supplierGroupId: input.groupId ?? null,
          gstRegistrationType: input.gstRegistrationType,
          gstin: id.gstin,
          pan: id.pan,
          stateCode: id.stateCode,
          currencyCode: input.currencyCode ?? 'INR',
          paymentTermId: input.paymentTermId ?? null,
          msmeUdyamNo: input.msmeUdyamNo ?? null,
          msmeCategory: input.msmeCategory ?? null,
          msmeActivity: input.msmeActivity ?? null,
          msmeAgreedDays: input.msmeAgreedDays ?? null,
          approvalStatus: 'PENDING',
          createdById: caller.auth.userId,
          updatedById: caller.auth.userId,
        },
      });
      await recordAudit(
        {
          action: 'SUPPLIER_CREATED',
          actorId: caller.auth.userId,
          targetType: 'Supplier',
          targetId: created.id,
          meta: caller.meta,
          detail: { code, name: created.name, gstin: id.gstin },
        },
        tx,
      );
      return created;
    });
  },

  /** Sends a new / rejected supplier to the approval engine. It cannot be used on purchase documents until approved. */
  async submitSupplier(caller: ApprovalCaller, supplierId: string) {
    const req = await approvalService.submit(caller, SUPPLIER_DOC_TYPE, supplierId);
    await recordAudit({
      action: 'SUPPLIER_SUBMITTED',
      actorId: caller.auth.userId,
      targetType: 'Supplier',
      targetId: supplierId,
      meta: caller.meta,
      detail: { requestId: req.id },
    });
    return req;
  },

  /** Guard used by purchase documents (Phase 9): throws SUPPLIER_NOT_APPROVED. */
  async assertSupplierUsable(supplierId: string, db: Db = prisma): Promise<void> {
    const s = await db.supplier.findUnique({
      where: { id: supplierId },
      select: { code: true, approvalStatus: true, status: true, deletedAt: true },
    });
    if (!s || s.deletedAt) throw Errors.notFound('Supplier not found.');
    if (s.approvalStatus !== 'APPROVED') {
      throw new AppError(409, 'SUPPLIER_NOT_APPROVED', `Supplier ${s.code} is not approved yet.`, {
        supplier: `Supplier ${s.code} is not approved yet.`,
      });
    }
  },

  /**
   * Credit change: a LOWER limit applies at once (audited); a HIGHER limit creates a request that goes through
   * the approval engine and leaves the limit unchanged until approved. One open request per customer.
   */
  async requestCreditChange(
    caller: ApprovalCaller,
    customerId: string,
    input: { newLimit?: number | string | null; newDays?: number | null; reason: string },
  ): Promise<{ applied: boolean; requestId: string | null }> {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
    });
    if (!customer) throw Errors.notFound('Customer not found.');
    const reason = input.reason.trim();
    if (reason.length < 10) {
      throw Errors.validation({ reason: 'Please write a reason (at least 10 characters).' });
    }
    const open = await prisma.customerCreditRequest.findFirst({
      where: { customerId, status: 'PENDING' },
    });
    if (open) {
      throw new AppError(409, 'CREDIT_PENDING', MESSAGES.CREDIT_PENDING, {
        creditLimit: MESSAGES.CREDIT_PENDING,
      });
    }
    const newLimit =
      input.newLimit === undefined
        ? customer.creditLimit
        : input.newLimit === null
          ? null
          : new Prisma.Decimal(input.newLimit);
    const newDays = input.newDays === undefined ? customer.creditDays : input.newDays;
    // null = no limit, which is the highest possible value.
    const isIncrease =
      (customer.creditLimit !== null && newLimit === null) ||
      (customer.creditLimit !== null && newLimit !== null && newLimit.gt(customer.creditLimit)) ||
      (customer.creditDays !== null && newDays !== null && newDays > customer.creditDays);
    const base = {
      customerId,
      oldLimit: customer.creditLimit,
      newLimit,
      oldDays: customer.creditDays,
      newDays,
      reason,
      requestedById: caller.auth.userId,
    };
    if (!isIncrease) {
      await prisma.$transaction(async (tx) => {
        await tx.customer.update({
          where: { id: customerId },
          data: {
            creditLimit: newLimit,
            creditDays: newDays,
            version: { increment: 1 },
            updatedById: caller.auth.userId,
            updatedAt: new Date(),
          },
        });
        await tx.customerCreditRequest.create({
          data: { ...base, status: 'APPROVED', decidedAt: new Date() },
        });
        await recordAudit(
          {
            action: 'CUSTOMER_CREDIT_CHANGED',
            actorId: caller.auth.userId,
            targetType: 'Customer',
            targetId: customerId,
            meta: caller.meta,
            detail: {
              before: {
                limit: customer.creditLimit?.toString() ?? null,
                days: customer.creditDays,
              },
              after: { limit: newLimit?.toString() ?? null, days: newDays },
            },
          },
          tx,
        );
      });
      return { applied: true, requestId: null };
    }
    const request = await prisma.customerCreditRequest.create({ data: base });
    try {
      const approval = await approvalService.submit(caller, CREDIT_DOC_TYPE, request.id);
      await prisma.customerCreditRequest.update({
        where: { id: request.id },
        data: { approvalRequestId: approval.id },
      });
      await recordAudit({
        action: 'CUSTOMER_CREDIT_REQUESTED',
        actorId: caller.auth.userId,
        targetType: 'Customer',
        targetId: customerId,
        meta: caller.meta,
        detail: { requestId: approval.id, newLimit: newLimit?.toString() ?? null, newDays },
      });
      return { applied: false, requestId: approval.id };
    } catch (err) {
      await prisma.customerCreditRequest.delete({ where: { id: request.id } });
      throw err;
    }
  },

  /** Adds a bank account to a supplier. The number is typed twice; only the last 4 digits are ever shown. */
  async addBankAccount(
    caller: ApprovalCaller,
    supplierId: string,
    input: {
      ifsc: string;
      holderName: string;
      accountNo: string;
      accountNoConfirm: string;
      bankId?: string | null;
      canOverrideDuplicate?: boolean;
    },
  ) {
    const accountNo = normaliseAccountNo(input.accountNo);
    if (accountNo !== normaliseAccountNo(input.accountNoConfirm)) {
      throw new AppError(422, 'ACCOUNT_CONFIRM', MESSAGES.ACCOUNT_CONFIRM, {
        accountNo: MESSAGES.ACCOUNT_CONFIRM,
      });
    }
    if (!ACCOUNT_NO_RE.test(accountNo)) {
      throw Errors.validation({
        accountNo: 'Enter the account number using digits only (6 to 20).',
      });
    }
    const ifsc = input.ifsc.toUpperCase();
    if (!isIfsc(ifsc))
      throw new AppError(422, 'IFSC_FORMAT', MESSAGES.IFSC_FORMAT, { ifsc: MESSAGES.IFSC_FORMAT });
    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, deletedAt: null },
    });
    if (!supplier) throw Errors.notFound('Supplier not found.');
    const dup = await duplicateService.check({
      kind: 'SUPPLIER',
      accountNo,
      excludeId: supplierId,
      canOverrideBank: input.canOverrideDuplicate ?? false,
    });
    const block = dup.find((h) => h.level === 'BLOCK');
    if (block)
      throw new AppError(409, 'BANK_DUPLICATE', block.message, { accountNo: block.message });
    const bank =
      input.bankId ??
      (await prisma.bank.findUnique({ where: { code: ifsc.slice(0, 4) } }))?.id ??
      null;
    const created = await prisma.supplierBankAccount.create({
      data: {
        supplierId,
        bankId: bank,
        ifsc,
        holderName: input.holderName.trim(),
        accountNoEnc: encryptAccountNo(accountNo),
        accountLast4: accountNo.slice(-4),
        accountHash: accountHash(accountNo),
        changedById: caller.auth.userId,
      },
    });
    await recordAudit({
      action: 'SUPPLIER_BANK_CHANGED',
      actorId: caller.auth.userId,
      targetType: 'Supplier',
      targetId: supplierId,
      meta: caller.meta,
      detail: { bankAccountId: created.id, ifsc, accountNo: maskAccountNo(accountNo) },
    });
    return { id: created.id, ...maskedBank(created) };
  },

  /** A second person verifies the account before it may be used for payment. */
  async verifyBankAccount(caller: ApprovalCaller, supplierId: string, bankAccountId: string) {
    const acct = await prisma.supplierBankAccount.findFirst({
      where: { id: bankAccountId, supplierId },
    });
    if (!acct) throw Errors.notFound('Bank account not found.');
    if (acct.changedById === caller.auth.userId) {
      throw new AppError(403, 'BANK_SELF_VERIFY', MESSAGES.BANK_SELF_VERIFY);
    }
    const updated = await prisma.supplierBankAccount.update({
      where: { id: acct.id },
      data: { verifiedById: caller.auth.userId, verifiedAt: new Date() },
    });
    await recordAudit({
      action: 'SUPPLIER_BANK_VERIFIED',
      actorId: caller.auth.userId,
      targetType: 'Supplier',
      targetId: supplierId,
      meta: caller.meta,
      detail: { bankAccountId: acct.id },
    });
    return { id: updated.id, ...maskedBank(updated) };
  },
};

// ---- approval handlers ---------------------------------------------------------------------------------

export const SUPPLIER_DOC_TYPE = 'scm-suppliers';
export const CREDIT_DOC_TYPE = 'crm-customer360';

/** Where the master "lives" for the approval request: the creator's first unit (masters are company-wide). */
async function unitOfUser(db: Db, userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { defaultUnitId: true, units: { select: { unitId: true }, take: 1 } },
  });
  const unitId =
    user?.defaultUnitId ??
    user?.units[0]?.unitId ??
    (await db.unit.findFirst({ orderBy: { createdAt: 'asc' } }))?.id;
  if (!unitId) throw Errors.contextInvalid('No unit exists yet.');
  return unitId;
}

async function ownerDepartment(db: Db, pageId: string, fallback: string): Promise<string> {
  return (
    (await db.moduleControl.findUnique({ where: { pageId }, select: { ownerDepartment: true } }))
      ?.ownerDepartment ?? fallback
  );
}

const supplierHandler: ApprovalDocHandler = {
  async snapshot(tx, docId): Promise<DocSnapshot | null> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM suppliers WHERE id = ${docId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (!rows[0]) return null;
    const s = await tx.supplier.findUniqueOrThrow({ where: { id: docId } });
    const open = await tx.approvalRequest.count({
      where: { docType: SUPPLIER_DOC_TYPE, docId, status: 'PENDING' },
    });
    const creator = s.createdById ?? '';
    return {
      code: s.code,
      title: 'Supplier Master',
      amount: null,
      department: await ownerDepartment(tx, SUPPLIER_DOC_TYPE, 'Purchase'),
      unitId: await unitOfUser(tx, creator),
      createdBy: creator,
      status:
        open > 0
          ? 'Pending Approval'
          : s.approvalStatus === 'REJECTED'
            ? 'Rejected'
            : s.approvalStatus === 'APPROVED'
              ? 'Approved'
              : 'Draft',
      version: s.version,
      fyOpen: true,
    };
  },
  async onSubmitted(tx, docId, req) {
    await tx.supplier.update({
      where: { id: docId },
      data: { version: { increment: 1 }, updatedById: req.actorId, updatedAt: new Date() },
    });
  },
  async onApproved(tx, docId, req) {
    await tx.supplier.update({
      where: { id: docId },
      data: {
        approvalStatus: 'APPROVED',
        version: { increment: 1 },
        updatedById: req.actorId,
        updatedAt: new Date(),
      },
    });
    await recordAudit(
      {
        action: 'SUPPLIER_APPROVED',
        actorId: req.actorId,
        targetType: 'Supplier',
        targetId: docId,
        detail: { requestId: req.id },
      },
      tx,
    );
  },
  async onRejected(tx, docId, req) {
    await tx.supplier.update({
      where: { id: docId },
      data: {
        approvalStatus: 'REJECTED',
        version: { increment: 1 },
        updatedById: req.actorId,
        updatedAt: new Date(),
      },
    });
    await recordAudit(
      {
        action: 'SUPPLIER_REJECTED',
        actorId: req.actorId,
        targetType: 'Supplier',
        targetId: docId,
        detail: { requestId: req.id },
      },
      tx,
    );
  },
  async onReturned(tx, docId, req) {
    await tx.supplier.update({
      where: { id: docId },
      data: {
        approvalStatus: 'PENDING',
        version: { increment: 1 },
        updatedById: req.actorId,
        updatedAt: new Date(),
      },
    });
  },
};

/** docId = customer_credit_requests.id; the amount is the NEW limit so the matrix levels scale with it. */
const creditHandler: ApprovalDocHandler = {
  async snapshot(tx, docId): Promise<DocSnapshot | null> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM customer_credit_requests WHERE id = ${docId}::uuid FOR UPDATE`;
    if (!rows[0]) return null;
    const r = await tx.customerCreditRequest.findUniqueOrThrow({ where: { id: docId } });
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: r.customerId } });
    const requester = r.requestedById ?? '';
    return {
      code: customer.code,
      title: 'Credit limit change',
      amount: r.newLimit,
      department: await ownerDepartment(tx, CREDIT_DOC_TYPE, 'Sales'),
      unitId: await unitOfUser(tx, requester),
      createdBy: requester,
      status: r.status === 'PENDING' ? 'Draft' : r.status === 'REJECTED' ? 'Rejected' : 'Approved',
      version: customer.version,
      fyOpen: true,
    };
  },
  async onSubmitted() {
    // the request row already says PENDING
  },
  async onApproved(tx, docId, req) {
    const r = await tx.customerCreditRequest.findUniqueOrThrow({ where: { id: docId } });
    await tx.customerCreditRequest.update({
      where: { id: docId },
      data: { status: 'APPROVED', decidedAt: new Date() },
    });
    await tx.customer.update({
      where: { id: r.customerId },
      data: {
        creditLimit: r.newLimit,
        creditDays: r.newDays,
        version: { increment: 1 },
        updatedById: req.actorId,
        updatedAt: new Date(),
      },
    });
    await recordAudit(
      {
        action: 'CUSTOMER_CREDIT_CHANGED',
        actorId: req.actorId,
        targetType: 'Customer',
        targetId: r.customerId,
        detail: { requestId: req.id, newLimit: r.newLimit?.toString() ?? null, newDays: r.newDays },
      },
      tx,
    );
  },
  async onRejected(tx, docId) {
    await tx.customerCreditRequest.update({
      where: { id: docId },
      data: { status: 'REJECTED', decidedAt: new Date() },
    });
  },
  async onReturned(tx, docId) {
    await tx.customerCreditRequest.update({
      where: { id: docId },
      data: { status: 'WITHDRAWN', decidedAt: new Date() },
    });
  },
};

export function registerMasterApprovalHandlers(): void {
  registerApprovalHandler(SUPPLIER_DOC_TYPE, supplierHandler);
  registerApprovalHandler(CREDIT_DOC_TYPE, creditHandler);
}
registerMasterApprovalHandlers();
