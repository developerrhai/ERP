// Builds the .xlsx and .csv of a record list (docs/phases/PHASE-04.md §7). One column model for
// both formats: Code / Status / Unit / FY / Department + every field. Formula injection is blocked in
// EVERY text cell, headers included: text that starts with = + - @ (or a tab / CR) is prefixed with
// an apostrophe. Money stays a number with a ₹ format in xlsx and a plain number in CSV.
import ExcelJS from 'exceljs';
import type { FieldMeta } from '../../engine/field-types';
import type { PageSchema } from '../../engine/field-schema';
import type { RecordRow } from './repository';

const FORMULA_START = /^[=+\-@\t\r]/;

/** Text that a spreadsheet would run as a formula is stored with a leading apostrophe. */
export function safeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

const MONEY_FORMAT = '"₹" #,##0.00';
const DATE_FORMAT = 'dd-mmm-yyyy';

interface ExportColumn {
  key: string;
  header: string;
  width: number;
  field?: FieldMeta;
}

export function exportColumns(schema: PageSchema): ExportColumn[] {
  const fields = schema.fields.filter((f) => f.type !== 'code' && f.type !== 'status');
  return [
    { key: '__code', header: 'Code', width: 24 },
    { key: '__status', header: 'Status', width: 14 },
    { key: '__unit', header: 'Unit', width: 10 },
    { key: '__fy', header: 'FY', width: 10 },
    { key: '__department', header: 'Department', width: 16 },
    ...fields.map((f) => ({
      key: f.key,
      header: f.label,
      width: Math.min(Math.max(f.label.length + 2, 14), 40),
      field: f,
    })),
  ];
}

type Cell = string | number | boolean | Date | null;

/** The raw (typed) value of one cell, before any format-specific escaping. */
function cellOf(column: ExportColumn, row: RecordRow): Cell {
  switch (column.key) {
    case '__code':
      return row.code;
    case '__status':
      return row.status;
    case '__unit':
      return row.unitCode;
    case '__fy':
      return row.fyCode;
    case '__department':
      return row.department;
    default:
      break;
  }
  const raw = row.data[column.key];
  if (raw === undefined || raw === null) return null;
  const f = column.field;
  if (f?.type === 'bool') return raw === true;
  if (typeof raw === 'number') return raw;
  if (f?.type === 'date' && typeof raw === 'string') return new Date(`${raw}T00:00:00Z`);
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

export async function buildWorkbook(
  schema: PageSchema,
  rows: readonly RecordRow[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sawant Group ERP';
  const sheet = workbook.addWorksheet(schema.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  const columns = exportColumns(schema);
  sheet.columns = columns.map(
    (c): Partial<ExcelJS.Column> => ({
      header: safeCell(c.header),
      key: c.key,
      width: c.width,
      ...(c.field?.type === 'money' ? { style: { numFmt: MONEY_FORMAT } } : {}),
    }),
  );
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of rows) {
    const values: Record<string, ExcelJS.CellValue> = {};
    for (const c of columns) {
      const v = cellOf(c, row);
      if (v === null) continue;
      if (typeof v === 'boolean') values[c.key] = v ? 'Yes' : 'No';
      else if (typeof v === 'string') values[c.key] = safeCell(v);
      else values[c.key] = v;
    }
    const added = sheet.addRow(values);
    for (const c of columns) {
      if (c.field?.type === 'date') added.getCell(c.key).numFmt = DATE_FORMAT;
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function csvEscape(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV, UTF-8 with a BOM so Excel shows ₹ and Devanagari correctly; dates ISO, money plain. */
export function buildCsv(schema: PageSchema, rows: readonly RecordRow[]): Buffer {
  const columns = exportColumns(schema);
  const lines = [columns.map((c) => csvEscape(safeCell(c.header))).join(',')];
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const v = cellOf(c, row);
          if (v === null) return '';
          if (typeof v === 'boolean') return v ? 'Yes' : 'No';
          if (typeof v === 'number') return String(v);
          if (v instanceof Date) return v.toISOString().slice(0, 10);
          return csvEscape(safeCell(v));
        })
        .join(','),
    );
  }
  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'),
  ]);
}
