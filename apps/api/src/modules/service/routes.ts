// apps/api/src/modules/service/routes.ts
// Service Router: /api/v1/service
import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { callerOf } from '../inventory/routes-shared';
import { dataEnvelope } from '../../core/http/envelope';
import { prisma } from '../../core/db/prisma';
import { norm, query } from '../procurement/core';
import { ticketService } from './ticket-service';
import { visitService } from './visit-service';
import { amcService } from './amc-service';
import { warrantyService } from './warranty-service';

export const serviceRouter = Router();

// Middleware pipeline
serviceRouter.use(authenticate);
serviceRouter.use(requirePasswordChanged);
serviceRouter.use(resolveContext);
serviceRouter.use(dataEnvelope);

// ---------------------------------------------------------------------------- Tickets
serviceRouter.get(
  '/tickets',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { status, customerId, technicianId, priority, page, size } = req.query;
    const result = await ticketService.listTickets(caller, {
      status: typeof status === 'string' ? status : undefined,
      customerId: typeof customerId === 'string' ? customerId : undefined,
      technicianId: typeof technicianId === 'string' ? technicianId : undefined,
      priority: priority ? Number(priority) : undefined,
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
    });
    res.json(result);
  }),
);

serviceRouter.post(
  '/tickets',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await ticketService.createTicket(caller, req.body);
    res.status(201).json(result);
  }),
);

serviceRouter.get(
  '/tickets/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await ticketService.getTicket(caller, req.params.id!);
    res.json(result);
  }),
);

serviceRouter.post(
  '/tickets/:id/assign',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { technicianId } = req.body;
    const result = await ticketService.assignTicket(caller, req.params.id!, technicianId);
    res.json(result);
  }),
);

serviceRouter.post(
  '/tickets/:id/auto-assign',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await ticketService.autoAssignTicket(caller, req.params.id!);
    res.json(result);
  }),
);

serviceRouter.post(
  '/tickets/:id/respond',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await ticketService.respondTicket(caller, req.params.id!);
    res.json(result);
  }),
);

serviceRouter.post(
  '/tickets/:id/pause',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { pauseStatus, reason } = req.body;
    const result = await ticketService.pauseTicket(caller, req.params.id!, pauseStatus, reason);
    res.json(result);
  }),
);

serviceRouter.post(
  '/tickets/:id/resume',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await ticketService.resumeTicket(caller, req.params.id!);
    res.json(result);
  }),
);

serviceRouter.post(
  '/tickets/:id/resolve',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { notes } = req.body;
    const result = await ticketService.resolveTicket(caller, req.params.id!, notes);
    res.json(result);
  }),
);

serviceRouter.post(
  '/tickets/:id/close',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { rating } = req.body;
    const result = await ticketService.closeTicket(caller, req.params.id!, rating ? Number(rating) : undefined);
    res.json(result);
  }),
);

serviceRouter.get(
  '/tickets/:id/entitlement',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const t = await ticketService.getTicket(caller, req.params.id!);
    res.json({
      ticketId: t.id,
      ticketNo: t.ticket_no,
      entitlement: t.entitlement,
      amcContractId: t.amc_contract_id,
      warrantyId: t.warranty_id,
    });
  }),
);

// ---------------------------------------------------------------------------- Technicians & Board
serviceRouter.get(
  '/technicians',
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await query(
      prisma,
      `SELECT tech.*, e.emp_code, e.first_name || ' ' || e.last_name AS name,
              e.mobile AS mobile_phone,
              COALESCE((
                SELECT COUNT(*)::int
                FROM service_tickets st
                WHERE st.assigned_technician_id = tech.id
                  AND st.status IN ('ASSIGNED', 'IN_PROGRESS')
              ), 0) AS open_jobs
       FROM technicians tech
       JOIN employees e ON e.id = tech.employee_id
       WHERE tech.active = true
       ORDER BY e.emp_code ASC`,
    );
    res.json(rows.map(norm));
  }),
);

serviceRouter.get(
  '/technicians/board',
  asyncHandler(async (req: Request, res: Response) => {
    const techRows = await query(
      prisma,
      `SELECT tech.*, e.emp_code, e.first_name || ' ' || e.last_name AS name
       FROM technicians tech
       JOIN employees e ON e.id = tech.employee_id
       WHERE tech.active = true`,
    );
    const tickets = await query(
      prisma,
      `SELECT t.*, c.name AS customer_name
       FROM service_tickets t
       JOIN customers c ON c.id = t.customer_id
       WHERE t.status IN ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'AWAITING_PARTS')
       ORDER BY t.priority ASC, t.created_at ASC`,
    );

    const lanes = techRows.map((tr) => {
      const tech = norm(tr);
      return {
        technician: tech,
        assignedTickets: tickets.filter((t) => t.assigned_technician_id === tech.id).map(norm),
      };
    });

    res.json({
      unassignedTickets: tickets.filter((t) => !t.assigned_technician_id).map(norm),
      lanes,
    });
  }),
);

// ---------------------------------------------------------------------------- Visits
serviceRouter.get(
  '/visits',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { technicianId, date, status } = req.query;
    const rows = await visitService.listVisits(caller, {
      technicianId: typeof technicianId === 'string' ? technicianId : undefined,
      date: typeof date === 'string' ? date : undefined,
      status: typeof status === 'string' ? status : undefined,
    });
    res.json(rows);
  }),
);

serviceRouter.post(
  '/visits',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await visitService.createVisit(caller, req.body);
    res.status(201).json(result);
  }),
);

serviceRouter.get(
  '/visits/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await visitService.getVisit(caller, req.params.id!);
    res.json(result);
  }),
);

serviceRouter.post(
  '/visits/:id/start-travel',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await visitService.startTravel(caller, req.params.id!);
    res.json(result);
  }),
);

serviceRouter.post(
  '/visits/:id/check-in',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await visitService.checkIn(caller, req.params.id!, req.body);
    res.json(result);
  }),
);

serviceRouter.post(
  '/visits/:id/checklist',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await visitService.saveChecklist(caller, req.params.id!, req.body);
    res.json(result);
  }),
);

serviceRouter.post(
  '/visits/:id/spares',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await visitService.issueSpares(caller, req.params.id!, req.body);
    res.status(201).json(result);
  }),
);

serviceRouter.post(
  '/visits/:id/consume-spares',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { issueId, lines } = req.body;
    const result = await visitService.consumeSpares(caller, issueId, { lines });
    res.json(result);
  }),
);

serviceRouter.post(
  '/visits/:id/sign',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await visitService.signAndComplete(caller, req.params.id!, req.body);
    res.json(result);
  }),
);

serviceRouter.get(
  '/visits/:id/report.pdf',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await visitService.getReportPdf(caller, req.params.id!);
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------- AMC
serviceRouter.get(
  '/amc-contracts',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { customerId, status, page, size } = req.query;
    const result = await amcService.listContracts(caller, {
      customerId: typeof customerId === 'string' ? customerId : undefined,
      status: typeof status === 'string' ? status : undefined,
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
    });
    res.json(result);
  }),
);

serviceRouter.post(
  '/amc-contracts',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await amcService.createContract(caller, req.body);
    res.status(201).json(result);
  }),
);

serviceRouter.get(
  '/amc-contracts/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await amcService.getContract(caller, req.params.id!);
    res.json(result);
  }),
);

serviceRouter.post(
  '/amc-contracts/:id/approve',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await amcService.approveContract(caller, req.params.id!);
    res.json(result);
  }),
);

serviceRouter.post(
  '/amc-contracts/:id/activate',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await amcService.activateContract(caller, req.params.id!);
    res.json(result);
  }),
);

serviceRouter.post(
  '/amc-contracts/:id/recognise-revenue',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { period } = req.body;
    const result = await amcService.recogniseRevenue(caller, req.params.id!, period);
    res.json(result);
  }),
);

serviceRouter.get(
  '/amc-contracts/:id/profitability',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await amcService.getProfitability(caller, req.params.id!);
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------- Warranties & Claims
serviceRouter.get(
  '/warranties/check',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { serial, date } = req.query;
    if (typeof serial !== 'string') {
      res.status(400).json({ error: 'serial query parameter required' });
      return;
    }
    const result = await warrantyService.checkWarranty(caller, serial, typeof date === 'string' ? date : undefined);
    res.json(result);
  }),
);

serviceRouter.get(
  '/warranties',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { customerId, status, page, size } = req.query;
    const result = await warrantyService.listWarranties(caller, {
      customerId: typeof customerId === 'string' ? customerId : undefined,
      status: typeof status === 'string' ? status : undefined,
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
    });
    res.json(result);
  }),
);

serviceRouter.post(
  '/warranties',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await warrantyService.registerWarranty(caller, req.body);
    res.status(201).json(result);
  }),
);

serviceRouter.get(
  '/warranty-claims',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { customerId, status } = req.query;
    const rows = await warrantyService.listClaims(caller, {
      customerId: typeof customerId === 'string' ? customerId : undefined,
      status: typeof status === 'string' ? status : undefined,
    });
    res.json(rows);
  }),
);

serviceRouter.post(
  '/warranty-claims',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await warrantyService.createClaim(caller, req.body);
    res.status(201).json(result);
  }),
);

serviceRouter.get(
  '/warranty-claims/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await warrantyService.getClaim(caller, req.params.id!);
    res.json(result);
  }),
);

serviceRouter.post(
  '/warranty-claims/:id/inspect',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await warrantyService.inspectClaim(caller, req.params.id!, req.body);
    res.json(result);
  }),
);

serviceRouter.post(
  '/warranty-claims/:id/claim-supplier',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await warrantyService.claimSupplier(caller, req.params.id!, req.body);
    res.json(result);
  }),
);

serviceRouter.post(
  '/warranty-claims/:id/settle',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await warrantyService.settleSupplierClaim(caller, req.params.id!, req.body);
    res.json(result);
  }),
);

serviceRouter.get(
  '/service-history',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { serialNumberId, customerId } = req.query;
    const rows = await warrantyService.getServiceHistory(caller, {
      serialNumberId: typeof serialNumberId === 'string' ? serialNumberId : undefined,
      customerId: typeof customerId === 'string' ? customerId : undefined,
    });
    res.json(rows);
  }),
);

