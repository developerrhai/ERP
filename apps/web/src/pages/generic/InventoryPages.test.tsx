// Stage C web tests (inventory slice) through the generic page: register filters and totals bar,
// Below Reorder highlighting, ref labels, computed read-only fields, lookup comboboxes (source vs
// destination unit scope), every action flow with server errors, and read-only after posting.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ADJUST_SCHEMA,
  adjustRow,
  ITEM_REF,
  OPENING_SCHEMA,
  recordsHandler,
  STOCK_SCHEMA,
  stockRow,
  TRANSFER_SCHEMA,
  transferRow,
  WH_REF,
} from '../../test/engine-fixtures';
import {
  apiError,
  countCalls,
  json,
  makeUser,
  renderApp,
  signedIn,
  type Call,
  type Handler,
} from '../../test/helpers';
import type { PageSchema, RecordRow } from './engineApi';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });

function setup(schema: PageSchema, handlers: Record<string, Handler> = {}) {
  const P = `/api/v1/pages/${schema.pageId}`;
  return signedIn(owner, {
    [`GET ${P}/schema`]: () => json(200, { data: schema }),
    'GET /api/v1/lookups/items': () => json(200, { data: [ITEM_REF] }),
    'GET /api/v1/lookups/warehouses': () => json(200, { data: [WH_REF] }),
    ...handlers,
  });
}

const rowOf = (code: string): HTMLElement =>
  screen.getByText(code, { selector: 'td' }).closest('tr') as HTMLElement;
const params = (c: Call | undefined): URLSearchParams =>
  new URL(c?.url ?? '', 'http://test').searchParams;

describe('Stock Balance (list-only typed page)', () => {
  const rows = [stockRow(1, 'OK', 100), stockRow(2, 'Below Reorder', 4)];
  const P = '/api/v1/pages/inv-stock';
  const list: Handler = (call) => {
    const below = params(call).get('belowReorder') === 'true';
    const data = below ? rows.filter((r) => r.data.stockStatus === 'Below Reorder') : rows;
    return json(200, {
      data,
      meta: {
        page: 1,
        size: 10,
        total: data.length,
        totals: { onHand: below ? 4 : 104, stockValue: below ? 200 : 5200 },
      },
    });
  };
  const open = () => `/m/inv-stock?tab=${encodeURIComponent('Stock Register')}`;

  it('shows the totals bar from meta.totals (qty and ₹ en-IN) and no write buttons', async () => {
    setup(STOCK_SCHEMA, { [`GET ${P}/records`]: list });
    renderApp(open());
    await screen.findByText('ITM/00001');
    const bar = within(screen.getByLabelText('Totals'));
    expect(bar.getByText('Total On Hand')).toBeInTheDocument();
    expect(bar.getByText('104')).toBeInTheDocument();
    expect(bar.getByText('Total Stock Value')).toBeInTheDocument();
    expect(bar.getByText('₹ 5,200')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
  });

  it('highlights Below Reorder rows and shows the pill', async () => {
    setup(STOCK_SCHEMA, { [`GET ${P}/records`]: list });
    renderApp(open());
    await screen.findByText('ITM/00001');
    const low = rowOf('ITM/00002');
    expect(low).toHaveClass('row-low');
    expect(within(low).getByText('Below Reorder')).toHaveClass('status', 'below-reorder');
    expect(rowOf('ITM/00001')).not.toHaveClass('row-low');
    expect(within(rowOf('ITM/00001')).getByText('OK')).toHaveClass('status', 'ok');
  });

  it('schema filters are controls that send query parameters and update the totals', async () => {
    const { calls } = setup(STOCK_SCHEMA, { [`GET ${P}/records`]: list });
    renderApp(open());
    await screen.findByText('ITM/00001');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('checkbox', { name: 'Below reorder only' }));
    await waitFor(() =>
      expect(
        params(calls.filter((c) => c.path === `${P}/records`).at(-1)).get('belowReorder'),
      ).toBe('true'),
    );
    await waitFor(() => expect(screen.queryByText('ITM/00001')).toBeNull());
    expect(within(screen.getByLabelText('Totals')).getByText('₹ 200')).toBeInTheDocument();
    const wh = screen.getByRole('combobox', { name: 'Warehouse' });
    expect(
      within(wh)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All Warehouse', 'TAL-MAIN', 'WH-OTHER']);
    await ue.selectOptions(wh, 'wh-1');
    await waitFor(() =>
      expect(params(calls.filter((c) => c.path === `${P}/records`).at(-1)).get('warehouseId')).toBe(
        'wh-1',
      ),
    );
    // Filters live in the URL and are kept by the Excel export.
    await ue.click(screen.getAllByRole('button', { name: 'Excel' })[0] as HTMLElement);
    await waitFor(() => expect(countCalls(calls, 'GET', '/export.xlsx')).toBe(1));
  });

  it('restores a filter from the URL', async () => {
    const { calls } = setup(STOCK_SCHEMA, { [`GET ${P}/records`]: list });
    renderApp(`${open()}&belowReorder=true`);
    await screen.findByText('ITM/00002');
    expect(screen.getByRole('checkbox', { name: 'Below reorder only' })).toBeChecked();
    expect(params(calls.find((c) => c.path === `${P}/records`)).get('belowReorder')).toBe('true');
  });
});

describe('Opening Stock', () => {
  const P = '/api/v1/pages/inv-opening';
  const open = '/m/inv-opening?tab=Opening%20Register';
  const posted: RecordRow = {
    ...adjustRow(1, 'Posted'),
    code: 'OPN/TAL/26-27/0001',
    data: { warehouse: 'wh-1', item: 'item-1', openingQty: 100, unitCost: 50, openingValue: 5000 },
  };
  const draft: RecordRow = { ...posted, id: 'r2', code: 'OPN/TAL/26-27/0002', status: 'Draft' };

  it('lists ref labels, locks posted vouchers and keeps Draft editable', async () => {
    setup(OPENING_SCHEMA, { [`GET ${P}/records`]: recordsHandler([draft, posted]) });
    renderApp(open);
    await screen.findByText(draft.code);
    expect(
      within(rowOf(draft.code)).getByText('TAL-MAIN — Talwade Main Store'),
    ).toBeInTheDocument();
    expect(within(rowOf(draft.code)).getByText('ITM/00001 — Steel Rod')).toBeInTheDocument();
    expect(within(rowOf(draft.code)).getByText('₹ 5,000')).toBeInTheDocument();
    expect(
      within(rowOf(draft.code)).getByRole('button', { name: `Edit ${draft.code}` }),
    ).toBeInTheDocument();
    const p = within(rowOf(posted.code));
    expect(p.getByText('Posted')).toHaveClass('status', 'posted');
    expect(p.queryByRole('button', { name: `Edit ${posted.code}` })).toBeNull();
    expect(p.queryByRole('button', { name: `Delete ${posted.code}` })).toBeNull();
    expect(p.getByRole('button', { name: `Cancel ${posted.code}` })).toBeInTheDocument();
  });

  it('computes Opening Value from qty × cost while typing and sends only editable fields', async () => {
    const { calls } = setup(OPENING_SCHEMA, {
      [`GET ${P}/records`]: recordsHandler([draft]),
      [`POST ${P}/records`]: () => json(201, { data: draft }),
    });
    renderApp(open);
    await screen.findByText(draft.code);
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Opening Stock' }));
    expect(d.getByLabelText('Opening Value')).toHaveValue('Computed by the server');
    await ue.type(d.getByRole('combobox', { name: 'Warehouse' }), 'tal');
    await ue.click(await d.findByRole('option', { name: /TAL-MAIN/ }));
    await ue.type(d.getByRole('combobox', { name: 'Item' }), 'steel');
    await ue.click(await d.findByRole('option', { name: /Steel Rod/ }));
    await ue.type(d.getByLabelText('Opening Qty'), '100');
    await ue.type(d.getByLabelText('Unit Cost'), '50.5');
    expect(d.getByLabelText('Opening Value')).toHaveValue('₹ 5,050');
    await ue.click(d.getByRole('button', { name: 'Save Record' }));
    await waitFor(() => expect(countCalls(calls, 'POST', `${P}/records`)).toBe(1));
    expect(calls.find((c) => c.method === 'POST' && c.path === `${P}/records`)?.body).toEqual({
      data: { warehouse: 'wh-1', item: 'item-1', openingQty: 100, unitCost: 50.5 },
    });
  });

  it('shows the server value for the saved voucher, not a client calculation', async () => {
    setup(OPENING_SCHEMA, { [`GET ${P}/records`]: recordsHandler([draft]) });
    renderApp(open);
    await screen.findByText(draft.code);
    await userEvent.setup().click(screen.getByRole('button', { name: `Edit ${draft.code}` }));
    expect(within(screen.getByRole('dialog')).getByLabelText('Opening Value')).toHaveValue(
      '₹ 5,000',
    );
  });

  it('PERIOD_CLOSED from the server is shown in the form', async () => {
    setup(OPENING_SCHEMA, {
      [`GET ${P}/records`]: recordsHandler([draft]),
      [`PATCH ${P}/records/${draft.id}`]: () =>
        apiError(409, 'PERIOD_CLOSED', 'FY 2025-26 is closed for posting.'),
    });
    renderApp(open);
    await screen.findByText(draft.code);
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: `Edit ${draft.code}` }));
    const d = within(screen.getByRole('dialog'));
    await ue.clear(d.getByLabelText('Opening Qty'));
    await ue.type(d.getByLabelText('Opening Qty'), '7');
    await ue.click(d.getByRole('button', { name: 'Save Record' }));
    expect(await d.findByText('FY 2025-26 is closed for posting.')).toBeInTheDocument();
  });

  it('IN_USE on delete is shown from the server', async () => {
    setup(OPENING_SCHEMA, {
      [`GET ${P}/records`]: recordsHandler([draft]),
      [`DELETE ${P}/records/${draft.id}`]: () =>
        apiError(409, 'IN_USE', 'This record has ledger entries and cannot be deleted.'),
    });
    renderApp(open);
    await screen.findByText(draft.code);
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: `Delete ${draft.code}` }));
    await ue.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText('This record has ledger entries and cannot be deleted.'),
    ).toBeInTheDocument();
  });

  it('Post confirm uses the server text; INSUFFICIENT_STOCK / success flows', async () => {
    let n = 0;
    const { calls } = setup(OPENING_SCHEMA, {
      [`GET ${P}/records`]: recordsHandler([draft]),
      [`POST ${P}/records/${draft.id}/actions/post`]: () =>
        ++n === 1
          ? apiError(409, 'PERIOD_CLOSED', 'FY is closed.')
          : json(200, { data: { ...draft, status: 'Posted', version: 2 } }),
    });
    renderApp(open);
    await screen.findByText(draft.code);
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: `Post ${draft.code}` }));
    const dlg = within(screen.getByRole('dialog', { name: `Post ${draft.code}` }));
    expect(
      dlg.getByText(`Post ${draft.code}? Stock will change and the voucher will be locked.`),
    ).toBeInTheDocument();
    await ue.click(dlg.getByRole('button', { name: 'Post' }));
    expect(await dlg.findByText('FY is closed.')).toBeInTheDocument();
    await ue.click(dlg.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText(`Post: ${draft.code} done.`)).toBeInTheDocument();
    const keys = calls
      .filter((c) => c.path.endsWith('/actions/post'))
      .map((c) => c.headers['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    // The retry in the same dialog replays the same key.
    expect(keys[0]).toBe(keys[1]);
  });
});

describe('Stock Transfer', () => {
  const P = '/api/v1/pages/inv-transfer';
  const open = '/m/inv-transfer?tab=Transfer%20Register';
  const draft = transferRow(1, 'Draft');
  const sent = transferRow(2, 'Dispatched');
  const got = transferRow(3, 'Received');
  const rows = [draft, sent, got];

  it('shows Dispatch on Draft, Receive on Dispatched, and nothing editable once Received', async () => {
    setup(TRANSFER_SCHEMA, { [`GET ${P}/records`]: recordsHandler(rows) });
    renderApp(open);
    await screen.findByText(draft.code);
    const d = within(rowOf(draft.code));
    expect(d.getByRole('button', { name: `Dispatch ${draft.code}` })).toHaveTextContent('Dispatch');
    expect(d.getByRole('button', { name: `Cancel ${draft.code}` })).toBeInTheDocument();
    expect(d.queryByRole('button', { name: `Receive ${draft.code}` })).toBeNull();
    expect(d.getByRole('button', { name: `Edit ${draft.code}` })).toBeInTheDocument();
    const s = within(rowOf(sent.code));
    expect(s.getByText('Dispatched')).toHaveClass('status', 'dispatched');
    expect(s.getByRole('button', { name: `Receive ${sent.code}` })).toBeInTheDocument();
    expect(s.queryByRole('button', { name: `Edit ${sent.code}` })).toBeNull();
    const g = within(rowOf(got.code));
    expect(g.getByText('Received')).toHaveClass('status', 'received');
    expect(g.queryByRole('button', { name: /^(Edit|Delete|Dispatch|Receive|Cancel) / })).toBeNull();
    expect(g.getByText('SAW-MAIN — Sawardari Main Store')).toBeInTheDocument();
  });

  it('Dispatch: confirm text from the server, 409 INSUFFICIENT_STOCK shown, then success', async () => {
    let n = 0;
    const { calls } = setup(TRANSFER_SCHEMA, {
      [`GET ${P}/records`]: recordsHandler(rows),
      [`POST ${P}/records/${draft.id}/actions/dispatch`]: () =>
        ++n === 1
          ? apiError(409, 'INSUFFICIENT_STOCK', 'Only 12 Kg available in TAL-MAIN.')
          : json(200, { data: { ...draft, status: 'Dispatched' } }),
    });
    renderApp(open);
    await screen.findByText(draft.code);
    const ue = userEvent.setup();
    await ue.click(
      within(rowOf(draft.code)).getByRole('button', { name: `Dispatch ${draft.code}` }),
    );
    const dlg = within(screen.getByRole('dialog', { name: `Dispatch ${draft.code}` }));
    expect(
      dlg.getByText(`Dispatch ${draft.code}? Stock leaves the source warehouse.`),
    ).toBeInTheDocument();
    await ue.click(dlg.getByRole('button', { name: 'Dispatch' }));
    expect(await dlg.findByText('Only 12 Kg available in TAL-MAIN.')).toBeInTheDocument();
    await ue.click(dlg.getByRole('button', { name: 'Dispatch' }));
    expect(await screen.findByText(`Dispatch: ${draft.code} done.`)).toBeInTheDocument();
    expect(
      calls.find((c) => c.path.endsWith('/actions/dispatch'))?.headers['Idempotency-Key'],
    ).toMatch(/.{8,}/);
  });

  it('Receive and Cancel run from the record bar and the drawer', async () => {
    const { calls } = setup(TRANSFER_SCHEMA, {
      [`GET ${P}/records`]: recordsHandler([sent]),
      [`POST ${P}/records/${sent.id}/actions/receive`]: () =>
        json(200, { data: { ...sent, status: 'Received' } }),
      [`POST ${P}/records/${sent.id}/actions/cancel`]: () =>
        json(200, { data: { ...sent, status: 'Cancelled' } }),
    });
    renderApp(open);
    await screen.findByText(sent.code);
    const ue = userEvent.setup();
    const bar = within(await screen.findByLabelText('Record actions'));
    await ue.click(bar.getByRole('button', { name: /Receive/ }));
    await ue.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Receive' }));
    await waitFor(() => expect(countCalls(calls, 'POST', '/actions/receive')).toBe(1));

    await ue.click(screen.getByRole('button', { name: `View ${sent.code}` }));
    const drawer = within(screen.getByRole('dialog', { name: 'Stock Transfer Details' }));
    await ue.click(drawer.getByRole('button', { name: `Cancel ${sent.code}` }));
    const dlg = within(screen.getByRole('dialog', { name: `Cancel ${sent.code}` }));
    expect(dlg.getByText(`Cancel ${sent.code}?`)).toBeInTheDocument();
    await ue.click(dlg.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(countCalls(calls, 'POST', '/actions/cancel')).toBe(1));
  });

  it('source warehouse lookups use the context unit; destination lookups any unit; preview fills Available', async () => {
    const { calls } = setup(TRANSFER_SCHEMA, {
      [`GET ${P}/records`]: recordsHandler([draft]),
      [`GET ${P}/preview`]: () => json(200, { data: { available: 60, avgRate: 52.5 } }),
    });
    renderApp(open);
    await screen.findByText(draft.code);
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Stock Transfer' }));
    const asked = (q: string): Call | undefined =>
      calls.find((c) => c.path.endsWith('/lookups/warehouses') && c.url.includes(`q=${q}`));
    await ue.type(d.getByRole('combobox', { name: 'Source Warehouse' }), 'src');
    await waitFor(() => expect(asked('src')).toBeDefined());
    await ue.click(await d.findByRole('option', { name: /TAL-MAIN/ }));
    await ue.type(d.getByRole('combobox', { name: 'Destination Warehouse' }), 'dst');
    await waitFor(() => expect(asked('dst')).toBeDefined());
    expect(params(asked('src')).get('unitId')).toBe('unit-tal');
    expect(params(asked('dst')).has('unitId')).toBe(false);
    await ue.click(await d.findByRole('option', { name: /TAL-MAIN/ }));
    await ue.type(d.getByRole('combobox', { name: 'Item' }), 'steel');
    await ue.click(await d.findByRole('option', { name: /Steel Rod/ }));
    await waitFor(() => expect(d.getByLabelText('Available')).toHaveValue('60'));
    await waitFor(() => {
      const pv = calls.filter((c) => c.path.endsWith('/preview')).at(-1);
      expect(params(pv).get('itemId')).toBe('item-1');
      expect(params(pv).get('warehouseId')).toBe('wh-1');
    });
  });
});

describe('Stock Adjustment computed fields', () => {
  const P = '/api/v1/pages/inv-adjustment';
  const schema: PageSchema = {
    ...ADJUST_SCHEMA,
    fields: [
      ...ADJUST_SCHEMA.fields.filter((f) => f.key !== 'status'),
      { key: 'variance', label: 'Variance Qty', type: 'qty', required: false, readOnly: true },
      { key: 'impact', label: 'Value Impact', type: 'money', required: false, readOnly: true },
      { key: 'status', label: 'Status', type: 'status', required: false, readOnly: true },
    ],
  };

  it('Variance Qty and Value Impact follow Counted Qty and the previewed system qty / rate', async () => {
    setup(schema, {
      [`GET ${P}/records`]: recordsHandler([adjustRow(1, 'Draft')]),
      [`GET ${P}/preview`]: () => json(200, { data: { systemQty: 60, avgRate: 52.5 } }),
    });
    renderApp('/m/inv-adjustment?tab=Adjustment%20Register');
    await screen.findByText('ADJ/TAL/26-27/0001');
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Stock Adjustment' }));
    await ue.type(d.getByRole('combobox', { name: 'Warehouse' }), 'tal');
    await ue.click(await d.findByRole('option', { name: /TAL-MAIN/ }));
    await ue.type(d.getByRole('combobox', { name: 'Item' }), 'steel');
    await ue.click(await d.findByRole('option', { name: /Steel Rod/ }));
    await waitFor(() => expect(d.getByLabelText('System Qty')).toHaveValue('60'));
    await ue.type(d.getByLabelText('Counted Qty'), '45');
    expect(d.getByLabelText('Variance Qty')).toHaveValue('-15');
    expect(d.getByLabelText('Value Impact')).toHaveValue('₹ -787.5');
    await ue.clear(d.getByLabelText('Counted Qty'));
    await ue.type(d.getByLabelText('Counted Qty'), '70');
    expect(d.getByLabelText('Variance Qty')).toHaveValue('10');
    expect(d.getByLabelText('Value Impact')).toHaveValue('₹ 525');
  });
});
