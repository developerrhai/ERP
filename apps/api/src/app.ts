// Builds the Express app (middleware order, routers, error handling) without listening, so tests can
// create isolated instances (e.g. with rate limits on) and server.ts can run the real one.
import cookieParser from 'cookie-parser';
import { createScreensRouter } from './modules/screens/routes';
import { createPageHealthRouter } from './modules/page-health/routes';
import { listLimitGuard } from './core/http/list-limit';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { queryBudgetMiddleware } from './core/db/prisma';
import { errorHandler, notFoundHandler } from './core/http/error-middleware';
import { attachRequestId, genRequestId } from './core/http/request-id';
import { logger } from './core/logger';
import { configureArgon2Concurrency } from './core/auth/argon2-gate';
import {
  createChangePasswordLimiter,
  createGlobalLimiter,
  createLoginIpLimiter,
  createLoginLimiter,
  createMfaVerifyLimiter,
  createPasswordResetConfirmLimiter,
  createPasswordResetRequestEmailLimiter,
  createPasswordResetRequestIpLimiter,
} from './core/rate-limit';
import { createAuthRouter } from './modules/auth/routes';
import { createHealthRouter } from './modules/health/routes';
import type { DbPing } from './modules/health/routes';
import { createMetaRouter } from './modules/meta/routes';
import { createUsersRouter } from './modules/users/routes';
import { createAuditLogsRouter } from './modules/audit-logs/routes';
import { createDepartmentAccessRouter } from './modules/department-access/routes';
import { createDepartmentsRouter } from './modules/departments/routes';
import { createMeRouter, createRoleLandingRouter } from './modules/me/routes';
import { createDashboardsRouter, createTvRouter } from './modules/dashboards/routes';
import { createWorkRouter } from './modules/work/routes';
import { createModuleControlsRouter } from './modules/module-controls/routes';
import { createPermissionsRouter } from './modules/permissions/routes';
import { createRolesRouter } from './modules/roles/routes';
import { createSettingsRouter } from './modules/settings/routes';
import { createCompanyRouter } from './modules/company/routes';
import { createFinancialYearsRouter } from './modules/financial-years/routes';
import { createLookupsRouter } from './modules/inventory/lookups/routes';
import { createKitLookupsRouter } from './kit/lookups';
import { createKitPanelsRouter } from './kit/panels/routes';
import { createKitCommandsRouter } from './kit/commands';
import { createKitPrintRouter } from './kit/print';
import { createExportsRouter, createJobsRouter } from './modules/data-jobs/routes';
import { createDocumentsRouter } from './modules/documents/routes';
import { createImportPagesRouter, createImportsRouter } from './modules/imports/routes';
import { createPagesRouter } from './modules/records/routes';
import { createUnitsRouter } from './modules/units/routes';
import { createFinanceRouter } from './modules/finance/routes';
import { createInventoryRouter } from './modules/inventory/routes';
import { createProcurementRouter } from './modules/procurement/routes';
import { createSalesRouter } from './modules/sales/routes';
import { createTaxRouter } from './modules/tax/routes';
import { createQmsRouter } from './modules/qms/routes';
import { createAssetsRouter } from './modules/assets/routes';
import { createMfgRouter } from './modules/mfg/routes';
import { createMastersRouter } from './modules/masters/routes';
import { createSimpleMastersRouter } from './modules/masters/simple-masters';
import { createApprovalMatrixRouter, createApprovalsRouter } from './modules/approvals/routes';
import {
  createNotificationPreferencesRouter,
  createNotificationsRouter,
} from './modules/notifications/routes';
import { createPhase21PublicRouter, createPhase21Router } from './modules/notifications/phase21-routes';
import { createDesignationsRouter } from './modules/designations/routes';
import { createCurrenciesRouter } from './modules/currencies/routes';
import { createUomsRouter } from './modules/uoms/routes';
import { createFilesRouter } from './modules/files/routes';
import { createFormatsRouter, createPageSettingsRouter } from './modules/format-settings/routes';
import { hrRouter } from './modules/hr/routes';
import { payrollRouter } from './modules/payroll/routes';
import { projectsRouter } from './modules/projects/routes';
import { serviceRouter } from './modules/service/routes';
import { createPhase18Router } from './modules/logistics/routes';
import { createPhase19Router } from './modules/bi/routes';
import { createPhase20Router } from './modules/hardening/routes';
import { bootKit } from './kit/boot';

export interface AppOptions {
  /** Defaults to !RATE_LIMIT_DISABLED. Tests pass true to exercise the limiter. */
  rateLimit?: boolean;
  /** When true (or outside NODE_ENV=test), rate limit keys are shared across processes. */
  sharedRateLimit?: boolean;
  dbPing?: DbPing;
  /** Overrides TRUST_PROXY (tests use it to simulate an untrusted peer). */
  trustProxy?: boolean | number | string;
  /** Overrides the CORS allow-list (WEB_ORIGINS / CORS_ORIGINS / WEB_ORIGIN). */
  corsOrigins?: string[];
  /** Overrides ARGON2_MAX_CONCURRENCY (process-wide). */
  argon2Concurrency?: number;
  /** Test hook: mount extra routes before the 404 handler (e.g. a route that throws). */
  extraRoutes?: (app: Express) => void;
}

export function createApp(options: AppOptions = {}): Express {
  const rateLimitEnabled = options.rateLimit ?? !env.RATE_LIMIT_DISABLED;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxy ?? env.trustProxy);
  configureArgon2Concurrency(options.argon2Concurrency ?? env.ARGON2_MAX_CONCURRENCY);
  const corsOrigins = options.corsOrigins ?? env.corsOrigins;

  app.use(pinoHttp({ logger, genReqId: genRequestId }));
  app.use(attachRequestId);
  // Phase 22-D: registered BEFORE the query-budget middleware so that one still sets X-Query-Count
  // before the compressed response flushes its headers.
  // Phase 22-D: gzip text responses, but never the SSE stream (it must flush every event at once).
  app.use(
    compression({
      filter: (req, res) => {
        const type = String(res.getHeader('Content-Type') ?? '');
        if (type.includes('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    }),
  );
  app.use(queryBudgetMiddleware);
  app.use(helmet());
  app.use(
    cors({
      // Exact allow-list only. No Origin header (same-origin, curl, server-to-server) needs no
      // CORS headers; an unlisted origin gets none, so the browser blocks the response.
      origin: (origin, callback) => {
        callback(null, origin !== undefined && corsOrigins.includes(origin) ? origin : false);
      },
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'If-Match',
        'X-Request-Id',
        'X-Unit-Id',
        'X-FY-Id',
        'X-Activity',
      ],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'ETag'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(listLimitGuard);
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const rlOpts = options.sharedRateLimit !== undefined ? { shared: options.sharedRateLimit } : undefined;
  api.use(createGlobalLimiter(rateLimitEnabled, rlOpts));
  api.use('/health', createHealthRouter(options.dbPing));
  api.use(
    '/auth',
    createAuthRouter({
      loginIpLimiter: createLoginIpLimiter(rateLimitEnabled, rlOpts),
      loginLimiter: createLoginLimiter(rateLimitEnabled, rlOpts),
      changePasswordLimiter: createChangePasswordLimiter(rateLimitEnabled, rlOpts),
      mfaVerifyLimiter: createMfaVerifyLimiter(rateLimitEnabled, rlOpts),
      passwordResetRequestIpLimiter: createPasswordResetRequestIpLimiter(rateLimitEnabled, rlOpts),
      passwordResetRequestEmailLimiter: createPasswordResetRequestEmailLimiter(rateLimitEnabled, rlOpts),
      passwordResetConfirmLimiter: createPasswordResetConfirmLimiter(rateLimitEnabled, rlOpts),
    }),
  );
  api.use('/meta', createMetaRouter());
  api.use(createScreensRouter()); // Phase 22: /screens/:pageId (the screens moved off the generic engine)
  api.use(createPageHealthRouter()); // Phase 22: /admin/page-health
  api.use('/users', createUsersRouter());
  api.use('/me', createMeRouter());
  api.use(createDashboardsRouter());
  api.use('/tv', createTvRouter());
  api.use('/work', createWorkRouter());
  api.use('/admin/role-landing', createRoleLandingRouter());
  api.use(createPhase21PublicRouter()); // Public SNS-signed webhooks before any module router
  api.use('/departments', createDepartmentsRouter());
  api.use('/roles', createRolesRouter());
  api.use('/permissions', createPermissionsRouter());
  api.use('/department-access', createDepartmentAccessRouter());
  api.use('/module-controls', createModuleControlsRouter());
  api.use('/settings', createSettingsRouter());
  api.use('/audit-logs', createAuditLogsRouter());
  api.use('/company', createCompanyRouter());
  api.use('/units', createUnitsRouter());
  api.use('/financial-years', createFinancialYearsRouter());
  api.use('/designations', createDesignationsRouter());
  api.use('/currencies', createCurrenciesRouter());
  api.use('/uoms', createUomsRouter());
  api.use(createSimpleMastersRouter());
  api.use(createMastersRouter()); // Phase 6: /statutory, /parties, /tax, /pricing, /customers, /suppliers
  api.use(createFinanceRouter()); // Phase 7: /finance (accounts, journals, cash & bank, budgets, reports, close, reconciliation)
  api.use(createSalesRouter()); // Phase 10: /crm, /sales
  api.use(createTaxRouter()); // Phase 11: /tax
  api.use(createQmsRouter()); // Phase 12: /qms
  api.use(createMfgRouter()); // Phase 13: /mfg
  api.use(createAssetsRouter()); // Phase 14: /maint and /assets
  api.use('/hr', hrRouter); // Phase 15: /hr
  api.use('/payroll', payrollRouter); // Phase 16: /payroll
  api.use('/projects', projectsRouter); // Phase 17: /projects
  api.use('/service', serviceRouter); // Phase 17: /service
  api.use(createPhase18Router()); // Phase 18: Logistics, Fleet, Gate & DMS
  api.use(createPhase19Router()); // Phase 19: BI, AI Copilot, Search, Automation, Webhooks & Comm
  api.use(createPhase20Router()); // Phase 20: DPDP, Audit Partitions & Opening Balance Cut-over
  api.use(createPhase21Router()); // Phase 21: SSE Realtime, Web Push, Broadcasts & Email Automation
  api.use(createProcurementRouter()); // Phase 9: /scm, /wms/putaway, /fin/debitnote, /fin/ap
  api.use(createInventoryRouter()); // Phase 8: /inventory (vouchers with lines, batches, serials, bins, reservations, counts, reports)
  api.use('/approval-matrix', createApprovalMatrixRouter());
  api.use('/approvals', createApprovalsRouter());
  api.use('/notifications', createNotificationsRouter());
  api.use('/notification-preferences', createNotificationPreferencesRouter());
  api.use('/files', createFilesRouter());
  api.use('/lookups', createLookupsRouter());
  api.use('/lookups', createKitLookupsRouter());
  bootKit(api);
  api.use('/pages', createPageSettingsRouter()); // Phase 6B: /pages/:p/settings (formats, rule sets, Excel import)
  api.use('/formats', createFormatsRouter()); // Phase 6B: admin-formats
  api.use('/pages', createKitPanelsRouter());
  api.use('/pages', createKitCommandsRouter());
  api.use('/pages', createKitPrintRouter());
  api.use('/pages', createDocumentsRouter());
  api.use('/pages', createExportsRouter());
  api.use('/pages', createImportPagesRouter());
  api.use('/imports', createImportsRouter());
  api.use('/jobs', createJobsRouter());
  api.use('/pages', createPagesRouter());
  app.use('/api/v1', api);

  options.extraRoutes?.(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
