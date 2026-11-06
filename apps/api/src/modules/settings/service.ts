// Letterhead & PDF settings (Phase 2 §2.3) and Security Policy (Phase 01):
// read and replaced as a whole with If-Match by authorized administrators.
// Stored values are re-validated on read. Audited with changed fields.
import type { Prisma } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import {
  getSecurityPolicyRecord,
  invalidateSecurityPolicyCache,
  type SecurityPolicy,
} from '../../core/auth/security-policy';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { DEFAULT_LETTERHEAD, LETTERHEAD_KEY } from '../../core/seed/defaults';
import { settingsRepository } from './repository';
import PDFDocument from 'pdfkit';
import { defaultStorage } from '../../core/storage';
import { letterheadSchema } from './schemas';
import type { Letterhead } from './schemas';

export const SECURITY_POLICY_KEY = 'security_policy';

/** Response shape (orchestrator decision): {value:{...11 fields}, version}. */
export interface LetterheadDto {
  value: Letterhead;
  version: number;
}

export interface SecurityPolicyDto {
  value: SecurityPolicy;
  version: number;
}

function parseStoredLetterhead(value: unknown): Letterhead {
  const parsed = letterheadSchema.safeParse(value);
  return parsed.success ? parsed.data : letterheadSchema.parse(DEFAULT_LETTERHEAD);
}

export const settingsService = {
  async getLetterhead(): Promise<LetterheadDto> {
    const row = await settingsRepository.get(LETTERHEAD_KEY);
    if (!row) return { value: letterheadSchema.parse(DEFAULT_LETTERHEAD), version: 0 };
    return { value: parseStoredLetterhead(row.value), version: row.version };
  },

  async putLetterhead(
    actor: AuthContext,
    expectedVersion: number,
    input: Letterhead,
    meta: RequestMeta,
  ): Promise<LetterheadDto> {
    const current = await this.getLetterhead();
    if (current.version !== expectedVersion) throw Errors.versionConflict();
    const before: Prisma.InputJsonObject = {};
    const after: Prisma.InputJsonObject = {};
    for (const key of Object.keys(input) as (keyof Letterhead)[]) {
      if (input[key] !== current.value[key]) {
        Object.assign(before, { [key]: current.value[key] });
        Object.assign(after, { [key]: input[key] });
      }
    }
    // Nothing changes: return the current value without a version bump or an audit row.
    if (current.version > 0 && Object.keys(after).length === 0) return current;
    await prisma.$transaction(async (tx) => {
      const ok = await settingsRepository.writeIfVersion(
        LETTERHEAD_KEY,
        expectedVersion,
        { ...input },
        actor.userId,
        tx,
      );
      if (!ok) throw Errors.versionConflict();
      await recordAudit(
        {
          action: 'SETTINGS_UPDATED',
          actorId: actor.userId,
          targetType: 'Setting',
          targetId: LETTERHEAD_KEY,
          meta,
          detail: { key: LETTERHEAD_KEY, before, after },
        },
        tx,
      );
    });
    return this.getLetterhead();
  },

  async getSecurityPolicy(): Promise<SecurityPolicyDto> {
    const record = await getSecurityPolicyRecord();
    return { value: record.policy, version: record.version };
  },

  async putSecurityPolicy(
    actor: AuthContext,
    expectedVersion: number,
    input: SecurityPolicy,
    meta: RequestMeta,
  ): Promise<SecurityPolicyDto> {
    const current = await this.getSecurityPolicy();
    if (current.version !== expectedVersion) throw Errors.versionConflict();
    const before: Prisma.InputJsonObject = {};
    const after: Prisma.InputJsonObject = {};
    for (const key of Object.keys(input) as (keyof SecurityPolicy)[]) {
      if (input[key] !== current.value[key]) {
        Object.assign(before, { [key]: current.value[key] });
        Object.assign(after, { [key]: input[key] });
      }
    }
    if (current.version > 0 && Object.keys(after).length === 0) return current;
    await prisma.$transaction(async (tx) => {
      const ok = await settingsRepository.writeIfVersion(
        SECURITY_POLICY_KEY,
        expectedVersion,
        { ...input },
        actor.userId,
        tx,
      );
      if (!ok) throw Errors.versionConflict();
      await recordAudit(
        {
          action: 'SECURITY_POLICY_UPDATED',
          actorId: actor.userId,
          targetType: 'Setting',
          targetId: SECURITY_POLICY_KEY,
          meta,
          detail: { key: SECURITY_POLICY_KEY, before, after },
        },
        tx,
      );
    });
    invalidateSecurityPolicyCache();
    return this.getSecurityPolicy();
  },

  async generateTestPdf(customConfig?: Partial<Letterhead>): Promise<Buffer> {
    const current = await this.getLetterhead();
    const config: Letterhead = { ...current.value, ...(customConfig ?? {}) };

    return new Promise<Buffer>(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 40,
          info: {
            Title: `Letterhead Preview - ${config.companyName}`,
            Author: config.companyName,
          },
        });

        const buffers: Buffer[] = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        const primary = config.primaryColor || '#0f172a';

        // 1. Logo (if logoFileId present)
        let hasLogo = false;
        if (config.logoFileId) {
          try {
            const fileData = await defaultStorage.get(config.logoFileId);
            if (fileData) {
              doc.image(fileData.buffer, 40, 40, { fit: [100, 60] });
              hasLogo = true;
            }
          } catch {
            // Ignore logo fetch error and continue
          }
        }

        // 2. Company Header
        const textX = hasLogo ? 150 : 40;
        doc
          .fillColor(primary)
          .fontSize(18)
          .font('Helvetica-Bold')
          .text(config.companyName, textX, 40);

        if (config.legalName && config.legalName !== config.companyName) {
          doc
            .fillColor('#475569')
            .fontSize(10)
            .font('Helvetica')
            .text(config.legalName, textX, 62);
        }

        const addressY = hasLogo ? 78 : (config.legalName && config.legalName !== config.companyName ? 78 : 64);
        doc
          .fillColor('#64748b')
          .fontSize(9)
          .font('Helvetica')
          .text(config.address || '', textX, addressY, { width: 350 });

        // Contact info right aligned
        const contactDetails: string[] = [];
        if (config.phone) contactDetails.push(`Tel: ${config.phone}`);
        if (config.email) contactDetails.push(`Email: ${config.email}`);
        if (config.website) contactDetails.push(`Web: ${config.website}`);
        if (contactDetails.length > 0) {
          doc
            .fillColor('#475569')
            .fontSize(8)
            .text(contactDetails.join(' | '), textX, doc.y + 4);
        }

        // Statutory identifiers (GSTIN, PAN, CIN)
        const statutory: string[] = [];
        if (config.showGstin && config.gstin) statutory.push(`GSTIN: ${config.gstin}`);
        if (config.showPan && config.pan) statutory.push(`PAN: ${config.pan}`);
        if (config.showCin && config.cin) statutory.push(`CIN: ${config.cin}`);
        if (statutory.length > 0) {
          doc
            .fillColor('#1e293b')
            .fontSize(8)
            .font('Helvetica-Bold')
            .text(statutory.join('  •  '), textX, doc.y + 3);
        }

        // Header separator rule
        const ruleY = Math.max(doc.y + 12, 115);
        doc
          .strokeColor(primary)
          .lineWidth(2)
          .moveTo(40, ruleY)
          .lineTo(555, ruleY)
          .stroke();

        doc
          .strokeColor('#cbd5e1')
          .lineWidth(0.5)
          .moveTo(40, ruleY + 3)
          .lineTo(555, ruleY + 3)
          .stroke();

        // 3. Document Content (Sample Body)
        const bodyY = ruleY + 25;
        doc
          .fillColor('#0f172a')
          .fontSize(14)
          .font('Helvetica-Bold')
          .text('CORPORATE LETTERHEAD PREVIEW', 40, bodyY, { align: 'center' });

        doc
          .fillColor('#64748b')
          .fontSize(9)
          .font('Helvetica')
          .text('Reference No: PREV/TAL/2026-27/0001', 40, bodyY + 25);
        doc
          .text(`Date: ${new Date().toISOString().slice(0, 10)}`, 40, bodyY + 38, { align: 'left' });

        doc
          .fillColor('#334155')
          .fontSize(10)
          .font('Helvetica')
          .text(
            'This test document demonstrates your corporate branding and letterhead configuration under RHAI Enterprise ERP.\n\n' +
            'Key features verified:\n' +
            '• High-resolution vector typography with dynamic primary accent coloring\n' +
            '• Statutory GSTIN, PAN, and CIN compliance metadata per Indian MCA & GST guidelines\n' +
            '• Configurable header/footer margin dimensions and asset linking with stored_files\n' +
            '• Gap-free transaction document rendering with authorized signature block',
            40,
            bodyY + 65,
            { lineGap: 4, width: 515 },
          );

        // 4. Footer & Signature
        const footerY = 740;
        doc
          .strokeColor('#e2e8f0')
          .lineWidth(1)
          .moveTo(40, footerY)
          .lineTo(555, footerY)
          .stroke();

        if (config.signatory) {
          doc
            .fillColor('#0f172a')
            .fontSize(9)
            .font('Helvetica-Bold')
            .text(`For ${config.companyName}`, 380, footerY - 50, { width: 175, align: 'right' });
          doc
            .fillColor('#64748b')
            .fontSize(8)
            .font('Helvetica')
            .text(config.signatory, 380, footerY - 15, { width: 175, align: 'right' });
        }

        doc
          .fillColor('#94a3b8')
          .fontSize(8)
          .font('Helvetica')
          .text(config.footer || 'System generated document from RHAI Enterprise ERP', 40, footerY + 8, {
            align: 'center',
            width: 515,
          });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  },
};
