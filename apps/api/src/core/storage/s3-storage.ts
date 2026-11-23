// Phase 20-C (§4.7): Amazon S3 StorageProvider implementation (AWS SDK v3, SSE-KMS, presigned downloads).
// Uses EC2 IAM instance-role / standard AWS SDK credential chain (no static keys in code).
// Supports local-disk fallback when a historical file has not yet been migrated to S3.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '../db/prisma';
import type {
  PresignedDownloadUrl,
  SaveFileInput,
  StorageProvider,
  StoredFileRecord,
} from './storage-provider';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  prefix?: string;
  kmsKeyId?: string;
  presignTtlSeconds?: number;
  endpoint?: string;
  forcePathStyle?: boolean;
  client?: S3Client;
  presignFn?: typeof getSignedUrl;
}

function buildContentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
    const arr = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(arr);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class S3StorageService implements StorageProvider {
  public readonly driverName = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly kmsKeyId?: string;
  private readonly presignTtlSeconds: number;
  private readonly presignFn: typeof getSignedUrl;

  constructor(cfg: S3StorageConfig) {
    this.bucket = cfg.bucket;
    this.prefix = (cfg.prefix ?? 'docs/').replace(/^\/+/, '');
    if (this.prefix && !this.prefix.endsWith('/')) this.prefix += '/';
    this.kmsKeyId = cfg.kmsKeyId || undefined;
    this.presignTtlSeconds = cfg.presignTtlSeconds ?? 300;
    this.presignFn = cfg.presignFn ?? getSignedUrl;
    this.client =
      cfg.client ??
      new S3Client({
        region: cfg.region,
        ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
        ...(cfg.forcePathStyle ? { forcePathStyle: true } : {}),
      });
  }

  public keyFor(originalFilename: string, sha256Hash: string, datePrefix?: string): string {
    const sanitizedName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const dp = datePrefix ?? new Date().toISOString().slice(0, 10);
    return `${this.prefix}${dp}/${sha256Hash.slice(0, 12)}_${sanitizedName}`;
  }

  async save(input: SaveFileInput): Promise<StoredFileRecord> {
    const sha256Hash = createHash('sha256').update(input.buffer).digest('hex');
    const sanitizedName = input.originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const datePrefix = new Date().toISOString().slice(0, 10);
    const filename = `${datePrefix}_${sha256Hash.slice(0, 12)}_${sanitizedName}`;
    const s3Key = this.keyFor(input.originalFilename, sha256Hash, datePrefix);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: input.buffer,
        ContentType: input.mimeType,
        ContentLength: input.buffer.length,
        ServerSideEncryption: 'aws:kms',
        ...(this.kmsKeyId ? { SSEKMSKeyId: this.kmsKeyId } : {}),
        Metadata: {
          sha256: sha256Hash,
        },
      }),
    );

    const record = await prisma.storedFile.create({
      data: {
        filename,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        fileSize: BigInt(input.buffer.length),
        storagePath: `s3://${this.bucket}/${s3Key}`,
        sha256Hash,
        storageDriver: 's3',
        s3Bucket: this.bucket,
        s3Key,
        migratedAt: new Date(),
        s3VerifiedAt: new Date(),
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

  async putObjectRaw(bucket: string, key: string, buffer: Buffer, mimeType: string, sha256Hash: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ContentLength: buffer.length,
        ServerSideEncryption: 'aws:kms',
        ...(this.kmsKeyId ? { SSEKMSKeyId: this.kmsKeyId } : {}),
        Metadata: { sha256: sha256Hash },
      }),
    );
  }

  async getObjectSha256(bucket: string, key: string): Promise<string> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const buf = await streamToBuffer(out.Body);
    return createHash('sha256').update(buf).digest('hex');
  }

  async get(id: string): Promise<{ buffer: Buffer; record: StoredFileRecord } | null> {
    const record = await prisma.storedFile.findFirst({ where: { id, deletedAt: null } });
    if (!record) return null;

    if (record.storageDriver === 's3' && record.s3Bucket && record.s3Key) {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: record.s3Bucket, Key: record.s3Key }),
      );
      const buffer = await streamToBuffer(out.Body);
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

    if (!fs.existsSync(record.storagePath)) return null;
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

  async getDownloadUrl(
    id: string,
    expiresInSeconds: number = this.presignTtlSeconds,
  ): Promise<PresignedDownloadUrl | null> {
    const record = await prisma.storedFile.findFirst({ where: { id, deletedAt: null } });
    if (!record || record.storageDriver !== 's3' || !record.s3Bucket || !record.s3Key) {
      return null;
    }
    const cmd = new GetObjectCommand({
      Bucket: record.s3Bucket,
      Key: record.s3Key,
      ResponseContentDisposition: buildContentDisposition(record.originalFilename),
      ResponseContentType: record.mimeType,
    });
    const url = await this.presignFn(this.client, cmd, { expiresIn: expiresInSeconds });
    return {
      url,
      expiresInSeconds,
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
      data: { deletedAt: new Date(), deletedById: userId ?? null },
    });
    return result.count === 1;
  }

  async healthCheck(): Promise<{ ok: boolean; driver: string; detail?: string }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true, driver: 's3' };
    } catch (err) {
      return { ok: false, driver: 's3', detail: err instanceof Error ? err.message : String(err) };
    }
  }
}

