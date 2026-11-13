// Phase 27: letters (offer / appointment) with merge fields, issued only after approval, and quality certificates.
import { recordAudit } from '../../core/audit/audit-service';
import { NumberingService } from '../../core/numbering/numbering-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { companyName, queueEmail, renderEmail } from '../notifications/email';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';

const S = (v: unknown): string => String(v ?? '');
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

export const lettersService = {
  async templates(): Promise<Row[]> {
    return query(prisma, `SELECT code, name, merge_fields, approved FROM letter_templates WHERE approved ORDER BY code`);
  },

  async list(caller: Caller, status?: string): Promise<Row[]> {
    return query(prisma, `SELECT id, number, template_code, person_name, person_email, status, issued_at, emailed_at, created_at FROM issued_letters WHERE unit_id = ANY($1::uuid[]) AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC LIMIT 200`, caller.ctx.unitIds, status ?? null);
  },

  async get(caller: Caller, id: string): Promise<Row> {
    const r = (await query(prisma, `SELECT * FROM issued_letters WHERE id = $1::uuid`, id))[0];
    if (!r || !caller.ctx.unitIds.includes(S(r.unit_id))) throw Errors.notFound('Letter not found.');
    return r;
  },

  /** Merge the template with the person's data. Every merge field must be given, so no {{placeholder}} reaches a letter. */
  async create(caller: Caller, b: { templateCode: string; personName: string; personEmail?: string | null; data: Record<string, string>; unitId?: string }): Promise<Row> {
    const unitId = b.unitId ?? caller.ctx.unitId ?? '';
    if (!caller.ctx.unitIds.includes(unitId)) throw Errors.forbidden();
    const t = (await query(prisma, `SELECT * FROM letter_templates WHERE code = $1 AND approved ORDER BY version DESC LIMIT 1`, b.templateCode))[0];
    if (!t) throw Errors.validation({ templateCode: 'Choose an approved template.' });
    const company = await companyName();
    const data: Record<string, string> = { ...b.data, name: b.personName, company };
    const missing = (t.merge_fields as string[]).filter((f) => !S(data[f]).trim());
    if (missing.length > 0) throw Errors.validation({ data: `Fill in: ${missing.join(', ')}.` });
    const body = S(t.body_html).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, k: string) => esc(S(data[k])));
    return prisma.$transaction(async (tx) => {
      const number = await NumberingService.next(tx, { docType: 'hr-letters', unitId, fyId: caller.ctx.fyId });
      const r = (await query(
        tx,
        `INSERT INTO issued_letters (unit_id, number, template_code, person_name, person_email, data_json, body_html, created_by_id)
         VALUES ($1::uuid,$2,$3,$4,$5,$6::jsonb,$7,$8::uuid) RETURNING *`,
        unitId, number, b.templateCode, b.personName, b.personEmail ?? null, JSON.stringify(data), body, caller.auth.user.id,
      ))[0]!;
      await recordAudit({ action: 'letter.created', actorId: caller.auth.user.id, targetType: 'issued_letter', targetId: S(r.id), detail: { number, template: b.templateCode } }, tx);
      return r;
    });
  },

  async approve(caller: Caller, id: string): Promise<Row> {
    const l = await lettersService.get(caller, id);
    if (S(l.created_by_id) === caller.auth.user.id) throw Errors.forbidden('The person who made the letter cannot approve it.');
    const r = await query(prisma, `UPDATE issued_letters SET status = 'Approved', approved_by_id = $2::uuid, approved_at = now() WHERE id = $1::uuid AND status = 'Draft' RETURNING *`, id, caller.auth.user.id);
    if (!r[0]) throw Errors.conflict('Only a draft letter can be approved.');
    await recordAudit({ action: 'letter.approved', actorId: caller.auth.user.id, targetType: 'issued_letter', targetId: id, detail: { number: S(l.number) } });
    return r[0];
  },

  async issue(caller: Caller, id: string): Promise<Row> {
    const l = await lettersService.get(caller, id);
    if (S(l.status) === 'Draft') throw Errors.conflict('The offer letter must be approved before issue.');
    const r = await query(prisma, `UPDATE issued_letters SET status = 'Issued', issued_at = coalesce(issued_at, now()) WHERE id = $1::uuid AND status IN ('Approved','Issued') RETURNING *`, id);
    await recordAudit({ action: 'letter.issued', actorId: caller.auth.user.id, targetType: 'issued_letter', targetId: id, detail: { number: S(l.number) } });
    return r[0]!;
  },

  async email(caller: Caller, id: string): Promise<Row> {
    const l = await lettersService.get(caller, id);
    if (S(l.status) !== 'Issued') throw Errors.conflict('Issue the letter before emailing it.');
    const to = S(l.person_email).trim();
    if (!EMAIL.test(to)) throw Errors.validation({ email: `${S(l.person_name)} has no email for this letter. Add it on the letter.` });
    const content = renderEmail(await companyName(), { title: `${S(l.template_code) === 'OFFER' ? 'Offer letter' : 'Appointment letter'} ${S(l.number)}`, body: stripHtml(S(l.body_html)), link: null });
    await prisma.$transaction(async (tx) => {
      await queueEmail(tx, to, `${S(l.template_code) === 'OFFER' ? 'Offer letter' : 'Appointment letter'} ${S(l.number)}`, content);
      await query(tx, `UPDATE issued_letters SET emailed_at = now() WHERE id = $1::uuid`, id);
      await recordAudit({ action: 'letter.emailed', actorId: caller.auth.user.id, targetType: 'issued_letter', targetId: id, detail: { to } }, tx);
    });
    return lettersService.get(caller, id);
  },
};

export interface CertificateInput {
  jobCardNo?: string | null; partCode?: string | null; partName: string; inspectionDate?: string; sampleQty: number; acceptedQty: number; rejectedQty: number;
  drawingRevision?: string | null; inspector?: string | null; result?: 'Pass' | 'Fail' | 'Conditional'; ncrNo?: string | null; remarks?: string | null;
  soId?: string | null; dcId?: string | null; unitId?: string;
}

export const certificatesService = {
  async list(caller: Caller, q?: string): Promise<Row[]> {
    return query(prisma, `SELECT * FROM quality_certificates WHERE unit_id = ANY($1::uuid[]) AND deleted_at IS NULL AND ($2::text IS NULL OR number ILIKE $2 OR part_name ILIKE $2 OR job_card_no ILIKE $2) ORDER BY created_at DESC LIMIT 200`, caller.ctx.unitIds, q ? `%${q}%` : null);
  },
  async create(caller: Caller, b: CertificateInput): Promise<Row> {
    const unitId = b.unitId ?? caller.ctx.unitId ?? '';
    if (!caller.ctx.unitIds.includes(unitId)) throw Errors.forbidden();
    if (b.acceptedQty + b.rejectedQty > b.sampleQty) throw Errors.validation({ acceptedQty: 'Accepted plus rejected cannot be more than the sample quantity.' });
    if (b.result === 'Fail' && !b.ncrNo?.trim()) throw Errors.validation({ ncrNo: 'A failed certificate needs the NCR number.' });
    return prisma.$transaction(async (tx) => {
      const number = await NumberingService.next(tx, { docType: 'quality-certificate', unitId, fyId: caller.ctx.fyId });
      const r = (await query(
        tx,
        `INSERT INTO quality_certificates (unit_id, fy_id, number, job_card_no, part_code, part_name, inspection_date, sample_qty, accepted_qty, rejected_qty, drawing_revision, inspector, result, ncr_no, remarks, so_id, dc_id, created_by_id, updated_by_id)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8,$9,$10,$11,$12,$13,$14,$15,$16::uuid,$17::uuid,$18::uuid,$18::uuid) RETURNING *`,
        unitId, caller.ctx.fyId, number, b.jobCardNo ?? null, b.partCode ?? null, b.partName, b.inspectionDate ?? null, b.sampleQty, b.acceptedQty, b.rejectedQty, b.drawingRevision ?? null, b.inspector ?? null, b.result ?? 'Pass', b.ncrNo ?? null, b.remarks ?? null, b.soId ?? null, b.dcId ?? null, caller.auth.user.id,
      ))[0]!;
      await recordAudit({ action: 'certificate.created', actorId: caller.auth.user.id, targetType: 'quality_certificate', targetId: S(r.id), detail: { number } }, tx);
      return r;
    });
  },
  /** Release approval by quality: not the person who made it. */
  async decide(caller: Caller, id: string, approved: boolean): Promise<Row> {
    const c = (await query(prisma, `SELECT * FROM quality_certificates WHERE id = $1::uuid AND deleted_at IS NULL`, id))[0];
    if (!c || !caller.ctx.unitIds.includes(S(c.unit_id))) throw Errors.notFound('Certificate not found.');
    if (S(c.created_by_id) === caller.auth.user.id) throw Errors.forbidden('The person who made the certificate cannot release it.');
    const r = await query(prisma, `UPDATE quality_certificates SET quality_approval = $2, version = version + 1, updated_at = now(), updated_by_id = $3::uuid WHERE id = $1::uuid AND quality_approval = 'Pending' RETURNING *`, id, approved ? 'Approved' : 'Rejected', caller.auth.user.id);
    if (!r[0]) throw Errors.conflict('This certificate was already decided.');
    await recordAudit({ action: approved ? 'certificate.released' : 'certificate.rejected', actorId: caller.auth.user.id, targetType: 'quality_certificate', targetId: id, detail: { number: S(c.number) } });
    return r[0];
  },
};
