// Phase 3 master pages: Company (If-Match, live tax-ID checks, 422), Unit Master (modal,
// activate/deactivate, 409 IN_USE) and Financial Years (add next, set current, close, reopen).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  countCalls,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
} from '../../test/helpers';
import type { Company, FinancialYear, Unit } from '../../types';
import { nextFinancialYear } from './orgApi';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });

const company: Company = {
  id: 'co-1',
  code: 'SAWANT',
  legalName: 'Sawant Group (Ready Hand)',
  tradeName: 'Sawant Group',
  pan: null,
  cin: null,
  gstin: null,
  address: 'Pune',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  version: 4,
};

const units: Unit[] = [
  {
    id: 'unit-tal',
    code: 'TAL',
    name: 'Talwade',
    address: 'Talwade MIDC',
    gstin: null,
    status: 'ACTIVE',
    version: 2,
  },
  {
    id: 'unit-var',
    code: 'VAR',
    name: 'Varale',
    address: null,
    gstin: null,
    status: 'INACTIVE',
    version: 5,
  },
];

const fys: FinancialYear[] = [
  {
    id: 'fy-2627',
    code: '2026-27',
    label: 'FY 2026-27',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'OPEN',
    isCurrent: true,
    version: 3,
  },
  {
    id: 'fy-2526',
    code: '2025-26',
    label: 'FY 2025-26',
    startDate: '2025-04-01T00:00:00.000Z',
    endDate: '2026-03-31T00:00:00.000Z',
    status: 'CLOSED',
    isCurrent: false,
    version: 6,
  },
];

const rowOf = (text: string): HTMLElement => {
  const row = within(screen.getByRole('table')).getByText(text).closest('tr');
  if (!row) throw new Error(`no row for ${text}`);
  return row;
};

describe('Company Master', () => {
  it('validates GSTIN / PAN / CIN while typing and PATCHes only changes with If-Match', async () => {
    const saved = { ...company, gstin: '27ABCDE1234F1Z5', version: 5 };
    const { calls } = signedIn(owner, {
      'GET /api/v1/company': () => json(200, { data: company }),
      'PATCH /api/v1/company': () => json(200, { data: saved }),
    });
    renderApp('/m/admin-company');
    await screen.findByRole('heading', { name: 'Company Master' });
    const ue = userEvent.setup();
    const gstin = await screen.findByLabelText('GSTIN');
    expect(screen.getByLabelText('Company Code')).toHaveValue('SAWANT');
    expect(screen.getByLabelText('Currency')).toBeDisabled();
    await ue.type(gstin, '27abc');
    expect(gstin).toHaveValue('27ABC');
    expect(
      screen.getByText('GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5.'),
    ).toBeInTheDocument();
    expect(gstin).toHaveAttribute('aria-invalid', 'true');
    await ue.type(screen.getByLabelText('PAN'), 'abc');
    expect(screen.getByText('PAN must look like ABCDE1234F.')).toBeInTheDocument();
    await ue.clear(screen.getByLabelText('PAN'));
    expect(screen.queryByText('PAN must look like ABCDE1234F.')).toBeNull();
    // Invalid → no request.
    await ue.click(screen.getByRole('button', { name: 'Save Company' }));
    expect(countCalls(calls, 'PATCH', '/company')).toBe(0);
    await ue.type(gstin, 'DE1234F1Z5');
    expect(screen.queryByText(/GSTIN must be/)).toBeNull();
    await ue.click(screen.getByRole('button', { name: 'Save Company' }));
    expect(await screen.findByText('Company saved.')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.headers['If-Match']).toBe('4');
    expect(patch?.body).toEqual({ gstin: '27ABCDE1234F1Z5' });
  });

  it('shows 422 field errors under the fields and a conflict with Reload', async () => {
    let n = 0;
    signedIn(owner, {
      'GET /api/v1/company': () => json(200, { data: company }),
      'PATCH /api/v1/company': () =>
        ++n === 1
          ? apiError(422, 'VALIDATION_ERROR', 'Some fields are invalid.', {
              legalName: 'Legal name is too similar to another company.',
            })
          : apiError(409, 'VERSION_CONFLICT', 'stale'),
    });
    renderApp('/m/admin-company');
    const ue = userEvent.setup();
    const legal = await screen.findByLabelText('Legal Name');
    await ue.type(legal, ' Pvt');
    await ue.click(screen.getByRole('button', { name: 'Save Company' }));
    expect(
      await screen.findByText('Legal name is too similar to another company.'),
    ).toBeInTheDocument();
    expect(legal).toHaveAttribute('aria-invalid', 'true');
    await ue.click(screen.getByRole('button', { name: 'Save Company' }));
    expect(
      await screen.findByText('This record was changed by someone else. Reload and try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('without controls the form is read-only with no Save', async () => {
    signedIn(owner, {
      'GET /api/v1/company': () => json(200, { data: company }),
      'GET /api/v1/me/permissions': permissionsRoute({ view: true }),
    });
    renderApp('/m/admin-company');
    expect(await screen.findByLabelText('Legal Name')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Save Company' })).toBeNull();
  });

  it('the System Setup tile opens it', async () => {
    signedIn(owner, { 'GET /api/v1/company': () => json(200, { data: company }) });
    renderApp('/m/admin-settings');
    await userEvent.setup().click(await screen.findByRole('button', { name: /Company Master/ }));
    expect(await screen.findByRole('heading', { name: 'Company Master' })).toBeInTheDocument();
  });
});

describe('Unit Master', () => {
  it('lists units in the Department Master layout; the tile opens it', async () => {
    signedIn(owner, { 'GET /api/v1/units': () => json(200, { data: units }) });
    renderApp('/m/admin-settings');
    await userEvent.setup().click(await screen.findByRole('button', { name: /Unit Master/ }));
    expect(await screen.findByRole('heading', { name: 'Unit Master' })).toBeInTheDocument();
    await screen.findByRole('cell', { name: 'Talwade' });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Code',
      'Name',
      'Address',
      'GSTIN',
      'Status',
      'Action',
    ]);
    expect(within(rowOf('Varale')).getByText('Inactive')).toHaveClass('status', 'inactive');
    expect(
      within(rowOf('Varale')).getByRole('button', { name: 'Activate Varale' }),
    ).toBeInTheDocument();
  });

  it('Add Unit validates locally (GSTIN live) and POSTs; the top bar context reloads', async () => {
    const created: Unit = {
      id: 'unit-chk',
      code: 'CHK',
      name: 'Chakan',
      address: null,
      gstin: '27ABCDE1234F1Z5',
      status: 'ACTIVE',
      version: 1,
    };
    const { calls } = signedIn(owner, {
      'GET /api/v1/units': () => json(200, { data: units }),
      'POST /api/v1/units': () => json(201, { data: created }),
    });
    renderApp('/m/admin-branches');
    await screen.findByRole('cell', { name: 'Talwade' });
    await waitFor(() => expect(countCalls(calls, 'GET', '/me/context')).toBe(1));
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add Unit' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Unit' }));
    await ue.type(d.getByLabelText('Code'), 'c');
    await ue.type(d.getByLabelText('GSTIN'), '27x');
    expect(d.getByText(/GSTIN must be 15 characters/)).toBeInTheDocument();
    await ue.click(d.getByRole('button', { name: 'Create Unit' }));
    expect(d.getByText('Code: 2–10 capital letters or digits.')).toBeInTheDocument();
    expect(d.getByText('Name must be 2–60 characters.')).toBeInTheDocument();
    expect(countCalls(calls, 'POST', '/units')).toBe(0);
    await ue.type(d.getByLabelText('Code'), 'hk');
    await ue.type(d.getByLabelText('Name'), 'Chakan');
    await ue.clear(d.getByLabelText('GSTIN'));
    await ue.type(d.getByLabelText('GSTIN'), '27ABCDE1234F1Z5');
    await ue.click(d.getByRole('button', { name: 'Create Unit' }));
    expect(await screen.findByText('Unit Chakan created.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && !c.path.includes('/auth/'))?.body).toEqual({
      code: 'CHK',
      name: 'Chakan',
      address: null,
      gstin: '27ABCDE1234F1Z5',
    });
    await waitFor(() => expect(countCalls(calls, 'GET', '/me/context')).toBe(2));
  });

  it('Edit sends only changes with If-Match', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/units': () => json(200, { data: units }),
      'PATCH /api/v1/units/unit-tal': () =>
        json(200, { data: { ...units[0], name: 'Talwade Plant', version: 3 } }),
    });
    renderApp('/m/admin-branches');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Edit Talwade' }));
    const d = within(screen.getByRole('dialog'));
    await ue.clear(d.getByLabelText('Name'));
    await ue.type(d.getByLabelText('Name'), 'Talwade Plant');
    await ue.click(d.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Unit Talwade Plant updated.')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.headers['If-Match']).toBe('2');
    expect(patch?.body).toEqual({ name: 'Talwade Plant' });
  });

  it('Deactivate / Activate confirm and PATCH the status', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/units': () => json(200, { data: units }),
      'PATCH /api/v1/units/unit-var': () =>
        json(200, { data: { ...units[1], status: 'ACTIVE', version: 6 } }),
    });
    renderApp('/m/admin-branches');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Activate Varale' }));
    const d = within(screen.getByRole('dialog', { name: 'Activate Unit' }));
    await ue.click(d.getByRole('button', { name: 'Activate' }));
    expect(await screen.findByText('Varale is now active.')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ status: 'ACTIVE' });
    expect(patch?.headers['If-Match']).toBe('5');
  });

  it('Delete shows the server IN_USE message and keeps the dialog open', async () => {
    const message = 'This unit has 12 users. Move them first or deactivate the unit.';
    const { calls } = signedIn(owner, {
      'GET /api/v1/units': () => json(200, { data: units }),
      'DELETE /api/v1/units/unit-tal': () => apiError(409, 'IN_USE', message),
    });
    renderApp('/m/admin-branches');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Delete Talwade' }));
    const d = within(screen.getByRole('dialog', { name: 'Delete Unit' }));
    await ue.click(d.getByRole('button', { name: 'Delete' }));
    expect(await d.findByText(message)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'DELETE')?.headers['If-Match']).toBe('2');
  });

  it('without controls there are no change buttons', async () => {
    signedIn(owner, {
      'GET /api/v1/units': () => json(200, { data: units }),
      'GET /api/v1/me/permissions': permissionsRoute({ view: true }),
    });
    renderApp('/m/admin-branches');
    await screen.findByRole('cell', { name: 'Talwade' });
    expect(screen.queryByRole('button', { name: '＋ Add Unit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Talwade' })).toBeNull();
  });
});

describe('Financial Years', () => {
  it('nextFinancialYear follows the latest year (Indian FY)', () => {
    expect(nextFinancialYear(fys)).toEqual({
      code: '2027-28',
      label: 'FY 2027-28',
      startDate: '2027-04-01',
      endDate: '2028-03-31',
    });
    expect(nextFinancialYear([], new Date(2026, 1, 10)).code).toBe('2025-26');
    expect(nextFinancialYear([], new Date(2026, 3, 1)).code).toBe('2026-27');
    expect(nextFinancialYear([{ endDate: '2099-03-31' }]).code).toBe('2099-00');
  });

  it('lists years; the current year cannot be closed; closed years can be reopened', async () => {
    signedIn(owner, { 'GET /api/v1/financial-years': () => json(200, { data: fys }) });
    renderApp('/m/admin-fy');
    await screen.findByText('FY 2026-27');
    const current = within(rowOf('FY 2026-27'));
    expect(current.getByText('Current')).toBeInTheDocument();
    expect(current.getByText('01 Apr 2026')).toBeInTheDocument();
    expect(current.getByText('31 Mar 2027')).toBeInTheDocument();
    const close = current.getByRole('button', { name: 'Close FY 2026-27' });
    expect(close).toBeDisabled();
    expect(close).toHaveAttribute('title', 'Set another year as current before closing this one.');
    expect(current.queryByRole('button', { name: /Set FY 2026-27/ })).toBeNull();
    const old = within(rowOf('FY 2025-26'));
    expect(old.getByText('Closed')).toHaveClass('status', 'inactive');
    expect(old.getByText('01 Apr 2025')).toBeInTheDocument();
    expect(old.getByRole('button', { name: 'Reopen FY 2025-26' })).toBeInTheDocument();
  });

  it('Add Next FY proposes 2027-28 and POSTs it; the context reloads', async () => {
    const created: FinancialYear = {
      id: 'fy-2728',
      code: '2027-28',
      label: 'FY 2027-28',
      startDate: '2027-04-01',
      endDate: '2028-03-31',
      status: 'OPEN',
      isCurrent: false,
      version: 1,
    };
    const { calls } = signedIn(owner, {
      'GET /api/v1/financial-years': () => json(200, { data: fys }),
      'POST /api/v1/financial-years': () => json(201, { data: created }),
    });
    renderApp('/m/admin-fy');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: '＋ Add Next FY' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Next Financial Year' }));
    expect(d.getByText('01 Apr 2027')).toBeInTheDocument();
    expect(d.getByText('31 Mar 2028')).toBeInTheDocument();
    await ue.click(d.getByRole('button', { name: 'Add FY 2027-28' }));
    expect(await screen.findByText('FY 2027-28 added.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && !c.path.includes('/auth/'))?.body).toEqual({
      code: '2027-28',
      label: 'FY 2027-28',
      startDate: '2027-04-01',
      endDate: '2028-03-31',
    });
    await waitFor(() => expect(countCalls(calls, 'GET', '/me/context')).toBe(2));
  });

  it('Close and Set current confirm first and POST with If-Match; errors stay in the modal', async () => {
    const open2526 = { ...fys[1], status: 'OPEN' } as FinancialYear;
    const { calls } = signedIn(owner, {
      'GET /api/v1/financial-years': () => json(200, { data: [fys[0], open2526] }),
      'POST /api/v1/financial-years/fy-2526/set-current': () =>
        json(200, { data: { ...open2526, isCurrent: true, version: 7 } }),
      'POST /api/v1/financial-years/fy-2526/close': () =>
        apiError(409, 'FY_CURRENT', 'The current financial year cannot be closed.'),
    });
    renderApp('/m/admin-fy');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Close FY 2025-26' }));
    let d = within(screen.getByRole('dialog', { name: 'Close FY 2025-26' }));
    await ue.click(d.getByRole('button', { name: 'Close year' }));
    expect(await d.findByText('The current financial year cannot be closed.')).toBeInTheDocument();
    await ue.click(d.getByRole('button', { name: 'Cancel' }));

    await ue.click(screen.getByRole('button', { name: 'Set FY 2025-26 as current' }));
    d = within(screen.getByRole('dialog', { name: 'Set current FY 2025-26' }));
    await ue.click(d.getByRole('button', { name: 'Set current' }));
    expect(
      await screen.findByText('FY 2025-26 is now the current financial year.'),
    ).toBeInTheDocument();
    const post = calls.find((c) => c.path.endsWith('/set-current'));
    expect(post?.method).toBe('POST');
    expect(post?.headers['If-Match']).toBe('6');
  });
});
