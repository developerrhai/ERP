// ExcelFormatImporter (docs/phases/PHASE-06B.md §3.4, §5): an uploaded .xlsx is parsed into the same
// data structures the editor saves (a format schema, or a rate table of a rule set) together with a
// validation report. parse() saves nothing and never throws for bad CONTENT: problems go in the
// report. Only an unreadable file throws.
import ExcelJS from 'exceljs';
import { Errors } from '../http/errors';
import { formatSchemaZ, validateFormatSchema } from './format-schema';
import type { FormatSchema } from './format-schema';

export interface ImportIssue {
  row: number | null;
  message: string;
}

export interface ImportReport {
  valid: boolean;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  summary: string;
}

export interface FormatImport {
  report: ImportReport;
  schema: FormatSchema | null;
}

export interface RateTableImport {
  report: ImportReport;
  table: { name: string; columns: string[]; rows: string[][] } | null;
}

const MAX_ROWS = 600;
const MAX_COLS = 14;

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    // Avoid float noise such as 0.1 + 0.2: keep up to 8 decimals, drop trailing zeros.
    return Number(value.toFixed(8)).toString();
  }
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value)
      return value.richText
        .map((t) => t.text)
        .join('')
        .trim();
    if ('text' in value) return String(value.text).trim();
    return '';
  }
  return String(value).trim();
}

async function readSheet(buffer: Buffer, sheetName?: string): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw Errors.importInvalid('The file is not a valid Excel workbook (.xlsx).');
  }
  const sheet =
    (sheetName
      ? workbook.worksheets.find((s) => s.name.toLowerCase() === sheetName.toLowerCase())
      : undefined) ?? workbook.worksheets[0];
  if (!sheet) throw Errors.importInvalid('The workbook has no sheet.');
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, n) => {
    if (n > MAX_ROWS + 1) return;
    const cells: string[] = [];
    for (let c = 1; c <= MAX_COLS; c += 1) cells.push(cellText(row.getCell(c).value));
    rows[n - 1] = cells;
  });
  return Array.from(rows, (r) => r ?? []);
}

const finish = (errors: ImportIssue[], warnings: ImportIssue[], summary: string): ImportReport => ({
  valid: errors.length === 0,
  errors,
  warnings,
  summary,
});

const yes = (s: string): boolean => ['y', 'yes', 'true', '1', 'x'].includes(s.trim().toLowerCase());

/**
 * Sheet layout (first row = headings): Section | Key | Label | Type | Required | Options | Formula.
 * Sections: Title, Header, Column, Total, Signature, Print.
 */
export async function parseFormatWorkbook(buffer: Buffer): Promise<FormatImport> {
  const rows = await readSheet(buffer, 'Format');
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const head = (rows[0] ?? []).map((h) => h.toLowerCase());
  const idx = (name: string): number => head.indexOf(name);
  const need = ['section', 'key', 'label'];
  const missing = need.filter((n) => idx(n) < 0);
  if (missing.length > 0) {
    errors.push({
      row: 1,
      message: `The first row must have the headings Section, Key, Label (missing: ${missing.join(', ')}).`,
    });
    return { report: finish(errors, warnings, 'Not a format sheet.'), schema: null };
  }
  const get = (r: string[], name: string): string => (idx(name) >= 0 ? (r[idx(name)] ?? '') : '');
  const draft: Record<string, unknown> = {
    header: [],
    columns: [],
    totals: [],
    print: {},
    validations: [],
  };
  const signatures: string[] = [];
  const print: Record<string, unknown> = {};
  let used = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i] ?? [];
    if (r.every((c) => c === '')) continue;
    used += 1;
    const n = i + 1;
    const section = get(r, 'section').toLowerCase();
    const key = get(r, 'key');
    const label = get(r, 'label');
    const type = get(r, 'type').toLowerCase();
    const options = get(r, 'options');
    const formula = get(r, 'formula');
    switch (section) {
      case 'title':
        draft.title = label;
        break;
      case 'header':
        (draft.header as unknown[]).push({
          key,
          label,
          ...(type ? { type } : {}),
          required: yes(get(r, 'required')),
          ...(options
            ? {
                options: options
                  .split(/[|;]/)
                  .map((o) => o.trim())
                  .filter(Boolean),
              }
            : {}),
        });
        break;
      case 'column':
        (draft.columns as unknown[]).push({
          key,
          label,
          ...(type ? { type } : {}),
          required: yes(get(r, 'required')),
          ...(formula ? { formula } : {}),
        });
        break;
      case 'total':
        (draft.totals as unknown[]).push({
          key,
          label,
          op: type === 'expression' ? 'expression' : 'sum',
          ...(type !== 'expression' ? { column: options } : { expression: formula }),
        });
        break;
      case 'signature':
        if (label) signatures.push(label);
        else errors.push({ row: n, message: 'A Signature row needs a Label.' });
        break;
      case 'print':
        if (['paper', 'orientation', 'footernote'].includes(key.toLowerCase())) {
          const k = key.toLowerCase() === 'footernote' ? 'footerNote' : key.toLowerCase();
          print[k] = label;
        } else if (['showletterhead', 'showamountinwords'].includes(key.toLowerCase())) {
          print[key.toLowerCase() === 'showletterhead' ? 'showLetterhead' : 'showAmountInWords'] =
            yes(label);
        } else {
          warnings.push({
            row: n,
            message: `Print setting "${key}" is not known and was ignored.`,
          });
        }
        break;
      default:
        errors.push({
          row: n,
          message: `Section "${get(r, 'section')}" is not known. Use Title, Header, Column, Total, Signature or Print.`,
        });
    }
  }
  if (used === 0) errors.push({ row: null, message: 'The sheet has headings but no rows.' });
  draft.print = { ...print, signatures };
  if (errors.length > 0)
    return { report: finish(errors, warnings, `${errors.length} problem(s) found.`), schema: null };
  const zod = formatSchemaZ.safeParse(draft);
  if (!zod.success) {
    for (const issue of zod.error.issues.slice(0, 20)) {
      errors.push({ row: null, message: `${issue.path.join('.') || 'format'}: ${issue.message}` });
    }
    return { report: finish(errors, warnings, `${errors.length} problem(s) found.`), schema: null };
  }
  try {
    const schema = validateFormatSchema(draft);
    return {
      report: finish(
        errors,
        warnings,
        `${schema.header.length} header field(s), ${schema.columns.length} column(s), ${schema.totals.length} total(s).`,
      ),
      schema,
    };
  } catch (err) {
    errors.push({
      row: null,
      message: err instanceof Error ? err.message : 'The format is not valid.',
    });
    return { report: finish(errors, warnings, 'The format is not valid.'), schema: null };
  }
}

/** A rate table: first row = column headings, one row per rate. The first column is the key / "from". */
export async function parseRateTableWorkbook(
  buffer: Buffer,
  name: string,
): Promise<RateTableImport> {
  const rows = await readSheet(buffer);
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const headRow = rows[0] ?? [];
  let width = headRow.length;
  while (width > 0 && headRow[width - 1] === '') width -= 1;
  if (width === 0) {
    errors.push({ row: 1, message: 'The first row must hold the column headings.' });
    return { report: finish(errors, warnings, 'No headings.'), table: null };
  }
  const columns = headRow.slice(0, width);
  const seen = new Set<string>();
  const body: string[][] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const r = (rows[i] ?? []).slice(0, width);
    while (r.length < width) r.push('');
    if (r.every((c) => c === '')) continue;
    const n = i + 1;
    if (r[0] === '') {
      errors.push({ row: n, message: 'The first column (the rate key) is empty.' });
      continue;
    }
    const k = (r[0] ?? '').toLowerCase();
    if (seen.has(k))
      errors.push({ row: n, message: `"${r[0]}" appears twice in the first column.` });
    seen.add(k);
    for (let c = 1; c < width; c += 1) {
      if (!/^-?\d+(\.\d+)?$/.test(r[c] ?? '')) {
        errors.push({
          row: n,
          message: `"${columns[c]}" must be a number (found "${r[c] ?? ''}").`,
        });
      }
    }
    body.push(r);
  }
  if (body.length === 0 && errors.length === 0) {
    errors.push({ row: null, message: 'The sheet has headings but no rates.' });
  }
  if (rows.length - 1 > MAX_ROWS)
    warnings.push({ row: null, message: `Only the first ${MAX_ROWS} rows were read.` });
  if (errors.length > 0)
    return { report: finish(errors, warnings, `${errors.length} problem(s) found.`), table: null };
  return {
    report: finish(errors, warnings, `${body.length} rate row(s), ${columns.length} column(s).`),
    table: { name, columns, rows: body },
  };
}

/** A small template the head can download, fill in and upload. */
export async function formatTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Format');
  ws.addRow(['Section', 'Key', 'Label', 'Type', 'Required', 'Options', 'Formula']);
  ws.addRow(['Title', '', 'Quotation', '', '', '', '']);
  ws.addRow(['Header', 'customerRef', 'Customer reference', 'text', 'yes', '', '']);
  ws.addRow(['Column', 'item', 'Item', 'text', 'yes', '', '']);
  ws.addRow(['Column', 'qty', 'Quantity', 'number', 'yes', '', '']);
  ws.addRow(['Column', 'rate', 'Rate', 'money', 'yes', '', '']);
  ws.addRow(['Column', 'amount', 'Amount', 'money', '', '', 'qty * rate']);
  ws.addRow(['Total', 'subtotal', 'Sub total', 'sum', '', 'amount', '']);
  ws.addRow(['Signature', '', 'Prepared by', '', '', '', '']);
  ws.addRow(['Print', 'paper', 'A4', '', '', '', '']);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export async function rateTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Rates');
  ws.addRow(['Process', 'Rate per hour']);
  ws.addRow(['Cutting', '450']);
  ws.addRow(['Welding', '600']);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
