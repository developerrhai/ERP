// apps/api/src/core/storage/local-disk-storage.ts
// Local disk file storage implementation (Phase 03 Order 4 + Phase 20-C health check & S3 fallback metadata)
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prisma } from '../db/prisma';
import type { SaveFileInput, StorageProvider, StoredFileRecord } from './storage-provider';

export class LocalDiskStorage implements StorageProvider {
  public readonly driverName = 'local' as const;
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.resolve(process.cwd(), 'storage', 'uploads');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async save(input: SaveFileInput): Promise<StoredFileRecord> {
    const sha256Hash = createHash('sha256').update(input.buffer).digest('hex');
    const sanitizedName = input.originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const datePrefix = new Date().toISOString().slice(0, 10);
    const diskFilename = `${datePrefix}_${sha256Hash.slice(0, 12)}_${sanitizedName}`;
    const targetPath = path.join(this.baseDir, diskFilename);

    await fs.promises.writeFile(targetPath, input.buffer);

    const record = await prisma.storedFile.create({
      data: {
        filename: diskFilename,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        fileSize: BigInt(input.buffer.length),
        storagePath: targetPath,
        sha256Hash,
        storageDriver: 'local',
        createdById: input.userId ?? null,
      },
    });

    return {
      id: record.id,
      filename: record.filename,
      originalFilename: record.originalFilename,
      mimeType: record.mimeType,
      fileSize: Number(record.fileSize),
      storagePath: record.storagePath,
      sha256Hash: record.sha256Hash,
      createdAt: record.createdAt,
      createdById: record.createdById,
      storageDriver: record.storageDriver,
      s3Bucket: record.s3Bucket,
      s3Key: record.s3Key,
    };
  }

  async get(id: string): Promise<{ buffer: Buffer; record: StoredFileRecord } | null> {
    const record = await prisma.storedFile.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) return null;

    if (!fs.existsSync(record.storagePath)) {
      return null;
    }

    const buffer = await fs.promises.readFile(record.storagePath);
    return {
      buffer,
      record: {
        id: record.id,
        filename: record.filename,
        originalFilename: record.originalFilename,
        mimeType: record.mimeType,
        fileSize: Number(record.fileSize),
        storagePath: record.storagePath,
        sha256Hash: record.sha256Hash,
        createdAt: record.createdAt,
        createdById: record.createdById,
        storageDriver: record.storageDriver,
        s3Bucket: record.s3Bucket,
        s3Key: record.s3Key,
      },
    };
  }

  async delete(id: string, userId?: string | null): Promise<boolean> {
    const result = await prisma.storedFile.updateMany({
      where: { id, deletedAt: null },
      data: {
        deletedAt: new Date(),
        deletedById: userId ?? null,
      },
    });
    return result.count === 1;
  }

  async healthCheck(): Promise<{ ok: boolean; driver: string; detail?: string }> {
    try {
      await fs.promises.access(this.baseDir, fs.constants.R_OK | fs.constants.W_OK);
      return { ok: true, driver: 'local' };
    } catch (err) {
      return { ok: false, driver: 'local', detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
