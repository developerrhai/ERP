// Phase 20-C: Resumable local-to-S3 file migration tool with SHA-256 verification.
// Skips dump/ and client/ folders (PHASE-20 §4.7). Keeps local copies intact for 30 days.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prisma } from '../apps/api/src/core/db/prisma';
import { S3StorageService } from '../apps/api/src/core/storage/s3-storage';

const FORBIDDEN_PATH_SEGMENTS = [`${path.sep}dump${path.sep}`, `${path.sep}doc from clint${path.sep}`, `${path.sep}client${path.sep}`];

function isExcludedPath(filePath: string): boolean {
  const normalized = path.resolve(filePath).toLowerCase();
  return FORBIDDEN_PATH_SEGMENTS.some((seg) => normalized.includes(seg.toLowerCase()));
}

async function main() {
  const bucket = process.env.S3_BUCKET || 'sawant-erp-prod-docs-aps1';
  const region = process.env.AWS_REGION || 'ap-south-1';
  const prefix = process.env.S3_PREFIX || 'docs/';
  const kmsKeyId = process.env.S3_SSE_KMS_KEY_ID;
  const dryRun = process.argv.includes('--dry-run');
  const verifyOnly = process.argv.includes('--verify-only');

  const s3 = new S3StorageService({ bucket, region, prefix, kmsKeyId });

  const candidates = await prisma.storedFile.findMany({
    where: { deletedAt: null, storageDriver: verifyOnly ? 's3' : 'local' },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${candidates.length} stored_files (${verifyOnly ? 'verify-only' : 'migrate to s3'}, dryRun=${dryRun}).`);
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of candidates) {
    if (isExcludedPath(row.storagePath)) {
      skipped += 1;
      continue;
    }
    try {
      if (verifyOnly && row.s3Bucket && row.s3Key) {
        const remoteSha = await s3.getObjectSha256(row.s3Bucket, row.s3Key);
        if (remoteSha !== row.sha256Hash) {
          throw new Error(`Checksum mismatch for ${row.id}: expected ${row.sha256Hash}, got ${remoteSha}`);
        }
        await prisma.storedFile.update({ where: { id: row.id }, data: { s3VerifiedAt: new Date() } });
        migrated += 1;
        continue;
      }

      if (!fs.existsSync(row.storagePath)) {
        console.warn(`Missing local file ${row.storagePath} (${row.id}); skipping.`);
        skipped += 1;
        continue;
      }

      const buf = await fs.promises.readFile(row.storagePath);
      const localSha = createHash('sha256').update(buf).digest('hex');
      if (localSha !== row.sha256Hash) {
        throw new Error(`Local SHA-256 mismatch on ${row.id}: db=${row.sha256Hash}, disk=${localSha}`);
      }

      const key = s3.keyFor(row.originalFilename, row.sha256Hash, row.createdAt.toISOString().slice(0, 10));
      if (dryRun) {
        console.log(`[dry-run] ${row.id} -> s3://${bucket}/${key} (${buf.length} bytes, sha256=${localSha})`);
        migrated += 1;
        continue;
      }

      await s3.putObjectRaw(bucket, key, buf, row.mimeType, localSha);
      const remoteSha = await s3.getObjectSha256(bucket, key);
      if (remoteSha !== localSha) {
        throw new Error(`Remote S3 SHA-256 verification failed for ${row.id}`);
      }

      await prisma.storedFile.update({
        where: { id: row.id },
        data: {
          storageDriver: 's3',
          s3Bucket: bucket,
          s3Key: key,
          migratedAt: new Date(),
          s3VerifiedAt: new Date(),
        },
      });
      migrated += 1;
    } catch (err) {
      failed += 1;
      console.error(`Failed file ${row.id}:`, err);
    }
  }

  console.log(`Summary: migrated/verified=${migrated}, skipped=${skipped}, failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

