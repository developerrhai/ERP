// One-file multipart/form-data reader on busboy: enforces the byte limit while streaming, so an
// oversized upload is cut off instead of being buffered whole.
import busboy from 'busboy';
import type { Request } from 'express';
import { Errors } from './errors';

export interface UploadedFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface MultipartResult {
  file: UploadedFile;
  fields: Record<string, string>;
}

export function readSingleFile(req: Request, maxBytes: number): Promise<MultipartResult> {
  const contentType = req.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return Promise.reject(
      Errors.badRequest('Send the file as multipart/form-data (field "file").'),
    );
  }
  const declared = Number(req.get('content-length') ?? '0');
  // The envelope (boundaries, small fields) is far below 64 KB.
  if (Number.isFinite(declared) && declared > maxBytes + 64 * 1024) {
    return Promise.reject(Errors.fileTooLarge(`The file is larger than ${maxBytes / 1048576} MB.`));
  }

  return new Promise((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: maxBytes, fields: 10, fieldSize: 2048, parts: 12 },
      });
    } catch {
      reject(Errors.badRequest('Malformed multipart request.'));
      return;
    }

    const fields: Record<string, string> = {};
    const chunks: Buffer[] = [];
    let file: { filename: string; mimeType: string } | null = null;
    let truncated = false;
    let failed = false;
    const fail = (err: Error): void => {
      if (failed) return;
      failed = true;
      reject(err);
    };

    parser.on('field', (name, value) => {
      fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      if (name !== 'file' || file) {
        stream.resume();
        return;
      }
      file = {
        filename: info.filename ?? 'file',
        mimeType: info.mimeType ?? 'application/octet-stream',
      };
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        truncated = true;
      });
    });
    parser.on('filesLimit', () => fail(Errors.badRequest('Send exactly one file.')));
    parser.on('error', () => fail(Errors.badRequest('Malformed multipart request.')));
    parser.on('close', () => {
      if (failed) return;
      if (truncated) {
        fail(Errors.fileTooLarge(`The file is larger than ${maxBytes / 1048576} MB.`));
      } else if (!file) {
        fail(Errors.validation({ file: 'Choose a file to upload.' }));
      } else {
        resolve({ file: { ...file, buffer: Buffer.concat(chunks) }, fields });
      }
    });
    req.pipe(parser);
  });
}
