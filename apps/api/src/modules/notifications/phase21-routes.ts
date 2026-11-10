// Phase 21 API routes (§6): Real-time SSE, Web Push, Notification Prefs & Catalogue,
// Broadcast Announcements, Automated/Manual Email, Suppressions, Health, and SES SNS webhook.
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { requireAuth } from '../../core/auth/auth-context';
import { prisma } from '../../core/db/prisma';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { validate, validated } from '../../core/http/validate';
import { ADMIN_LEVEL } from '../../core/rbac/role-rules';
import { broadcastService } from './broadcast-service';
import { emailAutomationService } from './email-automation-service';
import { pushService } from './push-service';
import { sseStreamHandler } from './realtime';
import { notificationService } from './service';

const prefsV2PutSchema = z
  .object({
    items: z
      .array(
        z.object({
          typeCode: z.string().min(1).max(64),
          channel: z.enum(['IN_APP', 'PUSH', 'EMAIL', 'SMS']),
          enabled: z.boolean(),
          mode: z.enum(['IMMEDIATE', 'DIGEST']).optional(),
        }),
      )
      .min(1)
      .max(200),
  })
  .strict();

const userSettingsSchema = z
  .object({
    quietStart: z.string().nullable().optional(),
    quietEnd: z.string().nullable().optional(),
    digestEnabled: z.boolean().optional(),
    language: z.enum(['en', 'hi']).optional(),
    dismissSoftAsk: z.boolean().optional(),
  })
  .strict();

const pushSubscribeSchema = z
  .object({
    endpoint: z.string().url().max(2000),
    p256dh: z.string().min(10).max(500),
    auth: z.string().min(8).max(500),
    platform: z.enum(['ANDROID', 'IOS', 'DESKTOP', 'OTHER']).default('DESKTOP'),
    browser: z.string().min(1).max(64).default('Chrome'),
    deviceLabel: z.string().max(120).optional(),
    standalone: z.boolean().optional(),
  })
  .strict();

const broadcastCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    bodyMd: z.string().trim().min(1).max(4000),
    severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
    audience: z
      .object({
        all: z.boolean().optional(),
        unitIds: z.array(z.string().uuid()).optional(),
        departments: z.array(z.string().min(1)).optional(),
        roles: z.array(z.string().min(1)).optional(),
        userIds: z.array(z.string().uuid()).optional(),
      })
      .strict(),
    channels: z.array(z.enum(['IN_APP', 'PUSH', 'EMAIL', 'SMS'])).optional(),
    emergency: z.boolean().optional(),
    reason: z.string().max(500).optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    pinBanner: z.boolean().optional(),
    requireAck: z.boolean().optional(),
  })
  .strict();

const sendDocEmailSchema = z
  .object({
    to: z.array(z.string().email()).min(1).max(25).optional(),
    cc: z.array(z.string().email()).max(25).optional(),
    message: z.string().max(4000).optional(),
    attachMode: z.enum(['ATTACH', 'LINK', 'AUTO']).optional(),
  })
  .strict();

const resendEmailSchema = z
  .object({
    to: z.array(z.string().email()).max(25).optional(),
    cc: z.array(z.string().email()).max(25).optional(),
    reason: z.string().trim().min(5).max(400),
  })
  .strict();

function requireAdmin(req: Request) {
  const auth = requireAuth(req);
  if (auth.level < ADMIN_LEVEL) throw Errors.forbidden('Administrator access required.');
  return auth;
}

function p(req: Request, key: string): string {
  return String(req.params[key] ?? '');
}

const guard = [authenticate, requirePasswordChanged];

export function createPhase21PublicRouter(): Router {
  const router = Router();
  // Public AWS SNS -> SES Webhook (no session auth; SNS cryptographically signed)
  router.post(
    '/webhooks/inbound/ses',
    express.text({ type: 'text/plain', limit: '1mb' }),
    asyncHandler(async (req: Request, res: Response) => {
      const raw =
        typeof req.body === 'string'
          ? req.body
          : Buffer.isBuffer(req.body)
            ? req.body.toString('utf8')
            : JSON.stringify(req.body ?? {});
      const out = await emailAutomationService.handleSesSnsWebhook(raw);
      res.json({ data: out });
    }),
  );
  return router;
}

export function createPhase21Router(): Router {
  const router = Router();

  // ── Real-time SSE stream (§6) ───────────────────────────────────────────
  router.get('/realtime/stream', ...guard, asyncHandler(sseStreamHandler));

  // ── User Notification Prefs & Settings (§6) ─────────────────────────────
  router.get(
    '/me/notification-prefs',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store');
      res.json({ data: await notificationService.getPrefsV2(requireAuth(req).userId) });
    }),
  );

  router.put(
    '/me/notification-prefs',
    ...guard,
    validate({ body: prefsV2PutSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', prefsV2PutSchema);
      res.json({
        data: await notificationService.savePrefsV2(requireAuth(req).userId, body.items),
      });
    }),
  );

  router.get(
    '/me/notification-settings',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store');
      res.json({ data: await notificationService.getUserSettingsV2(requireAuth(req).userId) });
    }),
  );

  router.put(
    '/me/notification-settings',
    ...guard,
    validate({ body: userSettingsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', userSettingsSchema);
      res.json({
        data: await notificationService.saveUserSettingsV2(requireAuth(req).userId, body),
      });
    }),
  );

  // ── Web Push (§6) ───────────────────────────────────────────────────────
  router.get(
    '/push/vapid-public-key',
    ...guard,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ data: { publicKey: pushService.getPublicKey() } });
    }),
  );

  router.post(
    '/push/subscriptions',
    ...guard,
    validate({ body: pushSubscribeSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', pushSubscribeSchema);
      const row = await pushService.subscribe(requireAuth(req).userId, body);
      res.status(201).json({ data: row });
    }),
  );

  router.get(
    '/me/devices',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ data: await pushService.listDevices(requireAuth(req).userId) });
    }),
  );

  router.patch(
    '/me/devices/:id',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const label = String(req.body?.label ?? '').trim();
      if (!label) throw Errors.validation({ label: 'Device label is required.' });
      const row = await pushService.renameDevice(requireAuth(req).userId, p(req, 'id'), label.slice(0, 120));
      if (!row) throw Errors.notFound('Device subscription not found.');
      res.json({ data: row });
    }),
  );

  router.delete(
    '/me/devices/:id',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const ok = await pushService.revokeDevice(requireAuth(req).userId, p(req, 'id'), 'USER');
      if (!ok) throw Errors.notFound('Device subscription not found.');
      res.json({ data: { ok: true } });
    }),
  );

  router.post(
    '/push/test',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const uid = requireAuth(req).userId;
      await notificationService.notify(prisma, [uid], {
        type: 'APPROVAL_ASSIGNED',
        title: 'Test Push Notification',
        body: 'Push delivery works on this device.',
        link: '/m/notif-preferences',
        dedupeKey: `push-test:${uid}:${Date.now()}`,
      });
      const drain = await pushService.drainPushDeliveries(10);
      res.json({ data: drain });
    }),
  );

  // ── Admin Notification Types & Settings (§6) ────────────────────────────
  router.get(
    '/admin/notification-types',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      requireAdmin(req);
      res.json({ data: await notificationService.listTypesAdmin() });
    }),
  );

  router.patch(
    '/admin/notification-types/:code',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      res.json({
        data: await notificationService.updateTypeAdmin(p(req, 'code'), req.body ?? {}, auth.userId),
      });
    }),
  );

  router.post(
    '/admin/notification-types/:code/test',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      const code = p(req, 'code');
      const sent = await notificationService.notify(prisma, [auth.userId], {
        type: code,
        title: `Test: ${code}`,
        body: 'Sample notification sent to yourself from Admin Console.',
        link: '/m/admin-notif-types',
        dedupeKey: `admin-test:${code}:${auth.userId}:${Date.now()}`,
      });
      res.json({ data: { sentCount: sent.length } });
    }),
  );

  router.get(
    '/admin/notification-settings',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      requireAdmin(req);
      res.json({ data: await notificationService.getSettingsAdmin() });
    }),
  );

  router.put(
    '/admin/notification-settings',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      res.json({ data: await notificationService.updateSettingsAdmin(req.body ?? {}, auth.userId) });
    }),
  );

  router.post(
    '/admin/notification-settings/reset',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      res.json({ data: await notificationService.resetSystemDefaultsAdmin(auth.userId) });
    }),
  );

  // ── Admin Broadcasts & User Banners (§6) ────────────────────────────────
  router.get(
    '/broadcasts/active',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store');
      res.json({ data: await broadcastService.listActiveForUser(requireAuth(req).userId) });
    }),
  );

  router.post(
    '/broadcasts/:id/ack',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ data: await broadcastService.acknowledge(requireAuth(req).userId, p(req, 'id')) });
    }),
  );

  router.get(
    '/admin/broadcasts',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      requireAdmin(req);
      res.json({ data: await broadcastService.listAdmin() });
    }),
  );

  router.post(
    '/admin/broadcasts/preview-audience',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      requireAdmin(req);
      res.json({ data: await broadcastService.previewAudience(req.body ?? { all: true }) });
    }),
  );

  router.post(
    '/admin/broadcasts',
    ...guard,
    validate({ body: broadcastCreateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      const body = validated(res, 'body', broadcastCreateSchema);
      const row = await broadcastService.createDraft(
        { userId: auth.userId, roleLevel: auth.level },
        body,
      );
      res.status(201).json({ data: row });
    }),
  );

  router.post(
    '/admin/broadcasts/:id/preview-audience',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      requireAdmin(req);
      const row = await broadcastService.getById(p(req, 'id'));
      if (!row) throw Errors.notFound('Broadcast not found.');
      res.json({ data: await broadcastService.previewAudience(row.audience ?? { all: true }) });
    }),
  );

  router.post(
    '/admin/broadcasts/:id/submit',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      res.json({
        data: await broadcastService.submit({ userId: auth.userId, roleLevel: auth.level }, p(req, 'id')),
      });
    }),
  );

  router.post(
    '/admin/broadcasts/:id/approve',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      res.json({
        data: await broadcastService.decideApproval(
          { userId: auth.userId, roleLevel: auth.level },
          p(req, 'id'),
          'APPROVE',
          req.body?.comment,
        ),
      });
    }),
  );

  router.post(
    '/admin/broadcasts/:id/reject',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      res.json({
        data: await broadcastService.decideApproval(
          { userId: auth.userId, roleLevel: auth.level },
          p(req, 'id'),
          'REJECT',
          req.body?.comment,
        ),
      });
    }),
  );

  router.post(
    '/admin/broadcasts/:id/send-now',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      const id = p(req, 'id');
      const row = await broadcastService.getById(id);
      if (!row) throw Errors.notFound('Broadcast not found.');
      if (row.status === 'DRAFT') {
        await broadcastService.submit({ userId: auth.userId, roleLevel: auth.level }, id);
      }
      await broadcastService.deliverBroadcast(id);
      res.json({ data: await broadcastService.getById(id) });
    }),
  );

  router.post(
    '/admin/broadcasts/:id/cancel',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      res.json({ data: await broadcastService.cancel({ userId: auth.userId }, p(req, 'id'), req.body?.reason) });
    }),
  );

  router.post(
    '/admin/broadcasts/:id/withdraw',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      res.json({ data: await broadcastService.withdraw({ userId: auth.userId }, p(req, 'id'), req.body?.reason) });
    }),
  );

  router.get(
    '/admin/broadcasts/:id/report',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      requireAdmin(req);
      res.json({ data: await broadcastService.report(p(req, 'id')) });
    }),
  );

  // ── Email Automation Rules, Documents, Logs, Suppressions, Health (§6) ─
  router.get(
    '/admin/email-rules',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      requireAdmin(req);
      res.json({ data: await emailAutomationService.listRules() });
    }),
  );

  router.patch(
    '/admin/email-rules/:id',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      res.json({ data: await emailAutomationService.updateRule(p(req, 'id'), req.body ?? {}, auth.userId) });
    }),
  );

  router.post(
    '/admin/email-rules/:id/test',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      const docId = String(req.body?.docId ?? '');
      if (!docId) throw Errors.validation({ docId: 'Sample docId is required for rule test.' });
      res.json({ data: await emailAutomationService.testRuleToSelf(p(req, 'id'), docId, auth.userId) });
    }),
  );

  router.get(
    '/documents/:docType/:id/email-preview',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({
        data: await emailAutomationService.previewDocumentEmail(p(req, 'docType'), p(req, 'id')),
      });
    }),
  );

  router.post(
    '/documents/:docType/:id/email',
    ...guard,
    validate({ body: sendDocEmailSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', sendDocEmailSchema);
      const auth = requireAuth(req);
      const sent = await emailAutomationService.sendDocumentEmail(
        { userId: auth.userId },
        p(req, 'docType'),
        p(req, 'id'),
        {
          to: body.to,
          cc: body.cc,
          message: body.message,
          attachMode: body.attachMode,
        },
      );
      res.status(201).json({ data: sent });
    }),
  );

  router.get(
    '/comm/messages',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const channel = typeof req.query.channel === 'string' ? req.query.channel : undefined;
      const docId = typeof req.query.doc === 'string' ? req.query.doc : undefined;
      res.json({ data: await emailAutomationService.listCommMessages({ channel, docId }) });
    }),
  );

  router.post(
    '/comm/messages/:id/resend',
    ...guard,
    validate({ body: resendEmailSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', resendEmailSchema);
      const auth = requireAuth(req);
      const sent = await emailAutomationService.resendMessage({ userId: auth.userId }, p(req, 'id'), body);
      res.status(201).json({ data: sent });
    }),
  );

  router.get(
    '/admin/email-suppressions',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      requireAdmin(req);
      const includeRemoved = req.query.all === 'true';
      res.json({ data: await emailAutomationService.listSuppressions(includeRemoved) });
    }),
  );

  router.post(
    '/admin/email-suppressions',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      const email = String(req.body?.email ?? '');
      const reason = (req.body?.reason ?? 'MANUAL') as 'HARD_BOUNCE' | 'COMPLAINT' | 'MANUAL' | 'UNSUBSCRIBE';
      res.status(201).json({ data: await emailAutomationService.addSuppression(email, reason, auth.userId) });
    }),
  );

  router.delete(
    '/admin/email-suppressions/:email',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAdmin(req);
      res.json({
        data: await emailAutomationService.removeSuppression(
          decodeURIComponent(p(req, 'email')),
          auth.userId,
          typeof req.body?.note === 'string' ? req.body.note : undefined,
        ),
      });
    }),
  );

  router.get(
    '/admin/notif-health',
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      requireAdmin(req);
      res.json({ data: await emailAutomationService.getHealthSummary() });
    }),
  );

  return router;
}
