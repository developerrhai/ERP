// apps/api/src/modules/service/ticket-service.ts
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { norm, query, exec, insertRow, fyOfCaller } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import {
  computePriority,
  calculateSlaDue,
  checkSlaWarning,
  selectTechnician,
} from './service-calc';
import type { PauseInterval, TechnicianCandidate } from './service-calc';

export class TicketService {
  async listTickets(
    caller: Caller,
    params: {
      status?: string;
      customerId?: string;
      technicianId?: string;
      priority?: number;
      page?: number;
      size?: number;
    },
  ): Promise<{ rows: Row[]; total: number }> {
    const conds: string[] = ['1=1'];
    const args: unknown[] = [];

    if (params.status) {
      args.push(params.status);
      conds.push(`t.status = $${args.length}`);
    }
    if (params.customerId) {
      args.push(params.customerId);
      conds.push(`t.customer_id = $${args.length}::uuid`);
    }
    if (params.technicianId) {
      args.push(params.technicianId);
      conds.push(`t.assigned_technician_id = $${args.length}::uuid`);
    }
    if (params.priority) {
      args.push(params.priority);
      conds.push(`t.priority = $${args.length}`);
    }

    const countSql = `SELECT COUNT(*)::int AS count FROM service_tickets t WHERE ${conds.join(' AND ')}`;
    const countRows = await query(prisma, countSql, ...args);
    const total = (countRows[0]?.count as number) ?? 0;

    const page = Math.max(1, params.page ?? 1);
    const size = Math.max(1, Math.min(100, params.size ?? 25));
    const offset = (page - 1) * size;

    const sql = `
      SELECT t.*, c.name AS customer_name,
             e.first_name || ' ' || e.last_name AS technician_name,
             sn.serial_no AS serial_number, i.name AS item_name
      FROM service_tickets t
      JOIN customers c ON c.id = t.customer_id
      LEFT JOIN technicians tech ON tech.id = t.assigned_technician_id
      LEFT JOIN employees e ON e.id = tech.employee_id
      LEFT JOIN serial_numbers sn ON sn.id = t.serial_number_id
      LEFT JOIN items i ON i.id = t.item_id
      WHERE ${conds.join(' AND ')}
      ORDER BY t.created_at DESC
      LIMIT ${size} OFFSET ${offset}
    `;

    const rows = await query(prisma, sql, ...args);

    // Compute live SLA warnings
    const nowIso = new Date().toISOString();
    const enriched = rows.map((r) => {
      const row = norm(r);
      if (row.resolution_due_at && (row.status === 'NEW' || row.status === 'ASSIGNED' || row.status === 'IN_PROGRESS')) {
        const sla = checkSlaWarning(String(row.created_at), String(row.resolution_due_at), nowIso);
        if (sla.breached) row.sla_state = 'BREACHED';
        else if (sla.warning) row.sla_state = 'WARNING';
        else row.sla_state = 'ACTIVE';
      }
      return row;
    });

    return { rows: enriched, total };
  }

  async getTicket(caller: Caller, id: string): Promise<Row> {
    const rows = await query(
      prisma,
      `SELECT t.*, c.name AS customer_name,
              e.first_name || ' ' || e.last_name AS technician_name,
              sn.serial_no AS serial_number, i.name AS item_name,
              p.name AS sla_policy_name
       FROM service_tickets t
       JOIN customers c ON c.id = t.customer_id
       LEFT JOIN technicians tech ON tech.id = t.assigned_technician_id
       LEFT JOIN employees e ON e.id = tech.employee_id
       LEFT JOIN serial_numbers sn ON sn.id = t.serial_number_id
       LEFT JOIN items i ON i.id = t.item_id
       LEFT JOIN sla_policies p ON p.id = t.sla_policy_id
       WHERE t.id = $1::uuid`,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`Ticket not found: ${id}`);
    const ticket = norm(rows[0]);

    const events = await query(
      prisma,
      `SELECT te.*, u.login_id AS actor_name
       FROM ticket_events te
       LEFT JOIN users u ON u.id = te.actor_id
       WHERE te.ticket_id = $1::uuid
       ORDER BY te.event_at ASC`,
      id,
    );
    ticket.events = events.map(norm);

    return ticket;
  }

  async createTicket(
    caller: Caller,
    input: {
      customerId: string;
      contactPerson?: string;
      contactPhone?: string;
      siteAddress: string;
      serialNumberId?: string;
      itemId?: string;
      subject: string;
      category?: string;
      channel?: string;
      impact?: number;
      urgency?: number;
    },
  ): Promise<Row> {
    const impact = Number(input.impact ?? 2);
    const urgency = Number(input.urgency ?? 2);
    const priority = computePriority(impact, urgency);

    // 1. Find SLA policy
    const policyRows = await query(
      prisma,
      `SELECT * FROM sla_policies WHERE priority = $1 AND active = true LIMIT 1`,
      priority,
    );
    const policy = policyRows[0];
    const respMins = Number(policy?.response_mins ?? (priority === 1 ? 60 : priority === 2 ? 120 : 240));
    const resoMins = Number(policy?.resolution_mins ?? (priority === 1 ? 240 : priority === 2 ? 480 : 960));

    // Fetch Phase 15 holidays
    const holRows = await query(
      prisma,
      `SELECT holiday_date FROM holidays WHERE holiday_date >= CURRENT_DATE - INTERVAL '7 days'`,
    );
    const holidays = holRows.map((h) => String(h.holiday_date).slice(0, 10));

    const now = new Date().toISOString();
    const respCalc = calculateSlaDue(now, respMins, [], { holidays });
    const resoCalc = calculateSlaDue(now, resoMins, [], { holidays });

    // 2. Check entitlement
    let entitlement = 'CHARGEABLE';
    let amcId: string | null = null;
    let warrantyId: string | null = null;

    if (input.serialNumberId) {
      // Check AMC
      const amcRows = await query(
        prisma,
        `SELECT a.id FROM amc_contracts a
         JOIN amc_contract_assets ca ON ca.amc_contract_id = a.id
         WHERE ca.serial_number_id = $1::uuid
           AND a.status = 'ACTIVE'
           AND CURRENT_DATE BETWEEN a.start_date AND a.end_date
         LIMIT 1`,
        input.serialNumberId,
      );
      if (amcRows[0]) {
        entitlement = 'AMC';
        amcId = amcRows[0].id as string;
      } else {
        // Check Warranty
        const wRows = await query(
          prisma,
          `SELECT id FROM warranty_registrations
           WHERE serial_number_id = $1::uuid
             AND status = 'ACTIVE'
             AND CURRENT_DATE BETWEEN start_date AND end_date
           LIMIT 1`,
          input.serialNumberId,
        );
        if (wRows[0]) {
          entitlement = 'WARRANTY';
          warrantyId = wRows[0].id as string;
        }
      }
    }

    const fy = await fyOfCaller(caller);
    const unitId = caller.ctx.unitId || '';
    const ticketNo = await NumberingService.allocate(prisma as any, {
      pageId: 'service-tickets',
      unitId,
      fyId: fy.id,
      prefix: 'TKT',
    });
    const id = await insertRow(prisma, 'service_tickets', {
      ticket_no: ticketNo,
      customer_id: input.customerId,
      contact_person: input.contactPerson ?? null,
      contact_phone: input.contactPhone ?? null,
      site_address: input.siteAddress,
      serial_number_id: input.serialNumberId ?? null,
      item_id: input.itemId ?? null,
      subject: input.subject,
      category: input.category ?? 'BREAKDOWN',
      channel: input.channel ?? 'PORTAL',
      impact,
      urgency,
      priority,
      sla_policy_id: policy?.id ?? null,
      response_due_at: respCalc.dueAt,
      resolution_due_at: resoCalc.dueAt,
      entitlement,
      amc_contract_id: amcId,
      warranty_id: warrantyId,
      status: 'NEW',
    });

    // Record creation event
    await insertRow(prisma, 'ticket_events', {
      ticket_id: id,
      actor_id: caller.auth.userId,
      kind: 'STATUS_CHANGE',
      from_status: null,
      to_status: 'NEW',
      body: `Ticket created: ${input.subject}`,
    });

    return this.getTicket(caller, id);
  }

  async assignTicket(caller: Caller, ticketId: string, technicianId: string): Promise<Row> {
    await exec(
      prisma,
      `UPDATE service_tickets
       SET assigned_technician_id = $1::uuid,
           status = CASE WHEN status = 'NEW' THEN 'ASSIGNED' ELSE status END,
           updated_at = now()
       WHERE id = $2::uuid`,
      technicianId,
      ticketId,
    );

    await insertRow(prisma, 'ticket_events', {
      ticket_id: ticketId,
      actor_id: caller.auth.userId,
      kind: 'ASSIGN',
      to_status: 'ASSIGNED',
      body: `Assigned to technician ${technicianId}`,
    });

    return this.getTicket(caller, ticketId);
  }

  async autoAssignTicket(caller: Caller, ticketId: string): Promise<Row> {
    const t = await this.getTicket(caller, ticketId);

    // Candidates: technicians with skill & open jobs < max_jobs
    const techRows = await query(
      prisma,
      `SELECT tech.id, e.emp_code, e.first_name || ' ' || e.last_name AS name,
              tech.max_open_jobs, tech.territory_ids,
              COALESCE((
                SELECT COUNT(*)::int
                FROM service_tickets st
                WHERE st.assigned_technician_id = tech.id
                  AND st.status IN ('ASSIGNED','IN_PROGRESS')
              ), 0) AS open_jobs,
              COALESCE((
                SELECT MAX(ts.level)
                FROM technician_skills ts
                WHERE ts.technician_id = tech.id
              ), 3) AS skill_level
       FROM technicians tech
       JOIN employees e ON e.id = tech.employee_id
       WHERE tech.active = true`,
    );

    const candidates: TechnicianCandidate[] = techRows.map((tr) => ({
      id: tr.id as string,
      employeeCode: tr.emp_code as string,
      name: tr.name as string,
      skillCode: 'GENERAL',
      skillLevel: Number(tr.skill_level ?? 3),
      openJobs: Number(tr.open_jobs ?? 0),
      maxJobs: Number(tr.max_open_jobs ?? 5),
      isSameTerritory: true, // simplified territory match
      isParentTerritory: false,
    }));

    const selected = selectTechnician(candidates);
    if (!selected) {
      return t; // remain unassigned
    }

    return this.assignTicket(caller, ticketId, selected.technicianId);
  }

  async respondTicket(caller: Caller, ticketId: string): Promise<Row> {
    await exec(
      prisma,
      `UPDATE service_tickets
       SET first_response_at = COALESCE(first_response_at, now()),
           status = CASE WHEN status IN ('NEW', 'ASSIGNED') THEN 'IN_PROGRESS' ELSE status END,
           updated_at = now()
       WHERE id = $1::uuid`,
      ticketId,
    );

    await insertRow(prisma, 'ticket_events', {
      ticket_id: ticketId,
      actor_id: caller.auth.userId,
      kind: 'STATUS_CHANGE',
      to_status: 'IN_PROGRESS',
      body: 'First response recorded',
    });

    return this.getTicket(caller, ticketId);
  }

  async pauseTicket(
    caller: Caller,
    ticketId: string,
    pauseStatus: 'AWAITING_CUSTOMER' | 'AWAITING_PARTS',
    reason?: string,
  ): Promise<Row> {
    await exec(
      prisma,
      `UPDATE service_tickets
       SET status = $1, sla_state = 'PAUSED', updated_at = now()
       WHERE id = $2::uuid`,
      pauseStatus,
      ticketId,
    );

    await insertRow(prisma, 'ticket_events', {
      ticket_id: ticketId,
      actor_id: caller.auth.userId,
      kind: 'PAUSE',
      from_status: 'IN_PROGRESS',
      to_status: pauseStatus,
      body: reason ?? `SLA paused: ${pauseStatus}`,
    });

    return this.getTicket(caller, ticketId);
  }

  async resumeTicket(caller: Caller, ticketId: string): Promise<Row> {
    // Calculate paused minutes from events
    const pauseEvents = await query(
      prisma,
      `SELECT * FROM ticket_events WHERE ticket_id = $1::uuid AND kind IN ('PAUSE', 'RESUME') ORDER BY event_at ASC`,
      ticketId,
    );

    const pauses: PauseInterval[] = [];
    let curPauseStart: string | null = null;
    for (const e of pauseEvents) {
      if (e.kind === 'PAUSE') {
        curPauseStart = new Date(String(e.event_at)).toISOString();
      } else if (e.kind === 'RESUME' && curPauseStart) {
        pauses.push({ startAt: curPauseStart, endAt: new Date(String(e.event_at)).toISOString() });
        curPauseStart = null;
      }
    }
    if (curPauseStart) {
      pauses.push({ startAt: curPauseStart, endAt: new Date().toISOString() });
    }

    const t = await this.getTicket(caller, ticketId);
    const policyRows = await query(
      prisma,
      `SELECT resolution_mins FROM sla_policies WHERE id = $1::uuid`,
      t.sla_policy_id,
    );
    const resoMins = Number(policyRows[0]?.resolution_mins ?? 480);

    const holRows = await query(
      prisma,
      `SELECT holiday_date FROM holidays WHERE holiday_date >= CURRENT_DATE - INTERVAL '7 days'`,
    );
    const holidays = holRows.map((h) => String(h.holiday_date).slice(0, 10));

    const calc = calculateSlaDue(String(t.created_at), resoMins, pauses, { holidays });

    await exec(
      prisma,
      `UPDATE service_tickets
       SET status = 'IN_PROGRESS',
           sla_state = 'ACTIVE',
           sla_paused_mins = $1,
           resolution_due_at = $2::timestamptz,
           updated_at = now()
       WHERE id = $3::uuid`,
      calc.totalPausedMins,
      calc.dueAt,
      ticketId,
    );

    await insertRow(prisma, 'ticket_events', {
      ticket_id: ticketId,
      actor_id: caller.auth.userId,
      kind: 'RESUME',
      from_status: t.status,
      to_status: 'IN_PROGRESS',
      body: `SLA resumed; new resolution due: ${calc.dueAt}`,
    });

    return this.getTicket(caller, ticketId);
  }

  async resolveTicket(caller: Caller, ticketId: string, notes?: string): Promise<Row> {
    const t = await this.getTicket(caller, ticketId);
    const now = new Date();
    const resolutionDue = t.resolution_due_at ? new Date(String(t.resolution_due_at)) : null;
    const isMet = !resolutionDue || now <= resolutionDue;

    await exec(
      prisma,
      `UPDATE service_tickets
       SET status = 'RESOLVED',
           resolved_at = now(),
           sla_state = $1,
           updated_at = now()
       WHERE id = $2::uuid`,
      isMet ? 'MET' : 'BREACHED',
      ticketId,
    );

    await insertRow(prisma, 'ticket_events', {
      ticket_id: ticketId,
      actor_id: caller.auth.userId,
      kind: 'STATUS_CHANGE',
      from_status: t.status,
      to_status: 'RESOLVED',
      body: notes ?? 'Ticket resolved',
    });

    return this.getTicket(caller, ticketId);
  }

  async closeTicket(caller: Caller, ticketId: string, rating?: number): Promise<Row> {
    await exec(
      prisma,
      `UPDATE service_tickets
       SET status = 'CLOSED',
           closed_at = now(),
           rating = $1,
           updated_at = now()
       WHERE id = $2::uuid`,
      rating ?? null,
      ticketId,
    );
    return this.getTicket(caller, ticketId);
  }
}

export const ticketService = new TicketService();
