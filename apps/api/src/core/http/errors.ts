// AppError carries an HTTP status + contract error code (CONTRACT §7). Services throw these and the
// error middleware turns them into the one error shape, so no handler formats errors by hand.
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'SESSION_EXPIRED'
  | 'FORBIDDEN'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IN_PROGRESS'
  | 'PRECONDITION_REQUIRED'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_NOT_ALLOWED'
  | 'FILE_INFECTED'
  | 'IMPORT_INVALID'
  | 'JOB_NOT_READY'
  | 'VERSION_CONFLICT'
  | 'DUPLICATE'
  | 'IN_USE'
  | 'PROTECTED'
  | 'NOT_GENERIC'
  | 'PERIOD_CLOSED'
  | 'RECORD_LOCKED'
  | 'INSUFFICIENT_STOCK'
  | 'READ_ONLY'
  | 'CONTEXT_FORBIDDEN'
  | 'CONTEXT_INVALID'
  | 'REFRESH_RACE'
  | 'PAYLOAD_TOO_LARGE'
  | 'VALIDATION_ERROR'
  | 'ACCOUNT_LOCKED'
  | 'RATE_LIMITED'
  | 'SERVER_BUSY'
  | 'STOCK_RESERVED'
  | 'BACKDATED_POSTING'
  | 'WAREHOUSE_FROZEN'
  | 'BATCH_REQUIRED'
  | 'BATCH_BLOCKED'
  | 'BATCH_EXPIRED'
  | 'SERIAL_QTY_MISMATCH'
  | 'SERIAL_DUPLICATE'
  | 'SERIAL_NOT_IN_STOCK'
  | 'TRACKING_CONFLICT'
  | 'TRACKING_LOCKED'
  | 'UOM_NOT_CONVERTIBLE'
  | 'UOM_PRECISION'
  | 'VALUATION_METHOD_LOCKED'
  | 'LAYER_CONSUMED'
  | 'BIN_CAPACITY_EXCEEDED'
  | 'BIN_BLOCKED'
  | 'BIN_NOT_EMPTY'
  | 'CAPACITY_EXCEEDED'
  | 'MAKER_CHECKER'
  | 'SAME_COUNTER'
  | 'COUNT_STALE'
  | 'UNIT_COST_REQUIRED'
  | 'STANDARD_COST_MISSING'
  | 'NRV_REVERSAL_EXCEEDS_WRITEDOWN'
  | 'NOT_SUPPORTED_FOR_FIFO'
  | 'MFA_SETUP_REQUIRED'
  | 'MFA_CODE_INVALID'
  | 'MFA_CHALLENGE_EXPIRED'
  | 'NOT_LOCKED'
  | 'CURRENT_SESSION'
  | 'FEATURE_DISABLED'
  | 'ZONE_RESTRICTION'
  | 'MATRIX_LEVEL_GAP'
  | 'MATRIX_FIRST_THRESHOLD'
  | 'MATRIX_THRESHOLD_ORDER'
  | 'MATRIX_APPROVER_REQUIRED'
  | 'MATRIX_SAME_USER'
  | 'MATRIX_DUPLICATE_SET'
  | 'NO_APPROVAL_RULE'
  | 'NO_ELIGIBLE_APPROVER'
  | 'ALREADY_PENDING'
  | 'NOT_SUBMITTABLE'
  | 'SELF_APPROVAL'
  | 'ONE_LEVEL_ONLY'
  | 'NOT_YOUR_LEVEL'
  | 'OVER_LIMIT'
  | 'LEVEL_ALREADY_DECIDED'
  | 'COMMENT_REQUIRED'
  | 'DELEGATION_OVERLAP'
  | 'DELEGATION_SELF'
  | 'GSTIN_LENGTH'
  | 'GSTIN_FORMAT'
  | 'GSTIN_STATE'
  | 'GSTIN_CHECKSUM'
  | 'GSTIN_PAN_MISMATCH'
  | 'GSTIN_STATE_MISMATCH'
  | 'GSTIN_REQUIRED'
  | 'GSTIN_NOT_ALLOWED'
  | 'GSTIN_DUPLICATE'
  | 'PAN_FORMAT'
  | 'UDYAM_FORMAT'
  | 'MSME_DAYS'
  | 'IFSC_FORMAT'
  | 'ACCOUNT_CONFIRM'
  | 'BANK_SELF_VERIFY'
  | 'BANK_DUPLICATE'
  | 'HSN_REQUIRED'
  | 'HSN_DIGITS'
  | 'NO_GST_RATE'
  | 'RATE_OVERLAP'
  | 'TERMS_SUM'
  | 'PRICE_DATES'
  | 'CREDIT_PENDING'
  | 'SUPPLIER_NOT_APPROVED'
  | 'DUP_WARN'
  | 'JOURNAL_UNBALANCED'
  | 'AMOUNT_PRECISION'
  | 'PERIOD_LOCKED'
  | 'NO_PERIOD'
  | 'FUTURE_DATE'
  | 'ACCOUNT_NOT_POSTABLE'
  | 'COST_CENTER_REQUIRED'
  | 'PARTY_REQUIRED'
  | 'PARTY_ROLE_MISMATCH'
  | 'PARTY_NOT_ALLOWED'
  | 'ALREADY_REVERSED'
  | 'CANNOT_REVERSE_REVERSAL'
  | 'REVERSAL_DATE_INVALID'
  | 'REASON_REQUIRED'
  | 'SETTLED_DOCUMENT'
  | 'RECONCILED_ENTRY'
  | 'EVENT_PAYLOAD_CHANGED'
  | 'NO_POSTING_RULE'
  | 'UNMAPPED_ACCOUNT_KEY'
  | 'ROUND_OFF_TOO_LARGE'
  | 'BILL_REF_REQUIRED'
  | 'OVER_ALLOCATION'
  | 'ADVANCE_NOT_CONFIRMED'
  | 'ITEM_BLOCKED'
  | 'NEGATIVE_CASH'
  | 'CASH_RECEIPT_LIMIT'
  | 'MODE_ACCOUNT_MISMATCH'
  | 'BUDGET_EXCEEDED'
  | 'STATEMENT_DOES_NOT_FOOT'
  | 'DUPLICATE_STATEMENT'
  | 'PREVIOUS_STATEMENT_OPEN'
  | 'RECON_DIFFERENCE'
  | 'SUGGESTIONS_PENDING'
  | 'AMOUNT_MISMATCH'
  | 'CLOSE_BLOCKED'
  | 'PARENT_TYPE_MISMATCH'
  | 'CYCLE'
  | 'ACCOUNT_HAS_BALANCE'
  | 'INVALID_TRANSITION'
  | 'CURRENCY_NOT_SUPPORTED'
  | 'APPROVAL_NOT_ENABLED'
  | 'NOT_DRAFT'
  | 'LEDGER_LOCKED'
  | 'TAX_PAYLOAD_MISMATCH'
  | 'TDS_ALREADY_DEPOSITED'
  | 'CHALLAN_MISMATCH'
  | 'NO_FX_RATE'
  | 'EXPENSE_LIMIT'
  | 'FORMAT_NOT_ALLOWED'
  | 'FORMULA_INVALID'
  | 'FORMAT_IN_USE'
  | 'INTERNAL';

export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: FieldErrors,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const INVALID_CREDENTIALS_MESSAGE = 'Email / User ID or password is incorrect.';

export const Errors = {
  badRequest: (message = 'The request is malformed.') => new AppError(400, 'BAD_REQUEST', message),
  unauthenticated: (message = 'Authentication required.') =>
    new AppError(401, 'UNAUTHENTICATED', message),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE),
  sessionExpired: (message = 'Your session has expired. Please sign in again.') =>
    new AppError(401, 'SESSION_EXPIRED', message),
  forbidden: (message = 'You do not have permission to do this.') =>
    new AppError(403, 'FORBIDDEN', message),
  passwordChangeRequired: () =>
    new AppError(
      403,
      'PASSWORD_CHANGE_REQUIRED',
      'You must change your password before continuing.',
    ),
  notFound: (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message),
  versionConflict: () =>
    new AppError(
      409,
      'VERSION_CONFLICT',
      'This record was changed by someone else. Reload and try again.',
    ),
  duplicate: (fields: FieldErrors) =>
    new AppError(409, 'DUPLICATE', 'A record with these values already exists.', fields),
  refreshRace: () =>
    new AppError(409, 'REFRESH_RACE', 'Session was refreshed in another tab. Retry.'),
  currentSession: () =>
    new AppError(409, 'CURRENT_SESSION', 'Use Sign Out to end your current session.'),
  notLocked: () => new AppError(409, 'NOT_LOCKED', 'Account is not locked.'),
  inUse: (message: string) => new AppError(409, 'IN_USE', message),
  protectedResource: (message: string) => new AppError(409, 'PROTECTED', message),
  notGeneric: (message = 'This page is not served by the generic record engine.') =>
    new AppError(404, 'NOT_GENERIC', message),
  readOnly: (message = 'This page is read-only.') => new AppError(405, 'READ_ONLY', message),
  insufficientStock: (message: string) => new AppError(409, 'INSUFFICIENT_STOCK', message),
  recordLocked: (message: string) => new AppError(409, 'RECORD_LOCKED', message),
  periodClosed: (message = 'This financial year is closed.') =>
    new AppError(409, 'PERIOD_CLOSED', message),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  inProgress: () =>
    new AppError(409, 'IN_PROGRESS', 'The same request is still running. Retry in a moment.'),
  preconditionRequired: (message = 'Send the If-Match header with the record version (ETag).') =>
    new AppError(428, 'PRECONDITION_REQUIRED', message),
  fileTooLarge: (message: string) => new AppError(413, 'FILE_TOO_LARGE', message),
  fileTypeNotAllowed: (message: string) => new AppError(415, 'FILE_TYPE_NOT_ALLOWED', message),
  fileInfected: (message = 'This file was rejected by the security scan.') =>
    new AppError(422, 'FILE_INFECTED', message),
  importInvalid: (message: string, fields?: FieldErrors) =>
    new AppError(422, 'IMPORT_INVALID', message, fields),
  jobNotReady: (message = 'This job has not finished yet.') =>
    new AppError(409, 'JOB_NOT_READY', message),
  contextForbidden: (message = 'You cannot work in this unit.') =>
    new AppError(403, 'CONTEXT_FORBIDDEN', message),
  contextInvalid: (message: string) => new AppError(422, 'CONTEXT_INVALID', message),
  payloadTooLarge: () => new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.'),
  validation: (fields: FieldErrors, message = 'Please fix the highlighted fields.') =>
    new AppError(422, 'VALIDATION_ERROR', message, fields),
  accountLocked: (minutes: number, forKnownUser = true) =>
    new AppError(
      423,
      'ACCOUNT_LOCKED',
      forKnownUser
        ? `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'} or ask your administrator to unlock your account.`
        : `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    ),
  serverBusy: () =>
    new AppError(503, 'SERVER_BUSY', 'The server is busy. Please retry in a moment.', undefined, {
      'Retry-After': '1',
    }),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError(
      429,
      'RATE_LIMITED',
      'Too many requests. Please slow down and try again.',
      undefined,
      {
        'Retry-After': String(retryAfterSeconds),
      },
    ),
  backdatedPosting: (
    message = 'This posting is dated before the last movement of the item. Ask a user with approve rights to post it.',
  ) => new AppError(409, 'BACKDATED_POSTING', message),
  stockReserved: (message = 'Stock is reserved for another demand.') =>
    new AppError(409, 'STOCK_RESERVED', message),
  warehouseFrozen: (message = 'Warehouse is frozen for counting.') =>
    new AppError(409, 'WAREHOUSE_FROZEN', message),
  batchRequired: (message = 'Batch is required for this item.') =>
    new AppError(422, 'BATCH_REQUIRED', message),
  batchBlocked: (message = 'Batch is blocked by QC or on hold.') =>
    new AppError(409, 'BATCH_BLOCKED', message),
  batchExpired: (message = 'Batch has expired.') => new AppError(409, 'BATCH_EXPIRED', message),
  serialQtyMismatch: (message = 'Serial numbers count does not match quantity.') =>
    new AppError(422, 'SERIAL_QTY_MISMATCH', message),
  serialDuplicate: (message = 'Duplicate serial number.') =>
    new AppError(409, 'SERIAL_DUPLICATE', message),
  serialNotInStock: (message = 'Serial number is not in stock.') =>
    new AppError(409, 'SERIAL_NOT_IN_STOCK', message),
  trackingConflict: (message = 'Tracking configuration conflict.') =>
    new AppError(422, 'TRACKING_CONFLICT', message),
  trackingLocked: (message = 'Item tracking cannot be changed once transactions exist.') =>
    new AppError(409, 'TRACKING_LOCKED', message),
  uomNotConvertible: (message = 'UOM cannot be converted.') =>
    new AppError(422, 'UOM_NOT_CONVERTIBLE', message),
  uomPrecision: (message = 'Quantity exceeds UOM precision.') =>
    new AppError(422, 'UOM_PRECISION', message),
  valuationMethodLocked: (
    message = 'Valuation method cannot be changed once transactions exist.',
  ) => new AppError(409, 'VALUATION_METHOD_LOCKED', message),
  layerConsumed: (message = 'Cost layer has already been consumed.') =>
    new AppError(409, 'LAYER_CONSUMED', message),
  binCapacityExceeded: (message = 'Bin capacity exceeded.') =>
    new AppError(409, 'BIN_CAPACITY_EXCEEDED', message),
  binBlocked: (message = 'Bin is blocked.') => new AppError(409, 'BIN_BLOCKED', message),
  binNotEmpty: (message = 'Bin still contains stock.') =>
    new AppError(409, 'BIN_NOT_EMPTY', message),
  capacityExceeded: (message = 'Capacity exceeded.') =>
    new AppError(422, 'CAPACITY_EXCEEDED', message),
  makerChecker: (
    message = 'Maker-checker violation: cannot approve own transaction above threshold.',
  ) => new AppError(403, 'MAKER_CHECKER', message),
  sameCounter: (message = 'Second count must be performed by a different counter.') =>
    new AppError(409, 'SAME_COUNTER', message),
  countStale: (message = 'Stock count is stale.') => new AppError(409, 'COUNT_STALE', message),
  unitCostRequired: (message = 'Unit cost is required.') =>
    new AppError(422, 'UNIT_COST_REQUIRED', message),
  standardCostMissing: (message = 'Standard cost is not defined for this item.') =>
    new AppError(422, 'STANDARD_COST_MISSING', message),
  nrvReversalExceeds: (message = 'NRV reversal exceeds previous write-down.') =>
    new AppError(422, 'NRV_REVERSAL_EXCEEDS_WRITEDOWN', message),
  notSupportedForFifo: (message = 'Operation not supported under FIFO valuation.') =>
    new AppError(422, 'NOT_SUPPORTED_FOR_FIFO', message),
  zoneRestriction: (message = 'Zone restriction violation.') =>
    new AppError(422, 'ZONE_RESTRICTION', message),
  mfaSetupRequired: (
    message = 'For security, administrators must turn on two-step verification before continuing.',
  ) => new AppError(403, 'MFA_SETUP_REQUIRED', message),
  mfaCodeInvalid: (
    message = 'That code did not work. Check the time on your phone and try the newest code.',
  ) => new AppError(401, 'MFA_CODE_INVALID', message),
  mfaChallengeExpired: (message = 'This sign-in took too long. Please sign in again.') =>
    new AppError(401, 'MFA_CHALLENGE_EXPIRED', message),
  recoveryCodeFormat: () =>
    new AppError(422, 'VALIDATION_ERROR', 'Recovery codes look like ABCD-1234.'),
  resetLinkInvalid: () =>
    new AppError(
      400,
      'BAD_REQUEST',
      'This reset link has expired or was already used. Ask for a new one.',
    ),
  mfaCannotBeDisabled: () =>
    new AppError(
      403,
      'FORBIDDEN',
      'Two-step verification is required for administrators. You cannot turn it off.',
    ),
  formatNotAllowed: (department: string) =>
    new AppError(
      403,
      'FORMAT_NOT_ALLOWED',
      `Only the Department Head of ${department} can change these settings.`,
    ),
  formulaInvalid: (name: string, reason: string) =>
    new AppError(422, 'FORMULA_INVALID', `The formula for ${name} is not valid: ${reason}.`),
  formatInUse: (n: number) =>
    new AppError(
      409,
      'FORMAT_IN_USE',
      `This format is used by ${n} open document${n === 1 ? '' : 's'}. Publish a new version instead of editing.`,
    ),
  featureDisabled: (message = 'Feature is disabled.') =>
    new AppError(503, 'FEATURE_DISABLED', message),
};
