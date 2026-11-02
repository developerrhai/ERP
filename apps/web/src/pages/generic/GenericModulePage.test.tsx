// GenericModulePage tests (Phase 4 web): tabs and honest phase notices, the register (columns,
// minis, search / sort / filter / paging in the URL, cross-page selection, bulk delete, export),
// the schema-driven form, the drawer, delete + undo, and the real-data tabs.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  countCalls,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
  type Call,
  type Handler,
} from '../../test/helpers';
import { LEAD_ROWS, LEAD_SCHEMA, leadRow, recordsHandler } from '../../test/engine-fixtures';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const P = '/api/v1/pages/crm-leads';
const REGISTER = '/m/crm-leads?tab=Lead%20Register';

function setup(extra: Record<string, Handler> = {}, rows = LEAD_ROWS) {
  return signedIn(owner, {
    [`GET ${P}/schema`]: () => json(200, { data: LEAD_SCHEMA }),
    [`GET ${P}/records`]: recordsHandler(rows),
    ...extra,
  });
}

const lastList = (calls: Call[]): URL => {
  const c = calls.filter((x) => x.method === 'GET' && x.path === `${P}/records`).at(-1);
  return new URL(c?.url ?? '', 'http://test');
};

const createUrl = vi.fn(() => 'blob:test');

beforeEach(() => {
  createUrl.mockClear();
  window.print = vi.fn();
  URL.createObjectURL = createUrl;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

describe('tabs and honest notices', () => {
  it('shows the 16 prototype tabs in order with the real context chips', async () => {
    setup();
    renderApp('/m/crm-leads');
    await screen.findByRole('heading', { name: 'Lead Management' });
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Module Dashboard',
      'Lead Register',
      'Qualification Desk',
      'Communication Timeline',
      'Follow-up Queue',
      'Lead Scoring',
      'Conversion Analytics',
      'Analytics & Graphs',
      'AI Decision Center',
      'Automation Studio',
      'Data Quality',
      'Activity Timeline',
      'Documents',
      'Approvals',
      'Reports',
      'Audit Trail',
    ]);
    const chips = await screen.findByLabelText('Working context');
    await waitFor(() => expect(within(chips).getByText('Unit: Talwade')).toBeInTheDocument());
    expect(within(chips).getByText('FY: FY 2026-27')).toBeInTheDocument();
    expect(within(chips).getByText('Department: Administration')).toBeInTheDocument();
    expect(within(chips).getByText('Role: Super Admin')).toBeInTheDocument();
    expect(within(chips).getByText('Owner: Sales')).toBeInTheDocument();
    expect(within(chips).getByText('Approval: Required')).toBeInTheDocument();
  });

  it('every tab without data says which phase builds it (no numbers)', async () => {
    setup();
    renderApp('/m/crm-leads');
    const ue = userEvent.setup();
    const expected: Record<string, number> = {
      Approvals: 6,
      Documents: 5,
      'AI Decision Center': 19,
      'Automation Studio': 19,
      'Analytics & Graphs': 19,
      'Qualification Desk': 11,
      'Lead Scoring': 11,
    };
    await screen.findByRole('heading', { name: 'Lead Management' });
    for (const [tab, phase] of Object.entries(expected)) {
      await ue.click(screen.getByRole('tab', { name: tab }));
      expect(await screen.findByText(`This view is built in Phase ${phase}.`)).toBeInTheDocument();
    }
  });

  it('falls back to the placeholder when the engine does not serve the page', async () => {
    signedIn(owner, {
      [`GET ${P}/schema`]: () => apiError(404, 'NOT_GENERIC', 'This page is not generic.'),
    });
    renderApp('/m/crm-leads');
    expect(
      await screen.findByText('This module will be enabled in a later phase.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('shows the error when the schema fails for another reason', async () => {
    signedIn(owner, {
      [`GET ${P}/schema`]: () => apiError(500, 'INTERNAL', 'Schema service down.'),
    });
    renderApp('/m/crm-leads');
    expect(await screen.findByText('Schema service down.')).toBeInTheDocument();
  });
});

describe('Module Dashboard', () => {
  it('shows 4 KPIs computed from real data and the recent records', async () => {
    const calls = setup({
      [`GET ${P}/records`]: (call) => {
        const u = new URL(call.url, 'http://test');
        const status = u.searchParams.get('status');
        if (status) {
          const total = { Draft: 4, Open: 1, Active: 6, Completed: 2 }[status] ?? 0;
          return json(200, { data: [], meta: { page: 1, size: 1, total } });
        }
        return json(200, { data: LEAD_ROWS, meta: { page: 1, size: 100, total: 13 } });
      },
    });
    renderApp('/m/crm-leads');
    const kpis = await screen.findByText('Records');
    const card = (label: string): HTMLElement => {
      const el = screen.getByText(label).closest('.kpi');
      if (!el) throw new Error(label);
      return el as HTMLElement;
    };
    await waitFor(() => expect(within(card('Records')).getByText('13')).toBeInTheDocument());
    expect(kpis).toBeInTheDocument();
    expect(within(card('Draft / Open')).getByText('5')).toBeInTheDocument();
    expect(within(card('Active / Completed')).getByText('8')).toBeInTheDocument();
    // All 3 fetched rows are from this month but 13 exist: the count is capped, and says so.
    expect(within(card('Created this month')).getByText('3+')).toBeInTheDocument();
    expect(await screen.findByText('Lead 1')).toBeInTheDocument();
    expect(calls.calls.some((c) => c.url.includes('sort=-createdAt'))).toBe(true);
  });
});

describe('Register', () => {
  it('renders schema columns, formatted values, minis and status pills', async () => {
    setup();
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    expect(
      screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/\s*[▲▼]/, '')),
    ).toEqual([
      '',
      'Lead No',
      'Lead Name',
      'Company',
      'Stage',
      'Expected Value',
      'Next Follow-up',
      'Status',
      'Actions',
    ]);
    const row = screen.getByText('Lead 1').closest('tr') as HTMLElement;
    expect(within(row).getByText('₹ 1,000.5')).toBeInTheDocument();
    expect(within(row).getByText('05 Dec 2026')).toBeInTheDocument();
    expect(within(row).getByText('Draft')).toHaveClass('status', 'draft');
    expect(
      within(screen.getByText('Lead 3').closest('tr') as HTMLElement).getAllByText('—').length,
    ).toBeGreaterThan(0);
    const minis = screen.getByLabelText('Summary');
    const mini = (label: string): HTMLElement =>
      screen.getByText(label, { selector: 'small' }).closest('.v8-mini') as HTMLElement;
    expect(within(minis).getAllByText(/./, { selector: 'small' })).toHaveLength(5);
    expect(within(mini('Records')).getByText('3')).toBeInTheDocument();
    expect(within(mini('Draft / Open (this page)')).getByText('2')).toBeInTheDocument();
    expect(within(mini('Expected Value (this page)')).getByText('₹ 6,001.5')).toBeInTheDocument();
    expect(within(mini('Data completeness (this page)')).getByText(/%$/)).toBeInTheDocument();
  });

  it('keeps search, status, sort, page and size in the URL and sends them to the API', async () => {
    const { calls } = setup();
    renderApp('/m/crm-leads?tab=Lead%20Register&q=lead&status=Draft&sort=-leadName&page=2&size=20');
    await waitFor(() => {
      const u = lastList(calls);
      expect(u.searchParams.get('q')).toBe('lead');
      expect(u.searchParams.get('status')).toBe('Draft');
      expect(u.searchParams.get('sort')).toBe('-leadName');
      expect(u.searchParams.get('page')).toBe('2');
      expect(u.searchParams.get('size')).toBe('20');
    });
    expect(screen.getByLabelText('Search Lead Management')).toHaveValue('lead');
    expect(screen.getByLabelText('Filter by status')).toHaveValue('Draft');
    expect(screen.getByLabelText('Rows per page')).toHaveValue('20');
    expect(screen.getByRole('button', { name: /Lead Name ▼/ })).toBeInTheDocument();
  });

  it('typing in search and changing filters call the API (page resets to 1)', async () => {
    const { calls } = setup();
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    const ue = userEvent.setup();
    await ue.type(screen.getByLabelText('Search Lead Management'), 'lead 2');
    await waitFor(() => expect(lastList(calls).searchParams.get('q')).toBe('lead 2'));
    await waitFor(() => expect(screen.queryByText('Lead 1')).toBeNull());
    expect(screen.getByText('Lead 2')).toBeInTheDocument();
    await ue.clear(screen.getByLabelText('Search Lead Management'));
    await ue.selectOptions(screen.getByLabelText('Filter by status'), 'Active');
    await waitFor(() => expect(lastList(calls).searchParams.get('status')).toBe('Active'));
    await ue.selectOptions(screen.getByLabelText('Rows per page'), '25');
    await waitFor(() => expect(lastList(calls).searchParams.get('size')).toBe('25'));
    expect(
      within(screen.getByLabelText('Rows per page'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['10 rows', '20 rows', '25 rows']);
  });

  it('sortable headers cycle ascending, descending, none with ▲ ▼', async () => {
    const { calls } = setup();
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Company' }));
    await waitFor(() => expect(lastList(calls).searchParams.get('sort')).toBe('company'));
    expect(screen.getByRole('button', { name: 'Company ▲' })).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: 'Company ▲' }));
    await waitFor(() => expect(lastList(calls).searchParams.get('sort')).toBe('-company'));
    expect(screen.getByRole('button', { name: 'Company ▼' })).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: 'Company ▼' }));
    await waitFor(() => expect(lastList(calls).searchParams.get('sort')).toBeNull());
  });

  it('selection survives paging; Export Selected sends the ids; Clear empties it', async () => {
    const many = Array.from({ length: 12 }, (_, i) => leadRow(i + 1));
    const { calls } = setup(
      {
        [`GET ${P}/records/export.xlsx`]: () =>
          new Response(new Blob(['xlsx']), {
            status: 200,
            headers: { 'Content-Disposition': 'attachment; filename="Lead-Management.xlsx"' },
          }),
      },
      many,
    );
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('checkbox', { name: 'Select LEA/TAL/26-27/00001' }));
    await ue.click(screen.getByRole('checkbox', { name: 'Select LEA/TAL/26-27/00002' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: '2' })); // page 2 of the pager
    await screen.findByText('Lead 11');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await ue.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    expect(screen.getByText('4 selected')).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: 'Export Selected' }));
    await waitFor(() => expect(countCalls(calls, 'GET', '/export.xlsx')).toBe(1));
    const exp = calls.find((c) => c.path.endsWith('/export.xlsx'));
    expect(
      new URL(exp?.url ?? '', 'http://test').searchParams.get('ids')?.split(',').sort(),
    ).toEqual(['r1', 'r11', 'r12', 'r2'].sort());
    expect(createUrl).toHaveBeenCalled();
    await ue.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export Selected' })).toBeDisabled();
  });

  it('Delete Selected posts a bulk delete; more than 10 needs typing DELETE', async () => {
    const many = Array.from({ length: 12 }, (_, i) => leadRow(i + 1));
    const { calls } = setup(
      {
        [`POST ${P}/records/bulk`]: (call) =>
          json(200, {
            data: (call.body as { ids: string[] }).ids.map((id) =>
              id === 'r1' ? { id, ok: false, error: 'IN_USE' } : { id, ok: true },
            ),
          }),
      },
      many,
    );
    renderApp('/m/crm-leads?tab=Lead%20Register&size=20');
    await screen.findByText('Lead 12');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    await ue.click(screen.getByRole('button', { name: 'Delete Selected' }));
    const dlg = within(screen.getByRole('dialog', { name: 'Delete Selected' }));
    const go = dlg.getByRole('button', { name: 'Delete 12' });
    expect(go).toBeDisabled();
    await ue.type(dlg.getByLabelText(/Type DELETE to confirm/), 'delete');
    expect(go).toBeDisabled();
    await ue.clear(dlg.getByLabelText(/Type DELETE to confirm/));
    await ue.type(dlg.getByLabelText(/Type DELETE to confirm/), 'DELETE');
    await ue.click(go);
    expect(await screen.findByText('Deleted 11; 1 could not be deleted.')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/bulk'));
    expect((post?.body as { action: string; ids: string[] }).action).toBe('delete');
    expect((post?.body as { ids: string[] }).ids).toHaveLength(12);
    // The one that failed stays selected.
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('up to 10 selected needs no typing', async () => {
    setup({ [`POST ${P}/records/bulk`]: () => json(200, { data: [{ id: 'r1', ok: true }] }) });
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('checkbox', { name: 'Select LEA/TAL/26-27/00001' }));
    await ue.click(screen.getByRole('button', { name: 'Delete Selected' }));
    const dlg = within(screen.getByRole('dialog', { name: 'Delete Selected' }));
    expect(dlg.queryByLabelText(/Type DELETE/)).toBeNull();
    await ue.click(dlg.getByRole('button', { name: 'Delete 1' }));
    expect(await screen.findByText('Deleted 1 record.')).toBeInTheDocument();
  });
});

describe('permissions and read-only pages', () => {
  it('hides Add, Edit, Delete and Export without those rights', async () => {
    setup({ 'GET /api/v1/me/permissions': permissionsRoute({ view: true }) });
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    expect(screen.queryByRole('button', { name: '＋ Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export Selected' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Selected' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^View /i }).length).toBe(3);
  });

  it('a readOnly schema (list-only page) has no Add / Edit / Delete', async () => {
    setup({ [`GET ${P}/schema`]: () => json(200, { data: { ...LEAD_SCHEMA, readOnly: true } }) });
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    expect(screen.queryByRole('button', { name: '＋ Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Selected' })).toBeNull();
  });
});

describe('Add / Edit modal from the schema', () => {
  it('builds typed inputs, marks required fields and shows the code as read-only', async () => {
    setup();
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    await userEvent.setup().click(screen.getByRole('button', { name: '＋ Add' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Lead Management' }));
    expect(d.getByText('Lead Name').className).toContain('is-required');
    expect(d.getByLabelText('Lead No')).toBeDisabled();
    expect(d.getByLabelText('Lead No')).toHaveValue('Auto-generated');
    expect(d.queryByLabelText('Status')).toBeNull();
    expect(d.getByLabelText('Expected Value')).toHaveAttribute('type', 'number');
    expect(d.getByText('₹')).toBeInTheDocument();
    expect(d.getByText('%')).toBeInTheDocument();
    expect(d.getByLabelText('Next Follow-up')).toHaveAttribute('type', 'date');
    expect(d.getByLabelText('Consent')).toHaveAttribute('type', 'checkbox');
    expect(d.getByLabelText('Notes').tagName).toBe('TEXTAREA');
    const stage = d.getByLabelText('Stage');
    expect(
      within(stage)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['—', 'New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
  });

  it('validates required and GSTIN live, then POSTs typed values', async () => {
    const created = leadRow(9, { data: { leadName: 'Neha' } });
    const { calls } = setup({ [`POST ${P}/records`]: () => json(201, { data: created }) });
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Lead Management' }));
    await ue.type(d.getByLabelText('GSTIN'), '27abc');
    expect(d.getByLabelText('GSTIN')).toHaveValue('27ABC');
    expect(d.getByText('GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5.')).toBeInTheDocument();
    await ue.click(d.getByRole('button', { name: 'Save Record' }));
    expect(d.getByText('Lead Name is required.')).toBeInTheDocument();
    expect(countCalls(calls, 'POST', '/records')).toBe(0);
    await ue.type(d.getByLabelText('Lead Name'), 'Neha');
    await ue.clear(d.getByLabelText('GSTIN'));
    await ue.type(d.getByLabelText('GSTIN'), '27ABCDE1234F1Z5');
    await ue.type(d.getByLabelText('Expected Value'), '2500.5');
    await ue.type(d.getByLabelText('Discount'), '12');
    await ue.selectOptions(d.getByLabelText('Stage'), 'Qualified');
    await ue.click(d.getByLabelText('Consent'));
    await ue.click(d.getByRole('button', { name: 'Save Record' }));
    expect(await screen.findByText(`${created.code} created.`)).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path === `${P}/records`);
    expect(post?.body).toEqual({
      data: {
        leadName: 'Neha',
        stage: 'Qualified',
        expectedValue: 2500.5,
        discount: 12,
        gstin: '27ABCDE1234F1Z5',
        consent: true,
      },
    });
  });

  it('shows 422 field errors under the fields', async () => {
    setup({
      [`POST ${P}/records`]: () =>
        apiError(422, 'VALIDATION_ERROR', 'Some fields are invalid.', {
          company: 'Company already exists.',
        }),
    });
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add' }));
    const d = within(screen.getByRole('dialog'));
    await ue.type(d.getByLabelText('Lead Name'), 'Neha');
    await ue.type(d.getByLabelText('Company'), 'Acme');
    await ue.click(d.getByRole('button', { name: 'Save Record' }));
    expect(await d.findByText('Company already exists.')).toBeInTheDocument();
    expect(d.getByLabelText('Company')).toHaveAttribute('aria-invalid', 'true');
    expect(d.getByText('Some fields are invalid.')).toBeInTheDocument();
  });

  it('Edit sends If-Match and only the changed fields; code is read-only', async () => {
    const { calls } = setup({
      [`PATCH ${P}/records/r2`]: () => json(200, { data: leadRow(2, { version: 3 }) }),
    });
    renderApp(REGISTER);
    await screen.findByText('Lead 2');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Edit LEA/TAL/26-27/00002' }));
    const d = within(screen.getByRole('dialog', { name: 'Edit Lead Management' }));
    expect(d.getByLabelText('Lead No')).toHaveValue('LEA/TAL/26-27/00002');
    expect(d.getByLabelText('Lead No')).toBeDisabled();
    expect(d.getByLabelText('Status')).toHaveValue('Active');
    expect(d.getByLabelText('Next Follow-up')).toHaveValue('2026-12-05');
    await ue.clear(d.getByLabelText('Company'));
    await ue.type(d.getByLabelText('Company'), 'Acme Ltd');
    await ue.click(d.getByRole('button', { name: 'Save Record' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.headers['If-Match']).toBe('2');
    expect(patch?.body).toEqual({ data: { company: 'Acme Ltd' } });
  });

  it('a version conflict offers Reload, which refetches the record', async () => {
    const fresh = leadRow(2, { version: 9, data: { leadName: 'Lead 2', company: 'Fresh Co' } });
    setup({
      [`PATCH ${P}/records/r2`]: () => apiError(409, 'VERSION_CONFLICT', 'stale'),
      [`GET ${P}/records/r2`]: () => json(200, { data: fresh }),
    });
    renderApp(REGISTER);
    await screen.findByText('Lead 2');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Edit LEA/TAL/26-27/00002' }));
    const d = within(screen.getByRole('dialog'));
    await ue.type(d.getByLabelText('Notes'), 'x');
    await ue.click(d.getByRole('button', { name: 'Save Record' }));
    await ue.click(await d.findByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(d.getByLabelText('Company')).toHaveValue('Fresh Co'));
  });

  it('asks "Discard unsaved changes?" before closing a dirty form', async () => {
    setup();
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add' }));
    await ue.type(within(screen.getByRole('dialog')).getByLabelText('Lead Name'), 'Draft');
    await ue.click(
      within(screen.getByRole('dialog', { name: 'Add Lead Management' })).getByRole('button', {
        name: 'Cancel',
      }),
    );
    const confirm = screen.getByRole('dialog', { name: 'Discard unsaved changes?' });
    await ue.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog', { name: 'Add Lead Management' })).toBeInTheDocument();
    await ue.click(
      within(screen.getByRole('dialog', { name: 'Add Lead Management' })).getByRole('button', {
        name: 'Cancel',
      }),
    );
    await ue.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes a clean form without asking', async () => {
    setup();
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add' }));
    await ue.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('View drawer, delete and undo', () => {
  it('View shows every field with formatted values and Edit / Delete', async () => {
    setup();
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'View LEA/TAL/26-27/00001' }));
    const dr = within(screen.getByRole('dialog', { name: 'Lead Management Details' }));
    expect(dr.getByText('Lead No')).toBeInTheDocument();
    expect(dr.getByText('LEA/TAL/26-27/00001')).toBeInTheDocument();
    expect(dr.getByText('₹ 1,000.5')).toBeInTheDocument();
    expect(dr.getByText('05 Dec 2026')).toBeInTheDocument();
    expect(dr.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    await ue.click(dr.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog', { name: 'Delete Lead Management' })).toBeInTheDocument();
  });

  it('Delete is soft: an "Deleted. Undo" toast restores the record', async () => {
    const { calls } = setup({
      [`DELETE ${P}/records/r1`]: () => json(200, { data: { undoToken: 'tok-1' } }),
      [`POST ${P}/records/r1/restore`]: () => json(200, { data: leadRow(1) }),
    });
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Delete LEA/TAL/26-27/00001' }));
    await ue.click(
      within(screen.getByRole('dialog', { name: 'Delete Lead Management' })).getByRole('button', {
        name: 'Delete',
      }),
    );
    const undo = await screen.findByRole('button', { name: 'Undo' });
    expect(undo.parentElement).toHaveTextContent('Deleted.');
    expect(calls.find((c) => c.method === 'DELETE')?.headers['If-Match']).toBe('1');
    await ue.click(undo);
    await waitFor(() => expect(countCalls(calls, 'POST', '/restore')).toBe(1));
    expect(calls.find((c) => c.path.endsWith('/restore'))?.body).toEqual({ undoToken: 'tok-1' });
    expect(await screen.findByText('LEA/TAL/26-27/00001 restored.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('the Undo toast disappears after 10 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setup({ [`DELETE ${P}/records/r1`]: () => json(200, { data: { undoToken: 't' } }) });
      renderApp(REGISTER);
      await screen.findByText('Lead 1');
      fireEvent.click(screen.getByRole('button', { name: 'Delete LEA/TAL/26-27/00001' }));
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Delete Lead Management' })).getByRole('button', {
          name: 'Delete',
        }),
      );
      await screen.findByRole('button', { name: 'Undo' });
      await vi.advanceTimersByTimeAsync(10_100);
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Data Quality, audit tabs and Reports', () => {
  it('Data Quality shows per-field completeness from real rows', async () => {
    setup();
    renderApp('/m/crm-leads?tab=Data%20Quality');
    const row = (await screen.findByText('Company', { selector: 'td' })).closest(
      'tr',
    ) as HTMLElement;
    expect(within(row).getByText('2 / 3')).toBeInTheDocument();
    expect(within(row).getByText(/67%/)).toBeInTheDocument();
    const lead = screen.getByText('Lead Name', { selector: 'td' }).closest('tr') as HTMLElement;
    expect(within(lead).getByText(/100%/)).toBeInTheDocument();
    expect(screen.queryByText('Lead No', { selector: 'td' })).toBeNull();
  });

  it('Audit Trail and Activity Timeline read GET /pages/:id/audit', async () => {
    const audit = (call: Call) => {
      expect(new URL(call.url, 'http://test').searchParams.get('size')).toBe('20');
      return json(200, {
        data: [
          {
            id: 'a1',
            at: '2026-11-03T10:00:00.000Z',
            actor: { id: 'u1', name: 'Asha Patil', loginId: 'asha' },
            action: 'RECORD_CREATED',
            targetType: 'record',
            targetId: 'r1',
            ip: '10.0.0.1',
            userAgent: null,
            detail: { code: 'LEA/TAL/26-27/00001' },
          },
        ],
        meta: { page: 1, size: 20, total: 1 },
      });
    };
    setup({ [`GET ${P}/audit`]: audit });
    renderApp('/m/crm-leads?tab=Audit%20Trail');
    expect(await screen.findByText('record created')).toBeInTheDocument();
    expect(screen.getByText('Asha Patil')).toBeInTheDocument();
    expect(screen.getByText('LEA/TAL/26-27/00001')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Activity Timeline' }));
    const tl = await screen.findByRole('list', { name: 'Activity timeline' });
    expect(within(tl).getByText('record created')).toBeInTheDocument();
  });

  it('Audit Trail with no rows says so instead of inventing any', async () => {
    setup({
      [`GET ${P}/audit`]: () => json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
    });
    renderApp('/m/crm-leads?tab=Audit%20Trail');
    expect(
      await screen.findByText('No activity has been recorded for this page yet.'),
    ).toBeInTheDocument();
  });

  it('Reports: Excel downloads with the current filters; Print calls window.print', async () => {
    const { calls } = setup({
      [`GET ${P}/records/export.xlsx`]: () => new Response(new Blob(['x']), { status: 200 }),
    });
    renderApp('/m/crm-leads?tab=Reports&q=lead&status=Draft&sort=company');
    await screen.findByText(/matching records/);
    const ue = userEvent.setup();
    const bar = within(screen.getByText('Lead Management Report').parentElement as HTMLElement);
    await ue.click(bar.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(countCalls(calls, 'GET', '/export.xlsx')).toBe(1));
    const u = new URL(calls.find((c) => c.path.endsWith('/export.xlsx'))?.url ?? '', 'http://test');
    expect(u.searchParams.get('q')).toBe('lead');
    expect(u.searchParams.get('status')).toBe('Draft');
    expect(u.searchParams.get('sort')).toBe('company');
    expect(u.searchParams.has('ids')).toBe(false);
    await ue.click(bar.getByRole('button', { name: 'Print' }));
    expect(window.print).toHaveBeenCalled();
  });

  it('the head Excel and Print buttons work from any tab', async () => {
    const { calls } = setup({
      [`GET ${P}/records/export.xlsx`]: () => new Response(new Blob(['x']), { status: 200 }),
    });
    renderApp('/m/crm-leads');
    await screen.findByRole('heading', { name: 'Lead Management' });
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(countCalls(calls, 'GET', '/export.xlsx')).toBe(1));
    await ue.click(screen.getAllByRole('button', { name: 'Print' })[0] as HTMLElement);
    expect(window.print).toHaveBeenCalled();
  });

  it('an export failure shows the server message', async () => {
    setup({
      [`GET ${P}/records/export.xlsx`]: () =>
        apiError(422, 'TOO_MANY_ROWS', 'More than 10,000 rows.'),
    });
    renderApp('/m/crm-leads');
    await screen.findByRole('heading', { name: 'Lead Management' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Excel' }));
    expect(await screen.findByText('More than 10,000 rows.')).toBeInTheDocument();
  });
});

describe('activity, free-text enums and keyboard search', () => {
  it('the View drawer lists the activity of its record from the record audit endpoint', async () => {
    const { calls } = setup({
      [`GET ${P}/records/r1/audit`]: () =>
        json(200, {
          data: [
            {
              id: 'a9',
              at: '2026-11-03T10:00:00.000Z',
              actor: { id: 'u1', name: 'Asha Patil', loginId: 'asha' },
              action: 'RECORD_UPDATED',
              targetType: 'record',
              targetId: 'r1',
              ip: null,
              userAgent: null,
              detail: null,
            },
          ],
          meta: { page: 1, size: 10, total: 1 },
        }),
    });
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    await userEvent.setup().click(screen.getByRole('button', { name: 'View LEA/TAL/26-27/00001' }));
    const act = within(await screen.findByRole('region', { name: 'Activity' }));
    expect(await act.findByText('record updated')).toBeInTheDocument();
    expect(act.getByText(/Asha Patil/)).toBeInTheDocument();
    expect(countCalls(calls, 'GET', '/records/r1/audit')).toBe(1);
  });

  it('an enum field without options is a text input with suggestions, not an empty select', async () => {
    const schema = {
      ...LEAD_SCHEMA,
      fields: LEAD_SCHEMA.fields.map((f) => (f.type === 'enum' ? { ...f, options: undefined } : f)),
    };
    setup({ [`GET ${P}/schema`]: () => json(200, { data: schema }) });
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add' }));
    const d = within(screen.getByRole('dialog'));
    const enumField = schema.fields.find((f) => f.type === 'enum');
    const input = d.getByLabelText(enumField?.label ?? '');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('list');
    await ue.type(input, 'Anything');
    expect(input).toHaveValue('Anything');
  });

  it('a "… Status" field that is not the page Status is editable', async () => {
    const schema = {
      ...LEAD_SCHEMA,
      fields: [
        ...LEAD_SCHEMA.fields,
        {
          key: 'consentStatus',
          label: 'Consent Status',
          type: 'enum' as const,
          required: false,
          readOnly: false,
          options: ['Pending', 'Approved'],
        },
      ],
    };
    setup({ [`GET ${P}/schema`]: () => json(200, { data: schema }) });
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    await userEvent.setup().click(screen.getByRole('button', { name: '＋ Add' }));
    const d = within(screen.getByRole('dialog'));
    expect(d.getByLabelText('Consent Status')).toBeEnabled();
    expect(d.queryByLabelText('Status')).toBeNull(); // the real Status stays hidden on Add
  });

  it('Enter in the search box applies it immediately', async () => {
    const { calls } = setup();
    renderApp(REGISTER);
    await screen.findByText('Lead 1');
    const box = screen.getByLabelText('Search Lead Management');
    await userEvent.setup().type(box, 'lead 2{Enter}');
    // No 300 ms wait: the request is already on its way when typing finishes.
    expect(lastList(calls).searchParams.get('q')).toBe('lead 2');
  });
});
