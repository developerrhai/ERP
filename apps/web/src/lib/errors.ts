// One place that turns API errors into the messages Phase 2 screens show (409 IN_USE /
// PROTECTED / VERSION_CONFLICT, 422 field errors) so every page words them the same way.
import { ApiError } from './api';

export const RECORD_CONFLICT_MESSAGE =
  'This record was changed by someone else. Reload and try again.';

export interface UiError {
  message: string;
  fields: Record<string, string>;
  code: string;
}

export function toUiError(err: unknown): UiError {
  if (!(err instanceof ApiError)) {
    return { message: 'Something went wrong.', fields: {}, code: 'UNKNOWN' };
  }
  if (err.code === 'VERSION_CONFLICT') {
    return { message: RECORD_CONFLICT_MESSAGE, fields: {}, code: err.code };
  }
  return { message: err.message, fields: err.fields, code: err.code };
}

/**
 * The text to show when there is no form to hang field errors on (a toast, a banner above a document): a validation
 * error names what is wrong ("Enter a rate on every line before submitting.") instead of the bare "Please fix the
 * highlighted fields." when nothing is highlighted.
 */
export function toUiMessage(err: unknown): string {
  const u = toUiError(err);
  const details = Object.values(u.fields ?? {}).filter((m) => typeof m === 'string' && m.trim() !== '');
  return u.code === 'VALIDATION_ERROR' && details.length > 0 ? details.join(' ') : u.message;
}
