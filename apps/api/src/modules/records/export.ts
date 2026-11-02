// Builds the .xlsx of a record list (docs/phase3-4 B3): bold header, one column per field, ₹ number
// format for money, real dates, and formula injection blocked: a text cell that starts with
// = + - or @ is prefixed with an apostrophe.
import ExcelJS from 'exceljs';
import type { PageSchema } from '../../engine/field-schema';
import type { RecordRow } from './repository';

const FORMULA_START = /^[=+\-@]/;

/** Text that a spreadsheet would run as a formula is stored with a leading apostrophe. */
export function safeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

const MONEY_FORMAT = '"₹" #,##0.00';
const DATE_FORMAT = 'dd-mmm-yyyy';

export async function buildWorkbook(
  schema: PageSchema,
  rows: readonly RecordRow[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sawant Group ERP';
  const sheet = workbook.addWorksheet(schema.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  const fields = schema.fields.filter((f) => f.type !== 'code' && f.type !== 'status');
  const columns: Partial<ExcelJS.Column>[] = [
    { header: 'Code', key: '__code', width: 24 },
    { header: 'Status', key: '__status', width: 14 },
    { header: 'Unit', key: '__unit', width: 10 },
    { header: 'FY', key: '__fy', width: 10 },
    { header: 'Department', key: '__department', width: 16 },
    ...fields.map(
      (f): Partial<ExcelJS.Column> => ({
        header: f.label,
        key: f.key,
        width: Math.min(Math.max(f.label.length + 2, 14), 40),
        ...(f.type === 'money' ? { style: { numFmt: MONEY_FORMAT } } : {}),
      }),
    ),
  ];
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of rows) {
    const values: Record<string, ExcelJS.CellValue> = {
      __code: safeCell(row.code),
      __status: safeCell(row.status),
      __unit: safeCell(row.unitCode),
      __fy: safeCell(row.fyCode),
      __department: safeCell(row.department),
    };
    for (const f of fields) {
      const raw = row.data[f.key];
      if (raw === undefined || raw === null) continue;
      if (f.type === 'bool') values[f.key] = raw === true ? 'Yes' : 'No';
      else if (typeof raw === 'number') values[f.key] = raw;
      else if (f.type === 'date' && typeof raw === 'string') {
        values[f.key] = new Date(`${raw}T00:00:00Z`);
      } else values[f.key] = safeCell(typeof raw === 'string' ? raw : JSON.stringify(raw));
    }
    const added = sheet.addRow(values);
    for (const f of fields) {
      if (f.type === 'date') added.getCell(f.key).numFmt = DATE_FORMAT;
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
