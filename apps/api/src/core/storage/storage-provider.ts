// apps/api/src/core/storage/storage-provider.ts
// Abstract storage interface for RHAI ERP files (Phase 03 Order 4 + Phase 20-C S3/Presigned support)

export interface StoredFileRecord {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  sha256Hash: string;
  createdAt: Date;
  createdById: string | null;
  storageDriver?: string;
  s3Bucket?: string | null;
  s3Key?: string | null;
}

export interface SaveFileInput {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  userId?: string | null;
}

export interface PresignedDownloadUrl {
  url: string;
  expiresInSeconds: number;
  record: StoredFileRecord;
}

export interface StorageProvider {
  readonly driverName: 'local' | 's3';
  save(input: SaveFileInput): Promise<StoredFileRecord>;
  get(id: string): Promise<{ buffer: Buffer; record: StoredFileRecord } | null>;
  delete(id: string, userId?: string | null): Promise<boolean>;
  getDownloadUrl?(id: string, expiresInSeconds?: number): Promise<PresignedDownloadUrl | null>;
  healthCheck?(): Promise<{ ok: boolean; driver: string; detail?: string }>;
}
