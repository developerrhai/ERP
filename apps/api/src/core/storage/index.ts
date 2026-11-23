// apps/api/src/core/storage/index.ts
import { env } from '../../config/env';
import { LocalDiskStorage } from './local-disk-storage';
import { S3StorageService } from './s3-storage';
import type { StorageProvider } from './storage-provider';

export * from './storage-provider';
export * from './local-disk-storage';
export * from './s3-storage';

export function createStorageProvider(): StorageProvider {
  if (env.STORAGE_DRIVER === 's3' && env.S3_BUCKET) {
    return new S3StorageService({
      bucket: env.S3_BUCKET,
      region: env.AWS_REGION,
      prefix: env.S3_PREFIX,
      kmsKeyId: env.S3_SSE_KMS_KEY_ID,
      presignTtlSeconds: env.S3_PRESIGN_TTL_SECONDS,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return new LocalDiskStorage();
}

export const defaultStorage: StorageProvider = createStorageProvider();
