// Routes of the Format & Settings engine (docs/phases/PHASE-06B.md §6).
//   /pages/:pageId/settings/...  per-page formats and rule sets: everybody with `view` on the page
//                                reads; only the owner department's Head and Administrators write
//                                (checked in the service, so every verb answers FORMAT_NOT_ALLOWED).
//   /formats                     admin-formats: all formats and rule sets, versions, change history.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requireParamPageAction, requirePageAction } from '../../core/rbac/access';
import './approval';
import { formatSettingsController as c } from './controller';
import {
  changesQuerySchema,
  codeParamsSchema,
  evaluateBodySchema,
  formatKeyQuerySchema,
  formatVersionsQuerySchema,
  globalIdParamsSchema,
  idParamsSchema,
  importQuerySchema,
  listAllQuerySchema,
  optionalReasonBodySchema,
  pageParamsSchema,
  reasonBodySchema,
  resolveQuerySchema,
  saveFormatBodySchema,
  saveRuleBodySchema,
  templateQuerySchema,
} from './schemas';

export function createPageSettingsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged);
  // Page-level `view` guards every verb; the Department Head rule is the service's job.
  router.use('/:pageId/settings', requireParamPageAction('view'));

  const base = '/:pageId/settings';
  router.get(
    `${base}/formats`,
    validate({ params: pageParamsSchema, query: formatKeyQuerySchema }),
    asyncHandler(c.listFormats),
  );
  router.get(
    `${base}/formats/resolve`,
    validate({ params: pageParamsSchema, query: resolveQuerySchema }),
    asyncHandler(c.resolveFormat),
  );
  router.get(
    `${base}/formats/versions`,
    validate({ params: pageParamsSchema, query: formatVersionsQuerySchema }),
    asyncHandler(c.formatVersions),
  );
  router.put(
    `${base}/formats`,
    validate({ params: pageParamsSchema, body: saveFormatBodySchema }),
    asyncHandler(c.saveFormat),
  );
  router.post(
    `${base}/formats/:id/publish`,
    validate({ params: idParamsSchema, body: reasonBodySchema }),
    asyncHandler(c.formats.publish),
  );
  router.post(
    `${base}/formats/:id/retire`,
    validate({ params: idParamsSchema, body: reasonBodySchema }),
    asyncHandler(c.formats.retire),
  );
  router.post(
    `${base}/formats/:id/restore`,
    validate({ params: idParamsSchema, body: optionalReasonBodySchema }),
    asyncHandler(c.formats.restore),
  );
  router.delete(
    `${base}/formats/:id`,
    validate({ params: idParamsSchema }),
    asyncHandler(c.formats.discard),
  );

  router.get(`${base}/rules`, validate({ params: pageParamsSchema }), asyncHandler(c.listRules));
  router.get(
    `${base}/rules/:code/versions`,
    validate({ params: codeParamsSchema }),
    asyncHandler(c.ruleVersions),
  );
  router.put(
    `${base}/rules`,
    validate({ params: pageParamsSchema, body: saveRuleBodySchema }),
    asyncHandler(c.saveRule),
  );
  router.post(
    `${base}/rules/evaluate`,
    validate({ params: pageParamsSchema, body: evaluateBodySchema }),
    asyncHandler(c.evaluate),
  );
  router.post(
    `${base}/rules/:id/publish`,
    validate({ params: idParamsSchema, body: reasonBodySchema }),
    asyncHandler(c.rules.publish),
  );
  router.post(
    `${base}/rules/:id/retire`,
    validate({ params: idParamsSchema, body: reasonBodySchema }),
    asyncHandler(c.rules.retire),
  );
  router.post(
    `${base}/rules/:id/restore`,
    validate({ params: idParamsSchema, body: optionalReasonBodySchema }),
    asyncHandler(c.rules.restore),
  );
  router.delete(
    `${base}/rules/:id`,
    validate({ params: idParamsSchema }),
    asyncHandler(c.rules.discard),
  );

  router.get(
    `${base}/import-template`,
    validate({ params: pageParamsSchema, query: templateQuerySchema }),
    asyncHandler(c.template),
  );
  router.post(
    `${base}/import`,
    validate({ params: pageParamsSchema, query: importQuerySchema }),
    asyncHandler(c.importExcel),
  );
  return router;
}

export function createFormatsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged);
  router.get(
    '/',
    requirePageAction('admin-formats', 'view'),
    validate({ query: listAllQuerySchema }),
    asyncHandler(c.listAll),
  );
  router.get(
    '/changes',
    requirePageAction('admin-formats', 'view'),
    validate({ query: changesQuerySchema }),
    asyncHandler(c.changes),
  );
  router.get(
    '/:id/versions',
    requirePageAction('admin-formats', 'view'),
    validate({ params: globalIdParamsSchema }),
    asyncHandler(c.versionsById),
  );
  return router;
}
