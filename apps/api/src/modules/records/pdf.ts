// PDF of one generic record or of a filtered list (docs/phases/PHASE-04.md §6, §9 "PDF buttons").
// Needs the page's view AND export permission, the caller's unit / scope, and is audited.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { accessUserOf, can } from '../../core/rbac/access';
import { formatInr, groupIndian, rupeesInWords } from '../../core/pdf/amount-words';
import { renderDocumentPdf, renderTablePdf } from '../../core/pdf/template';
import type { PdfLetterhead } from '../../core/pdf/template';
import { defaultStorage } from '../../core/storage';
import type { FieldMeta } from '../../engine/field-types';
import type { PrintDto } from '../../kit/print';
import { settingsService } from '../settings/service';
import { recordService } from './service';
import type { Caller } from './service';
import type { ExportRecordsQuery } from './schemas';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}-${MONTHS[Number(m[2]) - 1] ?? m[2]}-${m[1]}`;
}

export function displayValue(field: FieldMeta, raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (field.type === 'bool') return raw === true ? 'Yes' : 'No';
  if (field.type === 'money' && typeof raw === 'number') return formatInr(raw);
  if (field.type === 'pct' && typeof raw === 'number') return `${groupIndian(raw, 2)}%`;
  if (typeof raw === 'number') return groupIndian(raw, Number.isInteger(raw) ? 0 : 3);
  if (field.type === 'date' && typeof raw === 'string') return formatDate(raw);
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

async function letterheadFor(): Promise<{ lh: PdfLetterhead; logo: Buffer | null }> {
  const { value } = await settingsService.getLetterhead();
  let logo: Buffer | null = null;
  if (value.logoFileId) logo = (await defaultStorage.get(value.logoFileId))?.buffer ?? null;
  return {
    lh: {
      companyName: value.companyName,
      legalName: value.legalName ?? null,
      address: value.address ?? null,
      phone: value.phone ?? null,
      email: value.email ?? null,
      gstin: value.gstin ?? null,
      pan: value.pan ?? null,
      footer: value.footer ?? null,
      primaryColor: value.primaryColor,
      showGstin: value.showGstin,
      showPan: value.showPan,
    },
    logo,
  };
}

async function requireViewAndExport(caller: Caller, pageId: string): Promise<void> {
  const user = accessUserOf(caller.auth.user);
  if (!(await can(user, pageId, 'view'))) throw Errors.forbidden();
  if (!(await can(user, pageId, 'export'))) throw Errors.forbidden('Export permission required.');
}

const DEFAULT_EXPORT_QUERY: ExportRecordsQuery = { sort: '-createdAt' };

export const recordPdfService = {
  async recordPdf(caller: Caller, pageId: string, id: string): Promise<Buffer> {
    await requireViewAndExport(caller, pageId);
    const record = await recordService.get(caller, pageId, id);
    const { schema } = await recordService.exportSpec(caller, pageId, DEFAULT_EXPORT_QUERY);
    const unit = await prisma.unit.findUnique({ where: { id: record.unitId } });
    const facts = schema.fields
      .filter((f) => f.type !== 'code' && f.type !== 'status')
      .map((f) => ({ label: f.label, value: displayValue(f, record.data[f.key]) }))
      .filter((f) => f.value !== '');
    const dto: PrintDto = {
      templateKey: 'record',
      title: schema.title,
      docNo: record.code,
      docDate: formatDate(record.createdAt),
      unit: {
        code: unit?.code ?? '-',
        name: unit?.name ?? '-',
        ...(unit?.gstin ? { gstin: unit.gstin } : {}),
        ...(unit?.address ? { address: [unit.address, unit.city].filter(Boolean).join(', ') } : {}),
      },
      letterhead: {},
      parties: [],
      facts: [
        { label: 'Status', value: record.status },
        { label: 'Department', value: record.department },
        ...facts,
      ],
      lines: null,
      sections: [],
      totals:
        record.amount !== null
          ? [{ label: 'Amount', value: formatInr(record.amount), bold: true }]
          : [],
      ...(record.amount !== null ? { amountInWords: rupeesInWords(record.amount) } : {}),
      signatures: [
        { label: 'Prepared by', name: record.createdBy.name },
        { label: 'Authorised by' },
      ],
    };
    const { lh, logo } = await letterheadFor();
    const buffer = await renderDocumentPdf(dto, lh, { logo });
    await recordAudit({
      action: 'PRINT_RENDERED',
      actorId: caller.auth.userId,
      targetType: 'record',
      targetId: id,
      meta: caller.meta,
      detail: { pageId, templateKey: 'record', kind: 'pdf' },
    });
    return buffer;
  },

  async listPdf(caller: Caller, pageId: string, query: ExportRecordsQuery): Promise<Buffer> {
    await requireViewAndExport(caller, pageId);
    const spec = await recordService.exportSpec(caller, pageId, query);
    const { rows } = await recordService.exportRowsFor(pageId, spec.visibility, spec.filters, 1001);
    if (rows.length > 1000) {
      throw Errors.validation({ _: 'A list PDF holds at most 1,000 rows. Narrow the filters.' });
    }
    const fields = spec.schema.fields.filter((f) => f.type !== 'status').slice(0, 7);
    const columns = [
      { key: '__status', label: 'Status' },
      ...fields.map((f) => ({
        key: f.key,
        label: f.label,
        ...(f.type === 'money' ? { align: 'right' as const } : {}),
      })),
    ];
    const tableRows = rows.map((r) => {
      const out: Record<string, string> = { __status: r.status };
      for (const f of fields) {
        out[f.key] = f.type === 'code' ? r.code : displayValue(f, r.data[f.key]);
      }
      return out;
    });
    const { lh, logo } = await letterheadFor();
    const buffer = await renderTablePdf(
      {
        title: spec.schema.title,
        subtitle: `${rows.length} record${rows.length === 1 ? '' : 's'}  |  ${new Date().toISOString().slice(0, 10)}`,
        columns,
        rows: tableRows,
      },
      lh,
      { logo },
    );
    await recordAudit({
      action: 'PRINT_RENDERED',
      actorId: caller.auth.userId,
      targetType: 'page',
      targetId: pageId,
      meta: caller.meta,
      detail: { pageId, templateKey: 'list', kind: 'pdf', count: rows.length },
    });
    return buffer;
  },
};
