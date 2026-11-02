// Phase 4 test helpers: the list of generic pages, valid sample data generated from a page's field
// metadata (one value per field type), and thin API wrappers for the records endpoints.
import type { Express } from 'express';
import request from 'supertest';
import { registry } from '../src/core/registry';
import type { FieldMeta } from '../src/engine/field-types';
import { buildPageSchema } from '../src/engine/field-schema';
import type { PageSchema } from '../src/engine/field-schema';
import { kindOf } from '../src/engine/kinds';
import { gstinCheckChar } from '../src/engine/validators';
import { API } from './helpers';
import type { Signed } from './helpers';

export const GSTIN_SAMPLE = `27AAPFU0939F1Z${gstinCheckChar('27AAPFU0939F1Z')}`;

export function genericPageIds(): string[] {
  return [...registry.pages.keys()].filter((id) => kindOf(id) === 'generic');
}

export function schemaOf(pageId: string): PageSchema {
  const schema = buildPageSchema(pageId);
  if (!schema) throw new Error(`No schema for ${pageId}`);
  return schema;
}

/** A valid value for one field; `n` varies text so records can be told apart. */
export function sampleValue(f: FieldMeta, n = 1): unknown {
  switch (f.type) {
    case 'date':
      return '2026-06-15';
    case 'datetime':
      return '2026-06-15T10:30';
    case 'money':
      return 1234.5 + n;
    case 'pct':
      return 55.5;
    case 'qty':
      return 12.5 + n;
    case 'email':
      return `sample${n}@test.local`;
    case 'phone':
      return '9876543210';
    case 'gstin':
      return GSTIN_SAMPLE;
    case 'pan':
      return 'ABCDE1234F';
    case 'ifsc':
      return 'HDFC0001234';
    case 'hsn':
      return '847130';
    case 'aadhaar':
      return '234567891234';
    case 'uan':
      return '123456789012';
    case 'bool':
      return true;
    case 'enum':
      return f.options?.[0] ?? `Option ${n}`;
    case 'longtext':
      return `Long text ${n} for ${f.label}`;
    default:
      return `${f.label} ${n}`.slice(0, 60);
  }
}

/** Sample data for every writable field of the page. */
export function sampleData(schema: PageSchema, n = 1): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of schema.fields) if (!f.readOnly) data[f.key] = sampleValue(f, n);
  return data;
}

export interface Hdr {
  unit?: string;
  fy?: string;
  extra?: Record<string, string>;
}

function headers(s: Signed, h: Hdr = {}): Record<string, string> {
  return {
    ...s.bearer,
    ...(h.unit ? { 'X-Unit-Id': h.unit } : {}),
    ...(h.fy ? { 'X-FY-Id': h.fy } : {}),
    ...(h.extra ?? {}),
  };
}

export interface RecordBody {
  id: string;
  code: string;
  status: string;
  unitId: string;
  fyId: string;
  department: string;
  data: Record<string, unknown>;
  version: number;
  createdBy: { id: string; name: string };
}

export function api(app: Express) {
  const base = (pageId: string) => `${API}/pages/${pageId}/records`;
  return {
    schema: (s: Signed, pageId: string, h?: Hdr) =>
      request(app).get(`${API}/pages/${pageId}/schema`).set(headers(s, h)),
    list: (s: Signed, pageId: string, query: Record<string, unknown> = {}, h?: Hdr) =>
      request(app).get(base(pageId)).query(query).set(headers(s, h)),
    get: (s: Signed, pageId: string, id: string, h?: Hdr) =>
      request(app)
        .get(`${base(pageId)}/${id}`)
        .set(headers(s, h)),
    create: (s: Signed, pageId: string, data: Record<string, unknown>, h?: Hdr) =>
      request(app).post(base(pageId)).set(headers(s, h)).send({ data }),
    patch: (
      s: Signed,
      pageId: string,
      id: string,
      version: number,
      data: Record<string, unknown>,
      h?: Hdr,
    ) =>
      request(app)
        .patch(`${base(pageId)}/${id}`)
        .set(headers(s, h))
        .set('If-Match', String(version))
        .send({ data }),
    remove: (s: Signed, pageId: string, id: string, h?: Hdr) =>
      request(app)
        .delete(`${base(pageId)}/${id}`)
        .set(headers(s, h)),
    restore: (s: Signed, pageId: string, id: string, body: Record<string, unknown> = {}, h?: Hdr) =>
      request(app)
        .post(`${base(pageId)}/${id}/restore`)
        .set(headers(s, h))
        .send(body),
    status: (s: Signed, pageId: string, id: string, to: string, h?: Hdr) =>
      request(app)
        .post(`${base(pageId)}/${id}/status`)
        .set(headers(s, h))
        .send({ to }),
    bulk: (s: Signed, pageId: string, body: Record<string, unknown>, h?: Hdr) =>
      request(app)
        .post(`${base(pageId)}/bulk`)
        .set(headers(s, h))
        .send(body),
    action: (
      s: Signed,
      pageId: string,
      id: string,
      name: string,
      body: Record<string, unknown> = {},
      key?: string,
      h?: Hdr,
    ) => {
      const req = request(app)
        .post(`${base(pageId)}/${id}/actions/${name}`)
        .set(headers(s, h));
      if (key !== undefined) void req.set('Idempotency-Key', key);
      return req.send(body);
    },
    preview: (s: Signed, pageId: string, query: Record<string, unknown> = {}, h?: Hdr) =>
      request(app).get(`${API}/pages/${pageId}/preview`).query(query).set(headers(s, h)),
    pageAudit: (s: Signed, pageId: string, query: Record<string, unknown> = {}, h?: Hdr) =>
      request(app).get(`${API}/pages/${pageId}/audit`).query(query).set(headers(s, h)),
    recordAudit: (s: Signed, pageId: string, id: string, h?: Hdr) =>
      request(app)
        .get(`${base(pageId)}/${id}/audit`)
        .set(headers(s, h)),
    lookup: (
      s: Signed,
      kind: 'items' | 'warehouses',
      query: Record<string, unknown> = {},
      h?: Hdr,
    ) => request(app).get(`${API}/lookups/${kind}`).query(query).set(headers(s, h)),
    export: (s: Signed, pageId: string, query: Record<string, unknown> = {}, h?: Hdr) =>
      request(app)
        .get(`${base(pageId)}/export.xlsx`)
        .query(query)
        .set(headers(s, h))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        }),
  };
}

export const dataOf = <T>(res: request.Response): T => (res.body as { data: T }).data;
