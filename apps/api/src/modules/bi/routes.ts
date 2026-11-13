// apps/api/src/modules/bi/routes.ts
// Phase 19 Router: Dashboards, BI, Global Search, AI Copilot & Forecasts, Automation, Webhooks, Comm & Payment Links
import { integrationService } from '../integrations/service';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { registerJobHandler, QUEUES } from '../../core/jobs';
import { callerOf } from '../inventory/routes-shared';
import { prisma } from '../../core/db/prisma';
import { query, norm } from '../procurement/core';
import { biService } from './bi-service';
import { aiService } from './ai-service';
import { automationCommService, AUTOMATION_EVENTS } from './automation-comm-service';

registerJobHandler(QUEUES.biKpiRefresh, async () => {
  // Periodic snapshot computation handled per unit/dept
});
registerJobHandler(QUEUES.biScheduleRun, async () => {});
registerJobHandler(QUEUES.searchUpsert, async () => {});
registerJobHandler(QUEUES.aiInsightsScan, async () => {});
registerJobHandler(QUEUES.webhooksRetry, async () => {
  await integrationService.deliverDue();
});

export function createPhase19Router(): Router {
  const router = Router();

  // ------------------------------------------------------------------------- Unauthenticated Signature-Verified Inbound Webhooks
  router.get('/inbound/meta', (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === (process.env.META_VERIFY_TOKEN || 'sawant-meta-verify')) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Forbidden');
  });

  router.post(
    '/inbound/meta',
    asyncHandler(async (req: Request, res: Response) => {
      const sig = String(req.headers['x-hub-signature-256'] || '');
      const secret = process.env.META_APP_SECRET || 'test-meta-secret';
      const data = await automationCommService.handleInboundMeta(JSON.stringify(req.body), sig, secret);
      res.json({ data });
    }),
  );

  router.post(
    '/inbound/razorpay',
    asyncHandler(async (req: Request, res: Response) => {
      const sig = String(req.headers['x-razorpay-signature'] || '');
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test-razorpay-secret';
      const data = await automationCommService.handleInboundRazorpay(JSON.stringify(req.body), sig, secret);
      res.json({ data });
    }),
  );

  // Authenticated middleware pipeline scoped to Phase 19 endpoints
  const PHASE19_PREFIXES = [
    '/dashboards',
    '/command-center',
    '/kpis',
    '/bi',
    '/search',
    '/ai',
    '/automation',
    '/jobs',
    '/webhooks',
    '/comm',
    '/payment-links',
  ];
  router.use(PHASE19_PREFIXES, authenticate, requirePasswordChanged, resolveContext);

  // ========================================================================= DASHBOARDS & KPIs
  router.get(
    '/dashboards/department/:dept',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await biService.getDepartmentDashboard(callerOf(req), req.params.dept!);
      res.json({ data });
    }),
  );

  router.get(
    '/command-center',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await biService.getCommandCenter(callerOf(req));
      res.json({ data });
    }),
  );

  router.get(
    '/kpis/:code',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await biService.computeKpiValue(callerOf(req), req.params.code!);
      res.json({ data });
    }),
  );

  // ========================================================================= BI REPORTS & DATASETS
  router.get(
    '/bi/datasets',
    asyncHandler(async (_req: Request, res: Response) => {
      const data = await biService.listDatasets();
      res.json({ data });
    }),
  );

  router.post(
    '/bi/query',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await biService.queryDataset(callerOf(req), req.body);
      res.json({ data });
    }),
  );

  router.get(
    '/bi/reports',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await biService.listReports(callerOf(req));
      res.json({ data });
    }),
  );

  router.post(
    '/bi/reports',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await biService.createReport(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/bi/reports/:id/run',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await biService.runReport(callerOf(req), req.params.id!);
      res.json({ data });
    }),
  );

  router.get(
    '/bi/schedules',
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await query(
        prisma,
        `SELECT rs.*, rd.name AS report_name FROM report_schedules rs JOIN report_definitions rd ON rd.id = rs.report_id ORDER BY rs.created_at DESC`,
      );
      res.json({ data: rows.map(norm) });
    }),
  );

  router.post(
    '/bi/schedules',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await biService.createSchedule(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  // ========================================================================= GLOBAL SEARCH
  router.get(
    '/search',
    asyncHandler(async (req: Request, res: Response) => {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const types =
        typeof req.query.types === 'string' && req.query.types.length > 0
          ? req.query.types.split(',')
          : undefined;
      const data = await biService.globalSearch(callerOf(req), q, types);
      res.json({ data });
    }),
  );

  // ========================================================================= AI COPILOT & FORECASTING
  router.get(
    '/ai/settings',
    asyncHandler(async (_req: Request, res: Response) => {
      const data = await aiService.getSettings();
      res.json({ data });
    }),
  );

  router.put(
    '/ai/settings',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await aiService.updateSettings(callerOf(req), req.body);
      res.json({ data });
    }),
  );

  router.get(
    '/ai/usage',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await aiService.getUsageToday(callerOf(req).auth.userId);
      res.json({ data });
    }),
  );

  router.post(
    '/ai/conversations',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await aiService.createConversation(callerOf(req), req.body?.title, req.body?.modulePageId);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/ai/conversations/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const messages = await query(
        prisma,
        `SELECT * FROM ai_messages WHERE conversation_id = $1::uuid ORDER BY created_at ASC`,
        req.params.id,
      );
      res.json({ data: messages.map(norm) });
    }),
  );

  router.post(
    '/ai/conversations/:id/messages',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await aiService.executeCopilotQuestion(
        callerOf(req),
        req.params.id!,
        String(req.body.content || ''),
        { datasetHint: req.body?.datasetHint },
      );
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/ai/insights',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await aiService.listInsights(callerOf(req));
      res.json({ data });
    }),
  );

  router.post(
    '/ai/forecasts/run',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await aiService.runForecast(callerOf(req), req.body);
      res.json({ data });
    }),
  );

  router.post(
    '/ai/what-if',
    asyncHandler(async (req: Request, res: Response) => {
      const data = aiService.whatIfSimulation(req.body);
      res.json({ data });
    }),
  );

  // ========================================================================= AUTOMATION & JOBS
  router.get('/automation/events', (_req: Request, res: Response) => {
    res.json({ data: AUTOMATION_EVENTS });
  });

  router.get(
    '/automation/rules',
    asyncHandler(async (_req: Request, res: Response) => {
      const data = await automationCommService.listRules();
      res.json({ data });
    }),
  );

  router.post(
    '/automation/rules',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await automationCommService.createRule(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/automation/rules/:id/activate',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await automationCommService.activateRule(callerOf(req), req.params.id!, req.body);
      res.json({ data });
    }),
  );

  router.get(
    '/automation/runs',
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await query(
        prisma,
        `SELECT ar.*, r.name AS rule_name FROM automation_runs ar JOIN automation_rules r ON r.id = ar.rule_id ORDER BY ar.started_at DESC LIMIT 50`,
      );
      res.json({ data: rows.map(norm) });
    }),
  );

  router.get(
    '/jobs',
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await query(
        prisma,
        `SELECT id, name, state, created_on, completed_on, retry_count FROM pgboss.job ORDER BY created_on DESC LIMIT 50`,
      ).catch(() => []);
      res.json({ data: rows.map(norm) });
    }),
  );

  // ========================================================================= WEBHOOKS & COMM
  router.get(
    '/webhooks/endpoints',
    asyncHandler(async (_req: Request, res: Response) => {
      const data = await automationCommService.listWebhooks();
      res.json({ data });
    }),
  );

  router.post(
    '/webhooks/endpoints',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await automationCommService.createWebhookEndpoint(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/webhooks/endpoints/:id/rotate-secret',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await automationCommService.rotateWebhookSecret(callerOf(req), req.params.id!);
      res.json({ data });
    }),
  );

  router.get(
    '/webhooks/deliveries',
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await query(
        prisma,
        `SELECT wd.*, we.name AS endpoint_name FROM webhook_deliveries wd JOIN webhook_endpoints we ON we.id = wd.endpoint_id ORDER BY wd.created_at DESC LIMIT 50`,
      );
      res.json({ data: rows.map(norm) });
    }),
  );

  router.get(
    '/comm/templates',
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await query(prisma, `SELECT * FROM message_templates ORDER BY created_at DESC`);
      res.json({ data: rows.map(norm) });
    }),
  );

  router.post(
    '/comm/templates',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await automationCommService.createTemplate(req.body);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/comm/consents',
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await query(prisma, `SELECT * FROM contact_consents ORDER BY consented_at DESC`);
      res.json({ data: rows.map(norm) });
    }),
  );

  router.post(
    '/comm/consents',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await automationCommService.upsertConsent(req.body);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/comm/messages',
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await query(prisma, `SELECT * FROM outbound_messages ORDER BY created_at DESC LIMIT 100`);
      res.json({ data: rows.map(norm) });
    }),
  );

  router.post(
    '/comm/send',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await automationCommService.sendMessage(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/payment-links',
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await query(prisma, `SELECT * FROM payment_links ORDER BY created_at DESC LIMIT 50`);
      res.json({ data: rows.map(norm) });
    }),
  );

  router.post(
    '/payment-links',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await automationCommService.createPaymentLink(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  return router;
}

