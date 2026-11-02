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

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid login ID or password.';

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
  contextForbidden: (message = 'You cannot work in this unit.') =>
    new AppError(403, 'CONTEXT_FORBIDDEN', message),
  contextInvalid: (message: string) => new AppError(422, 'CONTEXT_INVALID', message),
  payloadTooLarge: () => new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.'),
  validation: (fields: FieldErrors, message = 'Please fix the highlighted fields.') =>
    new AppError(422, 'VALIDATION_ERROR', message, fields),
  accountLocked: (minutes: number) =>
    new AppError(
      423,
      'ACCOUNT_LOCKED',
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
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
};
