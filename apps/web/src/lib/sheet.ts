// Reads a CSV, JSON or .xlsx file in the browser into a header row + data rows of text (the Import Data drawer).
// .xlsx is a zip of XML parts: the zip is read directly and its parts inflated with the browser's DecompressionStream.
export interface Sheet {
  headers: string[];
  rows: Record<string, string>[];
}

export const IMPORT_MAX_ROWS = 5000;

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) out.push(row);
  return out;
}

function toSheet(grid: string[][]): Sheet {
  const headerRow = grid[0] ?? [];
  const headers = headerRow.map((h, i) => (h ?? '').trim() || `Column ${i + 1}`);
  const rows = grid.slice(1, IMPORT_MAX_ROWS + 1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = (r[i] ?? '').trim();
    });
    return o;
  });
  return { headers, rows };
}

function fromJson(text: string): Sheet {
  const parsed: unknown = JSON.parse(text);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
        ? (parsed as { data: unknown[] }).data
        : null;
  if (!list) throw new Error('The JSON file must hold a list of records.');
  const objs = list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
  const headers: string[] = [];
  for (const o of objs) for (const k of Object.keys(o)) if (!headers.includes(k)) headers.push(k);
  const rows = objs.slice(0, IMPORT_MAX_ROWS).map((o) => {
    const r: Record<string, string> = {};
    for (const h of headers) r[h] = o[h] === null || o[h] === undefined ? '' : String(o[h]);
    return r;
  });
  return { headers, rows };
}

const u16 = (b: DataView, o: number): number => b.getUint16(o, true);
const u32 = (b: DataView, o: number): number => b.getUint32(o, true);

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not a valid .xlsx file.');
  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const files = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (u32(view, p) !== 0x02014b50) break;
    const method = u16(view, p + 10);
    const compSize = u32(view, p + 20);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const localOff = u32(view, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(name)) continue;
    const lhName = u16(view, localOff + 26);
    const lhExtra = u16(view, localOff + 28);
    const start = localOff + 30 + lhName + lhExtra;
    const raw = bytes.subarray(start, start + compSize);
    files.set(name, method === 0 ? raw : await inflateRaw(raw));
  }
  return files;
}

const colIndex = (ref: string): number => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

async function fromXlsx(file: File): Promise<Sheet> {
  const parts = await unzip(await file.arrayBuffer());
  const sheetName = [...parts.keys()].filter((k) => k.startsWith('xl/worksheets/')).sort()[0];
  if (!sheetName) throw new Error('No worksheet found in this .xlsx file.');
  const dec = new TextDecoder();
  const parse = (u8: Uint8Array): Document => new DOMParser().parseFromString(dec.decode(u8), 'application/xml');
  const shared: string[] = [];
  const ss = parts.get('xl/sharedStrings.xml');
  if (ss) {
    for (const si of Array.from(parse(ss).getElementsByTagName('si'))) {
      shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
    }
  }
  const sheet = parse(parts.get(sheetName)!);
  const grid: string[][] = [];
  for (const rowEl of Array.from(sheet.getElementsByTagName('row'))) {
    const r: string[] = [];
    for (const c of Array.from(rowEl.getElementsByTagName('c'))) {
      const idx = colIndex(c.getAttribute('r') ?? 'A1');
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let text = v;
      if (t === 's') text = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') text = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('');
      r[idx] = text;
    }
    for (let i = 0; i < r.length; i++) if (r[i] === undefined) r[i] = '';
    grid.push(r);
  }
  return toSheet(grid.filter((r) => r.some((c) => c.trim() !== '')));
}

export async function readSheet(file: File): Promise<Sheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) return fromJson(await file.text());
  if (name.endsWith('.csv') || name.endsWith('.txt')) return toSheet(parseCsv(await file.text()));
  if (name.endsWith('.xlsx')) return fromXlsx(file);
  if (name.endsWith('.xls')) throw new Error('Old .xls files cannot be read here. Save the file as .xlsx or .csv and choose it again.');
  throw new Error('Choose a CSV, JSON or Excel (.xlsx) file.');
}
