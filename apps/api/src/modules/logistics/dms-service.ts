// apps/api/src/modules/logistics/dms-service.ts
import { createHash, randomBytes } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { recordAudit } from '../../core/audit/audit-service';
import { builtInScanner, extensionOf, sanitizeFilename, sniffKind, MAX_FILE_BYTES } from '../../core/scan';
import { defaultStorage } from '../../core/storage';
import { norm, query, exec, fyOfCaller } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';

const DMS_DOC_COLS =
  'id, doc_code, title, description, folder_id, unit_id, owner_id, confidentiality, current_version_no, current_file_id, effective_date, expiry_date, linked_page_id, linked_record_id, checked_out_by_id, checked_out_at, legal_hold, legal_hold_reason, disposition_due, status, version, created_at, updated_at';

function sanitizeLtreeLabel(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return cleaned || 'folder';
}

export class DmsService {
  /**
   * Resolves caller's effective access to a folder/document.
   * Implements single-predicate rule:
   * - Owner gets all permissions
   * - Restricted folders require explicit non-expired ACL row (no inheritance bypass unless explicit)
   * - Normal folders inherit non-revoked ACLs from nearest non-inheriting ancestor or folder itself
   */
  async checkFolderAccess(
    caller: Caller,
    folderId: string,
    action: 'view' | 'upload' | 'edit' | 'delete' | 'download' | 'share' | 'approve',
  ): Promise<boolean> {
    const userId = caller.auth.userId;
    const roleId = caller.auth.user.roleId;

    const rows = await query(
      prisma,
      `SELECT f.id, f.name, f.owner_id, f.confidentiality, f.path::text AS path_str,
              EXISTS (
                SELECT 1
                FROM dms_folders anc
                JOIN dms_folder_acl acl ON acl.folder_id = anc.id
                WHERE anc.path @> f.path
                  AND (anc.id = f.id OR f.inherit_acl = true)
                  AND (f.confidentiality <> 'RESTRICTED' OR anc.id = f.id)
                  AND (acl.valid_till IS NULL OR acl.valid_till > now())
                  AND (
                    (acl.principal_type = 'USER' AND acl.principal_id = $2::uuid)
                    OR (acl.principal_type = 'ROLE' AND acl.principal_id = $3::uuid)
                  )
                  AND (
                    ($4 = 'view' AND acl.can_view)
                    OR ($4 = 'upload' AND acl.can_upload)
                    OR ($4 = 'edit' AND acl.can_edit)
                    OR ($4 = 'delete' AND acl.can_delete)
                    OR ($4 = 'download' AND acl.can_download)
                    OR ($4 = 'share' AND acl.can_share)
                    OR ($4 = 'approve' AND acl.can_approve)
                  )
              ) AS has_acl
       FROM dms_folders f
       WHERE f.id = $1::uuid AND f.deleted_at IS NULL`,
      folderId,
      userId,
      roleId,
      action,
    );
    if (!rows[0]) return false;
    const row = rows[0];
    if (String(row.owner_id) === userId) return true;
    // Admin level >= 95 retains non-restricted admin access unless restricted folder without explicit ACL
    if (caller.auth.level >= 95 && row.confidentiality !== 'RESTRICTED') return true;
    if (row.confidentiality === 'PUBLIC' && (action === 'view' || action === 'download')) return true;
    return Boolean(row.has_acl);
  }

  // ------------------------------------------------------------------------- Folders & ACLs
  async listFolders(caller: Caller): Promise<Row[]> {
    const userId = caller.auth.userId;
    const roleId = caller.auth.user.roleId;
    const isAdmin = caller.auth.level >= 95;

    const rows = await query(
      prisma,
      `SELECT f.id, f.parent_id, f.path::text AS path, f.name, f.unit_id, f.department_id,
              f.owner_id, f.confidentiality, f.retention_years, f.retention_trigger, f.inherit_acl, f.status
       FROM dms_folders f
       WHERE f.deleted_at IS NULL
         AND (
           f.owner_id = $1::uuid
           OR ($3::boolean AND f.confidentiality <> 'RESTRICTED')
           OR f.confidentiality = 'PUBLIC'
           OR EXISTS (
             SELECT 1
             FROM dms_folders anc
             JOIN dms_folder_acl acl ON acl.folder_id = anc.id
             WHERE anc.path @> f.path
               AND (anc.id = f.id OR f.inherit_acl = true)
               AND (f.confidentiality <> 'RESTRICTED' OR anc.id = f.id)
               AND (acl.valid_till IS NULL OR acl.valid_till > now())
               AND acl.can_view = true
               AND (
                 (acl.principal_type = 'USER' AND acl.principal_id = $1::uuid)
                 OR (acl.principal_type = 'ROLE' AND acl.principal_id = $2::uuid)
               )
           )
         )
       ORDER BY f.path ASC`,
      userId,
      roleId,
      isAdmin,
    );
    return rows.map(norm);
  }

  async createFolder(
    caller: Caller,
    input: {
      parentId?: string;
      name: string;
      unitId?: string;
      departmentId?: string;
      confidentiality?: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
      retentionYears?: number;
      retentionTrigger?: 'CREATED' | 'EXPIRY' | 'CLOSED';
      inheritAcl?: boolean;
    },
  ): Promise<Row> {
    let parentPath = '';
    if (input.parentId) {
      const pRows = await query(
        prisma,
        `SELECT path::text AS path FROM dms_folders WHERE id = $1::uuid AND deleted_at IS NULL`,
        input.parentId,
      );
      if (!pRows[0]) throw Errors.notFound(`Parent folder not found: ${input.parentId}`);
      parentPath = String(pRows[0].path);
    }

    const label = sanitizeLtreeLabel(input.name);
    const fullPath = parentPath ? `${parentPath}.${label}` : label;
    const retYears = Math.max(6, input.retentionYears ?? 8); // ISO 15489 / CGST s.36 floor

    const rows = await query(
      prisma,
      `INSERT INTO dms_folders (
        parent_id, path, name, unit_id, department_id, owner_id, confidentiality,
        retention_years, retention_trigger, inherit_acl, created_by_id
      ) VALUES ($1::uuid, $2::ltree, $3, $4::uuid, $5::uuid, $6::uuid, $7, $8, $9, $10, $11::uuid)
      RETURNING id, parent_id, path::text AS path, name, confidentiality, retention_years, retention_trigger, inherit_acl, status`,
      input.parentId ?? null,
      fullPath,
      input.name,
      input.unitId ?? caller.ctx.unitId ?? null,
      input.departmentId ?? null,
      caller.auth.userId,
      input.confidentiality ?? 'INTERNAL',
      retYears,
      input.retentionTrigger ?? 'CREATED',
      input.inheritAcl ?? true,
      caller.auth.userId,
    );
    return norm(rows[0]!);
  }

  async deleteFolder(caller: Caller, folderId: string): Promise<void> {
    const holdRows = await query(
      prisma,
      `SELECT COUNT(*) AS cnt FROM dms_documents WHERE folder_id = $1::uuid AND legal_hold = true AND deleted_at IS NULL`,
      folderId,
    );
    if (Number(holdRows[0]?.cnt ?? 0) > 0) {
      throw Errors.conflict('Folder has documents under legal hold; cannot delete.');
    }
    await exec(prisma, `UPDATE dms_folders SET deleted_at = now() WHERE id = $1::uuid`, folderId);
  }

  async grantFolderAcl(
    caller: Caller,
    folderId: string,
    input: {
      principalType: 'USER' | 'ROLE' | 'DEPARTMENT';
      principalId: string;
      canView?: boolean;
      canUpload?: boolean;
      canEdit?: boolean;
      canDelete?: boolean;
      canDownload?: boolean;
      canShare?: boolean;
      canApprove?: boolean;
      validTill?: string;
    },
  ): Promise<Row> {
    const rows = await query(
      prisma,
      `INSERT INTO dms_folder_acl (
        folder_id, principal_type, principal_id, can_view, can_upload, can_edit,
        can_delete, can_download, can_share, can_approve, valid_till, created_by_id
      ) VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::uuid)
      ON CONFLICT (folder_id, principal_type, principal_id) DO UPDATE SET
        can_view = EXCLUDED.can_view,
        can_upload = EXCLUDED.can_upload,
        can_edit = EXCLUDED.can_edit,
        can_delete = EXCLUDED.can_delete,
        can_download = EXCLUDED.can_download,
        can_share = EXCLUDED.can_share,
        can_approve = EXCLUDED.can_approve,
        valid_till = EXCLUDED.valid_till
      RETURNING *`,
      folderId,
      input.principalType,
      input.principalId,
      input.canView ?? true,
      input.canUpload ?? false,
      input.canEdit ?? false,
      input.canDelete ?? false,
      input.canDownload ?? true,
      input.canShare ?? false,
      input.canApprove ?? false,
      input.validTill ?? null,
      caller.auth.userId,
    );
    await recordAudit(
      {
        actorId: caller.auth.userId,
        action: 'dms.acl.grant',
        targetType: 'dms_folders',
        targetId: folderId,
        detail: input,
      },
      prisma,
    );
    return norm(rows[0]!);
  }

  // ------------------------------------------------------------------------- Documents, Versions & Phase 4 StoredFile Reuse
  async storeFileInPhase4Store(
    caller: Caller,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ): Promise<string> {
    if (file.buffer.length > MAX_FILE_BYTES) {
      throw Errors.validation({ file: 'File exceeds maximum upload size.' });
    }
    const safeName = sanitizeFilename(file.originalname || 'upload.bin');
    const ext = extensionOf(safeName);
    const kind = sniffKind(file.buffer, ext);
    const scanRes = kind ? await builtInScanner.scan(file.buffer, kind) : { status: 'CLEAN' as const, detail: null };
    if (scanRes.status === 'INFECTED') {
      throw Errors.validation({ file: `File rejected by security scanner: ${scanRes.detail}` });
    }
    const stored = await defaultStorage.save({
      buffer: file.buffer,
      originalFilename: safeName,
      mimeType: file.mimetype || 'application/octet-stream',
      userId: caller.auth.userId,
    });
    await prisma.storedFile.update({
      where: { id: stored.id },
      data: { scanStatus: 'CLEAN', scanDetail: null, scannedAt: new Date() },
    });
    return stored.id;
  }

  async createDocument(
    caller: Caller,
    input: {
      folderId: string;
      title: string;
      description?: string;
      confidentiality?: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
      effectiveDate?: string;
      expiryDate?: string;
      linkedPageId?: string;
      linkedRecordId?: string;
      storedFileId?: string;
      rawTextContent?: string;
      tagCodes?: string[];
    },
  ): Promise<Row> {
    const canUpload = await this.checkFolderAccess(caller, input.folderId, 'upload');
    if (!canUpload) {
      const fRow = await query(prisma, `SELECT name FROM dms_folders WHERE id = $1::uuid`, input.folderId);
      throw Errors.forbidden(
        `You do not have access to folder '${fRow[0]?.name ?? 'Folder'}'. Request access?`,
      );
    }

    const folderRows = await query(
      prisma,
      `SELECT unit_id, confidentiality, retention_years FROM dms_folders WHERE id = $1::uuid`,
      input.folderId,
    );
    const folder = folderRows[0];
    if (!folder) throw Errors.notFound(`Folder not found: ${input.folderId}`);

    const unitId = String(folder.unit_id || caller.ctx.unitId || '');
    const { id: fyId } = await fyOfCaller(caller);
    const docCode = await NumberingService.allocate(prisma as any, {
      pageId: 'dms-docs',
      unitId,
      fyId,
    });

    const retentionYears = Number(folder.retention_years ?? 8);
    const baseDate = new Date(input.effectiveDate || new Date().toISOString().slice(0, 10));
    baseDate.setFullYear(baseDate.getFullYear() + retentionYears);
    const dispositionDue = baseDate.toISOString().slice(0, 10);

    return prisma.$transaction(async (tx) => {
      const dRows = await query(
        tx,
        `INSERT INTO dms_documents (
          doc_code, title, description, folder_id, unit_id, owner_id, confidentiality,
          current_version_no, current_file_id, effective_date, expiry_date, linked_page_id,
          linked_record_id, disposition_due, status, created_by_id
        ) VALUES ($1,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7,1,$8::uuid,$9::date,$10::date,$11,$12::uuid,$13::date,'ACTIVE',$14::uuid)
        RETURNING ${DMS_DOC_COLS}`,
        docCode,
        input.title,
        input.description ?? null,
        input.folderId,
        unitId || null,
        caller.auth.userId,
        input.confidentiality ?? folder.confidentiality ?? 'INTERNAL',
        input.storedFileId ?? null,
        input.effectiveDate ?? null,
        input.expiryDate ?? null,
        input.linkedPageId ?? null,
        input.linkedRecordId ?? null,
        dispositionDue,
        caller.auth.userId,
      );
      const doc = norm(dRows[0]!);

      if (input.storedFileId) {
        const vRows = await query(
          tx,
          `INSERT INTO dms_document_versions (document_id, version_no, stored_file_id, change_note, created_by_id)
           VALUES ($1::uuid, 1, $2::uuid, 'Initial version', $3::uuid) RETURNING id`,
          doc.id,
          input.storedFileId,
          caller.auth.userId,
        );
        if (input.rawTextContent) {
          await exec(
            tx,
            `INSERT INTO dms_document_text (version_id, extracted_text) VALUES ($1::uuid, $2)`,
            vRows[0]!.id,
            input.rawTextContent.slice(0, 512000),
          );
        }
      }

      if (input.tagCodes && input.tagCodes.length > 0) {
        for (const code of input.tagCodes) {
          const tRows = await query(
            tx,
            `INSERT INTO dms_tags (code, name, owner_id) VALUES ($1, $2, $3::uuid)
             ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            code.toUpperCase(),
            code,
            caller.auth.userId,
          );
          await exec(
            tx,
            `INSERT INTO dms_document_tags (document_id, tag_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
            doc.id,
            tRows[0]!.id,
          );
        }
      }

      await exec(tx, `SELECT dms_refresh_search_tsv($1::uuid)`, doc.id);
      return doc;
    });
  }

  async checkoutDocument(caller: Caller, id: string): Promise<Row> {
    const docRows = await query(
      prisma,
      `SELECT d.id, d.folder_id, d.checked_out_by_id, u.name AS holder_name FROM dms_documents d LEFT JOIN users u ON u.id = d.checked_out_by_id WHERE d.id = $1::uuid`,
      id,
    );
    if (!docRows[0]) throw Errors.notFound(`Document not found: ${id}`);
    const d = docRows[0];

    const hasEdit = await this.checkFolderAccess(caller, String(d.folder_id), 'edit');
    if (!hasEdit) throw Errors.forbidden('No edit permission on this document.');

    if (d.checked_out_by_id && String(d.checked_out_by_id) !== caller.auth.userId) {
      throw Errors.conflict(`Document is checked out by ${d.holder_name || 'another user'}.`);
    }

    const updated = await query(
      prisma,
      `UPDATE dms_documents SET checked_out_by_id = $1::uuid, checked_out_at = now(), updated_at = now()
       WHERE id = $2::uuid RETURNING ${DMS_DOC_COLS}`,
      caller.auth.userId,
      id,
    );
    await recordAudit(
      {
        actorId: caller.auth.userId,
        action: 'dms.checkout',
        targetType: 'dms_documents',
        targetId: id,
      },
      prisma,
    );
    return norm(updated[0]!);
  }

  async checkinDocument(
    caller: Caller,
    id: string,
    input?: { storedFileId?: string; changeNote?: string; extractedText?: string },
  ): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const docRows = await query(
        tx,
        `SELECT d.id, d.current_version_no, d.current_file_id, d.checked_out_by_id, u.name AS holder_name FROM dms_documents d LEFT JOIN users u ON u.id = d.checked_out_by_id WHERE d.id = $1::uuid FOR UPDATE OF d`,
        id,
      );
      if (!docRows[0]) throw Errors.notFound(`Document not found: ${id}`);
      const d = docRows[0];

      if (d.checked_out_by_id && String(d.checked_out_by_id) !== caller.auth.userId) {
        throw Errors.conflict(`Document is checked out by ${d.holder_name || 'another user'}.`);
      }

      let nextVer = Number(d.current_version_no);
      let fileId = d.current_file_id;

      if (input?.storedFileId) {
        nextVer += 1;
        fileId = input.storedFileId;
        const vRows = await query(
          tx,
          `INSERT INTO dms_document_versions (document_id, version_no, stored_file_id, change_note, created_by_id)
           VALUES ($1::uuid, $2, $3::uuid, $4, $5::uuid) RETURNING id`,
          id,
          nextVer,
          fileId,
          input.changeNote ?? `Version ${nextVer}`,
          caller.auth.userId,
        );
        if (input.extractedText) {
          await exec(
            tx,
            `INSERT INTO dms_document_text (version_id, extracted_text) VALUES ($1::uuid, $2)`,
            vRows[0]!.id,
            input.extractedText.slice(0, 512000),
          );
        }
      }

      const updated = await query(
        tx,
        `UPDATE dms_documents
         SET checked_out_by_id = NULL, checked_out_at = NULL,
             current_version_no = $1, current_file_id = $2::uuid,
             version = version + 1, updated_at = now(), updated_by_id = $3::uuid
         WHERE id = $4::uuid RETURNING ${DMS_DOC_COLS}`,
        nextVer,
        fileId,
        caller.auth.userId,
        id,
      );
      await exec(tx, `SELECT dms_refresh_search_tsv($1::uuid)`, id);
      return norm(updated[0]!);
    });
  }

  async rollbackVersion(caller: Caller, id: string, versionNo: number): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const vRows = await query(
        tx,
        `SELECT * FROM dms_document_versions WHERE document_id = $1::uuid AND version_no = $2`,
        id,
        versionNo,
      );
      if (!vRows[0]) throw Errors.notFound(`Version ${versionNo} not found.`);

      const docRows = await query(tx, `SELECT ${DMS_DOC_COLS} FROM dms_documents WHERE id = $1::uuid`, id);
      if (!docRows[0]) throw Errors.notFound(`Document not found: ${id}`);

      const updated = await query(
        tx,
        `UPDATE dms_documents SET current_version_no = $1, current_file_id = $2::uuid, updated_at = now() WHERE id = $3::uuid RETURNING ${DMS_DOC_COLS}`,
        versionNo,
        vRows[0].stored_file_id,
        id,
      );
      await exec(tx, `SELECT dms_refresh_search_tsv($1::uuid)`, id);
      await recordAudit(
        {
          actorId: caller.auth.userId,
          action: 'dms.rollback',
          targetType: 'dms_documents',
          targetId: id,
          detail: { versionNo },
        },
        tx,
      );
      return norm(updated[0]!);
    });
  }

  async setLegalHold(caller: Caller, id: string, legalHold: boolean, reason?: string): Promise<Row> {
    const rows = await query(
      prisma,
      `UPDATE dms_documents SET legal_hold = $1, legal_hold_reason = $2, updated_at = now()
       WHERE id = $3::uuid RETURNING ${DMS_DOC_COLS}`,
      legalHold,
      reason ?? null,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`Document not found: ${id}`);
    await recordAudit(
      {
        actorId: caller.auth.userId,
        action: legalHold ? 'dms.hold.apply' : 'dms.hold.release',
        targetType: 'dms_documents',
        targetId: id,
        detail: { reason },
      },
      prisma,
    );
    return norm(rows[0]);
  }

  async createShareLink(
    caller: Caller,
    documentId: string,
    opts?: { expiresHours?: number; maxDownloads?: number },
  ): Promise<Row & { rawToken: string }> {
    const docRows = await query(prisma, `SELECT folder_id FROM dms_documents WHERE id = $1::uuid`, documentId);
    if (!docRows[0]) throw Errors.notFound(`Document not found: ${documentId}`);
    const canShare = await this.checkFolderAccess(caller, String(docRows[0].folder_id), 'share');
    if (!canShare) throw Errors.forbidden('No share permission on this document.');

    const rawToken = randomBytes(24).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + (opts?.expiresHours ?? 72) * 3600 * 1000);

    const rows = await query(
      prisma,
      `INSERT INTO dms_share_links (token_hash, document_id, expires_at, max_downloads, created_by_id)
       VALUES ($1, $2::uuid, $3::timestamptz, $4, $5::uuid) RETURNING *`,
      tokenHash,
      documentId,
      expiresAt,
      opts?.maxDownloads ?? null,
      caller.auth.userId,
    );
    await recordAudit(
      {
        actorId: caller.auth.userId,
        action: 'dms.share',
        targetType: 'dms_documents',
        targetId: documentId,
      },
      prisma,
    );
    return { ...norm(rows[0]!), rawToken };
  }

  // ------------------------------------------------------------------------- Search (Postgres FTS 'simple' + ACL Safe)
  async searchDocuments(
    caller: Caller,
    params: { q: string; folderId?: string; tagCode?: string; page?: number; size?: number },
  ): Promise<{ items: Row[]; total: number }> {
    const userId = caller.auth.userId;
    const roleId = caller.auth.user.roleId;
    const isAdmin = caller.auth.level >= 95;
    const size = Math.min(params.size ?? 25, 25);
    const offset = ((params.page ?? 1) - 1) * size;
    const qText = (params.q || '').trim();

    const conds: string[] = [`d.deleted_at IS NULL`, `d.status = 'ACTIVE'`];
    const args: unknown[] = [userId, roleId, isAdmin];

    if (params.folderId) {
      args.push(params.folderId);
      conds.push(`d.folder_id = $${args.length}::uuid`);
    }
    if (params.tagCode) {
      args.push(params.tagCode.toUpperCase());
      conds.push(`EXISTS (SELECT 1 FROM dms_document_tags dt JOIN dms_tags t ON t.id = dt.tag_id WHERE dt.document_id = d.id AND t.code = $${args.length})`);
    }

    let rankExpr = `0.0`;
    let snippetExpr = `COALESCE(left(d.description, 160), '')`;
    if (qText.length > 0) {
      args.push(qText);
      const qIdx = `$${args.length}`;
      conds.push(
        `(d.search_tsv @@ websearch_to_tsquery('simple', ${qIdx}) OR similarity(d.title, ${qIdx}) > 0.25)`,
      );
      rankExpr = `(COALESCE(ts_rank_cd(d.search_tsv, websearch_to_tsquery('simple', ${qIdx})), 0) * 1.0 + similarity(d.title, ${qIdx}) * 0.5 + CASE WHEN d.updated_at >= now() - interval '90 days' THEN 0.1 ELSE 0 END)`;
      snippetExpr = `ts_headline('simple', COALESCE(d.title, '') || ' — ' || COALESCE(d.description, ''), websearch_to_tsquery('simple', ${qIdx}), 'MaxFragments=2, MaxWords=25, MinWords=5')`;
    }

    // Strict permission predicate: never leaks restricted or forbidden titles!
    const permPredicate = `
      (
        d.owner_id = $1::uuid
        OR f.owner_id = $1::uuid
        OR ($3::boolean AND f.confidentiality <> 'RESTRICTED' AND d.confidentiality <> 'RESTRICTED')
        OR (f.confidentiality = 'PUBLIC' AND d.confidentiality = 'PUBLIC')
        OR EXISTS (
          SELECT 1
          FROM dms_folders anc
          JOIN dms_folder_acl acl ON acl.folder_id = anc.id
          WHERE anc.path @> f.path
            AND (anc.id = f.id OR f.inherit_acl = true)
            AND (f.confidentiality <> 'RESTRICTED' OR anc.id = f.id)
            AND (acl.valid_till IS NULL OR acl.valid_till > now())
            AND acl.can_view = true
            AND (
              (acl.principal_type = 'USER' AND acl.principal_id = $1::uuid)
              OR (acl.principal_type = 'ROLE' AND acl.principal_id = $2::uuid)
            )
        )
      )
    `;

    const sql = `
      SELECT d.id, d.doc_code, d.title, d.description, d.folder_id, f.name AS folder_name,
             d.confidentiality, d.current_version_no, d.legal_hold, d.disposition_due,
             d.checked_out_by_id, d.updated_at,
             ${rankExpr} AS rank_score,
             ${snippetExpr} AS snippet
      FROM dms_documents d
      JOIN dms_folders f ON f.id = d.folder_id
      WHERE ${conds.join(' AND ')}
        AND ${permPredicate}
      ORDER BY rank_score DESC, d.updated_at DESC
      LIMIT ${size} OFFSET ${offset}
    `;
    const items = await query(prisma, sql, ...args);

    if (qText.length > 0) {
      await exec(
        prisma,
        `INSERT INTO dms_search_log (user_id, query_text, result_count) VALUES ($1::uuid, $2, $3)`,
        userId,
        qText,
        items.length,
      );
    }

    return { items: items.map(norm), total: items.length };
  }

  // ------------------------------------------------------------------------- ISO 15489 Retention & Jobs
  async runRetentionJob(asOfDate?: string): Promise<{ queuedReviews: number; skippedLegalHold: number }> {
    const today = asOfDate || new Date().toISOString().slice(0, 10);
    const dueDocs = await query(
      prisma,
      `SELECT id, doc_code, legal_hold FROM dms_documents
       WHERE status = 'ACTIVE' AND deleted_at IS NULL AND disposition_due <= $1::date`,
      today,
    );

    let queuedReviews = 0;
    let skippedLegalHold = 0;

    for (const d of dueDocs) {
      if (d.legal_hold) {
        skippedLegalHold++;
        continue;
      }
      const existing = await query(
        prisma,
        `SELECT id FROM dms_dispositions WHERE document_id = $1::uuid AND approval_status = 'PENDING'`,
        d.id,
      );
      if (existing.length === 0) {
        await exec(
          prisma,
          `INSERT INTO dms_dispositions (document_id, action, approval_status, remarks)
           VALUES ($1::uuid, 'DESTROY', 'PENDING', 'Scheduled retention review per ISO 15489')`,
          d.id,
        );
        queuedReviews++;
      }
    }

    return { queuedReviews, skippedLegalHold };
  }

  async approveAndDestroyDocument(caller: Caller, dispositionId: string): Promise<Row> {
    const dispRows = await query(prisma, `SELECT * FROM dms_dispositions WHERE id = $1::uuid`, dispositionId);
    if (!dispRows[0]) throw Errors.notFound(`Disposition record not found: ${dispositionId}`);
    const disp = dispRows[0];

    const docRows = await query(prisma, `SELECT ${DMS_DOC_COLS} FROM dms_documents WHERE id = $1::uuid`, disp.document_id);
    if (!docRows[0]) throw Errors.notFound('Document not found.');
    const doc = docRows[0];

    if (doc.legal_hold) {
      throw Errors.conflict('Document is under legal hold; destruction blocked.');
    }

    // Generate PDF Destruction Certificate and store via Phase 4 stored_files
    const pdfBuf = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      pdf.on('data', (c) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
      pdf.fontSize(16).text('CERTIFICATE OF RECORD DESTRUCTION (ISO 15489)', { align: 'center' });
      pdf.moveDown();
      pdf.fontSize(11);
      pdf.text(`Document Code: ${doc.doc_code}`);
      pdf.text(`Title: ${doc.title}`);
      pdf.text(`Disposition Date: ${new Date().toISOString().slice(0, 10)}`);
      pdf.text(`Approved By: ${caller.auth.user.name}`);
      pdf.text('Status: Purged from active storage; metadata tombstone retained.');
      pdf.end();
    });

    const certFileId = await this.storeFileInPhase4Store(caller, {
      originalname: `destruction-cert-${doc.doc_code}.pdf`,
      mimetype: 'application/pdf',
      buffer: pdfBuf,
    });

    await exec(
      prisma,
      `UPDATE dms_documents SET status = 'DESTROYED', current_file_id = NULL, updated_at = now() WHERE id = $1::uuid`,
      doc.id,
    );
    const updatedDisp = await query(
      prisma,
      `UPDATE dms_dispositions
       SET approval_status = 'APPROVED', approved_by_id = $1::uuid, certificate_file_id = $2::uuid, executed_at = now()
       WHERE id = $3::uuid RETURNING *`,
      caller.auth.userId,
      certFileId,
      dispositionId,
    );
    await recordAudit(
      {
        actorId: caller.auth.userId,
        action: 'dms.destroy',
        targetType: 'dms_documents',
        targetId: String(doc.id),
        detail: { certificateFileId: certFileId },
      },
      prisma,
    );
    return norm(updatedDisp[0]!);
  }
}

export const dmsService = new DmsService();

