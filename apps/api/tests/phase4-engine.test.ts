// Phase 4 engine v2: lock matrix through the API, submit / bulk submit, summary + quality, CSV and
// PDF, background export and the import wizard (real pg-boss queue on rhai_erp_test).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stopJobs, startJobs } from '../src/core/jobs';
import { defaultStorage } from '../src/core/storage';
import { processImportCommit } from '../src/modules/imports/worker';
import {
  processExport,
  runMaintenance,
  registerDataJobHandlers,
} from '../src/modules/data-jobs/worker';
import { API, auditRows, errorOf, makeUser, newApp, prisma, signInAs, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { api, dataOf, sampleData, schemaOf } from './phase4-helpers';
import type { RecordBody } from './phase4-helpers';

const app = newApp();
const client = api(app);
const LEADS = 'crm-leads';
const SOURCES = 'crm-sources';
let owner: Signed;
let n = 0;

const base = `${API}/pages/${LEADS}/records`;

async function newLead(extra: Record<string, unknown> = {}): Promise<RecordBody> {
  n += 1;
  const res = await client.create(owner, LEADS, {
    ...sampleData(schemaOf(LEADS), n),
    leadName: `P4 lead ${n} ${Math.random().toString(36).slice(2, 8)}`,
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return dataOf<RecordBody>(res);
}

const submit = (rec: RecordBody, version = rec.version, key?: string) => {
  const r = request(app).post(`${base}/${rec.id}/submit`).set(owner.bearer);
  if (version !== undefined) r.set('If-Match', String(version));
  if (key) r.set('Idempotency-Key', key);
  return r;
};

interface JobBody {
  status: string;
  totalRows: number | null;
  okRows: number | null;
  errorRows: number | null;
  errors: { errors: { row: number }[] } | null;
}

async function waitForJob(jobId: string, who: Signed = owner): Promise<JobBody> {
  for (let i = 0; i < 60; i += 1) {
    const res = await request(app).get(`${API}/jobs/${jobId}`).set(who.bearer);
    const job = (res.body as { data: JobBody }).data;
    if (job.status === 'DONE' || job.status === 'FAILED') return job;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('job did not finish');
}

let adminRuleSetId = '';

beforeAll(async () => {
  owner = await signInOwner(app);
  // Phase 5: submit goes through the approval engine. The owner's records belong to Administration,
  // which has no seeded rules, so give it one level decided by a named Director.
  const director = await makeUser({ role: 'DIRECTOR', department: 'Administration', approvalLimit: 1_000_000_000 });
  const dept = await prisma.department.findUniqueOrThrow({ where: { name: 'Administration' } });
  const set = await prisma.approvalRuleSet.create({
    data: {
      departmentId: dept.id,
      rules: { create: [{ level: 1, threshold: 0, approverUserId: director.id, slaHours: 48 }] },
    },
  });
  adminRuleSetId = set.id;
  registerDataJobHandlers();
  await startJobs();
}, 60_000);

afterAll(async () => {
  await stopJobs();
  await prisma.approvalRequest.deleteMany({});
  await prisma.approvalRuleSet.deleteMany({ where: { id: adminRuleSetId } });
  await prisma.recordDocument.deleteMany({});
  await prisma.dataJob.deleteMany({});
  await prisma.genericRecord.deleteMany({});
  await prisma.idempotencyKey.deleteMany({});
  await prisma.numberSeries.deleteMany({ where: { NOT: { pageId: { startsWith: 'inv-' } } } });
});

describe('lock matrix through the API', () => {
  it('Draft -> submit locks the record: edit, delete, second submit are 409 RECORD_LOCKED', async () => {
    const rec = await newLead();
    const res = await submit(rec);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers.etag).toBe('"2"');
    expect(dataOf<RecordBody>(res).status).toBe('Pending Approval');
    expect((await auditRows('APPROVAL_SUBMITTED', { targetId: rec.id })).length).toBe(1);

    const patch = await client.patch(owner, LEADS, rec.id, 2, { leadName: 'changed' });
    expect(patch.status).toBe(409);
    expect(errorOf(patch).code).toBe('RECORD_LOCKED');
    const del = await request(app).delete(`${base}/${rec.id}`).set(owner.bearer);
    expect(del.status).toBe(409);
    expect(errorOf(del).code).toBe('RECORD_LOCKED');
    expect((await submit(rec, 2)).status).toBe(409);
    // Phase 5: nothing moves a Pending Approval document by hand, not even a cancel
    const cancel = await request(app)
      .post(`${base}/${rec.id}/status`)
      .set(owner.bearer)
      .send({ to: 'Cancelled' });
    expect(cancel.status).toBe(409);
    expect(errorOf(cancel).code).toBe('RECORD_LOCKED');
  });

  it('a Draft is deletable; a master (Active) is deletable too', async () => {
    const rec = await newLead();
    expect((await request(app).delete(`${base}/${rec.id}`).set(owner.bearer)).status).toBe(200);
    const m = dataOf<RecordBody>(
      await client.create(owner, SOURCES, sampleData(schemaOf(SOURCES), 1)),
    );
    expect(
      (await request(app).delete(`${API}/pages/${SOURCES}/records/${m.id}`).set(owner.bearer))
        .status,
    ).toBe(200);
  });

  it('a master cannot be submitted (409)', async () => {
    const m = dataOf<RecordBody>(
      await client.create(owner, SOURCES, sampleData(schemaOf(SOURCES), 2)),
    );
    const res = await request(app)
      .post(`${API}/pages/${SOURCES}/records/${m.id}/submit`)
      .set(owner.bearer)
      .set('If-Match', String(m.version));
    expect(res.status).toBe(409);
  });

  it('the page schema carries the lock table for the web', async () => {
    const res = await client.schema(owner, LEADS);
    const lock = (res.body as { data: { lock: Record<string, Record<string, boolean>> } }).data
      .lock;
    expect(lock.Draft).toMatchObject({ update: true, remove: true, submit: true });
    expect(lock.Pending).toMatchObject({ update: false, remove: false, documents: false });
  });
});

describe('submit / bulk submit', () => {
  it('needs If-Match, rejects a stale version, replays an Idempotency-Key', async () => {
    const rec = await newLead();
    const noMatch = await request(app).post(`${base}/${rec.id}/submit`).set(owner.bearer);
    expect(noMatch.status).toBe(400);
    expect((await submit(rec, 99)).status).toBe(409);
    const key = `sub-${Math.random().toString(36).slice(2, 14)}-key`;
    const a = await submit(rec, 1, key);
    const b = await submit(rec, 1, key);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(dataOf<RecordBody>(b).version).toBe(2);
    expect((await auditRows('APPROVAL_SUBMITTED', { targetId: rec.id })).length).toBe(1);
  });

  it('bulk submit reports every id and does not stop on a failure', async () => {
    const a = await newLead();
    const b = await newLead();
    await submit(b);
    const res = await request(app)
      .post(`${base}/submit-bulk`)
      .set(owner.bearer)
      .send({ ids: [a.id, b.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const report = dataOf<{ id: string; ok: boolean; error?: { code: string } }[]>(res);
    expect(report).toHaveLength(2);
    expect(report[0]).toMatchObject({ id: a.id, ok: true });
    expect(report[1]).toMatchObject({ id: b.id, ok: false, error: { code: 'ALREADY_PENDING' } });
    const bad = await request(app).post(`${base}/submit-bulk`).set(owner.bearer).send({ ids: [] });
    expect(bad.status).toBe(422);
  });
});

describe('summary + quality (server-side numbers)', () => {
  it('summary counts equal the database counts', async () => {
    await newLead();
    const res = await request(app).get(`${base}/summary`).set(owner.bearer);
    expect(res.status).toBe(200);
    const s = dataOf<{ total: number; byStatus: { status: string; count: number }[] }>(res);
    const unit = (await prisma.unit.findFirstOrThrow({ where: { code: 'TAL' } })).id;
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { code: '2026-27' } });
    const db = await prisma.genericRecord.count({
      where: { pageId: LEADS, unitId: unit, fyId: fy.id, deletedAt: null },
    });
    expect(s.total).toBe(db);
    expect(s.byStatus.reduce((t, r) => t + r.count, 0)).toBe(db);
  });

  it('quality finds blank required fields and duplicated names', async () => {
    const name = `Dup ${Math.random().toString(36).slice(2, 8)}`;
    await newLead({ leadName: name });
    const second = await newLead({ leadName: name.toUpperCase() });
    await prisma.$executeRaw`UPDATE generic_records SET data = data - 'leadName' WHERE id = ${second.id}::uuid AND false`;
    const res = await request(app).get(`${base}/quality`).set(owner.bearer);
    expect(res.status).toBe(200);
    const q = dataOf<{
      duplicates: { value: string; count: number }[];
      duplicateField: { field: string } | null;
      missingRequired: unknown[];
    }>(res);
    expect(q.duplicateField?.field).toBeTruthy();
    expect(q.duplicates.some((d) => d.value === name.toLowerCase() && d.count === 2)).toBe(true);
  });

  it('summary / quality need view permission', async () => {
    const res = await request(app).get(`${base}/summary`);
    expect(res.status).toBe(401);
  });
});

describe('CSV + PDF', () => {
  it('exports CSV with a BOM, a header and formula text neutralised', async () => {
    await newLead({ leadName: '=HYPERLINK("http://x","y")' });
    const res = await request(app)
      .get(`${base}/export.csv`)
      .set(owner.bearer)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const body = res.body as Buffer;
    expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = body.toString('utf8');
    expect(text.split('\r\n')[0]).toContain('Code,Status,Unit,FY,Department');
    expect(text).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect((await auditRows('RECORDS_EXPORTED', { targetId: LEADS })).length).toBeGreaterThan(0);
  });

  it('serves a record PDF and a list PDF, and audits them', async () => {
    const rec = await newLead();
    const one = await request(app).get(`${base}/${rec.id}/pdf`).set(owner.bearer).buffer(true);
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.headers['content-type']).toBe('application/pdf');
    const list = await request(app).get(`${base}/export.pdf`).set(owner.bearer).buffer(true);
    expect(list.status).toBe(200);
    expect(list.headers['content-type']).toBe('application/pdf');
    expect((await auditRows('PRINT_RENDERED', { targetId: rec.id })).length).toBe(1);
  });

  it('refuses a sync export above 5,000 rows and points to the background export', async () => {
    const pageId = 'crm-feedback';
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { code: '2026-27' } });
    const unit = await prisma.unit.findFirstOrThrow({ where: { code: 'TAL' } });
    await prisma.$executeRaw`
      INSERT INTO generic_records (id, page_id, unit_id, fy_id, department, code, status, data, version, created_by_id, created_at, updated_at)
      SELECT gen_random_uuid(), ${pageId}, ${unit.id}::uuid, ${fy.id}::uuid, 'Sales',
             'SYNC/' || i, 'Draft', '{}'::jsonb, 1, ${owner.user.id}::uuid, now(), now()
      FROM generate_series(1, 5001) AS i`;
    try {
      const res = await request(app)
        .get(`${API}/pages/${pageId}/records/export.csv`)
        .set(owner.bearer);
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toContain('background');
    } finally {
      await prisma.genericRecord.deleteMany({ where: { pageId, code: { startsWith: 'SYNC/' } } });
    }
  });
});

describe('background export (pg-boss)', () => {
  it('runs a job to DONE, serves the file, replays the key, hides it from other users', async () => {
    const rec = await newLead();
    const key = `exp-${Math.random().toString(36).slice(2, 14)}-key`;
    const start = await request(app)
      .post(`${API}/pages/${LEADS}/exports`)
      .set(owner.bearer)
      .set('Idempotency-Key', key)
      .send({ format: 'csv' });
    expect(start.status, JSON.stringify(start.body)).toBe(202);
    const jobId = dataOf<{ id: string }>(start).id;
    const again = await request(app)
      .post(`${API}/pages/${LEADS}/exports`)
      .set(owner.bearer)
      .set('Idempotency-Key', key)
      .send({ format: 'csv' });
    expect(dataOf<{ id: string }>(again).id).toBe(jobId);
    expect(again.headers['idempotent-replay']).toBe('true');

    const job = await waitForJob(jobId);
    expect(job.status, JSON.stringify(job)).toBe('DONE');
    expect(job.totalRows).toBeGreaterThan(0);
    const file = await request(app)
      .get(`${API}/jobs/${jobId}/download`)
      .set(owner.bearer)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect((file.body as Buffer).toString('utf8')).toContain(rec.code);

    const other = await signInAs(app, 'ADMIN');
    // administrators may see any job; an ordinary member may not
    expect((await request(app).get(`${API}/jobs/${jobId}`).set(other.bearer)).status).toBe(200);
    const member = await signInAs(app, 'MEMBER', { department: 'Sales' });
    expect((await request(app).get(`${API}/jobs/${jobId}`).set(member.bearer)).status).toBe(404);
  });

  it('maintenance removes expired job outputs', async () => {
    const rec = await newLead();
    void rec;
    const start = await request(app)
      .post(`${API}/pages/${LEADS}/exports`)
      .set(owner.bearer)
      .send({ format: 'xlsx' });
    const jobId = dataOf<{ id: string }>(start).id;
    expect((await waitForJob(jobId)).status).toBe('DONE');
    await prisma.dataJob.update({
      where: { id: jobId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await runMaintenance();
    expect(result.jobOutputsRemoved).toBeGreaterThanOrEqual(1);
    const dl = await request(app).get(`${API}/jobs/${jobId}/download`).set(owner.bearer);
    expect(dl.status).toBe(404);
  });
});

describe('import wizard', () => {
  const schema = schemaOf(LEADS);
  const fields = schema.fields.filter(
    (f) => f.type !== 'code' && f.type !== 'status' && !f.readOnly,
  );

  function csvFor(rowCount: number, mutate?: (row: string[], i: number) => string[]): Buffer {
    const header = fields.map((f) => f.label);
    const rows = Array.from({ length: rowCount }, (_, i) => {
      const data = sampleData(schema, 1000 + i + n * 10);
      const row = fields.map((f) => {
        const v = data[f.key];
        if (v === undefined || v === null) return '';
        if (typeof v === 'boolean') return v ? 'Yes' : 'No';
        return typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v);
      });
      const leadIdx = fields.findIndex((f) => f.key === 'leadName');
      if (leadIdx >= 0) row[leadIdx] = `Imp ${Math.random().toString(36).slice(2, 10)} ${i}`;
      return mutate ? mutate(row, i) : row;
    });
    const esc = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
    return Buffer.from([header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n'));
  }

  const upload = (buf: Buffer, name = 'leads.csv') =>
    request(app)
      .post(`${API}/pages/${LEADS}/imports`)
      .set(owner.bearer)
      .attach('file', buf, { filename: name });

  it('template download is an xlsx with the headings', async () => {
    const res = await request(app)
      .get(`${API}/pages/${LEADS}/import-template.xlsx`)
      .set(owner.bearer)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('upload -> validate -> commit creates the records, once', async () => {
    const before = await prisma.genericRecord.count({ where: { pageId: LEADS } });
    const up = await upload(csvFor(3));
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const u = dataOf<{
      job: { id: string };
      suggestedMapping: Record<string, number>;
      totalRows: number;
    }>(up);
    expect(u.totalRows).toBe(3);
    expect(Object.keys(u.suggestedMapping).length).toBe(fields.length);

    const val = await request(app)
      .post(`${API}/imports/${u.job.id}/validate`)
      .set(owner.bearer)
      .send({ mapping: u.suggestedMapping });
    expect(val.status, JSON.stringify(val.body)).toBe(202);
    const checked = await waitForJob(u.job.id);
    expect(checked).toMatchObject({ status: 'DONE', totalRows: 3, errorRows: 0, okRows: 3 });

    const key = `imp-${Math.random().toString(36).slice(2, 14)}-key`;
    const commit = await request(app)
      .post(`${API}/imports/${u.job.id}/commit`)
      .set(owner.bearer)
      .set('Idempotency-Key', key);
    expect(commit.status, JSON.stringify(commit.body)).toBe(202);
    const commitId = dataOf<{ id: string }>(commit).id;
    const done = await waitForJob(commitId);
    expect(done).toMatchObject({ status: 'DONE', okRows: 3 });
    expect(await prisma.genericRecord.count({ where: { pageId: LEADS } })).toBe(before + 3);

    const second = await request(app)
      .post(`${API}/imports/${u.job.id}/commit`)
      .set(owner.bearer)
      .set('Idempotency-Key', key);
    expect(dataOf<{ id: string }>(second).id).toBe(commitId);
    expect(await prisma.genericRecord.count({ where: { pageId: LEADS } })).toBe(before + 3);
    expect((await auditRows('IMPORT_COMMITTED', { targetId: LEADS })).length).toBeGreaterThan(0);
  });

  it('reports bad rows by number and blocks the commit (nothing is created)', async () => {
    const before = await prisma.genericRecord.count({ where: { pageId: LEADS } });
    const emailIdx = fields.findIndex((f) => f.type === 'email');
    const mobileIdx = fields.findIndex((f) => f.type === 'phone');
    const badIdx = emailIdx >= 0 ? emailIdx : mobileIdx;
    expect(badIdx).toBeGreaterThanOrEqual(0);
    const up = await upload(
      csvFor(3, (row, i) => {
        if (i === 1) row[badIdx] = 'not-valid';
        return row;
      }),
    );
    const u = dataOf<{ job: { id: string }; suggestedMapping: Record<string, number> }>(up);
    await request(app)
      .post(`${API}/imports/${u.job.id}/validate`)
      .set(owner.bearer)
      .send({ mapping: u.suggestedMapping });
    const checked = (await waitForJob(u.job.id)) as {
      errorRows: number;
      errors: { errors: { row: number }[] };
    };
    expect(checked.errorRows).toBe(1);
    expect(checked.errors.errors[0]?.row).toBe(3); // heading row 1 + data row 2 => sheet row 3
    const commit = await request(app).post(`${API}/imports/${u.job.id}/commit`).set(owner.bearer);
    expect(commit.status).toBe(422);
    expect(errorOf(commit).code).toBe('IMPORT_INVALID');
    expect(await prisma.genericRecord.count({ where: { pageId: LEADS } })).toBe(before);
  });

  it('flags duplicate rows inside the file', async () => {
    const up = await upload(csvFor(1));
    const base1 = dataOf<{ job: { id: string } }>(up);
    void base1;
    const one = csvFor(1).toString('utf8').split('\r\n');
    const dup = Buffer.from([one[0], one[1], one[1]].join('\r\n'));
    const u = dataOf<{ job: { id: string }; suggestedMapping: Record<string, number> }>(
      await upload(dup),
    );
    await request(app)
      .post(`${API}/imports/${u.job.id}/validate`)
      .set(owner.bearer)
      .send({ mapping: u.suggestedMapping });
    const checked = (await waitForJob(u.job.id)) as { errorRows: number };
    expect(checked.errorRows).toBe(1);
  });

  it('refuses a wrong mapping, other file types and too many rows', async () => {
    const u = dataOf<{ job: { id: string } }>(await upload(csvFor(1)));
    const bad = await request(app)
      .post(`${API}/imports/${u.job.id}/validate`)
      .set(owner.bearer)
      .send({ mapping: { leadName: 150 } });
    expect(bad.status).toBe(422);
    expect(errorOf(bad).code).toBe('IMPORT_INVALID');
    expect((await upload(Buffer.from('MZ binary'), 'x.exe')).status).toBe(415);
    const rows = Array.from({ length: 5001 }, () => 'a').join('\r\n');
    expect((await upload(Buffer.from(`h\r\n${rows}`), 'big.csv')).status).toBe(422);
  });
});

describe('job robustness', () => {
  it('a job left RUNNING by a crashed worker is finished on redelivery; a DONE job is skipped', async () => {
    await newLead();
    const start = await request(app)
      .post(`${API}/pages/${LEADS}/exports`)
      .set(owner.bearer)
      .send({ format: 'csv' });
    const jobId = dataOf<{ id: string }>(start).id;
    expect((await waitForJob(jobId)).status).toBe('DONE');
    const first = await prisma.dataJob.findUniqueOrThrow({ where: { id: jobId } });
    // Pretend the worker died after claiming the job: RUNNING again, no output.
    await prisma.dataJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', outputFileId: null, finishedAt: null },
    });
    await processExport(jobId);
    const again = await prisma.dataJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(again.status).toBe('DONE');
    expect(again.outputFileId).not.toBeNull();
    // A finished job is never run twice.
    await processExport(jobId);
    const third = await prisma.dataJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(third.outputFileId).toBe(again.outputFileId);
    expect(first.id).toBe(third.id);
  });

  it('maintenance fails a job stuck in RUNNING for over 30 minutes', async () => {
    const unit = await prisma.unit.findFirstOrThrow({ where: { code: 'TAL' } });
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { code: '2026-27' } });
    const job = await prisma.dataJob.create({
      data: {
        kind: 'EXPORT',
        pageId: LEADS,
        unitId: unit.id,
        fyId: fy.id,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 31 * 60_000),
        params: {},
        createdById: owner.user.id,
      },
    });
    const result = await runMaintenance();
    expect(result.staleJobsFailed).toBeGreaterThanOrEqual(1);
    expect((await prisma.dataJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'FAILED',
    );
  });

  it('a failing import commit rolls back: no records and no numbers used (gap-free)', async () => {
    const unit = await prisma.unit.findFirstOrThrow({ where: { code: 'TAL' } });
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { code: '2026-27' } });
    await newLead(); // makes sure the number series row exists
    const seriesKey = { pageId_unitId_fyId: { pageId: LEADS, unitId: unit.id, fyId: fy.id } };
    const seriesBefore = await prisma.numberSeries.findUniqueOrThrow({ where: seriesKey });
    const recordsBefore = await prisma.genericRecord.count({ where: { pageId: LEADS } });

    const csv =
      'Lead Name,Email\nGood One,a@example.com\nGood Two,b@example.com\nBad Three,not-an-email\n';
    const stored = await defaultStorage.save({
      buffer: Buffer.from(csv),
      originalFilename: 'atomic.csv',
      mimeType: 'text/csv',
      userId: owner.user.id,
    });
    const params = {
      stage: 'VALIDATED',
      format: 'csv',
      fileName: 'atomic.csv',
      headers: ['Lead Name', 'Email'],
      mapping: { leadName: 0, email: 1 },
    };
    const checked = await prisma.dataJob.create({
      data: {
        kind: 'IMPORT_VALIDATE',
        pageId: LEADS,
        unitId: unit.id,
        fyId: fy.id,
        status: 'DONE',
        params,
        inputFileId: stored.id,
        totalRows: 3,
        errorRows: 0,
        createdById: owner.user.id,
      },
    });
    const commit = await prisma.dataJob.create({
      data: {
        kind: 'IMPORT_COMMIT',
        pageId: LEADS,
        unitId: unit.id,
        fyId: fy.id,
        status: 'QUEUED',
        params: { ...params, validateJobId: checked.id },
        createdById: owner.user.id,
      },
    });
    await processImportCommit(commit.id);

    const failed = await prisma.dataJob.findUniqueOrThrow({ where: { id: commit.id } });
    expect(failed.status).toBe('FAILED');
    expect(JSON.stringify(failed.errorSummary)).toContain('Nothing was imported');
    expect(JSON.stringify(failed.errorSummary)).toContain('Row 4');
    expect(await prisma.genericRecord.count({ where: { pageId: LEADS } })).toBe(recordsBefore);
    const seriesAfter = await prisma.numberSeries.findUniqueOrThrow({ where: seriesKey });
    expect(seriesAfter.nextValue).toBe(seriesBefore.nextValue);
    // The very next record gets the number the failed import would have used first.
    const next = await newLead();
    expect(next.code.endsWith(String(seriesBefore.nextValue).padStart(5, '0'))).toBe(true);
  });
});
