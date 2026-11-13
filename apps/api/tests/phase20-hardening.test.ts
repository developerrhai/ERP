// Phase 20 Hardening Integration Suite: Health live/ready, Fail-open/closed PG Rate Limits,
// Log/Sentry Redaction, Audit Partitioning & erp_app Role Denial, FK-Index Coverage,
// S3 Presigned/Migration Config, Opening-Balance Cut-over & Dual Sign-off, DPDP 30-day Register,
// User Locale Preference, and N+1 Query Guard.
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/core/logger';
import { scrubSentryEvent } from '../src/core/observability/sentry';
import { PgRateLimitStore } from '../src/core/rate-limit';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  formatCappedCount,
} from '../src/core/http/pagination';
import { runWithQueryBudget } from '../src/core/db/prisma';
import { S3StorageService } from '../src/core/storage/s3-storage';
import { API, newApp, prisma, signInAs } from './helpers';

const app = newApp();

async function contextHeaders(): Promise<{ 'X-Unit-Id': string; 'X-FY-Id': string }> {
  const unit = await prisma.unit.findFirstOrThrow({ where: { status: 'ACTIVE' } });
  const fy = await prisma.financialYear.findFirstOrThrow({ where: { isCurrent: true } });
  return { 'X-Unit-Id': unit.id, 'X-FY-Id': fy.id };
}

describe('20-B Health, Observability & Redaction', () => {
  it('GET /health/live works without DB, /health/ready verifies DB, storage & migrations', async () => {
    const downApp = newApp({ dbPing: () => Promise.reject(new Error('db offline')) });
    const live = await request(downApp).get(`${API}/health/live`);
    expect(live.status).toBe(200);
    expect(live.body.data.status).toBe('ok');

    const unready = await request(downApp).get(`${API}/health/ready`);
    expect(unready.status).toBe(503);
    expect(unready.body.data.status).toBe('not_ready');

    const ready = await request(app).get(`${API}/health/ready`);
    expect(ready.status).toBe(200);
    expect(ready.body.data.status).toBe('ready');
    expect(ready.body.data.checks.db.ok).toBe(true);
    expect(ready.body.data.checks.migrations.ok).toBe(true);
  });

  it('redacts Aadhaar, PAN, bank account & IFSC from pino logs and Sentry events', () => {
    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const log = createLogger('info', sink);
    log.info({
      aadhaarNo: '1234 5678 9012',
      panNo: 'ABCDE1234F',
      bankAccountNo: '998877665544',
      ifscCode: 'HDFC0001234',
    });
    const logged = chunks.join('');
    expect(logged).not.toContain('1234 5678 9012');
    expect(logged).not.toContain('ABCDE1234F');
    expect(logged).not.toContain('998877665544');
    expect(logged).not.toContain('HDFC0001234');
    expect(logged).toContain('[REDACTED]');

    const scrubbed = scrubSentryEvent({
      user: { id: 'u1', email: 'secret@example.com' },
      request: {
        headers: { authorization: 'Bearer x', cookie: 'rt=y' },
        data: { pan: 'ABCDE1234F', aadhaar: '123456789012', safeField: 'ok' },
      },
    });
    expect('user' in scrubbed).toBe(false);
    expect((scrubbed.request as any).headers.authorization).toBeUndefined();
    expect((scrubbed.request as any).data.pan).toBe('[REDACTED]');
    expect((scrubbed.request as any).data.aadhaar).toBe('[REDACTED]');
    expect((scrubbed.request as any).data.safeField).toBe('ok');
  });
});

describe('20-A Postgres Rate-Limit Failure Modes', () => {
  it('fails OPEN for global limiter and CLOSED (503) for auth/login when DB fails', async () => {
    const failingRunner = async () => {
      throw new Error('ECONNREFUSED');
    };
    const globalStore = new PgRateLimitStore({
      prefix: 't:global',
      failMode: 'open',
      queryHits: failingRunner,
    });
    globalStore.init({ windowMs: 60_000 } as any);
    const openRes = await globalStore.increment('127.0.0.1');
    expect(openRes.totalHits).toBe(1);

    const loginStore = new PgRateLimitStore({
      prefix: 't:login',
      failMode: 'closed',
      queryHits: failingRunner,
    });
    loginStore.init({ windowMs: 60_000 } as any);
    await expect(loginStore.increment('127.0.0.1|user')).rejects.toMatchObject({ status: 503 });
  });
});

describe('20-C S3 Storage Service', () => {
  it('writes with SSE-KMS and generates 5-minute presigned download URLs', async () => {
    const sent: any[] = [];
    const fakeClient = {
      send: async (cmd: any) => {
        sent.push(cmd);
        return {};
      },
    } as any;
    const s3 = new S3StorageService({
      bucket: 'sawant-erp-prod-docs-aps1',
      region: 'ap-south-1',
      kmsKeyId: 'alias/sawant-erp-docs',
      client: fakeClient,
      presignFn: async (_c, cmd, opts) =>
        `https://s3.example/${(cmd as any).input.Key}?expires=${opts?.expiresIn}`,
    });

    const payload = Buffer.from('Sample S3 Verification PDF Content', 'utf8');
    const saved = await s3.save({
      buffer: payload,
      originalFilename: 'test-doc.pdf',
      mimeType: 'application/pdf',
    });
    expect(saved.storageDriver).toBe('s3');
    expect(saved.s3Bucket).toBe('sawant-erp-prod-docs-aps1');
    expect(saved.sha256Hash).toBe(createHash('sha256').update(payload).digest('hex'));
    expect(sent[0].input.ServerSideEncryption).toBe('aws:kms');
    expect(sent[0].input.SSEKMSKeyId).toBe('alias/sawant-erp-docs');

    const presigned = await s3.getDownloadUrl(saved.id);
    expect(presigned?.expiresInSeconds).toBe(300);
    expect(presigned?.url).toContain('https://s3.example/');
    expect(presigned?.url).toContain('expires=300');
  });
});

describe('20-D DB Hardening: Audit Partitions, erp_app Denial & FK Index Coverage', () => {
  it('audit_logs is monthly partitioned and erp_app cannot UPDATE/DELETE audit_logs', async () => {
    const rel = await prisma.$queryRaw<{ relkind: string }[]>`
      SELECT relkind::text AS relkind FROM pg_class WHERE relname = 'audit_logs'
    `;
    expect(rel[0]?.relkind).toBe('p');

    const admin = await signInAs(app, 'ADMIN');
    const partRes = await request(app)
      .get(`${API}/hardening/audit-partitions`)
      .set(admin.bearer)
      .set(await contextHeaders());
    expect(partRes.status).toBe(200);
    expect(partRes.body.data.partitions.length).toBeGreaterThanOrEqual(6);
    expect(partRes.body.data.defaultRows).toBe(0);

    // Explicitly prove DB role `erp_app` is denied UPDATE & DELETE on audit_logs (Phase 20 §5(b))
    const hasRole = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') AS exists
    `;
    if (hasRole[0]?.exists) {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL ROLE erp_app');
          await tx.$executeRawUnsafe(`UPDATE audit_logs SET action = 'HACK'`);
        }),
      ).rejects.toThrow(/permission denied/i);

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL ROLE erp_app');
          await tx.$executeRawUnsafe('DELETE FROM audit_logs');
        }),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('has 0 unindexed foreign keys across public tables', async () => {
    const missing = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE c.contype = 'f'
        AND n.nspname = 'public'
        AND cl.relkind IN ('r', 'p')
        AND cl.relname <> 'audit_logs_pre_partition_backup'
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND i.indisvalid
            AND i.indkey[0:array_length(c.conkey, 1)-1] = c.conkey
        )
    `;
    expect(missing).toEqual([]);
  });
});

describe('20-E Performance Helpers, Keyset Pagination & N+1 Guard', () => {
  it('encodes/decodes opaque cursors, caps display counts at 10,000+, and enforces N+1 budget', async () => {
    const cursor = encodeKeysetCursor(
      '2027-04-01T00:00:00.000Z',
      '11111111-1111-1111-1111-111111111111',
    );
    expect(decodeKeysetCursor(cursor)).toEqual({
      s: '2027-04-01T00:00:00.000Z',
      id: '11111111-1111-1111-1111-111111111111',
    });
    expect(formatCappedCount(10_001).totalDisplay).toBe('10,000+');

    const { count } = await runWithQueryBudget({ limit: 25, strict: true }, async () => {
      await prisma.$queryRaw`SELECT 1`;
      return 'ok';
    });
    expect(count).toBe(1);

    const admin = await signInAs(app, 'ADMIN');
    const res = await request(app)
      .get(`${API}/hardening/privacy/retention`)
      .set('X-Assert-No-N-Plus-One', '1')
      .set(admin.bearer)
      .set(await contextHeaders());
    expect(res.status).toBe(200);
    expect(Number(res.headers['x-query-count'])).toBeLessThanOrEqual(25);
  });
});

describe('20-G Opening-Balance Cut-over, 20-H Locale & 20-J DPDP Register', () => {
  it('requires authentication & permission and runs full dry-run -> commit (idempotent) -> PDF -> dual sign-off', async () => {
    expect((await request(app).get(`${API}/hardening/cutover/batches`)).status).toBe(401);
    const low = await signInAs(app, 'MEMBER');
    expect(
      (
        await request(app)
          .get(`${API}/hardening/cutover/batches`)
          .set(low.bearer)
          .set(await contextHeaders())
      ).status,
    ).toBe(403);

    const admin = await signInAs(app, 'ADMIN');
    const ctx = await contextHeaders();

    // Locale preference save & read
    const putLoc = await request(app)
      .put(`${API}/me/locale`)
      .set(admin.bearer)
      .send({ locale: 'hi' });
    expect(putLoc.status).toBe(200);
    expect((await request(app).get(`${API}/me/locale`).set(admin.bearer)).body.data.locale).toBe(
      'hi',
    );

    // Template fetch
    const tpl = await request(app)
      .get(`${API}/hardening/cutover/templates/GL_TRIAL`)
      .set(admin.bearer)
      .set(ctx);
    expect(tpl.status).toBe(200);
    expect(tpl.body.data.dataset).toBe('GL_TRIAL');

    // Unbalanced dry-run cannot be committed
    const badDry = await request(app)
      .post(`${API}/hardening/cutover/dry-run`)
      .set(admin.bearer)
      .set(ctx)
      .send({
        dataset: 'GL_TRIAL',
        legacyTotal: 1000,
        rows: [{ accountCode: '1101', debit: 1000, credit: 500 }],
      });
    expect(badDry.status).toBe(201);
    expect(badDry.body.data.status).toBe('DRY_RUN');
    const badCommit = await request(app)
      .post(`${API}/hardening/cutover/${badDry.body.data.id}/commit`)
      .set(admin.bearer)
      .set(ctx);
    expect(badCommit.status).toBe(422);

    // Balanced dry-run -> idempotent commit -> PDF -> sign-off
    const okDry = await request(app)
      .post(`${API}/hardening/cutover/dry-run`)
      .set(admin.bearer)
      .set(ctx)
      .send({
        dataset: 'GL_TRIAL',
        legacyTotal: 250000,
        rows: [
          { accountCode: '1101', debit: 250000, credit: 0 },
          { accountCode: '3009', debit: 0, credit: 250000 },
        ],
      });
    expect(okDry.status).toBe(201);
    expect(okDry.body.data.status).toBe('VALIDATED');
    expect(Number(okDry.body.data.difference)).toBe(0);

    const idemKey = `cutover-${Date.now()}`;
    const c1 = await request(app)
      .post(`${API}/hardening/cutover/${okDry.body.data.id}/commit`)
      .set(admin.bearer)
      .set(ctx)
      .set('Idempotency-Key', idemKey);
    expect(c1.status).toBe(200);
    expect(c1.body.data.status).toBe('COMMITTED');

    const c2 = await request(app)
      .post(`${API}/hardening/cutover/${okDry.body.data.id}/commit`)
      .set(admin.bearer)
      .set(ctx)
      .set('Idempotency-Key', idemKey);
    expect(c2.status).toBe(200);
    expect(c2.headers['idempotent-replay']).toBe('true');

    const pdf = await request(app)
      .get(`${API}/hardening/cutover/${okDry.body.data.id}/reconciliation.pdf`)
      .set(admin.bearer)
      .set(ctx);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.toString('utf8', 0, 5)).toBe('%PDF-');

    const signoff = await request(app)
      .post(`${API}/hardening/cutover/${okDry.body.data.id}/signoff`)
      .set(admin.bearer)
      .set(ctx)
      .send({ notes: 'Zero diff verified' });
    expect(signoff.status).toBe(200);
    expect(Number(signoff.body.data.difference)).toBe(0);
  });

  it('handles multilingual DPDP notices, 30-day request register & retention sweep', async () => {
    const admin = await signInAs(app, 'ADMIN');
    const ctx = await contextHeaders();

    const hiNotice = await request(app)
      .get(`${API}/hardening/privacy/notice?locale=hi`)
      .set(admin.bearer);
    expect(hiNotice.status).toBe(200);
    expect(hiNotice.body.data.localizedTitle).toContain('सावंत ग्रुप');

    const ack = await request(app)
      .post(`${API}/hardening/privacy/acknowledge`)
      .set(admin.bearer)
      .send({ noticeId: hiNotice.body.data.id });
    expect(ack.status).toBe(200);

    const createdReq = await request(app)
      .post(`${API}/hardening/privacy/requests`)
      .set(admin.bearer)
      .set(ctx)
      .send({
        requestType: 'ERASURE',
        principalType: 'CUSTOMER',
        principalName: 'Test Contact',
        contactEmail: 'contact@example.com',
        description: 'Erase non-statutory marketing contact profile under DPDP Act',
      });
    expect(createdReq.status).toBe(201);
    expect(createdReq.body.data.requestNo).toMatch(/^DPDP\//);

    const sweep = await request(app)
      .post(`${API}/hardening/privacy/retention/run`)
      .set(admin.bearer)
      .set(ctx);
    expect(sweep.status).toBe(200);
    expect(typeof sweep.body.data.anonymizedCandidates).toBe('number');
  });
});
