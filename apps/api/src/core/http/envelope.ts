// Phase 22 (crawler finding): the Projects and Service routers return bare JSON, while the web app reads the
// { data } envelope used everywhere else. This middleware wraps a body that has no top-level `data` key, so
// both shapes agree without editing every route.
import type { NextFunction, Request, Response } from 'express';

export function dataEnvelope(_req: Request, res: Response, next: NextFunction): void {
  const original = res.json.bind(res) as (body?: unknown) => Response;
  res.json = ((body?: unknown): Response => {
    const isEnveloped =
      body !== null && typeof body === 'object' && !Array.isArray(body) && 'data' in (body as object);
    return original(isEnveloped || body === undefined ? body : { data: body });
  }) as typeof res.json;
  next();
}
