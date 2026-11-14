import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { json, makeUser, renderApp, signedIn } from '../../test/helpers';
import type { Currency, Designation, Uom } from '../../types';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });

const now = '2026-04-01T00:00:00.000Z';

const designations: Designation[] = [
  {
    id: 'desig-mgr',
    code: 'MGR',
    name: 'Department Manager',
    departmentId: 'dept-eng',
    department: { id: 'dept-eng', code: 'ENG', name: 'Engineering' },
    level: 50,
    status: 'ACTIVE',
    version: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'desig-eng',
    code: 'ENG',
    name: 'Design Engineer',
    departmentId: null,
    level: 20,
    status: 'INACTIVE',
    version: 2,
    createdAt: now,
    updatedAt: now,
  },
];

const currencies: Currency[] = [
  {
    id: 'curr-inr',
    code: 'INR',
    name: 'Indian Rupee',
    symbol: '₹',
    decimalPlaces: 2,
    isBase: true,
    exchangeRate: 1.0,
    status: 'ACTIVE',
    version: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'curr-usd',
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    decimalPlaces: 2,
    isBase: false,
    exchangeRate: 86.5,
    status: 'ACTIVE',
    version: 3,
    createdAt: now,
    updatedAt: now,
  },
];

const uoms: Uom[] = [
  {
    id: 'uom-nos',
    code: 'NOS',
    name: 'Numbers',
    uomClass: 'COUNT',
    decimals: 0,
    status: 'ACTIVE',
    version: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'uom-kg',
    code: 'KG',
    name: 'Kilogram',
    uomClass: 'WEIGHT',
    decimals: 3,
    status: 'ACTIVE',
    version: 2,
    createdAt: now,
    updatedAt: now,
  },
];

describe('DesignationMasterPage', () => {
  it('lists designations, filters, and creates a new designation', async () => {
    const created: Designation = {
      id: 'desig-lead',
      code: 'LEAD',
      name: 'Team Lead',
      departmentId: null,
      level: 40,
      status: 'ACTIVE',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const { calls } = signedIn(owner, {
      'GET /api/v1/designations': () => json(200, { data: designations }),
      'GET /api/v1/departments': () => json(200, { data: [] }),
      'POST /api/v1/designations': () => json(201, { data: created }),
    });

    renderApp('/m/admin-designations');
    await screen.findByRole('heading', { name: 'Designation Master' });
    expect(await screen.findByText('Department Manager')).toBeInTheDocument();
    expect(screen.getByText('Design Engineer')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();

    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add Designation' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Designation' }));
    await ue.type(d.getByLabelText('Code'), 'lead');
    await ue.type(d.getByLabelText(/Title \/ Name/), 'Team Lead');
    await ue.click(d.getByRole('button', { name: 'Create Designation' }));

    expect(await screen.findByText('Designation Team Lead created.')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/designations'));
    expect(post?.body).toMatchObject({
      code: 'LEAD',
      name: 'Team Lead',
      level: 10,
    });
  });

  it('edits a designation with If-Match', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/designations': () => json(200, { data: designations }),
      'GET /api/v1/departments': () => json(200, { data: [] }),
      'PATCH /api/v1/designations/desig-mgr': () =>
        json(200, { data: { ...designations[0], name: 'Senior Manager', version: 2 } }),
    });

    renderApp('/m/admin-designations');
    await screen.findByText('Department Manager');

    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Edit Department Manager' }));
    const d = within(screen.getByRole('dialog', { name: /Edit Designation/ }));
    await ue.clear(d.getByLabelText(/Title \/ Name/));
    await ue.type(d.getByLabelText(/Title \/ Name/), 'Senior Manager');
    await ue.click(d.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText('Designation Senior Manager updated.')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.headers['If-Match']).toBe('1');
    expect(patch?.body).toEqual({ name: 'Senior Manager' });
  });

  it('deletes a designation with confirm dialog and If-Match', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/designations': () => json(200, { data: designations }),
      'GET /api/v1/departments': () => json(200, { data: [] }),
      'DELETE /api/v1/designations/desig-eng': () => json(204, {}),
    });

    renderApp('/m/admin-designations');
    await screen.findByText('Design Engineer');

    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Delete Design Engineer' }));
    const d = within(screen.getByRole('dialog', { name: 'Delete Designation' }));
    await ue.click(d.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Designation Design Engineer deleted.')).toBeInTheDocument();
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.headers['If-Match']).toBe('2');
  });
});

describe('CurrencyMasterPage', () => {
  it('lists currencies and highlights base currency', async () => {
    signedIn(owner, {
      'GET /api/v1/currencies': () => json(200, { data: currencies }),
    });

    renderApp('/m/admin-currency');
    await screen.findByRole('heading', { name: 'Currency Master' });
    expect(await screen.findByText('INR')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByText('Base Currency', { selector: '.chip' })).toBeInTheDocument();
    // Cannot delete base currency
    expect(screen.queryByRole('button', { name: 'Delete Indian Rupee' })).toBeNull();
    // Can delete non-base currency
    expect(screen.getByRole('button', { name: 'Delete US Dollar' })).toBeInTheDocument();
  });

  it('creates a new currency validating 3-letter code', async () => {
    const created: Currency = {
      id: 'curr-eur',
      code: 'EUR',
      name: 'Euro',
      symbol: '€',
      decimalPlaces: 2,
      isBase: false,
      exchangeRate: 92.0,
      status: 'ACTIVE',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const { calls } = signedIn(owner, {
      'GET /api/v1/currencies': () => json(200, { data: currencies }),
      'POST /api/v1/currencies': () => json(201, { data: created }),
    });

    renderApp('/m/admin-currency');
    await screen.findByText('INR');

    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add Currency' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Currency' }));

    await ue.type(d.getByLabelText(/ISO Code/), 'eu');
    await ue.click(d.getByRole('button', { name: 'Create Currency' }));
    expect(d.getByText(/must be 3 capital letters/)).toBeInTheDocument();

    await ue.type(d.getByLabelText(/ISO Code/), 'r');
    await ue.type(d.getByLabelText('Currency Name'), 'Euro');
    await ue.type(d.getByLabelText('Symbol'), '€');
    await ue.click(d.getByRole('button', { name: 'Create Currency' }));

    expect(await screen.findByText('Currency EUR created.')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/currencies'));
    expect(post?.body).toMatchObject({
      code: 'EUR',
      name: 'Euro',
      symbol: '€',
      decimalPlaces: 2,
    });
  });
});

describe('UomMasterPage', () => {
  it('lists UOMs and creates a new one', async () => {
    const created: Uom = {
      id: 'uom-ltr',
      code: 'LTR',
      name: 'Litre',
      uomClass: 'VOLUME',
      decimals: 2,
      status: 'ACTIVE',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const { calls } = signedIn(owner, {
      'GET /api/v1/uoms': () => json(200, { data: uoms }),
      'POST /api/v1/uoms': () => json(201, { data: created }),
    });

    renderApp('/m/admin-uom');
    await screen.findByRole('heading', { name: /Unit of Measurement/ });
    expect(await screen.findByText('NOS')).toBeInTheDocument();
    expect(screen.getByText('Kilogram')).toBeInTheDocument();

    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add UOM' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Unit of Measurement' }));

    await ue.type(d.getByLabelText(/UOM Code/), 'ltr');
    await ue.type(d.getByLabelText(/Full Unit Name/), 'Litre');
    await ue.selectOptions(d.getByLabelText('Measurement Category'), 'VOLUME');
    await ue.clear(d.getByLabelText(/Decimal Places/));
    await ue.type(d.getByLabelText(/Decimal Places/), '2');
    await ue.click(d.getByRole('button', { name: 'Create UOM' }));

    expect(await screen.findByText('UOM LTR created.')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/uoms'));
    expect(post?.body).toEqual({
      code: 'LTR',
      name: 'Litre',
      uomClass: 'VOLUME',
      decimals: 2,
      status: 'ACTIVE',
    });
  });
});
