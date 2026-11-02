// Zod validation for body, query and params (CONTRACT §7 Validation). Parsed values are stored on
// res.locals.valid so controllers read typed, trimmed data instead of the raw request.
import type { RequestHandler, Response } from 'express';
import type { ZodType, ZodTypeAny, ZodTypeDef } from 'zod';
import { Errors } from './errors';
import { zodToFieldErrors } from './error-middleware';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

type Part = keyof Schemas;

export function validate(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    const valid: Partial<Record<Part, unknown>> = {};
    const fields: Record<string, string> = {};
    const sources: Record<Part, unknown> = { body: req.body, query: req.query, params: req.params };
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      // An absent JSON body arrives as {} from express.json, or undefined without a content type.
      const result = schema.safeParse(sources[part] ?? {});
      if (result.success) valid[part] = result.data;
      else Object.assign(fields, zodToFieldErrors(result.error));
    }
    if (Object.keys(fields).length > 0) return next(Errors.validation(fields));
    // Merge, so a router-level validate (e.g. the :pageId param) survives a route-level one.
    res.locals.valid = { ...(res.locals.valid as object | undefined), ...valid };
    next();
  };
}

/** Reads a part validated by `validate`; the schema type ties the result to what was parsed. */
export function validated<T>(
  res: Response,
  part: Part,
  _schema: ZodType<T, ZodTypeDef, unknown>,
): T {
  const store = res.locals.valid as Partial<Record<Part, unknown>> | undefined;
  if (!store || !(part in store)) throw new Error(`Request ${part} was not validated`);
  return store[part] as T;
}
