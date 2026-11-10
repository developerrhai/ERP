// The last two middlewares: a JSON 404 for unknown routes, and the error handler that renders every
// error in the contract shape. Unknown errors become a 500 that hides the stack (logged instead).
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger';
import { captureApiException } from '../observability/sentry';
import { AppError, Errors } from './errors';
import type { FieldErrors } from './errors';

export function zodToFieldErrors(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fields[key] = 'Unknown field.';
      continue;
    }
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { type?: unknown }).type === 'string' &&
    typeof (err as { status?: unknown }).status === 'number'
  );
}

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return Errors.validation(zodToFieldErrors(err));
  if (isBodyParserError(err)) {
    if (err.type === 'entity.too.large') return Errors.payloadTooLarge();
    if (err.status >= 400 && err.status < 500) return Errors.badRequest('Malformed request body.');
  }
  return null;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(Errors.notFound('Route not found.'));
};

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const appError = toAppError(err);
  const requestId = req.requestId ?? 'unknown';
  if (!appError) {
    logger.error({ err, requestId }, 'Unhandled error');
    captureApiException(err, req);
    if (process.env.DEBUG_UNHANDLED) console.error('UNHANDLED', err);
    res.status(500).json({
      error: { code: 'INTERNAL', message: 'Something went wrong.', status: 500, requestId },
    });
    return;
  }
  if (appError.headers) res.set(appError.headers);
  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      status: appError.status,
      requestId,
      ...(appError.fields ? { fields: appError.fields } : {}),
    },
  });
};
