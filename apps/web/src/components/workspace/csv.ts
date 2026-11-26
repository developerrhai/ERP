// CSV file (opens in Excel) of a list the page holds as data, so it carries every record and none of the row buttons.
import { saveFile } from '../../lib/docsMailApi';

/** A cell that starts like a formula is kept as text, so a typed name can not run in the spreadsheet. */
const cell = (v: string): string => `"${(/^[=+@\t\r]|^-(?![\d.])/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;

export function saveCsvTable(filename: string, heads: string[], body: string[][]): void {
  const csv = [heads, ...body].map((line) => line.map(cell).join(',')).join('\r\n');
  saveFile({ blob: new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), filename: null }, filename);
}
