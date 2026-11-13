// Phase 26: project spine. Stage gates (approved through ApprovalService, no automatic movement - R-31), specs, tests,
// documents, the project history feed, the 360 order view, process exceptions and sales enquiries.
import { recordAudit } from '../../core/audit/audit-service';
import { NumberingService } from '../../core/numbering/numbering-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { approvalService } from '../approvals/service';
import { notificationService } from '../notifications/service';
import { quotationCrud } from '../sales/docs-service';
import { usersOf } from '../work/service';
import { EXCEPTION_CHECKS, gateMessage, gateMissing, gatesToOpen, progressPct, readinessPct, testResult } from './calc';
import type { GateFacts } from './calc';

export const GATE_DOC_TYPE = 'proj-stage-gates';
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const S = (v: unknown): string => String(v ?? '');
const N = (v: unknown): number => Number(v ?? 0);

// ------------------------------------------------------------------------------------------ events
export async function recordEvent(
  tx: Tx | typeof prisma,
  e: { projectId: string; unitId?: string | null; departmentId?: string | null; actorId?: string | null; kind: string; docType?: string | null; docId?: string | null; docNo?: string | null; text?: string | null; sourceEventId?: string | null },
): Promise<void> {
  await query(
    tx,
    `INSERT INTO project_events (project_id, unit_id, department_id, actor_id, kind, doc_type, doc_id, doc_no, text, source_event_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid,$8,$9,$10) ON CONFLICT (source_event_id) DO NOTHING`,
    e.projectId, e.unitId ?? null, e.departmentId ?? null, e.actorId ?? null, e.kind, e.docType ?? null, e.docId ?? null, e.docNo ?? null, e.text ?? null, e.sourceEventId ?? null,
  );
}

async function projectOf(db: Tx | typeof prisma, id: string): Promise<Row> {
  const r = (await query(db, `SELECT id, code, name, unit_id, created_by_id, gate_template_id FROM projects WHERE id = $1::uuid`, id))[0];
  if (!r) throw Errors.notFound('Project not found.');
  return r;
}

function assertPlant(caller: Caller, unitId: unknown): void {
  if (!caller.ctx.unitIds.includes(S(unitId))) throw Errors.notFound('Project not found.');
}

// ------------------------------------------------------------------------------------------ gates
const gateSql = `SELECT g.*, d.name AS owner_department FROM project_gates g LEFT JOIN departments d ON d.id = g.owner_department_id`;

async function gateFacts(db: Tx | typeof prisma, g: Row, all: Row[]): Promise<GateFacts> {
  const docType = g.deliverable_doc_type ? S(g.deliverable_doc_type) : null;
  const approvedDoc = docType
    ? Number((await query(db, `SELECT count(*)::int AS n FROM project_documents WHERE project_id = $1::uuid AND doc_type = $2 AND status = 'Approved' AND (gate_id = $3::uuid OR gate_id IS NULL)`, g.project_id, docType, g.id))[0]?.n ?? 0) > 0
    : true;
  const tests = (await query(db, `SELECT count(*)::int AS total, count(*) FILTER (WHERE result IS DISTINCT FROM 'OK')::int AS bad FROM project_tests WHERE gate_id = $1::uuid`, g.id))[0]!;
  const deps = (g.depends_on as string[] | null) ?? [];
  const blocked = deps.filter((c) => all.find((x) => S(x.code) === c)?.state !== 'APPROVED');
  return { code: S(g.code), deliverableDocType: docType, deliverableApproved: approvedDoc, testsTotal: N(tests.total), testsNotPassed: N(tests.bad), blockedBy: blocked };
}

async function notifyGate(tx: Tx, g: Row, unitId: string, title: string, body: string): Promise<void> {
  if (!g.owner_department_id) return;
  const who = (await usersOf(tx, S(g.owner_department_id), unitId)).map((u) => u.id);
  if (who.length === 0) return;
  await notificationService.notify(tx, who, { type: 'project.gate_opened', title, body, link: '/m/proj-stage-gates', entityType: 'project_gate', entityId: S(g.id), dedupeKey: `gate:${S(g.id)}:open` });
}

/** The approval engine asks this handler for the state of a gate (registered once, at import). */
approvalService.register(GATE_DOC_TYPE, {
  async snapshot(tx, docId) {
    const r = (await query(
      tx,
      `SELECT g.id, g.code, g.name, g.state, p.code AS pcode, p.unit_id, p.created_by_id, coalesce(d.name, 'Projects') AS dept
         FROM project_gates g JOIN projects p ON p.id = g.project_id LEFT JOIN departments d ON d.id = g.owner_department_id
        WHERE g.id = $1::uuid FOR UPDATE OF g`,
      docId,
    ))[0];
    if (!r) return null;
    const status = r.state === 'SUBMITTED' ? 'Pending Approval' : r.state === 'APPROVED' ? 'Approved' : 'Draft';
    return { code: `${S(r.pcode)}/${S(r.code)}`, title: S(r.name), amount: null, department: S(r.dept), unitId: S(r.unit_id), createdBy: S(r.created_by_id), status, version: 1, fyOpen: true };
  },
  async onSubmitted(tx, docId, req) {
    await query(tx, `UPDATE project_gates SET state = 'SUBMITTED', approval_request_id = $2::uuid, submitted_at = now(), reject_comment = NULL WHERE id = $1::uuid`, docId, req.id);
  },
  async onApproved(tx, docId, req) {
    const g = (await query(tx, `${gateSql} WHERE g.id = $1::uuid`, docId))[0]!;
    await query(tx, `UPDATE project_gates SET state = 'APPROVED', approved_at = now(), late = false WHERE id = $1::uuid`, docId);
    const p = await projectOf(tx, S(g.project_id));
    const all = await query(tx, `${gateSql} WHERE g.project_id = $1::uuid ORDER BY g.seq`, g.project_id);
    await recordEvent(tx, { projectId: S(g.project_id), unitId: S(p.unit_id), departmentId: S(g.owner_department_id) || null, actorId: req.actorId, kind: 'GATE_APPROVED', docType: GATE_DOC_TYPE, docId, docNo: `${S(p.code)}/${S(g.code)}`, text: `Gate ${S(g.code)} ${S(g.name)} approved`, sourceEventId: `gate:${docId}:approved` });
    const open = gatesToOpen(all.map((x) => ({ code: S(x.code), state: S(x.state), dependsOn: (x.depends_on as string[]) ?? [] })), S(g.code));
    for (const code of open) {
      const n = all.find((x) => S(x.code) === code)!;
      await query(tx, `UPDATE project_gates SET state = 'OPEN', opened_at = now() WHERE id = $1::uuid AND state = 'LOCKED'`, n.id);
      await recordEvent(tx, { projectId: S(g.project_id), unitId: S(p.unit_id), departmentId: S(n.owner_department_id) || null, actorId: req.actorId, kind: 'GATE_OPENED', docType: GATE_DOC_TYPE, docId: S(n.id), docNo: `${S(p.code)}/${code}`, text: `Gate ${code} ${S(n.name)} is open`, sourceEventId: `gate:${S(n.id)}:opened` });
      await notifyGate(tx, n, S(p.unit_id), `Gate ${code} is open`, `${S(p.code)}: ${S(n.name)} can start. Deliverable: ${S(n.deliverable_name)}.`);
    }
  },
  async onRejected(tx, docId, req) {
    const c = (await query(tx, `SELECT comment FROM approval_actions WHERE request_id = $1::uuid AND action = 'REJECT' ORDER BY at DESC LIMIT 1`, req.id))[0];
    await query(tx, `UPDATE project_gates SET state = 'IN_WORK', reject_comment = $2 WHERE id = $1::uuid`, docId, c?.comment ?? null);
  },
  async onReturned(tx, docId) {
    await query(tx, `UPDATE project_gates SET state = 'IN_WORK' WHERE id = $1::uuid`, docId);
  },
});

// ------------------------------------------------------------------------------------------ service
export const spineService = {
  // ---------------------------------------------------------------- gate templates / gates
  async templates() {
    return query(prisma, `SELECT t.id, t.code, t.name, (SELECT count(*)::int FROM gate_template_steps s WHERE s.template_id = t.id) AS steps FROM gate_templates t WHERE t.active ORDER BY t.code`);
  },

  /** Create the gates of a project from a template (BLDC / SPPM / CUSTOM). G01-type gates (no dependency) start OPEN. */
  async applyTemplate(caller: Caller, projectId: string, templateCode: string): Promise<Row[]> {
    const p = await projectOf(prisma, projectId);
    assertPlant(caller, p.unit_id);
    return prisma.$transaction(async (tx) => {
      const existing = Number((await query(tx, `SELECT count(*)::int AS n FROM project_gates WHERE project_id = $1::uuid`, projectId))[0]!.n);
      if (existing > 0) throw Errors.conflict('This project already has gates.');
      const t = (await query(tx, `SELECT id FROM gate_templates WHERE code = $1 AND active`, templateCode))[0];
      if (!t) throw Errors.validation({ template: 'Choose BLDC, SPPM or CUSTOM. CUSTOM has no steps until you add them.' });
      const steps = await query(tx, `SELECT * FROM gate_template_steps WHERE template_id = $1::uuid ORDER BY seq`, t.id);
      for (const s of steps) {
        const root = ((s.depends_on as string[]) ?? []).length === 0;
        await query(
          tx,
          `INSERT INTO project_gates (project_id, step_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, depends_on, state, opened_at)
           VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7,$8,$9,$10::text[],$11,$12)`,
          projectId, s.id, s.seq, s.code, s.name, s.owner_department_id, s.deliverable_name, s.deliverable_doc_type, s.exit_criteria, s.depends_on, root ? 'OPEN' : 'LOCKED', root ? new Date() : null,
        );
      }
      await query(tx, `UPDATE projects SET gate_template_id = $2::uuid WHERE id = $1::uuid`, projectId, t.id);
      await recordAudit({ action: 'project.gates_created', actorId: caller.auth.user.id, targetType: 'project', targetId: projectId, detail: { template: templateCode, gates: steps.length } }, tx);
      return query(tx, `${gateSql} WHERE g.project_id = $1::uuid ORDER BY g.seq`, projectId);
    });
  },

  async gates(caller: Caller, projectId: string): Promise<Row[]> {
    const p = await projectOf(prisma, projectId);
    assertPlant(caller, p.unit_id);
    const all = await query(prisma, `${gateSql} WHERE g.project_id = $1::uuid ORDER BY g.seq`, projectId);
    const out: Row[] = [];
    for (const g of all) {
      const facts = await gateFacts(prisma, g, all);
      out.push({ ...g, readinessPct: readinessPct(facts), missing: gateMissing(facts) });
    }
    return out;
  },

  async setGateDue(caller: Caller, projectId: string, gateId: string, dueDate: string | null): Promise<Row> {
    const p = await projectOf(prisma, projectId);
    assertPlant(caller, p.unit_id);
    const r = await query(prisma, `UPDATE project_gates SET due_date = $3::date WHERE id = $2::uuid AND project_id = $1::uuid RETURNING *`, projectId, gateId, dueDate);
    if (!r[0]) throw Errors.notFound('Gate not found.');
    return r[0];
  },

  /** Start work on an OPEN gate. */
  async startGate(caller: Caller, projectId: string, gateId: string): Promise<Row> {
    const p = await projectOf(prisma, projectId);
    assertPlant(caller, p.unit_id);
    const r = await query(prisma, `UPDATE project_gates SET state = 'IN_WORK' WHERE id = $2::uuid AND project_id = $1::uuid AND state = 'OPEN' RETURNING *`, projectId, gateId);
    if (!r[0]) throw Errors.conflict('Only an open gate can be started.');
    return r[0];
  },

  /** Submit: the readiness checklist must be green, then the approval engine takes over. */
  async submitGate(caller: Caller, projectId: string, gateId: string): Promise<{ gate: Row; approval: unknown }> {
    const p = await projectOf(prisma, projectId);
    assertPlant(caller, p.unit_id);
    const all = await query(prisma, `${gateSql} WHERE g.project_id = $1::uuid ORDER BY g.seq`, projectId);
    const g = all.find((x) => S(x.id) === gateId);
    if (!g) throw Errors.notFound('Gate not found.');
    if (!['OPEN', 'IN_WORK'].includes(S(g.state))) throw Errors.conflict(S(g.state) === 'LOCKED' ? `Gate ${S(g.code)} is locked until its earlier gates are approved.` : `Gate ${S(g.code)} is ${S(g.state).toLowerCase()}.`);
    const facts = await gateFacts(prisma, g, all);
    const missing = gateMissing(facts);
    if (missing.length > 0) throw Errors.validation({ gate: gateMessage(S(g.code), missing) });
    const approval = await approvalService.submit({ auth: caller.auth, meta: caller.meta }, GATE_DOC_TYPE, gateId);
    await recordEvent(prisma, { projectId, unitId: S(p.unit_id), departmentId: S(g.owner_department_id) || null, actorId: caller.auth.user.id, kind: 'SUBMITTED', docType: GATE_DOC_TYPE, docId: gateId, docNo: `${S(p.code)}/${S(g.code)}`, text: `Gate ${S(g.code)} submitted for approval`, sourceEventId: `gate:${gateId}:submitted:${S((approval as { id?: string }).id)}` });
    const fresh = (await query(prisma, `${gateSql} WHERE g.id = $1::uuid`, gateId))[0]!;
    return { gate: fresh, approval };
  },

  // ---------------------------------------------------------------- specs / tests / documents
  async listSpecs(caller: Caller, projectId: string): Promise<Row[]> {
    assertPlant(caller, (await projectOf(prisma, projectId)).unit_id);
    return query(prisma, `SELECT * FROM project_specs WHERE project_id = $1::uuid ORDER BY spec_no, revision DESC`, projectId);
  },
  async addSpec(caller: Caller, projectId: string, b: { parameter: string; target?: number | null; tolMinus?: number | null; tolPlus?: number | null; unit?: string | null; specNo?: string }): Promise<Row> {
    assertPlant(caller, (await projectOf(prisma, projectId)).unit_id);
    const next = Number((await query(prisma, `SELECT count(DISTINCT spec_no)::int + 1 AS n FROM project_specs WHERE project_id = $1::uuid`, projectId))[0]!.n);
    const no = b.specNo?.trim() || `SPEC-${String(next).padStart(3, '0')}`;
    const r = await query(
      prisma,
      `INSERT INTO project_specs (project_id, spec_no, parameter, target, tol_minus, tol_plus, unit, created_by_id) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::uuid) RETURNING *`,
      projectId, no, b.parameter, b.target ?? null, b.tolMinus ?? null, b.tolPlus ?? null, b.unit ?? null, caller.auth.user.id,
    ).catch((e: { code?: string }) => {
      if (e?.code === 'P2010') throw Errors.conflict('This specification number and revision already exist.');
      throw e;
    });
    return r[0]!;
  },
  async approveSpec(caller: Caller, projectId: string, specId: string): Promise<Row> {
    assertPlant(caller, (await projectOf(prisma, projectId)).unit_id);
    const r = await query(prisma, `UPDATE project_specs SET status = 'Approved' WHERE id = $2::uuid AND project_id = $1::uuid AND status = 'Draft' RETURNING *`, projectId, specId);
    if (!r[0]) throw Errors.conflict('Only a draft specification can be approved.');
    return r[0];
  },
  /** A new revision supersedes the old one; the old row stays for the dossier. */
  async reviseSpec(caller: Caller, projectId: string, specId: string, b: { target?: number | null; tolMinus?: number | null; tolPlus?: number | null }): Promise<Row> {
    assertPlant(caller, (await projectOf(prisma, projectId)).unit_id);
    return prisma.$transaction(async (tx) => {
      const o = (await query(tx, `SELECT * FROM project_specs WHERE id = $2::uuid AND project_id = $1::uuid FOR UPDATE`, projectId, specId))[0];
      if (!o) throw Errors.notFound('Specification not found.');
      await query(tx, `UPDATE project_specs SET status = 'Superseded' WHERE id = $1::uuid`, specId);
      const r = await query(
        tx,
        `INSERT INTO project_specs (project_id, spec_no, parameter, target, tol_minus, tol_plus, unit, revision, created_by_id) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9::uuid) RETURNING *`,
        projectId, o.spec_no, o.parameter, b.target ?? o.target, b.tolMinus ?? o.tol_minus, b.tolPlus ?? o.tol_plus, o.unit, N(o.revision) + 1, caller.auth.user.id,
      );
      return r[0]!;
    });
  },

  async listTests(caller: Caller, projectId: string): Promise<Row[]> {
    assertPlant(caller, (await projectOf(prisma, projectId)).unit_id);
    return query(prisma, `SELECT t.*, s.spec_no, s.parameter, s.target, g.code AS gate_code FROM project_tests t LEFT JOIN project_specs s ON s.id = t.spec_id LEFT JOIN project_gates g ON g.id = t.gate_id WHERE t.project_id = $1::uuid ORDER BY t.created_at`, projectId);
  },
  async addTest(caller: Caller, projectId: string, b: { testName: string; gateId?: string | null; method?: string | null; specId?: string | null; sample?: string | null; value?: number | null; result?: 'OK' | 'NG' | null }): Promise<Row> {
    assertPlant(caller, (await projectOf(prisma, projectId)).unit_id);
    let result: 'OK' | 'NG' | null = b.result ?? null;
    if (b.specId && b.value !== null && b.value !== undefined) {
      const s = (await query(prisma, `SELECT target, tol_minus, tol_plus FROM project_specs WHERE id = $1::uuid AND project_id = $2::uuid`, b.specId, projectId))[0];
      if (!s) throw Errors.validation({ specId: 'Choose a specification of this project.' });
      result = testResult(b.value, { target: s.target === null ? null : N(s.target), tolMinus: s.tol_minus === null ? null : N(s.tol_minus), tolPlus: s.tol_plus === null ? null : N(s.tol_plus) }) ?? result;
    }
    const tested = result !== null;
    const r = await query(
      prisma,
      `INSERT INTO project_tests (project_id, gate_id, test_name, method, spec_id, sample, value, result, tested_by_id, tested_at)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7,$8,$9::uuid,$10) RETURNING *`,
      projectId, b.gateId ?? null, b.testName, b.method ?? null, b.specId ?? null, b.sample ?? null, b.value ?? null, result, tested ? caller.auth.user.id : null, tested ? new Date() : null,
    );
    return r[0]!;
  },

  async listDocuments(caller: Caller, projectId: string): Promise<Row[]> {
    assertPlant(caller, (await projectOf(prisma, projectId)).unit_id);
    return query(prisma, `SELECT d.*, g.code AS gate_code FROM project_documents d LEFT JOIN project_gates g ON g.id = d.gate_id WHERE d.project_id = $1::uuid ORDER BY d.created_at`, projectId);
  },
  async addDocument(caller: Caller, projectId: string, b: { docType: string; title: string; gateId?: string | null; documentId?: string | null }): Promise<Row> {
    assertPlant(caller, (await projectOf(prisma, projectId)).unit_id);
    const rev = Number((await query(prisma, `SELECT coalesce(max(revision), 0)::int + 1 AS n FROM project_documents WHERE project_id = $1::uuid AND doc_type = $2 AND title = $3`, projectId, b.docType, b.title))[0]!.n);
    return prisma.$transaction(async (tx) => {
      if (rev > 1) await query(tx, `UPDATE project_documents SET status = 'Superseded' WHERE project_id = $1::uuid AND doc_type = $2 AND title = $3 AND status <> 'Superseded'`, projectId, b.docType, b.title);
      const r = await query(tx, `INSERT INTO project_documents (project_id, gate_id, doc_type, title, revision, document_id, created_by_id) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7::uuid) RETURNING *`, projectId, b.gateId ?? null, b.docType, b.title, rev, b.documentId ?? null, caller.auth.user.id);
      return r[0]!;
    });
  },
  async approveDocument(caller: Caller, projectId: string, docId: string): Promise<Row> {
    assertPlant(caller, (await projectOf(prisma, projectId)).unit_id);
    const r = await query(prisma, `UPDATE project_documents SET status = 'Approved' WHERE id = $2::uuid AND project_id = $1::uuid AND status = 'Draft' RETURNING *`, projectId, docId);
    if (!r[0]) throw Errors.conflict('Only a draft document can be approved.');
    return r[0];
  },

  // ---------------------------------------------------------------- history
  async history(caller: Caller, projectId: string, f: { kind?: string; dept?: string; unit?: string; cursor?: string; limit?: number }): Promise<{ rows: Row[]; next: string | null }> {
    await projectOf(prisma, projectId);
    const limit = Math.min(200, Math.max(1, f.limit ?? 50));
    const allowed = caller.ctx.unitIds;
    // project_events plus the Phase 25 movement events of movements tagged with this project (read, never copied: idempotent by design)
    const rows = await query(
      prisma,
      `SELECT * FROM (
         SELECT e.id::text AS id, e.at, e.unit_id::text AS unit_id, e.department_id::text AS department_id, e.actor_id::text AS actor_id, e.kind, e.doc_type, e.doc_id::text AS doc_id, e.doc_no, e.text
           FROM project_events e WHERE e.project_id = $1::uuid
         UNION ALL
         SELECT me.id::text, me.at, m.unit_id::text, me.department_id::text, me.actor_id::text,
                CASE me.event WHEN 'SENT' THEN 'MOVED' WHEN 'RECEIVED' THEN 'RECEIVED' WHEN 'ACCEPTED' THEN 'ACCEPTED' WHEN 'RETURNED' THEN 'RETURNED' ELSE 'NOTE' END,
                me.doc_type, me.doc_id::text, m.doc_no, coalesce(me.note, me.event)
           FROM movement_events me JOIN work_movements m ON m.id = me.movement_id WHERE m.project_id = $1::uuid
       ) x
       WHERE ($2::text IS NULL OR x.kind = $2) AND ($3::text IS NULL OR x.department_id = $3::text) AND ($4::text IS NULL OR x.unit_id = $4::text)
         AND ($5::timestamptz IS NULL OR x.at < $5::timestamptz)
       ORDER BY x.at DESC LIMIT $6`,
      projectId, f.kind ?? null, f.dept ?? null, f.unit ?? null, f.cursor ?? null, limit + 1,
    );
    const page = rows.slice(0, limit);
    const names = new Map<string, string>();
    const ids = [...new Set(page.flatMap((r) => [r.department_id, r.actor_id].filter(Boolean).map(S)))];
    if (ids.length > 0) {
      for (const r of await query(prisma, `SELECT id::text AS id, name FROM departments WHERE id::text = ANY($1::text[]) UNION ALL SELECT id::text, name FROM users WHERE id::text = ANY($1::text[])`, ids)) names.set(S(r.id), S(r.name));
    }
    const out = page.map((r) => {
      if (r.unit_id && !allowed.includes(S(r.unit_id))) {
        return { id: r.id, at: r.at, kind: null, masked: true, text: 'Event in another plant.' };
      }
      return { ...r, department: names.get(S(r.department_id)) ?? null, actor: names.get(S(r.actor_id)) ?? null, masked: false };
    });
    return { rows: out, next: rows.length > limit ? new Date(S(page[page.length - 1]!.at)).toISOString() : null };
  },

  async options(caller: Caller, q: string): Promise<Row[]> {
    return query(prisma, `SELECT id, code, name, status FROM projects WHERE unit_id = ANY($1::uuid[]) AND ($2 = '' OR code ILIKE $3 OR name ILIKE $3) ORDER BY code LIMIT 20`, caller.ctx.unitIds, q, `%${q}%`);
  },

  // ---------------------------------------------------------------- 360
  async order360(caller: Caller, soId: string): Promise<Record<string, unknown>> {
    const so = (await query(prisma, `SELECT so.*, c.name AS customer_name, p.code AS project_code, p.name AS project_name, u.code AS unit_code
        FROM sales_orders so JOIN customers c ON c.id = so.customer_id LEFT JOIN projects p ON p.id = so.project_id JOIN units u ON u.id = so.unit_id
       WHERE so.id = $1::uuid AND so.deleted_at IS NULL`, soId))[0];
    if (!so || !caller.ctx.unitIds.includes(S(so.unit_id))) throw Errors.notFound('Order not found.');
    const lines = await query(prisma, `SELECT l.id, l.line_no, l.item_id, i.name AS item, l.qty, l.dispatched_qty, l.invoiced_qty FROM sales_order_lines l LEFT JOIN items i ON i.id = l.item_id WHERE l.order_id = $1::uuid ORDER BY l.line_no`, soId);
    const lineIds = lines.map((l) => S(l.id));
    const mos = lineIds.length ? await query(prisma, `SELECT m.id, m.number, m.status, m.qty, m.qty_completed, m.qty_received, m.so_line_id FROM mfg_orders m WHERE m.so_line_id = ANY($1::uuid[]) AND m.deleted_at IS NULL`, lineIds) : [];
    const moIds = mos.map((m) => S(m.id));
    const mats = moIds.length ? (await query(prisma, `SELECT coalesce(sum(required_qty),0) AS req, coalesce(sum(LEAST(issued_qty, required_qty)),0) AS iss FROM mfg_order_materials WHERE order_id = ANY($1::uuid[])`, moIds))[0]! : { req: 0, iss: 0 };
    const insp = moIds.length ? await query(prisma, `SELECT number, kind, status, result FROM qms_inspections WHERE source_id = ANY($1::uuid[]) AND deleted_at IS NULL`, moIds) : [];
    const quote = so.quotation_id ? (await query(prisma, `SELECT id, number, status FROM sales_quotations WHERE id = $1::uuid`, so.quotation_id))[0] : null;
    const enq = quote ? (await query(prisma, `SELECT id, number, status FROM sales_enquiries WHERE quotation_id = $1::uuid`, quote.id))[0] : null;
    const prs = so.project_id ? await query(prisma, `SELECT id, number, status FROM purchase_requisitions WHERE project_id = $1::uuid AND deleted_at IS NULL`, so.project_id) : [];
    const pos = so.project_id ? await query(prisma, `SELECT id, number, status FROM purchase_orders WHERE project_id = $1::uuid AND deleted_at IS NULL`, so.project_id) : [];
    const grns = so.project_id ? await query(prisma, `SELECT id, number, status, qc_status FROM goods_receipts WHERE project_id = $1::uuid AND deleted_at IS NULL`, so.project_id) : [];
    const dcs = await query(prisma, `SELECT id, number, status FROM sales_dispatches WHERE order_id = $1::uuid AND deleted_at IS NULL`, soId);
    const invs = await query(prisma, `SELECT id, number, status, grand_total, received_amount FROM sales_invoices WHERE order_id = $1::uuid AND deleted_at IS NULL AND status <> 'Cancelled'`, soId);
    const holders = await query(prisma, `SELECT m.doc_type, m.doc_no, m.state, d.name AS department, m.sent_at FROM work_movements m JOIN departments d ON d.id = m.to_department_id WHERE m.doc_id = $1::uuid AND m.state IN ('SENT','RECEIVED','ACCEPTED','IN_WORK')`, soId);
    const ordered = lines.reduce((a, l) => a + N(l.qty), 0);
    const dispatched = lines.reduce((a, l) => a + N(l.dispatched_qty), 0);
    const billed = lines.reduce((a, l) => a + N(l.invoiced_qty), 0);
    const goodQty = mos.reduce((a, m) => a + N(m.qty_completed), 0);
    const moQty = mos.reduce((a, m) => a + N(m.qty), 0);
    const invTotal = invs.reduce((a, i) => a + N(i.grand_total), 0);
    const invReceived = invs.reduce((a, i) => a + N(i.received_amount), 0);
    const confirmed = ['Approved', 'Closed', 'Partially Dispatched', 'Dispatched', 'Completed'].includes(S(so.status));
    const parts = {
      order: confirmed ? 1 : 0,
      material: N(mats.req) > 0 ? N(mats.iss) / N(mats.req) : 0,
      production: moQty > 0 ? goodQty / moQty : 0,
      quality: insp.length > 0 ? insp.filter((i) => S(i.status) !== 'Draft' && S(i.result) === 'Pass').length / insp.length : 0,
      dispatch: ordered > 0 ? dispatched / ordered : 0,
      billing: ordered > 0 ? billed / ordered : 0,
      collection: invTotal > 0 ? invReceived / invTotal : 0,
    };
    const stage = (key: string, label: string, docs: Row[], done: number, total: number | null) => ({
      key, label, docs: docs.map((d) => ({ id: d.id, number: d.number ?? d.doc_no, status: d.status ?? d.state })),
      done, total, state: docs.length === 0 && done === 0 ? 'NOT_STARTED' : total !== null && total > 0 && done >= total ? 'DONE' : 'ACTIVE',
      heldBy: holders.filter((h) => key === 'so' ? S(h.doc_type) !== '' : false).map((h) => ({ department: h.department, since: h.sent_at })),
    });
    const stages = [
      stage('enquiry', 'Enquiry', enq ? [enq] : [], enq ? 1 : 0, enq ? 1 : null),
      stage('quotation', 'Quotation', quote ? [quote] : [], quote ? 1 : 0, quote ? 1 : null),
      stage('so', 'Sales Order', [{ id: so.id, number: so.number, status: so.status }], confirmed ? 1 : 0, 1),
      stage('project', 'Project', so.project_code ? [{ id: so.project_id, number: so.project_code, status: so.project_name }] : [], so.project_code ? 1 : 0, so.project_code ? 1 : null),
      stage('material', 'Material issued', [], N(mats.iss), N(mats.req) || null),
      stage('pr', 'Purchase requisition', prs, prs.length, null),
      stage('po', 'Purchase order', pos, pos.length, null),
      stage('grn', 'Goods receipt', grns, grns.length, null),
      stage('mo', 'Production', mos, goodQty, moQty || null),
      stage('quality', 'Quality', insp, insp.filter((i) => S(i.result) === 'Pass').length, insp.length || null),
      stage('dc', 'Dispatch', dcs, dispatched, ordered || null),
      stage('invoice', 'Invoice', invs, billed, ordered || null),
      stage('collection', 'Collection', [], invReceived, invTotal || null),
    ];
    const lineRows = lines.map((l) => ({ lineNo: l.line_no, item: l.item, ordered: N(l.qty), dispatched: N(l.dispatched_qty), invoiced: N(l.invoiced_qty), progressPct: N(l.qty) > 0 ? Math.round((N(l.dispatched_qty) / N(l.qty)) * 1000) / 10 : 0 }));
    return {
      order: { id: so.id, number: so.number, status: so.status, customer: so.customer_name, customerPo: so.customer_po_no, value: so.grand_total, project: so.project_code ?? null, plant: so.unit_code },
      progressPct: progressPct(parts),
      parts,
      stages,
      lines: lineRows,
      heldBy: holders.map((h) => ({ docType: h.doc_type, docNo: h.doc_no, department: h.department, since: h.sent_at })),
    };
  },

  // ---------------------------------------------------------------- exceptions
  /** Job body (every 30 min): raise what is late, auto-resolve what is fixed, notify the owner department. */
  async runExceptionChecks(): Promise<{ raised: number; resolved: number }> {
    const rules = await query(prisma, `SELECT * FROM exception_rules WHERE active`);
    let raised = 0;
    let resolved = 0;
    for (const rule of rules) {
      const sql = EXCEPTION_CHECKS[S(rule.check_key)];
      if (!sql) continue;
      const found = await query(prisma, sql, String(rule.threshold_hours)).catch(() => [] as Row[]);
      const keys = new Set(found.map((f) => `${S(f.doc_type)}:${S(f.id)}`));
      for (const f of found) {
        const ins = await query(
          prisma,
          `INSERT INTO process_exceptions (rule_code, unit_id, doc_type, doc_id, doc_no, project_id, detail)
           VALUES ($1,$2::uuid,$3,$4::uuid,$5,$6::uuid,$7) ON CONFLICT (rule_code, doc_type, doc_id) WHERE resolved_at IS NULL DO NOTHING RETURNING id`,
          rule.code, f.unit_id, f.doc_type, f.id, f.doc_no, f.project_id ?? null, f.detail,
        );
        if (ins[0]) {
          raised += 1;
          await spineService.notifyException(rule, f, S(ins[0].id));
          if (f.project_id) await recordEvent(prisma, { projectId: S(f.project_id), unitId: S(f.unit_id), kind: 'EXCEPTION', docType: S(f.doc_type), docId: S(f.id), docNo: S(f.doc_no), text: `${S(rule.name)}: ${S(f.detail)}`, sourceEventId: `exc:${S(ins[0].id)}` });
        }
      }
      const open = await query(prisma, `SELECT id, doc_type, doc_id FROM process_exceptions WHERE rule_code = $1 AND resolved_at IS NULL`, rule.code);
      for (const o of open) {
        if (!keys.has(`${S(o.doc_type)}:${S(o.doc_id)}`)) {
          await query(prisma, `UPDATE process_exceptions SET resolved_at = now(), auto_resolved = true WHERE id = $1::uuid`, o.id);
          resolved += 1;
        }
      }
    }
    return { raised, resolved };
  },

  async notifyException(rule: Row, f: Row, id: string): Promise<void> {
    if (S(rule.severity) !== 'High' || !f.unit_id) return;
    const dept = (await query(prisma, `SELECT id FROM departments WHERE name = $1`, rule.owner_department))[0];
    if (!dept) return;
    await prisma.$transaction(async (tx) => {
      const who = (await usersOf(tx, S(dept.id), S(f.unit_id))).map((u) => u.id);
      if (who.length === 0) return;
      await notificationService.notify(tx, who, { type: 'process.exception', title: `${S(rule.name)}: ${S(f.doc_no)}`, body: S(f.detail), link: '/m/process-exceptions', entityType: 'process_exception', entityId: id, dedupeKey: `exc:${id}` });
    });
  },

  async exceptions(caller: Caller, f: { dept?: string; severity?: string; state?: 'open' | 'resolved' | 'all' }): Promise<Row[]> {
    return query(
      prisma,
      `SELECT e.*, r.name AS rule_name, r.severity, r.owner_department, u.name AS assigned_to
         FROM process_exceptions e JOIN exception_rules r ON r.code = e.rule_code LEFT JOIN users u ON u.id = e.assigned_to_id
        WHERE (e.unit_id IS NULL OR e.unit_id = ANY($1::uuid[]))
          AND ($2::text IS NULL OR r.owner_department = $2) AND ($3::text IS NULL OR r.severity = $3)
          AND ($4 = 'all' OR ($4 = 'open' AND e.resolved_at IS NULL) OR ($4 = 'resolved' AND e.resolved_at IS NOT NULL))
        ORDER BY r.owner_department, e.raised_at DESC LIMIT 500`,
      caller.ctx.unitIds, f.dept ?? null, f.severity ?? null, f.state ?? 'open',
    );
  },
  async exceptionAction(caller: Caller, id: string, action: 'note' | 'assign' | 'resolve', b: { note?: string; assignedToId?: string }): Promise<Row> {
    const e = (await query(prisma, `SELECT * FROM process_exceptions WHERE id = $1::uuid`, id))[0];
    if (!e || (e.unit_id && !caller.ctx.unitIds.includes(S(e.unit_id)))) throw Errors.notFound('Exception not found.');
    if (action === 'note') {
      if (!b.note?.trim()) throw Errors.validation({ note: 'Write a note.' });
      return (await query(prisma, `UPDATE process_exceptions SET note = $2 WHERE id = $1::uuid RETURNING *`, id, b.note.trim()))[0]!;
    }
    if (action === 'assign') {
      if (!b.assignedToId) throw Errors.validation({ assignedToId: 'Choose a person.' });
      return (await query(prisma, `UPDATE process_exceptions SET assigned_to_id = $2::uuid WHERE id = $1::uuid RETURNING *`, id, b.assignedToId))[0]!;
    }
    return (await query(prisma, `UPDATE process_exceptions SET resolved_at = coalesce(resolved_at, now()), note = coalesce($2, note) WHERE id = $1::uuid RETURNING *`, id, b.note ?? null))[0]!;
  },

  // ---------------------------------------------------------------- enquiries
  async listEnquiries(caller: Caller, f: { status?: string; q?: string; page?: number; size?: number }): Promise<{ rows: Row[]; total: number }> {
    const size = Math.min(100, f.size ?? 25);
    const off = ((f.page ?? 1) - 1) * size;
    const args = [caller.ctx.unitIds, f.status ?? null, f.q ? `%${f.q}%` : null];
    const where = `e.deleted_at IS NULL AND e.unit_id = ANY($1::uuid[]) AND ($2::text IS NULL OR e.status = $2) AND ($3::text IS NULL OR e.number ILIKE $3 OR e.product ILIKE $3 OR e.prospect_name ILIKE $3)`;
    const total = Number((await query(prisma, `SELECT count(*)::int AS n FROM sales_enquiries e WHERE ${where}`, ...args))[0]!.n);
    const rows = await query(prisma, `SELECT e.*, c.name AS customer_name, u.name AS assigned_to FROM sales_enquiries e LEFT JOIN customers c ON c.id = e.customer_id LEFT JOIN users u ON u.id = e.assigned_to_id WHERE ${where} ORDER BY e.created_at DESC LIMIT ${size} OFFSET ${off}`, ...args);
    return { rows, total };
  },
  async createEnquiry(caller: Caller, b: { customerId?: string | null; prospectName?: string | null; contact?: string | null; product: string; application?: string | null; qty?: number | null; requiredDate?: string | null; source?: string | null; assignedToId?: string | null; projectTemplate?: 'BLDC' | 'SPPM' | 'CUSTOM' | null; unitId?: string }): Promise<Row> {
    if (!b.customerId && !b.prospectName?.trim()) throw Errors.validation({ prospectName: 'Choose a customer or type the prospect name.' });
    const unitId = b.unitId ?? caller.ctx.unitId ?? '';
    if (!caller.ctx.unitIds.includes(unitId)) throw Errors.forbidden();
    return prisma.$transaction(async (tx) => {
      const number = await NumberingService.next(tx, { docType: 'sales-enquiries', unitId, fyId: caller.ctx.fyId });
      const r = await query(
        tx,
        `INSERT INTO sales_enquiries (unit_id, fy_id, number, customer_id, prospect_name, contact, product, application, qty, required_date, source, assigned_to_id, project_template, created_by_id, updated_by_id)
         VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9,$10::date,$11,$12::uuid,$13,$14::uuid,$14::uuid) RETURNING *`,
        unitId, caller.ctx.fyId, number, b.customerId ?? null, b.prospectName ?? null, b.contact ?? null, b.product, b.application ?? null, b.qty ?? null, b.requiredDate ?? null, b.source ?? null, b.assignedToId ?? null, b.projectTemplate ?? null, caller.auth.user.id,
      );
      await recordAudit({ action: 'enquiry.created', actorId: caller.auth.user.id, targetType: 'sales_enquiry', targetId: S(r[0]!.id), detail: { number } }, tx);
      if (b.assignedToId) await notificationService.notify(tx, [b.assignedToId], { type: 'sales.enquiry_assigned', title: `Enquiry ${number} assigned to you`, body: b.product, link: '/m/sales-enquiries', entityType: 'sales_enquiry', entityId: S(r[0]!.id), dedupeKey: `enq:${S(r[0]!.id)}:assigned` });
      return r[0]!;
    });
  },
  async enquiry(caller: Caller, id: string): Promise<Row> {
    const e = (await query(prisma, `SELECT * FROM sales_enquiries WHERE id = $1::uuid AND deleted_at IS NULL`, id))[0];
    if (!e || !caller.ctx.unitIds.includes(S(e.unit_id))) throw Errors.notFound('Enquiry not found.');
    return e;
  },
  async setEnquiryStatus(caller: Caller, id: string, status: 'Qualified' | 'Won', ): Promise<Row> {
    await spineService.enquiry(caller, id);
    const ok = status === 'Qualified' ? ['New'] : ['Quoted'];
    const r = await query(prisma, `UPDATE sales_enquiries SET status = $2, version = version + 1, updated_at = now(), updated_by_id = $3::uuid WHERE id = $1::uuid AND status = ANY($4::text[]) RETURNING *`, id, status, caller.auth.user.id, ok);
    if (!r[0]) throw Errors.conflict(`An enquiry can only become ${status} from ${ok.join(' / ')}.`);
    return r[0];
  },
  async markLost(caller: Caller, id: string, reason: string): Promise<Row> {
    if (!reason?.trim()) throw Errors.validation({ lostReason: 'Give a lost reason.' });
    await spineService.enquiry(caller, id);
    const r = await query(prisma, `UPDATE sales_enquiries SET status = 'Lost', lost_reason = $2, version = version + 1, updated_at = now(), updated_by_id = $3::uuid WHERE id = $1::uuid AND status IN ('New','Qualified','Quoted') RETURNING *`, id, reason.trim(), caller.auth.user.id);
    if (!r[0]) throw Errors.conflict('This enquiry is already closed.');
    return r[0];
  },
  /** Create a Phase 10 draft quotation from the enquiry; the enquiry becomes Quoted. */
  async toQuotation(caller: Caller, id: string): Promise<Row> {
    const e = await spineService.enquiry(caller, id);
    if (!e.customer_id) throw Errors.validation({ customerId: 'Create the customer first, then pick it on the enquiry.' });
    if (!['New', 'Qualified'].includes(S(e.status))) throw Errors.conflict('A quotation was already made, or the enquiry is closed.');
    const claimed = await query(prisma, `UPDATE sales_enquiries SET status = 'Quoted', version = version + 1 WHERE id = $1::uuid AND status IN ('New','Qualified') RETURNING id`, id);
    if (!claimed[0]) throw Errors.conflict('A quotation is already being made from this enquiry.');
    try {
      const q = await quotationCrud.create(caller, {
        header: { customerId: e.customer_id, notes: `From enquiry ${S(e.number)}` },
        lines: [{ itemId: null, description: S(e.product), qty: N(e.qty) || 1, uom: 'Nos', rate: 0 }],
      } as never);
      const qid = S((q as { id?: string }).id);
      await query(prisma, `UPDATE sales_enquiries SET quotation_id = $2::uuid WHERE id = $1::uuid`, id, qid);
      await recordAudit({ action: 'enquiry.quoted', actorId: caller.auth.user.id, targetType: 'sales_enquiry', targetId: id, detail: { quotationId: qid } });
      return { ...(await spineService.enquiry(caller, id)), quotation: q } as Row;
    } catch (err) {
      await query(prisma, `UPDATE sales_enquiries SET status = $2 WHERE id = $1::uuid AND status = 'Quoted' AND quotation_id IS NULL`, id, S(e.status));
      throw err;
    }
  },
  /** A "new product" enquiry becomes a project with the BLDC / SPPM / CUSTOM template. */
  async toProject(caller: Caller, id: string, b: { template?: 'BLDC' | 'SPPM' | 'CUSTOM'; projectManagerId?: string }): Promise<Row> {
    const e = await spineService.enquiry(caller, id);
    if (e.project_id) throw Errors.conflict('This enquiry already has a project.');
    if (!e.customer_id) throw Errors.validation({ customerId: 'Create the customer first, then pick it on the enquiry.' });
    const template = b.template ?? (e.project_template as 'BLDC' | 'SPPM' | 'CUSTOM' | null) ?? 'CUSTOM';
    const code = await NumberingService.allocate(prisma as never, { pageId: 'proj-projects', unitId: S(e.unit_id), fyId: caller.ctx.fyId, prefix: 'PRJ' });
    const pm = b.projectManagerId ?? null; // an employee id (projects.project_manager_id references employees)
    const p = (await query(prisma, `INSERT INTO projects (code, name, customer_id, project_manager_id, unit_id, project_type, billing_method, contract_value, status, start_date, end_date, created_by_id)
      VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, 'CUSTOMER', 'FIXED_MILESTONE', 0, 'DRAFT', CURRENT_DATE, COALESCE($7::date, CURRENT_DATE + 180), $6::uuid) RETURNING id, code`, code, S(e.product).slice(0, 120), e.customer_id, pm, e.unit_id, caller.auth.user.id, e.required_date ?? null).catch((err: Error) => { throw Errors.validation({ project: `Could not create the project: ${err.message.split('\n').pop()}` }); }))[0]!;
    await query(prisma, `UPDATE sales_enquiries SET project_id = $2::uuid, project_template = $3 WHERE id = $1::uuid`, id, p.id, template);
    if (template !== 'CUSTOM') await spineService.applyTemplate(caller, S(p.id), template);
    await recordEvent(prisma, { projectId: S(p.id), unitId: S(e.unit_id), actorId: caller.auth.user.id, kind: 'DOC_CREATED', docType: 'sales_enquiries', docId: id, docNo: S(e.number), text: `Project created from enquiry ${S(e.number)}`, sourceEventId: `enq:${id}:project` });
    return { project: p, enquiry: await spineService.enquiry(caller, id) } as unknown as Row;
  },
};
