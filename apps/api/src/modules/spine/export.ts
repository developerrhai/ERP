// Phase 26 exports: the project dossier PDF and the history workbook.
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma } from '../../core/db/prisma';
import { FONT_FILES } from '../../core/pdf';
import { Errors } from '../../core/http/errors';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { spineService } from './service';

const S = (v: unknown): string => String(v ?? '');
const D = (v: unknown): string => (v ? new Date(S(v)).toISOString().slice(0, 10) : '-');

export interface DossierModel {
  project: Row;
  gates: Row[];
  specs: Row[];
  tests: Row[];
  documents: Row[];
  history: Row[];
  generatedAt: string;
}

export async function dossierModel(caller: Caller, projectId: string): Promise<DossierModel> {
  const project = (await query(
    prisma,
    `SELECT p.id, p.code, p.name, p.status, p.start_date, p.end_date, p.contract_value, c.name AS customer, u.code AS plant, pm.name AS manager
       FROM projects p LEFT JOIN customers c ON c.id = p.customer_id JOIN units u ON u.id = p.unit_id LEFT JOIN users pm ON pm.id = p.project_manager_id
      WHERE p.id = $1::uuid`,
    projectId,
  ))[0];
  if (!project) throw Errors.notFound('Project not found.');
  const gates = await spineService.gates(caller, projectId); // also checks the plant
  const approvers = await query(
    prisma,
    `SELECT a.request_id::text AS request_id, string_agg(DISTINCT u.name, ', ') AS names
       FROM approval_actions a JOIN users u ON u.id = a.actor_id WHERE a.action IN ('APPROVE','AUTO_APPROVED') AND a.request_id = ANY($1::uuid[]) GROUP BY a.request_id`,
    gates.map((g) => g.approval_request_id).filter(Boolean),
  );
  const by = new Map(approvers.map((a) => [S(a.request_id), S(a.names)]));
  for (const g of gates) g.approvers = by.get(S(g.approval_request_id)) ?? null;
  const specs = await spineService.listSpecs(caller, projectId);
  const tests = await spineService.listTests(caller, projectId);
  const documents = await spineService.listDocuments(caller, projectId);
  const history = (await spineService.history(caller, projectId, { limit: 40 })).rows;
  return { project, gates, specs, tests, documents, history, generatedAt: new Date().toISOString() };
}

export function dossierPdf(m: DossierModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Project dossier ${S(m.project.code)}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('sans', FONT_FILES.sans);
    doc.registerFont('bold', FONT_FILES.sansBold);
    const h1 = (t: string) => { doc.moveDown(0.8).font('bold').fontSize(13).text(t).moveDown(0.3).font('sans').fontSize(9); };
    const row = (cols: string[], widths: number[]) => {
      const y = doc.y;
      let x = 40;
      cols.forEach((c, i) => { doc.text(c, x, y, { width: widths[i]! - 4, ellipsis: true, lineBreak: false }); x += widths[i]!; });
      doc.y = y + 13;
      doc.x = 40;
      if (doc.y > 780) doc.addPage();
    };

    // cover
    doc.font('bold').fontSize(20).text('Project Dossier', { align: 'center' }).moveDown(0.4);
    doc.fontSize(14).text(`${S(m.project.code)}  ${S(m.project.name)}`, { align: 'center' }).moveDown(1);
    doc.font('sans').fontSize(10);
    for (const [k, v] of [['Customer', S(m.project.customer) || '-'], ['Plant', S(m.project.plant)], ['Project manager', S(m.project.manager) || '-'], ['Status', S(m.project.status)], ['Start', D(m.project.start_date)], ['Target end', D(m.project.end_date)], ['Generated', D(m.generatedAt)]] as const) {
      doc.text(`${k}: ${v}`, { align: 'center' });
    }

    h1('Gates');
    row(['Gate', 'Name', 'State', 'Due', 'Approved', 'Approvers'], [48, 170, 62, 58, 62, 115]);
    for (const g of m.gates) row([S(g.code), S(g.name), S(g.state), D(g.due_date), D(g.approved_at), S(g.approvers) || '-'], [48, 170, 62, 58, 62, 115]);

    h1('Specifications');
    row(['No', 'Parameter', 'Target', 'Tol -', 'Tol +', 'Unit', 'Rev', 'Status'], [60, 160, 55, 45, 45, 45, 35, 70]);
    for (const s of m.specs) row([S(s.spec_no), S(s.parameter), S(s.target), S(s.tol_minus), S(s.tol_plus), S(s.unit), String(s.revision), S(s.status)], [60, 160, 55, 45, 45, 45, 35, 70]);

    h1('Test results');
    row(['Test', 'Gate', 'Spec', 'Value', 'Result', 'Date'], [150, 50, 90, 70, 55, 100]);
    for (const t of m.tests) row([S(t.test_name), S(t.gate_code) || '-', S(t.spec_no) || '-', S(t.value), S(t.result) || 'pending', D(t.tested_at)], [150, 50, 90, 70, 55, 100]);

    h1('Documents');
    row(['Type', 'Title', 'Rev', 'Status'], [60, 280, 40, 90]);
    for (const d of m.documents) row([S(d.doc_type), S(d.title), String(d.revision), S(d.status)], [60, 280, 40, 90]);

    h1('History (latest events)');
    for (const e of m.history) {
      doc.text(`${D(e.at)}  ${S(e.department) || '-'}  ${S(e.kind)}  ${S(e.doc_no) || ''}  ${S(e.text)}`, { width: 515 });
      if (doc.y > 780) doc.addPage();
    }

    h1('Signatures');
    doc.moveDown(2);
    for (const who of ['Project Manager', 'Quality Head', 'Customer']) {
      const y = doc.y;
      doc.moveTo(40, y).lineTo(220, y).stroke();
      doc.text(who, 40, y + 3);
      doc.y = y + 40;
    }
    doc.end();
  });
}

export async function historyWorkbook(rows: Row[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Project history');
  ws.columns = [
    { header: 'Date', key: 'at', width: 20 }, { header: 'Department', key: 'department', width: 18 }, { header: 'Person', key: 'actor', width: 20 },
    { header: 'Event', key: 'kind', width: 14 }, { header: 'Document', key: 'doc_no', width: 22 }, { header: 'Text', key: 'text', width: 60 },
  ];
  for (const r of rows) ws.addRow({ at: new Date(S(r.at)), department: r.department, actor: r.actor, kind: r.kind, doc_no: r.doc_no, text: r.text });
  ws.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
