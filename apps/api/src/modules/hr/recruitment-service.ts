// apps/api/src/modules/hr/recruitment-service.ts
// Job requisitions, candidates, interviews, offers.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import {
  TX,
  exec,
  fyOfCaller,
  insertRow,
  norm,
  query,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { recordAudit } from '../../core/audit/audit-service';

export class RecruitmentService {
  async listRequisitions(caller: Caller): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT r.*, u.name AS unit_name, d.name AS designation_name
       FROM job_requisitions r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN designations d ON d.id = r.designation_id
       WHERE r.deleted_at IS NULL
       ORDER BY r.created_at DESC`,
    );
    return rows.map(norm);
  }

  async createRequisition(
    caller: Caller,
    input: {
      unitId: string;
      department: string;
      designationId?: string | null;
      positions?: number;
      reason?: string | null;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    },
  ): Promise<Row> {
    const fy = await fyOfCaller(caller);
    return await prisma.$transaction(async (tx) => {
      const reqCode = await NumberingService.allocate(tx, {
        pageId: 'hr-recruitment',
        unitId: input.unitId,
        fyId: fy.id,
        prefix: 'REQ',
      });

      const reqId = await insertRow(tx, 'job_requisitions', {
        reqCode,
        unitId: input.unitId,
        department: input.department,
        designationId: input.designationId ?? null,
        positions: input.positions ?? 1,
        reason: input.reason ?? null,
        priority: input.priority ?? 'MEDIUM',
        status: 'DRAFT',
        createdById: caller.auth.userId,
      });

      await recordAudit({
        action: 'RECORD_CREATED',
        actorId: caller.auth.userId,
        targetType: 'JobRequisition',
        targetId: reqId,
        detail: { reqCode },
      }, tx);

      const row = (await query(tx, `SELECT * FROM job_requisitions WHERE id = $1::uuid`, reqId))[0]!;
      return norm(row);
    });
  }

  async listCandidates(): Promise<Row[]> {
    const rows = await query(prisma, `SELECT * FROM candidates ORDER BY created_at DESC`);
    return rows.map(norm);
  }

  async createCandidate(
    caller: Caller,
    input: {
      name: string;
      email?: string | null;
      mobile?: string | null;
      source?: string | null;
      resumeFileId?: string | null;
    },
  ): Promise<Row> {
    const purgeAfter = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const id = await insertRow(prisma, 'candidates', {
      name: input.name,
      email: input.email ?? null,
      mobile: input.mobile ?? null,
      source: input.source ?? null,
      resumeFileId: input.resumeFileId ?? null,
      purgeAfter,
      createdById: caller.auth.userId,
    });

    const row = (await query(prisma, `SELECT * FROM candidates WHERE id = $1::uuid`, id))[0]!;
    return norm(row);
  }

  async listOffers(): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT o.*, c.name AS candidate_name, c.email AS candidate_email
       FROM offers o
       JOIN candidates c ON c.id = o.candidate_id
       ORDER BY o.created_at DESC`,
    );
    return rows.map(norm);
  }

  async createOffer(
    caller: Caller,
    input: {
      applicationId: string;
      candidateId: string;
      offeredCtc: number;
      joinDate: string;
      validityDate: string;
    },
  ): Promise<Row> {
    const fy = await fyOfCaller(caller);
    return await prisma.$transaction(async (tx) => {
      const offerNo = await NumberingService.allocate(tx, {
        pageId: 'hr-recruitment',
        unitId: caller.ctx.unitId || '',
        fyId: fy.id,
        prefix: 'OFR',
      });

      const offerId = await insertRow(tx, 'offers', {
        offerNo,
        applicationId: input.applicationId,
        candidateId: input.candidateId,
        offeredCtc: Number(input.offeredCtc).toFixed(2),
        joinDate: input.joinDate,
        validityDate: input.validityDate,
        status: 'DRAFT',
        createdById: caller.auth.userId,
      });

      await recordAudit({
        action: 'RECORD_CREATED',
        actorId: caller.auth.userId,
        targetType: 'Offer',
        targetId: offerId,
        detail: { offerNo },
      }, tx);

      const row = (await query(tx, `SELECT * FROM offers WHERE id = $1::uuid`, offerId))[0]!;
      return norm(row);
    });
  }
}

export const recruitmentService = new RecruitmentService();
