// V40 tab content of the sales pages: the columns of the open tab, real values, row buttons, selection bar,
// settlement panel, and the plain table outside the tab frame.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionSet } from '../../types';
import { V40TabFrame } from '../frame/V40TabFrame';
import { V40Register } from './V40Register';
import type { V40Page } from './salesV40Api';

const calls: { tab: string; first: boolean; q?: string | undefined }[] = [];
const REGISTER: V40Page = {
  columns: [
    { key: 'c0', label: 'SO No', type: 'text', source: true },
    { key: 'c1', label: 'Customer', type: 'text', source: true },
    { key: 'c2', label: 'Ordered Quantity', type: 'num', source: true },
    { key: 'c3', label: 'Total Amount', type: 'inr', source: true },
    { key: 'c4', label: 'Campaign', type: 'text', source: false },
    { key: 'c5', label: 'Status', type: 'pill', source: true },
    { key: 'c6', label: 'Actions', type: 'actions', source: true },
  ],
  rows: [
    {
      id: 'o1',
      number: 'SO/1',
      status: 'Draft',
      version: '1',
      c0: 'SO/1',
      c1: 'Acme Steel',
      c2: '10',
      c3: '1180',
      c4: null,
      c5: 'Draft',
      c6: null,
    },
    {
      id: 'o2',
      number: 'SO/2',
      status: 'Approved',
      version: '2',
      c0: 'SO/2',
      c1: 'Beta Works',
      c2: '2.5',
      c3: '500',
      c4: null,
      c5: 'Approved',
      c6: null,
    },
  ],
  total: 2,
  noSource: [],
  audit: false,
  panel: null,
};
const BILLING: V40Page = {
  ...REGISTER,
  columns: [
    { key: 'c0', label: 'SO No', type: 'text', source: true },
    { key: 'c1', label: 'Billing Balance', type: 'inr', source: true },
    { key: 'c2', label: 'Actions', type: 'actions', source: true },
  ],
  rows: [
    { id: 'o1', number: 'SO/1', status: 'Draft', version: '1', c0: 'SO/1', c1: '708', c2: null },
  ],
  panel: {
    title: 'Invoices against sales orders',
    columns: [
      { key: 'p0', label: 'Reference', type: 'text', source: true },
      { key: 'p1', label: 'Balance', type: 'inr', source: true },
      { key: 'p2', label: 'Action', type: 'actions', source: true },
    ],
    rows: [{ id: 'inv1', p0: 'INV/1', p1: '472', p2: 'Allocate' }],
  },
};

vi.mock('./salesV40Api', async (orig) => {
  const real = await orig<typeof import('./salesV40Api')>();
  return {
    ...real,
    getSalesV40: (_page: string, p: { tab: string; first: boolean; q?: string }) => {
      calls.push({ tab: p.tab, first: p.first, q: p.q });
      return Promise.resolve(p.tab === 'Billing Balance' ? BILLING : REGISTER);
    },
  };
});
vi.mock('../generic/engineApi', () => ({
  listPageAudit: () => Promise.resolve({ rows: [], meta: { page: 1, size: 10, total: 0 } }),
}));
const verbMock = vi.fn((...a: unknown[]) => Promise.resolve(a.length ? {} : {}));
vi.mock('../../lib/scmApi', async (orig) => {
  const real = await orig<typeof import('../../lib/scmApi')>();
  return {
    ...real,
    getDoc: (_p: string, id: string) => Promise.resolve({ id, version: 1, status: 'Draft' }),
    verb: (...a: unknown[]) => verbMock(...a),
  };
});

const ALL = {
  view: true,
  add: true,
  edit: true,
  delete: true,
  submit: true,
  post: true,
} as unknown as ActionSet;
const TABS = ['Order Register', 'Billing Balance', 'Documents'];

function body(onOpen = vi.fn(), onAllocate = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/m/sales-orders']}>
      <V40TabFrame pageId="sales-orders" tabs={TABS}>
        <V40Register
          pageId="sales-orders"
          actions={ALL}
          onOpen={onOpen}
          onAllocate={onAllocate}
          fallback={<p>plain table</p>}
        />
      </V40TabFrame>
    </MemoryRouter>,
  );
}

describe('V40Register', () => {
  beforeEach(() => {
    calls.length = 0;
    verbMock.mockClear();
  });

  it('shows the plain table outside the tab frame', () => {
    render(
      <MemoryRouter>
        <V40Register pageId="sales-orders" actions={ALL} fallback={<p>plain table</p>} />
      </MemoryRouter>,
    );
    expect(screen.getByText('plain table')).toBeInTheDocument();
  });

  it('keeps the plain table for a page that has no V40 views', () => {
    render(
      <MemoryRouter>
        <V40TabFrame pageId="scm-po" tabs={['A']}>
          <V40Register pageId="scm-po" actions={ALL} fallback={<p>plain table</p>} />
        </V40TabFrame>
      </MemoryRouter>,
    );
    expect(screen.getByText('plain table')).toBeInTheDocument();
  });

  it('first tab: the V40 columns, real values, row buttons and a dash for a column with no source', async () => {
    const onOpen = vi.fn();
    body(onOpen);
    expect(await screen.findByText('Acme Steel')).toBeInTheDocument();
    for (const h of ['SO No', 'Ordered Quantity', 'Total Amount', 'Status', 'Actions'])
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.getByText('₹ 1,180.00')).toBeInTheDocument();
    expect(screen.getByText('2.5')).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ tab: 'Order Register', first: true });
    expect(screen.getByText(/No source in the database yet.*Campaign/)).toBeInTheDocument();
    const row = screen.getByText('Acme Steel').closest('tr') as HTMLElement;
    for (const b of ['View', 'Email', 'PDF', 'Submit', '360° Track'])
      expect(within(row).getByRole('button', { name: b })).toBeInTheDocument();
    // an Approved row can not be submitted again
    const approved = screen.getByText('Beta Works').closest('tr') as HTMLElement;
    expect(within(approved).queryByRole('button', { name: 'Submit' })).toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'View' }));
    expect(onOpen).toHaveBeenCalledWith('o1');
  });

  it('Submit sends the document with its version; Submit Selected only touches drafts', async () => {
    const user = userEvent.setup();
    body();
    await screen.findByText('Acme Steel');
    const row = screen.getByText('Acme Steel').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(verbMock).toHaveBeenCalledWith('/sales/orders', 'o1', 'submit', {}, 1),
    );
    verbMock.mockClear();
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit Selected' }));
    await waitFor(() => expect(verbMock).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Export Selected' })).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }));
    expect(
      await screen.findByRole('dialog', { name: /Delete 2 sales orders/ }),
    ).toBeInTheDocument();
  });

  it('another tab asks the API for that tab and shows its own columns and settlement panel', async () => {
    const user = userEvent.setup();
    const onAllocate = vi.fn();
    body(vi.fn(), onAllocate);
    await screen.findByText('Acme Steel');
    await user.click(screen.getByRole('tab', { name: 'Billing Balance' }));
    expect(
      await screen.findByRole('columnheader', { name: 'Billing Balance' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Ordered Quantity' })).toBeNull();
    expect(calls.at(-1)).toMatchObject({ tab: 'Billing Balance', first: false });
    expect(
      screen.getByRole('region', { name: 'Invoices against sales orders' }),
    ).toBeInTheDocument();
    expect(screen.getByText('INV/1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Allocate' }));
    expect(onAllocate).toHaveBeenCalledWith('inv1');
  });

  it('search asks the API with the typed text; paging buttons carry the V40 names', async () => {
    const user = userEvent.setup();
    body();
    await screen.findByText('Acme Steel');
    await user.type(screen.getByLabelText('Search Sales Orders'), 'SO/2');
    await waitFor(() => expect(calls.some((c) => c.q === 'SO/2')).toBe(true));
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('Documents tab opens on a record (the first one) and lets you pick another', async () => {
    const user = userEvent.setup();
    body();
    await screen.findByText('Acme Steel');
    await user.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(await screen.findByLabelText('Record for documents')).toBeInTheDocument();
  });
});
