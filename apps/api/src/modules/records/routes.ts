// Route table for /pages/:pageId (docs/phase3-4 B1/B3, C3): GET schema (`view`), preview, audit, then
// the records API. Reads need `view` / `export`, writes need add / edit / delete AND a concrete unit
// (not "All units"); every route resolves the unit / FY context first. Pages that are neither generic
// nor typed Inventory pages answer 404 NOT_GENERIC. Typed pages are dispatched to their handlers.
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { requireConcreteUnit, resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requireParamPageAction } from '../../core/rbac/access';
import { typedHandlerFor } from '../inventory/typed-pages';
import { recordsController } from './controller';
import { assertServed } from './service';
import {
  actionBodySchema,
  actionParamsSchema,
  auditQuerySchema,
  bulkBodySchema,
  exportRecordsQuerySchema,
  listRecordsQuerySchema,
  pageParamsSchema,
  previewQuerySchema,
  recordBodySchema,
  recordParamsSchema,
  restoreBodySchema,
  statusBodySchema,
  typedExportQuerySchema,
  typedListQuerySchema,
} from './schemas';

/** 404 NOT_GENERIC for pages served by neither engine (after the id was validated). */
const requireServedPage: RequestHandler = (req, _res, next) => {
  try {
    assertServed(req.params.pageId ?? '');
    next();
  } catch (err) {
    next(err);
  }
};

/** Validates the list / export query with the schema of the engine that serves the page. */
const byEngine =
  (
    generic: Parameters<typeof validate>[0]['query'],
    typed: Parameters<typeof validate>[0]['query'],
  ): RequestHandler =>
  (req, res, next) =>
    validate({ query: typedHandlerFor(req.params.pageId ?? '') ? typed : generic })(req, res, next);

type Action = Parameters<typeof requireParamPageAction>[0];

function guard(action: Action, write: boolean): RequestHandler[] {
  const permission = requireParamPageAction(action);
  return write ? [permission, requireConcreteUnit] : [permission];
}

export function createPagesRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  router.get(
    '/:pageId/schema',
    validate({ params: pageParamsSchema }),
    requireParamPageAction('view'),
    asyncHandler(recordsController.schema),
  );

  router.get(
    '/:pageId/preview',
    validate({ params: pageParamsSchema }),
    requireParamPageAction('view'),
    validate({ query: previewQuerySchema }),
    asyncHandler(recordsController.preview),
  );

  router.get(
    '/:pageId/audit',
    validate({ params: pageParamsSchema }),
    requireServedPage,
    requireParamPageAction('view'),
    validate({ query: auditQuerySchema }),
    asyncHandler(recordsController.audit),
  );

  const records = Router({ mergeParams: true });
  records.use(validate({ params: pageParamsSchema }), requireServedPage);

  records.get(
    '/',
    ...guard('view', false),
    byEngine(listRecordsQuerySchema, typedListQuerySchema),
    asyncHandler(recordsController.list),
  );
  records.post(
    '/',
    ...guard('add', true),
    validate({ body: recordBodySchema }),
    asyncHandler(recordsController.create),
  );
  records.get(
    '/export.xlsx',
    ...guard('export', false),
    byEngine(exportRecordsQuerySchema, typedExportQuerySchema),
    asyncHandler(recordsController.export),
  );
  records.post(
    '/bulk',
    ...guard('delete', true),
    validate({ body: bulkBodySchema }),
    asyncHandler(recordsController.bulk),
  );
  records.get(
    '/:id',
    ...guard('view', false),
    validate({ params: recordParamsSchema }),
    asyncHandler(recordsController.get),
  );
  records.get(
    '/:id/audit',
    ...guard('view', false),
    validate({ params: recordParamsSchema, query: auditQuerySchema }),
    asyncHandler(recordsController.recordAudit),
  );
  records.patch(
    '/:id',
    ...guard('edit', true),
    validate({ params: recordParamsSchema, body: recordBodySchema }),
    asyncHandler(recordsController.update),
  );
  records.delete(
    '/:id',
    ...guard('delete', true),
    validate({ params: recordParamsSchema }),
    asyncHandler(recordsController.remove),
  );
  records.post(
    '/:id/restore',
    ...guard('delete', true),
    validate({ params: recordParamsSchema, body: restoreBodySchema }),
    asyncHandler(recordsController.restore),
  );
  records.post(
    '/:id/status',
    ...guard('edit', true),
    validate({ params: recordParamsSchema, body: statusBodySchema }),
    asyncHandler(recordsController.status),
  );
  // Typed Inventory actions: post | cancel | dispatch | receive (| activate | deactivate). The
  // permission is `edit` (the module's allow_edit switch applies); a concrete unit is needed.
  records.post(
    '/:id/actions/:action',
    ...guard('edit', true),
    validate({ params: actionParamsSchema, body: actionBodySchema }),
    asyncHandler(recordsController.action),
  );

  router.use('/:pageId/records', records);
  return router;
}
