// The .xlsx of a typed Inventory page: bold frozen header, one column per schema field (lookup
// fields show "code - name"), real dates, ₹ format on money, Yes / No for flags, an optional bold
// totals row (Stock Balance), and text cells starting with = + - or @ prefixed with an apostrophe.
import ExcelJS from 'exceljs';
import { safeCell } from '../records/export';
import type { TypedSchema } from './definitions';
import type { TypedRecordDto } from './typed';

const MONEY_FORMAT = '"₹" #,##0.00';
const QTY_FORMAT = '#,##0.###';

export async function buildTypedWorkbook(
  schema: TypedSchema,
  rows: readonly TypedRecordDto[],
  totals?: Record<string, number>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sawant Group ERP';
  const sheet = workbook.addWorksheet(schema.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  const fields = schema.fields;
  sheet.columns = fields.map(
    (f): Partial<ExcelJS.Column> => ({
      header: f.label,
      key: f.key,
      width: Math.min(Math.max(f.label.length + 2, 14), 40),
      ...(f.type === 'money' ? { style: { numFmt: MONEY_FORMAT } } : {}),
      ...(f.type === 'qty' ? { style: { numFmt: QTY_FORMAT } } : {}),
    }),
  );
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of rows) {
    const values: Record<string, ExcelJS.CellValue> = {};
    for (const f of fields) {
      const raw = f.type === 'code' ? row.code : row.data[f.key];
      if (raw === undefined || raw === null) continue;
      const ref = row.refs[f.key];
      if (ref) values[f.key] = safeCell(`${ref.code} - ${ref.name}`);
      else if (f.type === 'bool') values[f.key] = raw === true ? 'Yes' : 'No';
      else if (typeof raw === 'number') values[f.key] = raw;
      else if (f.type === 'date' && typeof raw === 'string')
        values[f.key] = new Date(`${raw}T00:00:00Z`);
      else values[f.key] = safeCell(typeof raw === 'string' ? raw : JSON.stringify(raw));
    }
    const added = sheet.addRow(values);
    for (const f of fields) if (f.type === 'date') added.getCell(f.key).numFmt = 'dd-mmm-yyyy';
  }
  if (totals) {
    const line: Record<string, ExcelJS.CellValue> = {};
    const first = fields[0];
    if (first) line[first.key] = 'Total';
    for (const f of fields) {
      const total = totals[f.key];
      if (total !== undefined) line[f.key] = total;
    }
    const added = sheet.addRow(line);
    added.font = { bold: true };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
