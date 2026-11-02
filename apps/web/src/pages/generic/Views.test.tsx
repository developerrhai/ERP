// Tests for schema.views (Ledger | Vouchers toggle on inv-transactions), action `requires`
// permissions, and the read-only unit chip (warehouse Branch) in the form.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { leadRow } from '../../test/engine-fixtures';
import {
  countCalls,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
  type Call,
  type Handler,
} from '../../test/helpers';
import type { FieldMeta, PageSchema, RecordRow } from './engineApi';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const P = '/api/v1/pages/inv-transactions';
const REG = '/m/inv-transactions?tab=Transaction%20Register';

const f = (
  key: string,
  label: string,
  type: FieldMeta['type'],
  over: Partial<FieldMeta> = {},
): FieldMeta => ({
  key,
  label,
  type,
  required: false,
  readOnly: type === 'code' || type === 'status',
  ...over,
});

const SCHEMA: PageSchema = {
  pageId: 'inv-transactions',
  title: 'Inventory Transactions',
  family: 'Inventory',
  tabs: ['Transaction Register', 'Receipts', 'Issues', 'Reversals', 'Approvals Desk', 'Audit'],
  kind: 'typed',
  statuses: ['Draft', 'Posted', 'Cancelled'],
  listColumns: ['txnNo', 'qty', 'status'],
  fields: [
    f('txnNo', 'Transaction No', 'code'),
    f('qty', 'Qty', 'qty', { required: true }),
    f('status', 'Status', 'status'),
  ],
  actions: [
    {
      key: 'post',
      label: 'Post',
      variant: 'primary',
      confirm: 'Post {code}?',
      allowedFrom: ['Draft'],
      requires: 'edit',
    },
    {
      key: 'cancel',
      label: 'Cancel voucher',
      variant: 'danger',
      confirm: true,
      allowedFrom: ['Draft', 'Posted'],
      requires: 'delete',
    },
  ],
  filters: [
    { key: 'view', label: 'View', type: 'select', param: 'view', options: ['ledger', 'vouchers'] },
  ],
  views: [
    {
      key: 'ledger',
      label: 'Ledger',
      columns: [
        { key: 'postingDate', label: 'Date', format: 'date' },
        { key: 'voucherNo', label: 'Voucher No', format: 'text' },
        { key: 'qtyIn', label: 'In', format: 'qty' },
        { key: 'value', label: 'Value', format: 'money' },
        { key: 'postedAt', label: 'Posted At', format: 'datetime' },
      ],
    },
    { key: 'vouchers', label: 'Vouchers' },
  ],
};

const ledgerRow: RecordRow = {
  ...leadRow(1),
  id: 'l1',
  code: 'OPN/TAL/26-27/0001',
  data: {
    postingDate: '2026-11-03',
    voucherNo: 'OPN/TAL/26-27/0001',
    qtyIn: 12500,
    value: 625000.5,
    postedAt: '2026-11-03T10:30:00.000Z',
  },
};
const draft: RecordRow = {
  ...leadRow(2),
  id: 'v1',
  code: 'TXN/TAL/26-27/0001',
  status: 'Draft',
  data: { qty: 5 },
};
const posted: RecordRow = {
  ...leadRow(3),
  id: 'v2',
  code: 'TXN/TAL/26-27/0002',
  status: 'Posted',
  data: { qty: 8 },
};

const params = (c: Call | undefined): URLSearchParams =>
  new URL(c?.url ?? '', 'http://test').searchParams;
const records: Handler = (call) => {
  const rows = params(call).get('view') === 'vouchers' ? [draft, posted] : [ledgerRow];
  return json(200, { data: rows, meta: { page: 1, size: 10, total: rows.length } });
};
const lastList = (calls: Call[]): Call | undefined =>
  calls.filter((c) => c.method === 'GET' && c.path === `${P}/records`).at(-1);

function setup(extra: Record<string, Handler> = {}) {
  return signedIn(owner, {
    [`GET ${P}/schema`]: () => json(200, { data: SCHEMA }),
    [`GET ${P}/records`]: records,
    ...extra,
  });
}

describe('Ledger | Vouchers toggle', () => {
  it('defaults to the first view, shows a segmented toggle (no select) and requests view=ledger', async () => {
    const { calls } = setup();
    renderApp(REG);
    await screen.findByText('OPN/TAL/26-27/0001', { selector: 'td' });
    const toggle = within(screen.getByRole('group', { name: 'View' }));
    expect(toggle.getByRole('button', { name: 'Ledger' })).toHaveAttribute('aria-pressed', 'true');
    expect(toggle.getByRole('button', { name: 'Vouchers' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByRole('combobox', { name: 'View' })).toBeNull();
    expect(params(lastList(calls)).get('view')).toBe('ledger');
  });

  it('ledger rows use the view columns with qty / ₹ / date formats and are read-only', async () => {
    setup();
    renderApp(REG);
    const row = (await screen.findByText('OPN/TAL/26-27/0001', { selector: 'td' })).closest(
      'tr',
    ) as HTMLElement;
    expect(
      screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/\s*[▲▼]/, '')),
    ).toEqual(['', 'Date', 'Voucher No', 'In', 'Value', 'Posted At', 'Actions']);
    expect(within(row).getByText('03 Nov 2026')).toBeInTheDocument();
    expect(within(row).getByText('12,500')).toBeInTheDocument();
    expect(within(row).getByText('₹ 6,25,000.5')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: `View ${ledgerRow.code}` })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^(Edit|Delete|Post|Cancel)/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Selected' })).toBeNull();
    // The drawer shows the same ledger fields.
    await userEvent
      .setup()
      .click(within(row).getByRole('button', { name: `View ${ledgerRow.code}` }));
    const dr = within(screen.getByRole('dialog', { name: 'Inventory Transactions Details' }));
    expect(dr.getByText('Voucher No')).toBeInTheDocument();
    expect(dr.getByText('12,500')).toBeInTheDocument();
    expect(dr.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('switching to Vouchers keeps ?view= in the URL, changes columns and brings the actions', async () => {
    const { calls } = setup();
    renderApp(REG);
    await screen.findByText('OPN/TAL/26-27/0001', { selector: 'td' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Vouchers' }));
    await screen.findByText(draft.code, { selector: 'td' });
    expect(params(lastList(calls)).get('view')).toBe('vouchers');
    expect(screen.getByRole('button', { name: 'Vouchers' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual([
      '',
      'Transaction No',
      'Qty',
      'Status',
      'Actions',
    ]);
    expect(screen.getByRole('button', { name: `Post ${draft.code}` })).toBeInTheDocument();
  });

  it('opens straight on ?view=vouchers', async () => {
    const { calls } = setup();
    renderApp(`${REG}&view=vouchers`);
    await screen.findByText(draft.code, { selector: 'td' });
    expect(screen.getByRole('button', { name: 'Vouchers' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(params(lastList(calls)).get('view')).toBe('vouchers');
  });

  it('＋ Add from the ledger saves a voucher, then shows Vouchers with a hint', async () => {
    const { calls } = setup({ [`POST ${P}/records`]: () => json(201, { data: draft }) });
    renderApp(REG);
    await screen.findByText('OPN/TAL/26-27/0001', { selector: 'td' });
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Inventory Transactions' }));
    await ue.type(d.getByLabelText('Qty'), '5');
    await ue.click(d.getByRole('button', { name: 'Save Record' }));
    expect(await screen.findByText('Draft saved — post it from Vouchers')).toBeInTheDocument();
    await screen.findByText(draft.code, { selector: 'td' });
    expect(screen.getByRole('button', { name: 'Vouchers' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(countCalls(calls, 'POST', `${P}/records`)).toBe(1);
  });

  it('dashboard and data quality read vouchers, not the ledger', async () => {
    const { calls } = setup();
    renderApp('/m/inv-transactions');
    await screen.findByText(draft.code, { selector: 'td' });
    expect(
      calls
        .filter((c) => c.path === `${P}/records`)
        .every((c) => params(c).get('view') === 'vouchers'),
    ).toBe(true);
  });
});

describe('action requires', () => {
  const vouchers = `${REG}&view=vouchers`;

  it('cancel of a posted voucher needs delete; a Draft cancel only needs edit', async () => {
    setup({
      'GET /api/v1/me/permissions': permissionsRoute({ view: true, add: true, edit: true }),
    });
    renderApp(vouchers);
    await screen.findByText(draft.code, { selector: 'td' });
    expect(screen.getByRole('button', { name: `Post ${draft.code}` })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Cancel voucher ${draft.code}` }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Cancel voucher ${posted.code}` })).toBeNull();
  });

  it('with delete the posted cancel is offered, without edit Post is hidden', async () => {
    setup({ 'GET /api/v1/me/permissions': permissionsRoute({ view: true, delete: true }) });
    renderApp(vouchers);
    await screen.findByText(draft.code, { selector: 'td' });
    expect(
      screen.getByRole('button', { name: `Cancel voucher ${posted.code}` }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Post ${draft.code}` })).toBeNull();
    // A Draft cancel needs edit, which this user lacks.
    expect(screen.queryByRole('button', { name: `Cancel voucher ${draft.code}` })).toBeNull();
  });

  it('the drawer follows the same rule', async () => {
    setup({ 'GET /api/v1/me/permissions': permissionsRoute({ view: true, edit: true }) });
    renderApp(vouchers);
    await screen.findByText(posted.code, { selector: 'td' });
    await userEvent.setup().click(screen.getByRole('button', { name: `View ${posted.code}` }));
    const dr = within(screen.getByRole('dialog', { name: 'Inventory Transactions Details' }));
    expect(dr.queryByRole('button', { name: `Cancel voucher ${posted.code}` })).toBeNull();
  });
});

describe('read-only unit chip', () => {
  const whSchema: PageSchema = {
    pageId: 'wms-warehouses',
    title: 'Warehouse Master',
    family: 'Warehouse / WMS',
    tabs: ['Warehouse Register', 'B', 'C', 'D', 'E', 'F'],
    kind: 'typed',
    statuses: ['ACTIVE', 'INACTIVE'],
    actions: [],
    listColumns: ['code', 'name', 'branch'],
    fields: [
      f('code', 'Warehouse Code', 'code'),
      f('name', 'Warehouse Name', 'text', { required: true }),
      f('branch', 'Branch', 'ref', { readOnly: true }),
    ],
  };

  it('shows Branch as a chip with the unit, never an input', async () => {
    const wh: RecordRow = {
      ...leadRow(1),
      id: 'w1',
      code: 'TAL-MAIN',
      status: 'ACTIVE',
      data: { name: 'Talwade Main Store', branch: 'unit-tal' },
      refs: { branch: { id: 'unit-tal', code: 'TAL', name: 'Talwade' } },
    };
    setup({
      'GET /api/v1/pages/wms-warehouses/schema': () => json(200, { data: whSchema }),
      'GET /api/v1/pages/wms-warehouses/records': () =>
        json(200, { data: [wh], meta: { page: 1, size: 10, total: 1 } }),
    });
    renderApp('/m/wms-warehouses?tab=Warehouse%20Register');
    await screen.findByText('TAL-MAIN', { selector: 'td' });
    expect(screen.getAllByText('TAL — Talwade').length).toBeGreaterThan(0);
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Edit TAL-MAIN' }));
    const d = within(screen.getByRole('dialog', { name: 'Edit Warehouse Master' }));
    const chip = d.getByText('TAL — Talwade');
    expect(chip).toHaveClass('chip');
    expect(d.queryByRole('textbox', { name: 'Branch' })).toBeNull();
    await ue.click(d.getByRole('button', { name: 'Cancel' }));
    await ue.click(screen.getByRole('button', { name: '＋ Add' }));
    expect(await screen.findByText('Set from the current unit')).toBeInTheDocument();
  });
});
