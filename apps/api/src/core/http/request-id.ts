// Gives every request an id (a safe incoming X-Request-Id or a new UUID). It is logged by pino-http,
// echoed in the X-Request-Id header and put in every error body so support can trace a failure.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequestHandler } from 'express';

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Used as pino-http's genReqId, so the logger and the app share one id. */
export function genRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/** Copies the id pino-http assigned onto req.requestId (typed) for handlers and errors. */
export const attachRequestId: RequestHandler = (req, res, next) => {
  req.requestId = typeof req.id === 'string' ? req.id : genRequestId(req, res);
  next();
};
