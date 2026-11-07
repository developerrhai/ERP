// Finance error factory (05c §7.7). Every new code is also in ErrorCode (core/http/errors.ts).
import { AppError } from '../../core/http/errors';
import type { ErrorCode, FieldErrors } from '../../core/http/errors';

const e =
  (status: number, code: ErrorCode) =>
  (message: string, fields?: FieldErrors): AppError =>
    new AppError(status, code, message, fields);

export const FinErrors = {
  unbalanced: (difference: string, detail?: string) =>
    new AppError(
      422,
      'JOURNAL_UNBALANCED',
      detail ?? `Debit and credit do not match: the difference is ${difference}.`,
      { difference },
    ),
  noPeriod: e(422, 'NO_PERIOD'),
  periodLocked: e(409, 'PERIOD_LOCKED'),
  futureDate: e(422, 'FUTURE_DATE'),
  accountNotPostable: e(422, 'ACCOUNT_NOT_POSTABLE'),
  costCenterRequired: e(422, 'COST_CENTER_REQUIRED'),
  partyRequired: e(422, 'PARTY_REQUIRED'),
  partyRoleMismatch: e(422, 'PARTY_ROLE_MISMATCH'),
  partyNotAllowed: e(422, 'PARTY_NOT_ALLOWED'),
  alreadyReversed: e(409, 'ALREADY_REVERSED'),
  cannotReverseReversal: e(409, 'CANNOT_REVERSE_REVERSAL'),
  reversalDateInvalid: e(422, 'REVERSAL_DATE_INVALID'),
  reasonRequired: e(422, 'REASON_REQUIRED'),
  settledDocument: e(409, 'SETTLED_DOCUMENT'),
  reconciledEntry: e(409, 'RECONCILED_ENTRY'),
  eventPayloadChanged: e(409, 'EVENT_PAYLOAD_CHANGED'),
  noPostingRule: e(422, 'NO_POSTING_RULE'),
  unmappedKey: e(422, 'UNMAPPED_ACCOUNT_KEY'),
  billRefRequired: e(422, 'BILL_REF_REQUIRED'),
  overAllocation: e(422, 'OVER_ALLOCATION'),
  advanceNotConfirmed: e(422, 'ADVANCE_NOT_CONFIRMED'),
  itemBlocked: e(422, 'ITEM_BLOCKED'),
  negativeCash: e(409, 'NEGATIVE_CASH'),
  cashReceiptLimit: e(422, 'CASH_RECEIPT_LIMIT'),
  modeAccountMismatch: e(422, 'MODE_ACCOUNT_MISMATCH'),
  budgetExceeded: e(409, 'BUDGET_EXCEEDED'),
  statementDoesNotFoot: e(422, 'STATEMENT_DOES_NOT_FOOT'),
  duplicateStatement: e(409, 'DUPLICATE_STATEMENT'),
  previousStatementOpen: e(409, 'PREVIOUS_STATEMENT_OPEN'),
  reconDifference: e(422, 'RECON_DIFFERENCE'),
  suggestionsPending: e(422, 'SUGGESTIONS_PENDING'),
  amountMismatch: e(422, 'AMOUNT_MISMATCH'),
  closeBlocked: e(409, 'CLOSE_BLOCKED'),
  parentTypeMismatch: e(422, 'PARENT_TYPE_MISMATCH'),
  cycle: e(422, 'CYCLE'),
  accountHasBalance: e(409, 'ACCOUNT_HAS_BALANCE'),
  invalidTransition: e(409, 'INVALID_TRANSITION'),
  currencyNotSupported: e(422, 'CURRENCY_NOT_SUPPORTED'),
  notDraft: e(409, 'NOT_DRAFT'),
  taxPayloadMismatch: e(422, 'TAX_PAYLOAD_MISMATCH'),
  tdsAlreadyDeposited: e(409, 'TDS_ALREADY_DEPOSITED'),
  challanMismatch: e(422, 'CHALLAN_MISMATCH'),
  noFxRate: e(422, 'NO_FX_RATE'),
  expenseLimit: e(422, 'EXPENSE_LIMIT'),
};
