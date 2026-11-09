// Phase 14 screens: the machine list and its health, acknowledging a breakdown once, the disposal GST note, and the empty states.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  countCalls,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
} from '../../test/helpers';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const ALL = permissionsRoute({
  view: true,
  add: true,
  edit: true,
  delete: true,
  approve: true,
  submit: true,
  post: true,
  cancel: true,
  print: true,
  controls: true,
});
const VIEW_ONLY = permissionsRoute({ view: true });
const page = (rows: unknown[]) =>
  json(200, { data: rows, meta: { page: 1, size: 100, total: rows.length } });

const machine = {
  id: 'a1',
  version: 3,
  assetNo: 'AST/TAL/26-27/0001',
  name: 'CNC Lathe',
  categoryName: 'Plant and machinery (general)',
  location: 'Shop 1',
  criticality: 'A',
  status: 'ACTIVE',
  health: 'GOOD',
  failures: 2,
  mtbfHours: '120.00',
  mttrHours: '3.50',
  availabilityPct: '97.20',
  lastService: null,
  nextService: '2026-12-01',
  warrantyEnd: null,
  meters: [],
  children: [],
  profiles: [],
};

describe('Machine Master', () => {
  it('lists machines and shows their reliability numbers', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/maint/machines': () => page([machine]),
      'GET /api/v1/assets/by-id/a1': () => json(200, { data: machine }),
    });
    renderApp('/m/maint-machines');
    const ue = userEvent.setup();
    expect(await screen.findByText('CNC Lathe')).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: 'Open' }));
    const panel = await screen.findByRole('dialog');
    expect(await within(panel).findByText('120.00 h')).toBeInTheDocument();
    expect(within(panel).getByText('3.50 h')).toBeInTheDocument();
    expect(within(panel).getByText('Good')).toBeInTheDocument();
  });
  it('says what to do when there are no machines, and hides + New without the add right', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': VIEW_ONLY,
      'GET /api/v1/maint/machines': () => page([]),
    });
    renderApp('/m/maint-machines');
    expect(await screen.findByText(/No assets yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New machine/ })).toBeNull();
  });
});

describe('Breakdown Log', () => {
  const ticket = {
    id: 'b1',
    version: 1,
    bdNo: 'BD/TAL/26-27/0001',
    assetName: 'CNC Lathe',
    assetNo: 'AST1',
    symptom: 'Spindle will not start',
    priority: 'P1',
    status: 'OPEN',
    reportedAt: '2026-11-09T04:00:00Z',
    mwoNo: null,
  };
  it('acknowledges a ticket once', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/maint/breakdowns': () => page([ticket]),
      'GET /api/v1/maint/breakdowns/b1': () => json(200, { data: ticket }),
      'GET /api/v1/maint/failure-codes': () => json(200, { data: [] }),
      'POST /api/v1/maint/breakdowns/b1/acknowledge': () =>
        json(200, { data: { ...ticket, status: 'ACK', mwoNo: 'MWO/1' } }),
    });
    renderApp('/m/maint-breakdown');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Open' }));
    const panel = await screen.findByRole('dialog');
    await ue.click(await within(panel).findByRole('button', { name: 'Acknowledge' }));
    await screen.findAllByText('Done');
    expect(countCalls(calls, 'POST', '/maint/breakdowns/b1/acknowledge')).toBe(1);
    expect(calls.find((c) => c.path.endsWith('/acknowledge'))?.headers['If-Match']).toBe('"1"');
  });
  it('shows no acknowledge button to a viewer', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': VIEW_ONLY,
      'GET /api/v1/maint/breakdowns': () => page([ticket]),
      'GET /api/v1/maint/breakdowns/b1': () => json(200, { data: ticket }),
      'GET /api/v1/maint/failure-codes': () => json(200, { data: [] }),
    });
    renderApp('/m/maint-breakdown');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Open' }));
    const panel = await screen.findByRole('dialog');
    await within(panel).findByText('Spindle will not start');
    expect(within(panel).queryByRole('button', { name: 'Acknowledge' })).toBeNull();
  });
});

describe('Asset Disposal', () => {
  it('explains the section 18(6) figure as a memo', async () => {
    const d = {
      id: 'd1',
      version: 1,
      dispNo: 'DSP1',
      assetName: 'Press',
      assetNo: 'AST2',
      method: 'SALE',
      status: 'DRAFT',
      approvalStatus: 'DRAFT',
      saleValue: '1000000',
      gstOnSale: '180000',
      nbvAtDisposal: null,
      gainLoss: null,
      s186Calc: '180000',
      s186PayableExtra: '0',
    };
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/assets/disposals': () => page([d]),
      'GET /api/v1/assets/disposals/d1': () => json(200, { data: d }),
      'GET /api/v1/assets/lookup': () => page([]),
      'GET /api/v1/assets/lookup-accounts': () => json(200, { data: [] }),
    });
    renderApp('/m/asset-disposal');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Open' }));
    const panel = await screen.findByRole('dialog');
    expect(await within(panel).findByText(/section 18\(6\)/)).toBeInTheDocument();
    expect(within(panel).getByText(/nothing is posted for it/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Send for approval' })).toBeInTheDocument();
  });
});

describe('MTBF', () => {
  it('shows a dash, not zero, for a machine with no failures', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/maint/reports/mtbf': () =>
        json(200, {
          data: {
            rows: [
              {
                assetId: 'a1',
                assetNo: 'AST1',
                name: 'Drill',
                criticality: 'B',
                failures: 0,
                mtbfHours: null,
                mttrHours: null,
                availabilityPct: null,
                downtimeMinutes: '0',
              },
            ],
          },
        }),
    });
    renderApp('/m/maint-mtbf');
    const row = (await screen.findByText(/AST1 · Drill/)).closest('tr')!;
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });
});
