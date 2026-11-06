// Phase 4 web: Documents in the drawer (upload / download / lock), Submit Selected and the drawer
// Submit, the Import wizard, Reports extras (background export) and button states from the lock table.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { json, makeUser, renderApp, signedIn, type Handler } from '../../test/helpers';
import { LEAD_ROWS, LEAD_SCHEMA, leadRow, recordsHandler } from '../../test/engine-fixtures';
import type { PageSchema } from './engineApi';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const P = '/api/v1/pages/crm-leads';
const REGISTER = '/m/crm-leads?tab=Lead%20Register';
const row = (status: string) =>
  ({
    Draft: {
      update: true,
      remove: true,
      restore: true,
      status: true,
      submit: true,
      documents: true,
    },
    Pending: {
      update: false,
      remove: false,
      restore: false,
      status: true,
      submit: false,
      documents: false,
    },
    Active: {
      update: true,
      remove: false,
      restore: false,
      status: true,
      submit: false,
      documents: true,
    },
  })[status];
const SCHEMA: PageSchema = {
  ...LEAD_SCHEMA,
  kind: 'generic',
  lock: {
    Draft: row('Draft')!,
    Pending: row('Pending')!,
    Active: row('Active')!,
  },
};

const DOC = {
  id: 'd1',
  recordId: 'r1',
  title: 'Quote',
  docType: 'INVOICE',
  fileName: 'quote.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  scanStatus: 'CLEAN',
  createdAt: '2026-11-06T10:00:00.000Z',
  createdBy: { id: 'u1', name: 'Asha Patil' },
};

function setup(extra: Record<string, Handler> = {}, rows = LEAD_ROWS) {
  return signedIn(owner, {
    [`GET ${P}/schema`]: () => json(200, { data: SCHEMA }),
    [`GET ${P}/records`]: recordsHandler(rows),
    [`GET ${P}/records/summary`]: () =>
      json(200, {
        data: {
          pageId: 'crm-leads',
          total: 3,
          amountTotal: 0,
          hasAmount: false,
          createdThisMonth: 3,
          staleDrafts: 0,
          byStatus: [],
        },
      }),
    ...extra,
  });
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

describe('Documents in the drawer', () => {
  it('lists documents, uploads a file as multipart, and downloads', async () => {
    let docs = [DOC];
    const { fn } = setup({
      [`GET ${P}/records/r1/documents`]: () =>
        json(200, { data: docs, meta: { total: docs.length } }),
      [`POST ${P}/records/r1/documents`]: () => {
        docs = [...docs, { ...DOC, id: 'd2', title: 'Second', fileName: 'second.pdf' }];
        return json(201, { data: docs[1] });
      },
      [`GET ${P}/records/r1/documents/d1/download`]: () =>
        new Response('%PDF-1.4', {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="quote.pdf"' },
        }),
    });
    renderApp(REGISTER);
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'View LEA/TAL/26-27/00001' }));
    const panel = within(await screen.findByRole('region', { name: 'Documents' }));
    expect(await panel.findByText('Quote')).toBeInTheDocument();
    expect(panel.getByText(/Scanned/)).toBeInTheDocument();

    await ue.upload(
      panel.getByLabelText('Document file'),
      new File(['%PDF-1.4'], 'second.pdf', { type: 'application/pdf' }),
    );
    await ue.click(panel.getByRole('button', { name: 'Upload' }));
    await panel.findByText('Second');
    const post = fn.mock.calls.find(
      (c) =>
        (c[1] as RequestInit | undefined)?.method === 'POST' && String(c[0]).endsWith('/documents'),
    );
    const init = post?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();

    await ue.click(panel.getByRole('button', { name: 'Download Quote' }));
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => String(c[0]).endsWith('/documents/d1/download'))).toBe(true),
    );
  });

  it('a locked (Pending) record offers download only: no upload, no remove', async () => {
    setup(
      {
        [`GET ${P}/records/r1/documents`]: () => json(200, { data: [DOC], meta: { total: 1 } }),
      },
      [leadRow(1, { status: 'Pending' })],
    );
    renderApp(REGISTER);
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'View LEA/TAL/26-27/00001' }));
    const panel = within(await screen.findByRole('region', { name: 'Documents' }));
    await panel.findByText('Quote');
    expect(panel.queryByRole('button', { name: 'Upload' })).toBeNull();
    expect(panel.queryByRole('button', { name: 'Remove Quote' })).toBeNull();
    expect(panel.getByRole('button', { name: 'Download Quote' })).toBeInTheDocument();
    expect(
      panel.getByText(/cannot be added or removed while the record is Pending/),
    ).toBeInTheDocument();
  });
});

describe('Submit', () => {
  it('Submit Selected posts the ids and reports the result', async () => {
    const { fn } = setup({
      [`POST ${P}/records/submit-bulk`]: () =>
        json(200, {
          data: [
            { id: 'r1', ok: true },
            {
              id: 'r3',
              ok: false,
              error: { code: 'RECORD_LOCKED', message: 'Only a Draft record can be submitted.' },
            },
          ],
        }),
    });
    renderApp(REGISTER);
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('checkbox', { name: 'Select LEA/TAL/26-27/00001' }));
    await ue.click(screen.getByRole('checkbox', { name: 'Select LEA/TAL/26-27/00003' }));
    await ue.click(screen.getByRole('button', { name: 'Submit Selected' }));
    expect(await screen.findByText(/Submitted 1; 1 could not be submitted/)).toBeInTheDocument();
    const call = fn.mock.calls.find((c) => String(c[0]).endsWith('/records/submit-bulk'));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ ids: ['r1', 'r3'] });
  });

  it('Submit Selected is disabled until rows are selected', async () => {
    setup();
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    expect(screen.getByRole('button', { name: 'Submit Selected' })).toBeDisabled();
  });

  it('the drawer Submit sends If-Match and an Idempotency-Key, only for Draft records', async () => {
    const { fn } = setup({
      [`GET ${P}/records/r1/documents`]: () => json(200, { data: [], meta: { total: 0 } }),
      [`POST ${P}/records/r1/submit`]: () =>
        json(200, { data: leadRow(1, { status: 'Pending', version: 2 }) }),
    });
    renderApp(REGISTER);
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'View LEA/TAL/26-27/00001' }));
    const drawer = within(await screen.findByRole('dialog'));
    await ue.click(await drawer.findByRole('button', { name: 'Submit for Approval' }));
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => String(c[0]).endsWith('/r1/submit'))).toBe(true),
    );
    const call = fn.mock.calls.find((c) => String(c[0]).endsWith('/r1/submit'));
    const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['If-Match']).toBe('1');
    expect(headers['Idempotency-Key']).toBeTruthy();
  });

  it('an Active record shows no Submit and no Delete (from the lock table)', async () => {
    setup({
      [`GET ${P}/records/r2/documents`]: () => json(200, { data: [], meta: { total: 0 } }),
    });
    renderApp(REGISTER);
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'View LEA/TAL/26-27/00002' }));
    const drawer = within(await screen.findByRole('dialog'));
    await drawer.findByRole('button', { name: 'Edit' });
    expect(drawer.queryByRole('button', { name: 'Submit for Approval' })).toBeNull();
    expect(drawer.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});

describe('Import wizard and report extras', () => {
  const UPLOAD = {
    job: { id: 'j1', kind: 'IMPORT_VALIDATE', pageId: 'crm-leads', status: 'DONE', totalRows: 2 },
    headers: ['Lead Name', 'Company'],
    sample: [['A', 'B']],
    suggestedMapping: { leadName: 0, company: 1 },
    fields: [
      { key: 'leadName', label: 'Lead Name', type: 'text', required: true },
      { key: 'company', label: 'Company', type: 'text', required: false },
    ],
    totalRows: 2,
  };

  it('walks upload -> map -> check -> import and reloads', async () => {
    let checks = 0;
    const jobDone = {
      id: 'j1',
      kind: 'IMPORT_VALIDATE',
      pageId: 'crm-leads',
      status: 'DONE',
      totalRows: 2,
      okRows: 2,
      errorRows: 0,
      errors: { errors: [], warnings: [], preview: [] },
      hasOutput: false,
      createdAt: '2026-11-06T10:00:00.000Z',
      finishedAt: null,
      expiresAt: null,
    };
    const { fn } = setup({
      [`GET /api/v1/jobs`]: () => json(200, { data: [], meta: { total: 0 } }),
      [`POST ${P}/imports`]: () => json(201, { data: UPLOAD }),
      [`POST /api/v1/imports/j1/validate`]: () =>
        json(202, { data: { ...jobDone, status: 'QUEUED' } }),
      [`GET /api/v1/jobs/j1`]: () => {
        checks += 1;
        return json(200, { data: jobDone });
      },
      [`POST /api/v1/imports/j1/commit`]: () =>
        json(202, { data: { ...jobDone, id: 'c1', kind: 'IMPORT_COMMIT', status: 'QUEUED' } }),
      [`GET /api/v1/jobs/c1`]: () =>
        json(200, { data: { ...jobDone, id: 'c1', kind: 'IMPORT_COMMIT', okRows: 2 } }),
    });
    renderApp('/m/crm-leads?tab=Reports');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Import…' }));
    const dlg = within(await screen.findByRole('dialog'));
    await ue.upload(
      dlg.getByLabelText('Import file'),
      new File(['Lead Name,Company\nA,B\nC,D'], 'leads.csv', { type: 'text/csv' }),
    );
    await ue.click(dlg.getByRole('button', { name: 'Upload' }));
    expect(await dlg.findByText(/2 data rows found/)).toBeInTheDocument();
    expect(dlg.getByLabelText('Column for Lead Name')).toHaveValue('0');
    await ue.click(dlg.getByRole('button', { name: 'Check file' }));
    expect(await dlg.findByText(/of 2 rows are valid/)).toBeInTheDocument();
    expect(checks).toBeGreaterThan(0);
    await ue.click(dlg.getByRole('button', { name: 'Import 2 records' }));
    expect(await dlg.findByText(/records created/)).toBeInTheDocument();
    const commit = fn.mock.calls.find((c) => String(c[0]).endsWith('/imports/j1/commit'));
    expect((commit?.[1] as RequestInit).headers as Record<string, string>).toHaveProperty(
      'Idempotency-Key',
    );
  });

  it('blocks the check when a required field has no column', async () => {
    setup({
      [`GET /api/v1/jobs`]: () => json(200, { data: [], meta: { total: 0 } }),
      [`POST ${P}/imports`]: () =>
        json(201, { data: { ...UPLOAD, suggestedMapping: { company: 1 } } }),
    });
    renderApp('/m/crm-leads?tab=Reports');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Import…' }));
    const dlg = within(await screen.findByRole('dialog'));
    await ue.upload(
      dlg.getByLabelText('Import file'),
      new File(['x'], 'leads.csv', { type: 'text/csv' }),
    );
    await ue.click(dlg.getByRole('button', { name: 'Upload' }));
    expect(await dlg.findByRole('alert')).toHaveTextContent('Map a column to: Lead Name');
    expect(dlg.getByRole('button', { name: 'Check file' })).toBeDisabled();
  });

  it('lists background jobs and offers the download of a finished export', async () => {
    const { fn } = setup({
      [`GET /api/v1/jobs`]: () =>
        json(200, {
          data: [
            {
              id: 'e1',
              kind: 'EXPORT',
              pageId: 'crm-leads',
              status: 'DONE',
              totalRows: 5,
              okRows: 5,
              errorRows: 0,
              errors: null,
              hasOutput: true,
              createdAt: '2026-11-06T10:00:00.000Z',
              finishedAt: '2026-11-06T10:00:05.000Z',
              expiresAt: '2026-11-13T10:00:00.000Z',
            },
          ],
          meta: { total: 1 },
        }),
      [`GET /api/v1/jobs/e1/download`]: () =>
        new Response('a,b', {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="crm-leads.csv"' },
        }),
    });
    renderApp('/m/crm-leads?tab=Reports');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Download' }));
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => String(c[0]).endsWith('/jobs/e1/download'))).toBe(true),
    );
  });

  it('starts a background export with an Idempotency-Key', async () => {
    const { fn } = setup({
      [`GET /api/v1/jobs`]: () => json(200, { data: [], meta: { total: 0 } }),
      [`POST ${P}/exports`]: () =>
        json(202, {
          data: {
            id: 'e2',
            kind: 'EXPORT',
            pageId: 'crm-leads',
            status: 'QUEUED',
            totalRows: null,
            okRows: null,
            errorRows: null,
            errors: null,
            hasOutput: false,
            createdAt: '2026-11-06T10:00:00.000Z',
            finishedAt: null,
            expiresAt: null,
          },
        }),
    });
    renderApp('/m/crm-leads?tab=Reports');
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Export in background' }));
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => String(c[0]).endsWith('/exports'))).toBe(true),
    );
    const call = fn.mock.calls.find((c) => String(c[0]).endsWith('/exports'));
    expect(
      ((call?.[1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'],
    ).toBeTruthy();
  });
});
