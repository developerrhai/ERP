// Client for the Phase 7 Finance endpoints (/finance/...). Money is always a decimal STRING ("1234.50").
import { api, request } from './api';
import type { PageMeta } from '../types';

const key = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const idem = () => ({ 'Idempotency-Key': key() });
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const qs = (o: Record<string, string | number | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export interface Paged<T> {
  rows: T[];
  meta: PageMeta;
}
async function paged<T>(path: string): Promise<Paged<T>> {
  const r = await request<T[]>(path);
  return { rows: r.data, meta: r.meta ?? { page: 1, size: r.data.length, total: r.data.length } };
}

// ---- chart of accounts ------------------------------------------------------------------------------------
export interface Account {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  isGroup: boolean;
  rootType: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';
  subType: string;
  postingAllowed: boolean;
  costCenterRequired: boolean;
  partyRequired: boolean;
  controlSide: 'RECEIVABLE' | 'PAYABLE' | null;
  status: 'Active' | 'Inactive';
  isSystem: boolean;
  version: number;
}
export interface AccountInput {
  code: string;
  name: string;
  parentId?: string | null;
  isGroup?: boolean;
  rootType?: Account['rootType'];
  subType?: string;
  costCenterRequired?: boolean;
  partyRequired?: boolean;
  controlSide?: 'RECEIVABLE' | 'PAYABLE' | null;
}
/** All matching accounts: pages of 200 are fetched until the total is reached (the chart has 200+ rows). */
export async function listAccounts(
  q: { q?: string; postable?: boolean } & { page?: number; size?: number } = {},
): Promise<Paged<Account>> {
  const size = 200;
  const first = await paged<Account>(
    `/finance/accounts${qs({ q: q.q, postable: q.postable ? 'true' : undefined, page: 1, size })}`,
  );
  const rows = [...first.rows];
  for (let page = 2; rows.length < first.meta.total && page <= 25; page += 1) {
    rows.push(
      ...(
        await paged<Account>(
          `/finance/accounts${qs({ q: q.q, postable: q.postable ? 'true' : undefined, page, size })}`,
        )
      ).rows,
    );
  }
  return { rows, meta: { ...first.meta, page: 1, size: rows.length } };
}
export const createAccount = (b: AccountInput) =>
  api<Account>('/finance/accounts', { method: 'POST', body: b });
export const updateAccount = (
  id: string,
  version: number,
  b: Partial<AccountInput> & { status?: 'Active' | 'Inactive' },
) =>
  api<Account>(`/finance/accounts/${id}`, { method: 'PATCH', body: b, headers: ifMatch(version) });
export const deleteAccount = (id: string) =>
  api<void>(`/finance/accounts/${id}`, { method: 'DELETE' });

// ---- cost / profit centres --------------------------------------------------------------------------------
export interface Dimension {
  id: string;
  code: string;
  name: string;
  unitId: string | null;
  parentId?: string | null;
  isGroup?: boolean;
  isDefault?: boolean;
  status: 'Active' | 'Inactive';
  version: number;
}
export const listDimension = (kind: 'cost' | 'profit') =>
  paged<Dimension>(`/finance/${kind === 'cost' ? 'cost-centers' : 'profit-centers'}?size=200`);
export const createDimension = (kind: 'cost' | 'profit', b: Record<string, unknown>) =>
  api<Dimension>(`/finance/${kind === 'cost' ? 'cost-centers' : 'profit-centers'}`, {
    method: 'POST',
    body: b,
  });
export const updateDimension = (
  kind: 'cost' | 'profit',
  id: string,
  version: number,
  b: Record<string, unknown>,
) =>
  api<Dimension>(`/finance/${kind === 'cost' ? 'cost-centers' : 'profit-centers'}/${id}`, {
    method: 'PATCH',
    body: b,
    headers: ifMatch(version),
  });
export const deleteDimension = (kind: 'cost' | 'profit', id: string) =>
  api<void>(`/finance/${kind === 'cost' ? 'cost-centers' : 'profit-centers'}/${id}`, {
    method: 'DELETE',
  });

// ---- journals ---------------------------------------------------------------------------------------------
export interface JournalLine {
  id?: string;
  lineNo?: number;
  accountId: string;
  accountCode?: string | null;
  accountName?: string | null;
  debit: string;
  credit: string;
  partyId?: string | null;
  costCenterId?: string | null;
  narration?: string | null;
  billDocNo?: string | null;
  billDueDate?: string | null;
  currencyCode?: string;
  fxRate?: string;
  amountFc?: string | null;
}
export interface Journal {
  id: string;
  code: string;
  unitId: string;
  voucherType: string;
  docDate: string;
  status: 'Draft' | 'Posted' | 'Cancelled';
  postingStatus: string;
  narration: string | null;
  referenceNo: string | null;
  totalDebit: string;
  totalCredit: string;
  reversalOfId: string | null;
  reversedById: string | null;
  version: number;
  warnings: { code: string; message: string }[];
  lines: JournalLine[];
  lineCount?: number;
}
export interface JournalInput {
  unitId: string;
  docDate: string;
  voucherType: string;
  narration?: string;
  referenceNo?: string;
  lines: {
    accountId: string;
    debit: string;
    credit: string;
    costCenterId?: string;
    partyId?: string;
    narration?: string;
    billDocNo?: string;
    billDueDate?: string;
    currencyCode?: string;
    amountFc?: string;
    fxRate?: string;
    side?: 'DR' | 'CR';
  }[];
}
export const listJournals = (q: { q?: string; status?: string; page: number; size: number }) =>
  paged<Journal>(
    `/finance/journals${qs({ q: q.q, status: q.status, page: q.page, size: q.size })}`,
  );
export const getJournal = (id: string) => api<Journal>(`/finance/journals/${id}`);
export const createJournal = (b: JournalInput) =>
  api<Journal>('/finance/journals', { method: 'POST', body: b });
export const updateJournal = (id: string, version: number, b: Partial<JournalInput>) =>
  api<Journal>(`/finance/journals/${id}`, { method: 'PATCH', body: b, headers: ifMatch(version) });
export const deleteJournal = (id: string) =>
  api<void>(`/finance/journals/${id}`, { method: 'DELETE' });
export const submitJournal = (id: string, version: number) =>
  api<Journal & { needsApproval: boolean }>(`/finance/journals/${id}/submit`, {
    method: 'POST',
    headers: { ...ifMatch(version), ...idem() },
  });
export const postJournal = (id: string, version: number, overrideBudget?: { reason: string }) =>
  api<{ id: string; code: string; warnings: { code: string; message: string }[] }>(
    `/finance/journals/${id}/post`,
    {
      method: 'POST',
      body: overrideBudget ? { overrideBudget } : {},
      headers: { ...ifMatch(version), ...idem() },
    },
  );
export const reverseJournal = (id: string, reason: string) =>
  api<{ id: string; code: string }>(`/finance/journals/${id}/reverse`, {
    method: 'POST',
    body: { reason },
    headers: idem(),
  });

// ---- cash and bank ----------------------------------------------------------------------------------------
export interface BankAccount {
  id: string;
  unitId: string;
  accountId: string;
  accountCode: string | null;
  kind: 'BANK' | 'CASH' | 'PETTY';
  name: string;
  bankName: string | null;
  accountLast4: string | null;
  status: string;
  version: number;
}
export const listBankAccounts = () => api<BankAccount[]>('/finance/bank-accounts');
export const createBankAccount = (b: Record<string, unknown>) =>
  api<BankAccount>('/finance/bank-accounts', { method: 'POST', body: b });
export interface Book {
  account: { id: string; name: string; kind: string };
  opening: string;
  totalReceipts: string;
  totalPayments: string;
  closing: string;
  rows: {
    id: string;
    date: string;
    voucherType: string;
    voucherNo: string;
    narration: string | null;
    receipt: string;
    payment: string;
    balance: string;
  }[];
}
export const getBook = (id: string, from: string, to: string) =>
  api<Book>(`/finance/books/${id}${qs({ from, to })}`);
export interface Payment {
  id: string;
  code: string;
  kind: string;
  docDate: string;
  amount: string;
  mode: string;
  status: string;
  partyId: string | null;
  version: number;
}
export const listPayments = (q: { bankAccountId?: string; page: number; size: number }) =>
  paged<Payment>(`/finance/payments${qs(q)}`);
export interface PaymentInput {
  kind: 'PAYMENT' | 'RECEIPT' | 'TRANSFER';
  docDate: string;
  bankAccountId: string;
  supplierId?: string;
  counterAccountId?: string;
  toBankAccountId?: string;
  amount: string;
  mode: string;
  referenceNo?: string;
  narration?: string;
  allowAdvance?: boolean;
}
export const createPayment = (b: PaymentInput) =>
  api<Payment & { warnings: { code: string; message: string }[] }>('/finance/payments', {
    method: 'POST',
    body: b,
    headers: idem(),
  });
export const cancelPayment = (id: string, version: number, reason: string) =>
  api<Payment>(`/finance/payments/${id}/cancel`, {
    method: 'POST',
    body: { reason },
    headers: { ...ifMatch(version), ...idem() },
  });
export interface OpenBill {
  id: string;
  docNo: string;
  docDate: string;
  dueDate: string | null;
  outstanding: string;
}
export const openBills = (partyId: string, side: 'PAYABLE' | 'RECEIVABLE' = 'PAYABLE') =>
  api<OpenBill[]>(`/finance/open-items/bills${qs({ partyId, side })}`);

// ---- reconciliation ---------------------------------------------------------------------------------------
export interface Statement {
  id: string;
  bankAccountId: string;
  periodFrom: string;
  periodTo: string;
  openingBalance: string;
  closingBalance: string;
  status: 'Open' | 'Reconciled';
  version: number;
}
export interface StatementLine {
  id: string;
  lineNo: number;
  txnDate: string;
  description: string | null;
  refNo: string | null;
  withdrawal: string;
  deposit: string;
  matchStatus: string;
}
export interface Proof {
  bookBalance: string;
  unclearedBook: string;
  statementClosing: string;
  unrecordedBank: string;
  difference: string;
  unrecordedCount: number;
}
export interface StatementDetail {
  statement: Statement;
  lines: StatementLine[];
  proof: Proof;
}
export const listStatements = () => paged<Statement>('/finance/bank-statements?size=50');
export const getStatement = (id: string) => api<StatementDetail>(`/finance/bank-statements/${id}`);
export const importStatement = (b: Record<string, unknown>) =>
  api<Statement>('/finance/bank-statements', { method: 'POST', body: b });
export const suggestions = (id: string) =>
  api<
    {
      lineId: string;
      candidates: {
        glEntryId: string;
        date: string;
        voucherNo: string;
        narration: string | null;
      }[];
    }[]
  >(`/finance/bank-statements/${id}/suggestions`);
export const matchLine = (id: string, lineId: string, glEntryId: string) =>
  api<Proof>(`/finance/bank-statements/${id}/match`, {
    method: 'POST',
    body: { lineId, glEntryId },
  });
export const unmatchLine = (id: string, lineId: string) =>
  api<Proof>(`/finance/bank-statements/${id}/unmatch`, { method: 'POST', body: { lineId } });
export const createEntryFromLine = (id: string, lineId: string, counterAccountId: string) =>
  api<Proof>(`/finance/bank-statements/${id}/create-entry`, {
    method: 'POST',
    body: { lineId, counterAccountId },
  });
export const reconcileStatement = (id: string, version: number) =>
  api<Proof>(`/finance/bank-statements/${id}/reconcile`, {
    method: 'POST',
    headers: ifMatch(version),
  });

// ---- budgets ----------------------------------------------------------------------------------------------
export interface Budget {
  id: string;
  name: string;
  accountId: string;
  accountCode: string | null;
  accountName: string | null;
  status: 'Draft' | 'Active' | 'Closed';
  total: string;
  months: { periodNo: number; amount: string }[];
  version: number;
  unitId: string;
}
export const listBudgets = () => api<Budget[]>('/finance/budgets');
export const createBudget = (b: Record<string, unknown>) =>
  api<Budget>('/finance/budgets', { method: 'POST', body: b });
export const setBudgetStatus = (id: string, version: number, status: 'Active' | 'Closed') =>
  api<Budget>(`/finance/budgets/${id}/status`, {
    method: 'POST',
    body: { status },
    headers: ifMatch(version),
  });
export const deleteBudget = (id: string) =>
  api<void>(`/finance/budgets/${id}`, { method: 'DELETE' });

// ---- reports ----------------------------------------------------------------------------------------------
export interface TrialBalance {
  asOf: string;
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  lines: {
    code: string;
    name: string;
    debit: string;
    credit: string;
    closingDebit: string;
    closingCredit: string;
  }[];
}
export const trialBalance = (asOf: string) =>
  api<TrialBalance>(`/finance/reports/trial-balance${qs({ asOf })}`);
export interface Group {
  code: string;
  name: string;
  total: string;
  accounts: { code: string; name: string; amount: string }[];
}
export interface ProfitLoss {
  from: string;
  to: string;
  summary: Record<string, string>;
  sections: (Group & { rootType: string })[];
}
export const profitAndLoss = (from: string, to: string) =>
  api<ProfitLoss>(`/finance/reports/profit-and-loss${qs({ from, to })}`);
export interface BalanceSheet {
  asOf: string;
  assets: Group[];
  liabilities: Group[];
  equity: Group[];
  currentYearProfit: string;
  totals: Record<string, string>;
  balanced: boolean;
}
export const balanceSheet = (asOf: string) =>
  api<BalanceSheet>(`/finance/reports/balance-sheet${qs({ asOf })}`);
export interface Ledger {
  account: { code: string; name: string };
  opening: string;
  closing: string;
  totalDebit: string;
  totalCredit: string;
  lines: {
    id: string;
    date: string;
    voucherType: string;
    voucherNo: string;
    narration: string | null;
    debit: string;
    credit: string;
    balance: string;
  }[];
}
export const generalLedger = (accountId: string, from: string, to: string) =>
  api<Ledger>(`/finance/reports/general-ledger${qs({ accountId, from, to })}`);
export interface Ageing {
  parties: {
    partyId: string;
    name: string;
    notDue: string;
    d1_30: string;
    d31_60: string;
    d61_90: string;
    d90plus: string;
    total: string;
  }[];
  total: {
    notDue: string;
    d1_30: string;
    d31_60: string;
    d61_90: string;
    d90plus: string;
    total: string;
  };
}
export const ageing = (side: 'RECEIVABLE' | 'PAYABLE', asOf: string) =>
  api<Ageing>(`/finance/reports/ageing${qs({ side, asOf })}`);

// ---- notes ------------------------------------------------------------------------------------------------
export interface Note {
  id: string;
  code: string;
  kind: 'CREDIT' | 'DEBIT';
  effect: 'REDUCE' | 'ADD';
  partyId: string;
  partyName: string | null;
  docDate: string;
  amount: string;
  reason: string;
  againstDocNo: string | null;
  status: 'Draft' | 'Pending Approval' | 'Approved' | 'Rejected' | 'Posted' | 'Cancelled';
  version: number;
  counterAccountId: string;
}
const notePath = (kind: 'CREDIT' | 'DEBIT') => (kind === 'CREDIT' ? 'credit-notes' : 'debit-notes');
export const listNotes = (kind: 'CREDIT' | 'DEBIT', page: number) =>
  paged<Note>(`/finance/${notePath(kind)}${qs({ page, size: 20 })}`);
export const createNote = (kind: 'CREDIT' | 'DEBIT', b: Record<string, unknown>) =>
  api<Note>(`/finance/${notePath(kind)}`, { method: 'POST', body: b });
export const postNote = (kind: 'CREDIT' | 'DEBIT', id: string, version: number) =>
  api<Note>(`/finance/${notePath(kind)}/${id}/post`, {
    method: 'POST',
    headers: { ...ifMatch(version), ...idem() },
  });
export const cancelNote = (kind: 'CREDIT' | 'DEBIT', id: string, version: number, reason: string) =>
  api<Note>(`/finance/${notePath(kind)}/${id}/cancel`, {
    method: 'POST',
    body: { reason },
    headers: { ...ifMatch(version), ...idem() },
  });
export const deleteNote = (kind: 'CREDIT' | 'DEBIT', id: string) =>
  api<void>(`/finance/${notePath(kind)}/${id}`, { method: 'DELETE' });

export interface ApprovalLimits {
  journalApprovalThreshold: string | null;
  noteApprovalThreshold: string | null;
}
export const getApprovalLimits = () => api<ApprovalLimits>('/finance/approval-limits');
export const saveApprovalLimits = (b: Partial<ApprovalLimits>) =>
  api<ApprovalLimits>('/finance/approval-limits', { method: 'PUT', body: b });
export const submitNote = (kind: 'CREDIT' | 'DEBIT', id: string, version: number) =>
  api<Note & { needsApproval: boolean }>(`/finance/${notePath(kind)}/${id}/submit`, {
    method: 'POST',
    headers: { ...ifMatch(version), ...idem() },
  });

// ---- parties for pickers ----------------------------------------------------------------------------------
export interface PartyOption {
  id: string;
  code: string;
  name: string;
}
export const listCustomers = () =>
  api<PartyOption[]>(`/customers${qs({ size: 100, status: 'ACTIVE', approval: 'APPROVED' })}`);
export const listSuppliers = () =>
  api<PartyOption[]>(`/suppliers${qs({ size: 100, status: 'ACTIVE', approval: 'APPROVED' })}`);

// ---- expense claims -----------------------------------------------------------------------------------------
export interface ExpensePolicy {
  category: string;
  perClaimLimit: string;
  perMonthLimit: string;
  approvalLimit: string;
  defaultAccountId: string | null;
  version: number;
}
export interface Claim {
  id: string;
  code: string;
  employee: string | null;
  claimDate: string;
  category: string;
  amount: string;
  description: string;
  billNo: string | null;
  status: string;
  warnings: { code: string; message: string }[];
  version: number;
}
export const expensePolicies = () => api<ExpensePolicy[]>('/finance/expense-policies');
export const saveExpensePolicy = (category: string, version: number, b: Record<string, unknown>) =>
  api<ExpensePolicy>(`/finance/expense-policies/${encodeURIComponent(category)}`, {
    method: 'PUT',
    body: b,
    headers: ifMatch(version),
  });
export const listClaims = (page: number, mine: boolean) =>
  paged<Claim>(`/finance/expenses${qs({ page, size: 20, mine: mine ? 'true' : undefined })}`);
export const createClaim = (b: Record<string, unknown>) =>
  api<Claim>('/finance/expenses', { method: 'POST', body: b });
export const deleteClaim = (id: string) =>
  api<void>(`/finance/expenses/${id}`, { method: 'DELETE' });
export const submitClaim = (id: string, version: number) =>
  api<Claim>(`/finance/expenses/${id}/submit`, {
    method: 'POST',
    headers: { ...ifMatch(version), ...idem() },
  });
export const payClaim = (id: string, version: number, b: { bankAccountId: string; mode: string }) =>
  api<Claim>(`/finance/expenses/${id}/pay`, {
    method: 'POST',
    body: b,
    headers: { ...ifMatch(version), ...idem() },
  });
export const cancelClaim = (id: string, version: number, reason: string) =>
  api<Claim>(`/finance/expenses/${id}/cancel`, {
    method: 'POST',
    body: { reason },
    headers: { ...ifMatch(version), ...idem() },
  });

// ---- recurring journals -------------------------------------------------------------------------------------
export interface Recurring {
  id: string;
  name: string;
  frequency: string;
  nextRun: string;
  endDate: string | null;
  autoPost: boolean;
  reverseNextDay: boolean;
  status: string;
  runs: number;
  version: number;
  lines: { accountId: string; debit: string; credit: string }[];
}
export const listRecurring = () => api<Recurring[]>('/finance/recurring');
export const createRecurring = (b: Record<string, unknown>) =>
  api<Recurring>('/finance/recurring', { method: 'POST', body: b });
export const setRecurringStatus = (id: string, version: number, status: 'Active' | 'Paused') =>
  api<Recurring>(`/finance/recurring/${id}/status`, {
    method: 'POST',
    body: { status },
    headers: ifMatch(version),
  });
export const deleteRecurring = (id: string) =>
  api<void>(`/finance/recurring/${id}`, { method: 'DELETE' });
export interface RunResult {
  created: { template: string; code: string; date: string; posted: boolean }[];
  reversed: { journal: string; reversal: string }[];
  failures: { template: string; error: string }[];
}
export const runRecurring = (asOf: string) =>
  api<RunResult>('/finance/recurring/run', { method: 'POST', body: { asOf } });

// ---- foreign currency ---------------------------------------------------------------------------------------
export interface FxRate {
  id: string;
  currencyCode: string;
  rateDate: string;
  rate: string;
}
export const listFxRates = () => paged<FxRate>('/finance/fx-rates?size=50');
export const saveFxRate = (b: { currencyCode: string; rateDate: string; rate: string }) =>
  api<FxRate>('/finance/fx-rates', { method: 'PUT', body: b });
export const fxRateOn = (currency: string, date: string) =>
  api<{ rate: string; rateDate: string } | null>(`/finance/fx-rates/on${qs({ currency, date })}`);
export interface Revaluation {
  asOf: string;
  unrealisedGain: string;
  unrealisedLoss: string;
  net: string;
  lines: {
    itemId: string;
    docNo: string;
    currency: string;
    foreignOutstanding: string;
    rate: string;
    carrying: string;
    revalued: string;
    difference: string;
    result: string;
  }[];
}
export const revaluation = (asOf: string) =>
  api<Revaluation>(`/finance/reports/fx-revaluation${qs({ asOf })}`);

// ---- cash flow ----------------------------------------------------------------------------------------------
export interface CashFlow {
  from: string;
  to: string;
  operating: {
    netProfit: string;
    items: { code: string; name: string; amount: string }[];
    total: string;
  };
  investing: { items: { code: string; name: string; amount: string }[]; total: string };
  financing: { items: { code: string; name: string; amount: string }[]; total: string };
  netChange: string;
  openingCash: string;
  closingCash: string;
  reconciles: boolean;
}
export const cashFlow = (from: string, to: string) =>
  api<CashFlow>(`/finance/reports/cash-flow${qs({ from, to })}`);

// ---- period close and year-end -------------------------------------------------------------------------------
export interface CloseView {
  fy: { id: string; code: string; status: string; yearEndPosted: boolean };
  periods: {
    id: string;
    periodNo: number;
    label: string;
    startDate: string;
    endDate: string;
    status: string;
    version: number;
    draftJournals: number;
    openBankStatements: number;
  }[];
  preview: { draftJournals: number; units: { unitId: string; unit: string; netProfit: string }[] };
}
export const closeView = (fyId: string) => api<CloseView>(`/finance/close/${fyId}`);
export const closePeriod = (id: string, version: number) =>
  api<unknown>(`/finance/close/periods/${id}/close`, { method: 'POST', headers: ifMatch(version) });
export const reopenPeriod = (id: string, version: number, reason: string) =>
  api<unknown>(`/finance/close/periods/${id}/reopen`, {
    method: 'POST',
    body: { reason },
    headers: ifMatch(version),
  });
export const closeYear = (fyId: string) =>
  api<{ closings: { unit?: string; netProfit: string }[] }>(`/finance/close/${fyId}/year-end`, {
    method: 'POST',
    body: {},
    headers: idem(),
  });

// ---- tax registers --------------------------------------------------------------------------------------------
export interface TaxRegister {
  totals: { taxable: string; cgst: string; sgst: string; igst: string; cess: string };
  rows: {
    id: string;
    docKind: string;
    docNo: string;
    docDate: string;
    partyName: string;
    partyGstin: string | null;
    placeOfSupply: string;
    taxable: string;
    cgst: string;
    sgst: string;
    igst: string;
    cess: string;
    status: string;
  }[];
}
export const taxRegister = (kind: 'sales' | 'purchase', from: string, to: string) =>
  api<TaxRegister>(`/finance/tax/${kind}-register${qs({ from, to })}`);
export interface TdsRegister {
  totalDeducted: string;
  pendingDeposit: string;
  rows: {
    id: string;
    sectionCode: string;
    supplier: string | null;
    baseAmount: string;
    ratePct: string;
    tdsAmount: string;
    deductedOn: string;
    docNo: string | null;
    challanNo: string | null;
    status: string;
  }[];
}
export const tdsRegister = (kind: 'tds' | 'tcs', from: string, to: string) =>
  api<TdsRegister>(`/finance/tax/${kind}-register${qs({ from, to })}`);
export const taxChallans = () =>
  api<
    {
      id: string;
      taxKind: string;
      challanNo: string;
      bsrCode: string | null;
      paidOn: string;
      amount: string;
      entries: number;
    }[]
  >('/finance/tax/challans');
export const depositChallan = (b: Record<string, unknown>) =>
  api<{ challanNo: string; amount: string }>('/finance/tax/challans', { method: 'POST', body: b });
