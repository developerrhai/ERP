import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Grid, KpiCard, Rag } from '../../lib/dashApi';

const plantFn = vi.fn();
const ownerFn = vi.fn();
const myFn = vi.fn();
const excFn = vi.fn();
const clFn = vi.fn();
const tvFn = vi.fn();

vi.mock('../../lib/dashApi', async (orig) => {
  const real = await orig<typeof import('../../lib/dashApi')>();
  return {
    ...real,
    dashApi: {
      ...real.dashApi,
      plant: () => plantFn() as Promise<unknown>,
      owner: () => ownerFn() as Promise<unknown>,
      my: () => myFn() as Promise<unknown>,
      tvToken: (...a: unknown[]) => tvFn(...a) as Promise<unknown>,
    },
  };
});
vi.mock('../../lib/spineApi', async (orig) => {
  const real = await orig<typeof import('../../lib/spineApi')>();
  return { ...real, spineApi: { ...real.spineApi, exceptions: () => excFn() as Promise<unknown> } };
});
vi.mock('../../lib/clApi', async (orig) => {
  const real = await orig<typeof import('../../lib/clApi')>();
  return { ...real, clApi: { ...real.clApi, command: () => clFn() as Promise<unknown> } };
});

import { MyDashboardPage, OwnerConsolePage, PlantDashboardPage } from './DashboardPages';
import { ClCommandPage } from '../contractlabour/ClCommandCenter';

const card = (code: string, unitId: string, value: number | null, rag: Rag, target: number | null = null): KpiCard => ({
  code,
  name: code,
  department: 'x',
  format: 'num',
  unitLabel: '',
  value,
  target,
  pct: null,
  rag,
  direction: 'HIGHER_GOOD',
  formulaText: '',
  sourceText: null,
  rowCount: 1,
  noData: value === null,
  drill: { page: 'sales-orders', filters: {} },
  refreshedAt: '2026-11-15T00:00:00Z',
  unitId,
});

const grid = (): Grid => ({
  plants: [
    { id: 'u1', code: 'TAL', name: 'Talwade' },
    { id: 'u2', code: 'SAW', name: 'Sawardari' },
  ],
  rows: [
    {
      code: 'SALES_MTD',
      name: 'Sales Orders MTD',
      department: 'Sales',
      format: 'num',
      direction: 'HIGHER_GOOD',
      cells: [card('SALES_MTD', 'u1', 5, 'GREEN', 4), card('SALES_MTD', 'u2', 2, 'RED', 4)],
      total: 7,
      totalNote: null,
    },
    {
      code: 'PO_OPEN',
      name: 'Open PO Value',
      department: 'Purchase',
      format: 'num',
      direction: 'LOWER_GOOD',
      cells: [card('PO_OPEN', 'u1', null, 'NONE'), card('PO_OPEN', 'u2', 9, 'AMBER', 10)],
      total: 9,
      totalNote: null,
    },
  ],
});

const wrap = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

beforeEach(() => {
  for (const f of [plantFn, ownerFn, myFn, excFn, clFn, tvFn]) f.mockReset();
  excFn.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }]);
});

describe('Plant Dashboard', () => {
  it('shows department cards, a RAG roll-up, the V40 buttons and switches plant', async () => {
    plantFn.mockResolvedValue({ key: 'plant', title: 'Plant Dashboard', override: null, ...grid() });
    wrap(<PlantDashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Plant Dashboard' })).toBeTruthy();
    const sales = screen.getByRole('region', { name: 'Sales Dashboard' });
    expect(within(sales).getByText('7')).toBeTruthy(); // total of both plants
    expect(within(sales).getByRole('link', { name: 'Open Module' }).getAttribute('href')).toBe('/m/sales-orders');
    expect(screen.getByRole('region', { name: 'Purchase Dashboard' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open 360° Order Tracking' }).getAttribute('href')).toBe('/m/ops-order-360');
    expect(await screen.findByRole('link', { name: 'Exceptions (3)' })).toBeTruthy();
    const roll = screen.getByLabelText('KPI status');
    expect(within(roll).getByText('On target').nextSibling?.textContent).toBe('1');
    expect(within(roll).getByText('Off target').nextSibling?.textContent).toBe('1');
    // pick one plant: its own value, target and RAG
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sawardari' }));
    expect(within(sales).getByText('2')).toBeTruthy();
    expect(within(sales).getByText('/ 4')).toBeTruthy();
    expect(within(sales).getByRole('img', { name: 'Off target' })).toBeTruthy();
  });

  it('shows an empty state, not numbers, when there are no KPIs; TV link is created on demand', async () => {
    plantFn.mockResolvedValue({ key: 'plant', title: 'Plant Dashboard', override: null, plants: [{ id: 'u1', code: 'TAL', name: 'Talwade' }], rows: [] });
    tvFn.mockResolvedValue({ token: 'tok123', expiresAt: '2026-12-15' });
    wrap(<PlantDashboardPage />);
    expect(await screen.findByText('No KPIs to show yet.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create TV link' }));
    const input = (await screen.findByLabelText('TV link')) as HTMLInputElement;
    expect(input.value).toContain('/tv/plant?token=tok123');
    expect(tvFn).toHaveBeenCalledWith('plant', 'u1');
  });

  it('hides the exceptions count when the exceptions page is not allowed', async () => {
    excFn.mockResolvedValue(null);
    plantFn.mockResolvedValue({ key: 'plant', title: 'Plant Dashboard', override: null, ...grid() });
    wrap(<PlantDashboardPage />);
    expect(await screen.findByRole('link', { name: 'Exceptions' })).toBeTruthy();
  });
});

describe('Owner Console', () => {
  it('shows department cards, approvals by age and statutory rows', async () => {
    ownerFn.mockResolvedValue({
      key: 'owner',
      title: 'Owner Console',
      ...grid(),
      approvalsByAge: [
        { label: 'Under 1 day', count: 2 },
        { label: 'Over 7 days', count: 1 },
      ],
      needsReview: { gstRates: 4, hsnCodes: 0 },
    });
    wrap(<OwnerConsolePage />);
    expect(await screen.findByRole('heading', { name: 'Owner Console' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Sales' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Pending approvals by age' })).toBeTruthy();
    const st = screen.getByRole('region', { name: 'Statutory rows to review' });
    expect(within(st).getByRole('link', { name: '4' }).getAttribute('href')).toBe('/m/tax-gst');
  });
});

describe('My Dashboard', () => {
  it('shows my queues and an empty documents state', async () => {
    myFn.mockResolvedValue({
      key: 'my',
      title: 'My Dashboard',
      department: 'Finance',
      scopeNote: 'Your approvals are your own.',
      queues: { approvalsWaiting: 3, approvalsOverdue: 1, submittedPending: 0 },
      myDocumentsByStatus: [],
      cards: [],
      override: null,
    });
    wrap(<MyDashboardPage />);
    expect(await screen.findByRole('heading', { name: 'My Dashboard' })).toBeTruthy();
    expect(screen.getByText('Approvals waiting for me').nextSibling?.textContent).toBe('3');
    expect(screen.getByText('No documents of yours in the chosen plants yet.')).toBeTruthy();
    expect(screen.getByText('No KPIs are defined for Finance yet.')).toBeTruthy();
  });
});

describe('Contract Labour Command Center', () => {
  it('shows lifecycle, headcount per plant, control alerts with Open buttons and the three cards', async () => {
    clFn.mockResolvedValue({
      tiles: { workersOnSite: 5, billsBlocked: 1 },
      alerts: { highRiskCompliance: 2, onboardingBlocked: 7, invoiceOutstanding: 1818800 },
      headcount: [
        { unit_code: 'TAL', contractor: 'A', headcount: 3 },
        { unit_code: 'TAL', contractor: 'B', headcount: 1 },
        { unit_code: 'SAW', contractor: 'A', headcount: 1 },
      ],
      expiries: [{ name: 'A', what: 'Licence', on_date: '2026-11-20' }],
      blockers: [],
    });
    wrap(<ClCommandPage />);
    expect(await screen.findByRole('heading', { name: 'Contract Labour Command Center' })).toBeTruthy();
    for (const l of ['Compliance', 'Wage Run', '＋ Add Worker']) expect(screen.getByRole('link', { name: l })).toBeTruthy();
    expect(screen.getByText('Plant Deployment')).toBeTruthy();
    const heads = screen.getByRole('region', { name: 'Plant / Unit Headcount' });
    expect(within(heads).getByText('TAL').parentElement?.textContent).toContain('4');
    const al = screen.getByRole('region', { name: 'Control Alerts' });
    expect(within(al).getByText(/2 high-risk compliance record/)).toBeTruthy();
    expect(within(al).getByText(/₹ 18,18,800/)).toBeTruthy();
    expect(within(al).getAllByRole('link', { name: 'Open' })).toHaveLength(4);
    for (const l of ['Worker Master', 'Billing Control', 'Compliance Score']) expect(screen.getByRole('link', { name: l })).toBeTruthy();
    expect(screen.getByText('No bill is blocked.')).toBeTruthy();
  });

  it('shows empty states when nothing is deployed', async () => {
    clFn.mockResolvedValue({ tiles: {}, headcount: [], expiries: [], blockers: [] });
    wrap(<ClCommandPage />);
    expect((await screen.findAllByText('Nobody deployed.')).length).toBeGreaterThan(0);
    expect(screen.getByText('Nothing expires soon.')).toBeTruthy();
  });
});
