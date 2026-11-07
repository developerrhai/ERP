// Typed-page tests (Stage C web): schema.actions as buttons in the record bar, drawer and rows with
// confirm modals and Idempotency-Key, locked (Posted) records, lookup comboboxes for items and
// warehouses, and server-computed read-only fields from the preview endpoint.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ADJUST_SCHEMA,
  adjustRow,
  ITEM_REF,
  recordsHandler,
  WH_REF,
} from '../../test/engine-fixtures';
import {
  apiError,
  countCalls,
  json,
  makeUser,
  renderApp,
  signedIn,
  type Handler,
} from '../../test/helpers';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const P = '/api/v1/pages/inv-adjustment';
const REGISTER = '/m/inv-adjustment?tab=Adjustment%20Register';
const DRAFT = adjustRow(1, 'Draft');
const POSTED = adjustRow(2, 'Posted');

function setup(extra: Record<string, Handler> = {}) {
  return signedIn(owner, {
    [`GET ${P}/schema`]: () => json(200, { data: ADJUST_SCHEMA }),
    [`GET ${P}/records`]: recordsHandler([DRAFT, POSTED]),
    ...extra,
  });
}

const rowOf = (code: string): HTMLElement =>
  screen.getByText(code, { selector: 'td' }).closest('tr') as HTMLElement;

// Phase 8: /m/inv-adjustment is now the header+lines voucher screen (covered by pages/inventory/Inventory.test.tsx), so these
// suites that drove the old one-item adjustment page are skipped, not deleted.
describe.skip('typed page actions', () => {
  it('shows only the actions a status allows and locks Posted records', async () => {
    setup();
    renderApp(REGISTER);
    await screen.findByText(DRAFT.code);
    const draft = within(rowOf(DRAFT.code));
    expect(draft.getByRole('button', { name: `Post ${DRAFT.code}` })).toBeInTheDocument();
    expect(draft.queryByRole('button', { name: `Cancel voucher ${DRAFT.code}` })).toBeNull();
    expect(draft.getByRole('button', { name: `Edit ${DRAFT.code}` })).toBeInTheDocument();
    expect(draft.getByRole('button', { name: `Delete ${DRAFT.code}` })).toBeInTheDocument();
    const posted = within(rowOf(POSTED.code));
    expect(posted.getByText('Posted')).toHaveClass('status', 'posted');
    expect(
      posted.getByRole('button', { name: `Cancel voucher ${POSTED.code}` }),
    ).toBeInTheDocument();
    expect(posted.queryByRole('button', { name: `Post ${POSTED.code}` })).toBeNull();
    expect(posted.queryByRole('button', { name: `Edit ${POSTED.code}` })).toBeNull();
    expect(posted.queryByRole('button', { name: `Delete ${POSTED.code}` })).toBeNull();
    expect(posted.getByRole('button', { name: `View ${POSTED.code}` })).toBeInTheDocument();
  });

  it('Post asks for confirmation with the server text, then POSTs with an Idempotency-Key', async () => {
    const { calls } = setup({
      [`POST ${P}/records/${DRAFT.id}/actions/post`]: () =>
        json(200, { data: { ...DRAFT, status: 'Posted', version: 2 } }),
    });
    renderApp(REGISTER);
    await screen.findByText(DRAFT.code);
    const ue = userEvent.setup();
    await ue.click(within(rowOf(DRAFT.code)).getByRole('button', { name: `Post ${DRAFT.code}` }));
    const dlg = within(screen.getByRole('dialog', { name: `Post ${DRAFT.code}` }));
    expect(
      dlg.getByText(`Post ${DRAFT.code}? Stock will change and the voucher will be locked.`),
    ).toBeInTheDocument();
    await ue.click(dlg.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText(`Post: ${DRAFT.code} done.`)).toBeInTheDocument();
    const post = calls.find((c) => c.path.endsWith('/actions/post'));
    expect(post?.method).toBe('POST');
    expect(post?.headers['Idempotency-Key']).toMatch(/.{8,}/);
    expect(countCalls(calls, 'POST', '/actions/post')).toBe(1);
  });

  it('a refused action shows the server error inside the modal and keeps it open', async () => {
    setup({
      [`POST ${P}/records/${POSTED.id}/actions/cancel`]: () =>
        apiError(409, 'INSUFFICIENT_STOCK', 'Cancelling would make stock negative.'),
    });
    renderApp(REGISTER);
    await screen.findByText(POSTED.code);
    const ue = userEvent.setup();
    await ue.click(
      within(rowOf(POSTED.code)).getByRole('button', { name: `Cancel voucher ${POSTED.code}` }),
    );
    const dlg = within(screen.getByRole('dialog'));
    expect(dlg.getByText(`Cancel voucher ${POSTED.code}?`)).toBeInTheDocument();
    await ue.click(dlg.getByRole('button', { name: 'Cancel voucher' }));
    expect(await dlg.findByText('Cancelling would make stock negative.')).toBeInTheDocument();
  });

  it('the record bar and the View drawer offer the same actions', async () => {
    const { calls } = setup({
      [`POST ${P}/records/${DRAFT.id}/actions/post`]: () =>
        json(200, { data: { ...DRAFT, status: 'Posted', version: 2 } }),
    });
    renderApp(REGISTER);
    await screen.findByText(DRAFT.code);
    const ue = userEvent.setup();
    const bar = within(await screen.findByLabelText('Record actions'));
    expect(bar.getByRole('combobox', { name: 'Record' })).toHaveValue(DRAFT.id);
    expect(bar.getByRole('button', { name: 'Post' })).toBeInTheDocument();
    await ue.selectOptions(bar.getByRole('combobox', { name: 'Record' }), POSTED.id);
    expect(bar.queryByRole('button', { name: 'Post' })).toBeNull();
    expect(bar.getByRole('button', { name: 'Cancel voucher' })).toBeInTheDocument();

    await ue.click(screen.getByRole('button', { name: `View ${DRAFT.code}` }));
    const drawer = within(screen.getByRole('dialog', { name: 'Stock Adjustment Details' }));
    expect(drawer.getByText('Warehouse')).toBeInTheDocument();
    expect(drawer.getByText('TAL-MAIN — Talwade Main Store')).toBeInTheDocument();
    await ue.click(drawer.getByRole('button', { name: `Post ${DRAFT.code}` }));
    await ue.click(
      within(screen.getByRole('dialog', { name: `Post ${DRAFT.code}` })).getByRole('button', {
        name: 'Post',
      }),
    );
    await waitFor(() => expect(countCalls(calls, 'POST', '/actions/post')).toBe(1));
  });

  it('an action without a confirm text runs straight away', async () => {
    const schema = {
      ...ADJUST_SCHEMA,
      actions: [{ key: 'post', label: 'Post', variant: 'primary', allowedFrom: ['Draft'] }],
    };
    const { calls } = setup({
      [`GET ${P}/schema`]: () => json(200, { data: schema }),
      [`POST ${P}/records/${DRAFT.id}/actions/post`]: () =>
        json(200, { data: { ...DRAFT, status: 'Posted' } }),
    });
    renderApp(REGISTER);
    await screen.findByText(DRAFT.code);
    await userEvent
      .setup()
      .click(within(rowOf(DRAFT.code)).getByRole('button', { name: `Post ${DRAFT.code}` }));
    await waitFor(() => expect(countCalls(calls, 'POST', '/actions/post')).toBe(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe.skip('typed page form', () => {
  it('searches items and warehouses with lookups, fills read-only fields from preview and saves ids', async () => {
    const { calls } = setup({
      'GET /api/v1/lookups/items': () => json(200, { data: [ITEM_REF] }),
      'GET /api/v1/lookups/warehouses': () => json(200, { data: [WH_REF] }),
      [`GET ${P}/preview`]: () => json(200, { data: { systemQty: 60, avgRate: 52.5 } }),
      [`POST ${P}/records`]: () => json(201, { data: DRAFT }),
    });
    renderApp(REGISTER);
    await screen.findByText(DRAFT.code);
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Stock Adjustment' }));
    expect(d.getByLabelText('System Qty')).toHaveValue('Computed by the server');

    const asked = (kind: string, q: string): boolean =>
      calls.some((c) => c.path.endsWith(`/lookups/${kind}`) && c.url.includes(`q=${q}`));
    await ue.type(d.getByRole('combobox', { name: 'Warehouse' }), 'tal');
    await waitFor(() => expect(asked('warehouses', 'tal')).toBe(true));
    await ue.click(await d.findByRole('option', { name: /TAL-MAIN — Talwade Main Store/ }));
    await ue.type(d.getByRole('combobox', { name: 'Item' }), 'steel');
    await waitFor(() => expect(asked('items', 'steel')).toBe(true));
    await ue.click(await d.findByRole('option', { name: /ITM\/00001 — Steel Rod/ }));

    await waitFor(() => expect(d.getByLabelText('System Qty')).toHaveValue('60'));
    expect(d.getByLabelText('Unit Cost')).toHaveValue('₹ 52.5');
    const wh = calls
      .filter((c) => c.path.endsWith('/lookups/warehouses'))
      .find((c) => c.url.includes('q=tal'));
    expect(new URL(wh?.url ?? '', 'http://test').searchParams.get('q')).toBe('tal');
    expect(new URL(wh?.url ?? '', 'http://test').searchParams.get('unitId')).toBe('unit-tal');
    const item = calls
      .filter((c) => c.path.endsWith('/lookups/items'))
      .find((c) => c.url.includes('q=steel'));
    expect(new URL(item?.url ?? '', 'http://test').searchParams.get('q')).toBe('steel');
    await waitFor(() => {
      const pv = calls.filter((c) => c.path.endsWith('/preview')).at(-1);
      const pq = new URL(pv?.url ?? '', 'http://test').searchParams;
      expect(pq.get('itemId')).toBe('item-1');
      expect(pq.get('warehouseId')).toBe('wh-1');
    });
    await ue.type(d.getByLabelText('Counted Qty'), '45');
    await ue.click(d.getByRole('button', { name: 'Save Record' }));
    await waitFor(() => expect(countCalls(calls, 'POST', `${P}/records`)).toBe(1));
    expect(calls.find((c) => c.method === 'POST' && c.path === `${P}/records`)?.body).toEqual({
      data: { warehouse: 'wh-1', item: 'item-1', countedQty: 45 },
    });
  });

  it('requires the lookup fields before saving', async () => {
    const { calls } = setup();
    renderApp(REGISTER);
    await screen.findByText(DRAFT.code);
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add' }));
    const d = within(screen.getByRole('dialog'));
    await ue.click(d.getByRole('button', { name: 'Save Record' }));
    expect(d.getByText('Warehouse is required.')).toBeInTheDocument();
    expect(d.getByText('Item is required.')).toBeInTheDocument();
    expect(d.getByText('Counted Qty is required.')).toBeInTheDocument();
    expect(countCalls(calls, 'POST', `${P}/records`)).toBe(0);
  });

  it('Edit shows the resolved item and warehouse names and server values', async () => {
    setup({ [`PATCH ${P}/records/${DRAFT.id}`]: () => json(200, { data: DRAFT }) });
    renderApp(REGISTER);
    await screen.findByText(DRAFT.code);
    await userEvent.setup().click(screen.getByRole('button', { name: `Edit ${DRAFT.code}` }));
    const d = within(screen.getByRole('dialog', { name: 'Edit Stock Adjustment' }));
    expect(d.getByRole('combobox', { name: 'Item' })).toHaveValue('ITM/00001 — Steel Rod');
    expect(d.getByRole('combobox', { name: 'Warehouse' })).toHaveValue(
      'TAL-MAIN — Talwade Main Store',
    );
    expect(d.getByLabelText('Counted Qty')).toHaveValue(45);
  });
});

describe.skip('list-only typed page', () => {
  it('a readOnly schema shows the table without Add, Edit, Delete or actions', async () => {
    setup({
      [`GET ${P}/schema`]: () =>
        json(200, { data: { ...ADJUST_SCHEMA, readOnly: true, actions: [] } }),
    });
    renderApp(REGISTER);
    await screen.findByText(DRAFT.code);
    expect(screen.queryByRole('button', { name: '＋ Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByLabelText('Record actions')).toBeNull();
  });
});
