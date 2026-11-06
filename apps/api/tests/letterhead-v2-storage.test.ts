// apps/api/tests/letterhead-v2-storage.test.ts
// Tests for Phase 03 Order 4: M5 data moves, stored_files, LocalDiskStorage, Letterhead v2, and PDFKit Test PDF.

import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, newApp, signInOwner } from './helpers';
import type { Signed } from './helpers';

const app = newApp();
let owner: Signed;

beforeAll(async () => {
  owner = await signInOwner(app);
});

describe('Letterhead v2 & Storage (Phase 03 Order 4)', () => {
  let uploadedFileId: string;

  it('uploads a file via POST /files storing to disk and database', async () => {
    // 1x1 transparent PNG base64
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const res = await request(app)
      .post(`${API}/files`)
      .set(owner.bearer)
      .send({
        filename: 'company-logo.png',
        mimeType: 'image/png',
        dataBase64: pngBase64,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      originalFilename: 'company-logo.png',
      mimeType: 'image/png',
      fileSize: 68,
    });
    expect(res.body.data.sha256Hash).toHaveLength(64);
    uploadedFileId = res.body.data.id;
  });

  it('downloads the uploaded file via GET /files/:id', async () => {
    const res = await request(app)
      .get(`${API}/files/${uploadedFileId}`)
      .set(owner.bearer);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBe(68);
  });

  it('reads letterhead v2 with default v2 metadata fields', async () => {
    const res = await request(app)
      .get(`${API}/settings/letterhead`)
      .set(owner.bearer);

    expect(res.status).toBe(200);
    expect(res.body.data.value).toMatchObject({
      version: 2,
      primaryColor: expect.any(String),
      showGstin: true,
      showPan: true,
      showCin: true,
    });
  });

  it('links uploaded logo to letterhead v2 via PATCH /settings/letterhead', async () => {
    const getRes = await request(app)
      .get(`${API}/settings/letterhead`)
      .set(owner.bearer);

    const version = getRes.body.data.version;

    const res = await request(app)
      .patch(`${API}/settings/letterhead`)
      .set(owner.bearer)
      .set('If-Match', `"${version}"`)
      .send({
        logoFileId: uploadedFileId,
        primaryColor: '#1e3a8a',
        gstin: '27AABCU9603R1ZM',
        pan: 'AABCU9603R',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.value.logoFileId).toBe(uploadedFileId);
    expect(res.body.data.value.primaryColor).toBe('#1e3a8a');
  });

  it('generates and streams test PDF via POST /settings/letterhead/test-pdf', async () => {
    const res = await request(app)
      .post(`${API}/settings/letterhead/test-pdf`)
      .set(owner.bearer)
      .send({});

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body).toBeInstanceOf(Buffer);

    // PDF files start with binary header %PDF-
    const header = res.body.slice(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });
});
