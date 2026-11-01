// Express 4 does not catch rejected promises; this wrapper forwards them to the error middleware so
// async handlers can simply throw.
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
