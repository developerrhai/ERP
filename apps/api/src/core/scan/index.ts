// Upload safety checks (docs/phases/PHASE-04.md §5 C8 / C9): magic-byte sniffing, an allow-list, and a
// built-in content scan. `Scanner` is the seam for a real engine (ClamAV) later; v1 has no daemon.

export type ScanStatus = 'CLEAN' | 'INFECTED';

export interface ScanResult {
  status: ScanStatus;
  detail: string | null;
}

export interface Scanner {
  scan(buffer: Buffer, detectedType: AllowedKind): Promise<ScanResult>;
}

export type AllowedKind = 'pdf' | 'png' | 'jpg' | 'xlsx' | 'docx' | 'csv';

export interface KindInfo {
  mime: string;
  extensions: readonly string[];
}

export const ALLOWED_KINDS: Readonly<Record<AllowedKind, KindInfo>> = {
  pdf: { mime: 'application/pdf', extensions: ['pdf'] },
  png: { mime: 'image/png', extensions: ['png'] },
  jpg: { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'] },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
  },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
  },
  csv: { mime: 'text/csv', extensions: ['csv'] },
};

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_RECORD = 20;

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** The real type from the first bytes, or null when it is not an allowed type. */
export function sniffKind(buffer: Buffer, extension: string): AllowedKind | null {
  if (buffer.length < 4) return null;
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
    // OOXML containers: the part names are stored uncompressed in the local file headers.
    const head = buffer.subarray(0, Math.min(buffer.length, 64 * 1024)).toString('latin1');
    if (extension === 'xlsx' && head.includes('xl/')) return 'xlsx';
    if (extension === 'docx' && head.includes('word/')) return 'docx';
    return null;
  }
  if (extension === 'csv' && looksLikeText(buffer)) return 'csv';
  return null;
}

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
  }
  return true;
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

/** Strips any path and control characters; never returns an empty name. */
export function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const cleaned = base.replace(/^\.+/, '').slice(0, 255);
  return cleaned === '' ? 'file' : cleaned;
}

/** The standard anti-virus test string (harmless) that every scanner must flag. */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export const builtInScanner: Scanner = {
  scan(buffer, kind) {
    const text = buffer.toString('latin1');
    if (text.includes(EICAR)) {
      return Promise.resolve({ status: 'INFECTED', detail: 'EICAR test signature' });
    }
    if (kind === 'pdf' && /\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(text)) {
      return Promise.resolve({ status: 'INFECTED', detail: 'PDF with active content' });
    }
    if ((kind === 'xlsx' || kind === 'docx') && text.includes('vbaProject.bin')) {
      return Promise.resolve({ status: 'INFECTED', detail: 'Office file with macros' });
    }
    return Promise.resolve({ status: 'CLEAN', detail: null });
  },
};
