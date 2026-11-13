import { Errors } from '../../core/http/errors';
// apps/api/src/modules/logistics/routes.ts
// Phase 18 Router: Logistics, Fleet, Gate & DMS mounted on /api/v1
import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { registerJobHandler, QUEUES } from '../../core/jobs';
import { callerOf } from '../inventory/routes-shared';
import { prisma } from '../../core/db/prisma';
import { query, norm } from '../procurement/core';
import { fleetService } from './fleet-service';
import { logisticsService } from './logistics-service';
import { gateService } from './gate-service';
import { dmsService } from './dms-service';

// Register Phase 18 background workers
registerJobHandler(QUEUES.gateReturnableOverdue, async () => {
  await gateService.runOverdueJob();
});
registerJobHandler(QUEUES.fleetDocsExpiry, async () => {
  await fleetService.runExpiryScan();
});
registerJobHandler(QUEUES.dmsRetention, async () => {
  await dmsService.runRetentionJob();
});
registerJobHandler(QUEUES.dmsExtract, async () => {
  // Extraction handler invoked per-document or batch refresh
});

export function createPhase18Router(): Router {
  const router = Router();
  const PHASE18_PREFIXES = [
    '/vehicles',
    '/drivers',
    '/fuel-logs',
    '/vehicle-services',
    '/transporters',
    '/routes',
    '/freight-rate-cards',
    '/freight',
    '/freight-calculations',
    '/shipments',
    '/pods',
    '/containers',
    '/gate-passes',
    '/gate',
    '/dms',
  ];
  router.use(PHASE18_PREFIXES, authenticate, requirePasswordChanged, resolveContext);

  // ========================================================================= FLEET
  router.get(
    '/vehicles',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await fleetService.listVehicles(callerOf(req));
      res.json({ data });
    }),
  );

  router.post(
    '/vehicles',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await fleetService.createVehicle(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/vehicles/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await fleetService.getVehicle(callerOf(req), req.params.id!);
      res.json({ data });
    }),
  );

  router.post(
    '/vehicles/:id/documents',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await fleetService.addVehicleDocument(callerOf(req), req.params.id!, req.body);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/drivers',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await fleetService.listDrivers(callerOf(req));
      res.json({ data });
    }),
  );

  router.post(
    '/drivers',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await fleetService.createDriver(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/fuel-logs',
    asyncHandler(async (req: Request, res: Response) => {
      const vehicleId = typeof req.query.vehicleId === 'string' ? req.query.vehicleId : undefined;
      const data = await fleetService.listFuelLogs(callerOf(req), vehicleId);
      res.json({ data });
    }),
  );

  router.post(
    '/fuel-logs',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await fleetService.createFuelLog(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/fuel-logs/:id/post',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await fleetService.postFuelLog(callerOf(req), req.params.id!);
      res.json({ data });
    }),
  );

  router.get(
    '/vehicle-services',
    asyncHandler(async (req: Request, res: Response) => {
      const vehicleId = typeof req.query.vehicleId === 'string' ? req.query.vehicleId : undefined;
      const data = await fleetService.listServices(callerOf(req), vehicleId);
      res.json({ data });
    }),
  );

  router.post(
    '/vehicle-services',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await fleetService.createService(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/vehicle-services/:id/post',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await fleetService.postService(callerOf(req), req.params.id!, req.body?.warehouseId);
      res.json({ data });
    }),
  );

  // ========================================================================= LOGISTICS
  router.get(
    '/transporters',
    asyncHandler(async (_req: Request, res: Response) => {
      const data = await logisticsService.listTransporters();
      res.json({ data });
    }),
  );

  router.post(
    '/transporters/:supplierId/profile',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.upsertTransporterProfile(callerOf(req), req.params.supplierId!, req.body);
      res.json({ data });
    }),
  );

  router.post(
    '/transporters/:id/lanes',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.addTransporterLane(req.params.id!, req.body);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/routes',
    asyncHandler(async (_req: Request, res: Response) => {
      const data = await logisticsService.listRoutes();
      res.json({ data });
    }),
  );

  router.post(
    '/routes',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.createRoute(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/freight-rate-cards',
    asyncHandler(async (_req: Request, res: Response) => {
      const data = await logisticsService.listRateCards();
      res.json({ data });
    }),
  );

  router.post(
    '/freight-rate-cards',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.createRateCard(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/freight-rate-cards/:id/approve',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.approveRateCard(req.params.id!);
      res.json({ data });
    }),
  );

  router.post(
    '/freight/calculate',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.calculateAndSaveFreight(callerOf(req), req.body);
      res.json({ data });
    }),
  );

  router.get(
    '/freight-calculations',
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await query(prisma, `SELECT * FROM freight_calculations ORDER BY created_at DESC`);
      res.json({ data: rows.map(norm) });
    }),
  );

  router.get(
    '/shipments',
    asyncHandler(async (req: Request, res: Response) => {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const data = await logisticsService.listShipments(callerOf(req), status);
      res.json({ data });
    }),
  );

  router.post(
    '/shipments',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.createShipment(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/shipments/:id/allocate',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.allocateShipment(callerOf(req), req.params.id!, req.body);
      res.json({ data });
    }),
  );

  router.get(
    '/shipments/:id/events',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.listTrackingEvents(req.params.id!);
      res.json({ data });
    }),
  );

  router.post(
    '/shipments/:id/events',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.addTrackingEvent(callerOf(req), req.params.id!, req.body);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/pods',
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await query(
        prisma,
        `SELECT p.*, s.shipment_no, c.name AS customer_name FROM pods p JOIN shipments s ON s.id = p.shipment_id LEFT JOIN customers c ON c.id = s.customer_id ORDER BY p.created_at DESC`,
      );
      res.json({ data: rows.map(norm) });
    }),
  );

  router.post(
    '/pods',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.recordPod(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/pods/:id/release-billing',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.releasePodBilling(callerOf(req), req.params.id!);
      res.json({ data });
    }),
  );

  router.get(
    '/containers',
    asyncHandler(async (_req: Request, res: Response) => {
      const data = await logisticsService.listContainers();
      res.json({ data });
    }),
  );

  router.post(
    '/containers',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.createContainer(req.body);
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/containers/:id/movements',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await logisticsService.recordContainerMovement(callerOf(req), req.params.id!, req.body);
      res.status(201).json({ data });
    }),
  );

  // ========================================================================= GATE
  router.get(
    '/gate-passes',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await gateService.listPasses(callerOf(req), {
        direction: typeof req.query.direction === 'string' ? req.query.direction : undefined,
        passType: typeof req.query.passType === 'string' ? req.query.passType : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      });
      res.json({ data });
    }),
  );

  router.post(
    '/gate-passes',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await gateService.createPass(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/gate-passes/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await gateService.getPass(req.params.id!);
      res.json({ data });
    }),
  );

  router.post(
    '/gate-passes/:id/approve',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await gateService.approvePass(callerOf(req), req.params.id!);
      res.json({ data });
    }),
  );

  router.post(
    '/gate-passes/:id/enter',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await gateService.enterPass(callerOf(req), req.params.id!, req.body?.weighInKg);
      res.json({ data });
    }),
  );

  router.post(
    '/gate-passes/:id/weigh',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await gateService.weighPass(req.params.id!, Number(req.body.weighOutKg));
      res.json({ data });
    }),
  );

  router.post(
    '/gate-passes/:id/exit',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await gateService.exitPass(callerOf(req), req.params.id!);
      res.json({ data });
    }),
  );

  router.post(
    '/gate-passes/:id/returns',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await gateService.recordReturn(callerOf(req), req.params.id!, req.body.returns);
      res.json({ data });
    }),
  );

  router.get(
    '/gate-passes/:id/print',
    asyncHandler(async (req: Request, res: Response) => {
      const pdfBuf = await gateService.printChallanPdf(callerOf(req), req.params.id!);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="challan-${req.params.id}.pdf"`);
      res.send(pdfBuf);
    }),
  );

  router.get(
    '/gate/open-pos',
    asyncHandler(async (req: Request, res: Response) => {
      const supplierId = String(req.query.supplier || '');
      if (!/^[0-9a-f-]{36}$/i.test(supplierId)) throw Errors.validation({ supplier: 'Choose a supplier.' });
      const data = await gateService.getOpenPosForSupplier(callerOf(req), supplierId);
      res.json({ data });
    }),
  );

  router.get(
    '/gate/pending-dispatch',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await gateService.getPendingDispatchLines(callerOf(req));
      res.json({ data });
    }),
  );

  router.get(
    '/gate/overdue-returnables',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await gateService.getOverdueReturnables(callerOf(req));
      res.json({ data });
    }),
  );

  // ========================================================================= DMS
  router.get(
    '/dms/folders',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await dmsService.listFolders(callerOf(req));
      res.json({ data });
    }),
  );

  router.post(
    '/dms/folders',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await dmsService.createFolder(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.delete(
    '/dms/folders/:id',
    asyncHandler(async (req: Request, res: Response) => {
      await dmsService.deleteFolder(callerOf(req), req.params.id!);
      res.json({ data: { deleted: true } });
    }),
  );

  router.post(
    '/dms/folders/:id/acl',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await dmsService.grantFolderAcl(callerOf(req), req.params.id!, req.body);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/dms/search',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await dmsService.searchDocuments(callerOf(req), {
        q: typeof req.query.q === 'string' ? req.query.q : '',
        folderId: typeof req.query.folderId === 'string' ? req.query.folderId : undefined,
        tagCode: typeof req.query.tag === 'string' ? req.query.tag : undefined,
        page: req.query.page ? Number(req.query.page) : 1,
        size: req.query.size ? Number(req.query.size) : 25,
      });
      res.json({ data: data.items, meta: { total: data.total } });
    }),
  );

  router.post(
    '/dms/documents',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await dmsService.createDocument(callerOf(req), req.body);
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/dms/documents/:id/checkout',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await dmsService.checkoutDocument(callerOf(req), req.params.id!);
      res.json({ data });
    }),
  );

  router.post(
    '/dms/documents/:id/checkin',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await dmsService.checkinDocument(callerOf(req), req.params.id!, req.body);
      res.json({ data });
    }),
  );

  router.post(
    '/dms/documents/:id/rollback',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await dmsService.rollbackVersion(callerOf(req), req.params.id!, Number(req.body.versionNo));
      res.json({ data });
    }),
  );

  router.post(
    '/dms/documents/:id/hold',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await dmsService.setLegalHold(callerOf(req), req.params.id!, Boolean(req.body.legalHold), req.body.reason);
      res.json({ data });
    }),
  );

  router.post(
    '/dms/documents/:id/share',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await dmsService.createShareLink(callerOf(req), req.params.id!, req.body);
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/dms/tags',
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await query(prisma, `SELECT * FROM dms_tags ORDER BY name ASC`);
      res.json({ data: rows.map(norm) });
    }),
  );

  router.get(
    '/dms/dispositions',
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await query(
        prisma,
        `SELECT disp.*, d.doc_code, d.title FROM dms_dispositions disp JOIN dms_documents d ON d.id = disp.document_id ORDER BY disp.created_at DESC`,
      );
      res.json({ data: rows.map(norm) });
    }),
  );

  router.post(
    '/dms/dispositions/:id/approve',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await dmsService.approveAndDestroyDocument(callerOf(req), req.params.id!);
      res.json({ data });
    }),
  );

  return router;
}

