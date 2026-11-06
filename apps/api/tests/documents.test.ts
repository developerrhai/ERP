// Phase 4 documents: upload pipeline (type sniffing, size, scan), lock matrix, download, remove, audit.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, auditRows, errorOf, newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { api, dataOf, sampleData, schemaOf } from './phase4-helpers';
import type { RecordBody } from './phase4-helpers';

const app = newApp();
const client = api(app);
const LEADS = 'crm-leads';
let owner: Signed;
let n = 0;

const pdf = (extra = ''): Buffer => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n${extra}\n%%EOF`);
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

interface DocBody {
  id: string;
  fileName: string;
  scanStatus: string;
  size: number;
  title: string;
}

async function newRecord(): Promise<RecordBody> {
  n += 1;
  const res = await client.create(owner, LEADS, {
    ...sampleData(schemaOf(LEADS), n),
    leadName: `Doc lead ${n} ${Math.random().toString(36).slice(2, 8)}`,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return dataOf<RecordBody>(res);
}

const url = (rec: RecordBody, tail = '') =>
  `${API}/pages/${LEADS}/records/${rec.id}/documents${tail}`;

function upload(
  rec: RecordBody,
  buf: Buffer,
  filename: string,
  extra: Record<string, string> = {},
  key?: string,
) {
  const r = request(app).post(url(rec)).set(owner.bearer);
  if (key) r.set('Idempotency-Key', key);
  for (const [k, v] of Object.entries(extra)) r.field(k, v);
  return r.attach('file', buf, { filename });
}

const docOf = (res: request.Response) => (res.body as { data: DocBody }).data;

beforeAll(async () => {
  owner = await signInOwner(app);
});

afterAll(async () => {
  await prisma.recordDocument.deleteMany({});
  await prisma.genericRecord.deleteMany({});
  await prisma.idempotencyKey.deleteMany({});
  await prisma.numberSeries.deleteMany({ where: { NOT: { pageId: { startsWith: 'inv-' } } } });
});

describe('documents', () => {
  it('uploads, lists, downloads the same bytes and audits', async () => {
    const rec = await newRecord();
    const body = pdf('hello रेडी हँड');
    const res = await upload(rec, body, 'Quote 1.pdf', { title: 'Quote', docType: 'INVOICE' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const doc = docOf(res);
    expect(doc).toMatchObject({ scanStatus: 'CLEAN', size: body.length, title: 'Quote' });

    const list = await request(app).get(url(rec)).set(owner.bearer);
    expect((list.body as { data: unknown[] }).data).toHaveLength(1);

    const dl = await request(app)
      .get(url(rec, `/${doc.id}/download`))
      .set(owner.bearer)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, body)).toBe(0);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect((await auditRows('DOCUMENT_ADDED', { targetId: rec.id })).length).toBe(1);
    expect((await auditRows('DOCUMENT_DOWNLOADED', { targetId: rec.id })).length).toBe(1);
  });

  it('rejects the EICAR test file (422 FILE_INFECTED) and stores nothing', async () => {
    const rec = await newRecord();
    const res = await upload(rec, Buffer.from(EICAR), 'notes.csv');
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('FILE_INFECTED');
    expect(await prisma.recordDocument.count({ where: { recordId: rec.id } })).toBe(0);
    expect((await auditRows('DOCUMENT_REJECTED', { targetId: rec.id })).length).toBe(1);
  });

  it('rejects content that does not match the extension (415)', async () => {
    const rec = await newRecord();
    const exe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00 fake exe');
    for (const name of ['setup.exe', 'invoice.pdf', 'page.html', 'pic.svg']) {
      const res = await upload(rec, exe, name);
      expect(res.status, name).toBe(415);
      expect(errorOf(res).code).toBe('FILE_TYPE_NOT_ALLOWED');
    }
    // a real PDF named .png is also refused
    expect((await upload(rec, pdf(), 'x.png')).status).toBe(415);
  });

  it('refuses a file over 10 MB (413)', async () => {
    const rec = await newRecord();
    const big = Buffer.concat([pdf(), Buffer.alloc(10 * 1024 * 1024 + 10, 0x20)]);
    const res = await upload(rec, big, 'big.pdf');
    expect(res.status).toBe(413);
    expect(errorOf(res).code).toBe('FILE_TOO_LARGE');
  });

  it('strips path parts from the file name', async () => {
    const rec = await newRecord();
    const res = await upload(rec, pdf(), '../../etc/evil.pdf');
    expect(res.status).toBe(201);
    expect(docOf(res).fileName).toBe('evil.pdf');
  });

  it('a Pending (locked) record refuses add / remove with RECORD_LOCKED but still downloads', async () => {
    const rec = await newRecord();
    const docId = docOf(await upload(rec, pdf(), 'a.pdf')).id;
    await prisma.genericRecord.update({ where: { id: rec.id }, data: { status: 'Pending' } });
    const add = await upload(rec, pdf(), 'b.pdf');
    expect(add.status).toBe(409);
    expect(errorOf(add).code).toBe('RECORD_LOCKED');
    const del = await request(app)
      .delete(url(rec, `/${docId}`))
      .set(owner.bearer);
    expect(del.status).toBe(409);
    const dl = await request(app)
      .get(url(rec, `/${docId}/download`))
      .set(owner.bearer);
    expect(dl.status).toBe(200);
  });

  it('removes a document (soft): gone from list and download, audited', async () => {
    const rec = await newRecord();
    const docId = docOf(await upload(rec, pdf(), 'a.pdf')).id;
    const del = await request(app)
      .delete(url(rec, `/${docId}`))
      .set(owner.bearer);
    expect(del.status).toBe(200);
    const list = await request(app).get(url(rec)).set(owner.bearer);
    expect((list.body as { data: unknown[] }).data).toHaveLength(0);
    const dl = await request(app)
      .get(url(rec, `/${docId}/download`))
      .set(owner.bearer);
    expect(dl.status).toBe(404);
    expect((await auditRows('DOCUMENT_REMOVED', { targetId: rec.id })).length).toBe(1);
  });

  it('an Idempotency-Key makes a retried upload create one document', async () => {
    const rec = await newRecord();
    const key = `doc-${Math.random().toString(36).slice(2, 14)}-key`;
    const a = await upload(rec, pdf(), 'a.pdf', {}, key);
    const b = await upload(rec, pdf(), 'a.pdf', {}, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(await prisma.recordDocument.count({ where: { recordId: rec.id } })).toBe(1);
    const other = await upload(rec, pdf('different'), 'a.pdf', {}, key);
    expect(other.status).toBe(409);
  });

  it('enforces 20 documents per record', async () => {
    const rec = await newRecord();
    for (let i = 0; i < 20; i += 1) {
      expect((await upload(rec, pdf(String(i)), `f${i}.pdf`)).status).toBe(201);
    }
    expect((await upload(rec, pdf('21'), 'f21.pdf')).status).toBe(422);
  });

  it('needs a login', async () => {
    const rec = await newRecord();
    const anon = await request(app).post(url(rec)).attach('file', pdf(), { filename: 'a.pdf' });
    expect(anon.status).toBe(401);
  });
});
