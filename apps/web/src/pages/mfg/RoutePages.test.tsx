// plant-unit-routing and mfg-unit-route: V40 tabs/columns, real rows, disabled buttons that say why.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  lookups: vi.fn(),
  routes: vi.fn(),
  route: vi.fn(),
  createRoute: vi.fn(),
  plants: vi.fn(),
  live: vi.fn(),
  workCentres: vi.fn(),
}));
vi.mock('../../lib/routingApi', async (orig) => {
  const real = await orig<typeof import('../../lib/routingApi')>();
  return { ...real, routingApi: { ...real.routingApi, ...api } };
});

import { MfgUnitRoutePage } from './RouteLivePage';
import { PlantUnitRoutingPage } from './RoutePlantUnitRouting';

const plants = [
  { id: 'u1', code: 'TAL', name: 'Talegaon', processes: ['Laser Cutting'], jobs: 2, wipBalance: '20.000' },
  { id: 'u2', code: 'SAW', name: 'Sawantwadi', processes: [], jobs: 0, wipBalance: '0' },
];
const row = {
  id: 'j1', orderId: 'o1', jobNo: 'MO/TAL/0001', partCode: 'P1', partName: 'Shaft', routeCode: 'ROUTE-1', currentStep: 1, currentProcess: 'Turning',
  currentUnitCode: 'TAL', currentUnitName: 'Talegaon', nextProcess: 'Grinding', nextUnitName: 'Sawantwadi', planned: '500.000', good: '470.000',
  rejected: '0.000', scrap: '10.000', transferred: '0.000', balance: '20.000', yield: '94.0', routeStatus: 'IN_PROGRESS', qualityApproval: null, dcStatus: null,
  transferNo: null, transferStatus: null,
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.lookups.mockResolvedValue({ units: [{ id: 'u1', code: 'TAL', name: 'Talegaon' }], departments: [{ id: 'd1', name: 'Production' }] });
  api.routes.mockResolvedValue({ routes: [], cards: { templates: 3, steps: 9, activeDeptHandover: 4, physicalMoves: 1 } });
  api.workCentres.mockResolvedValue([]);
  api.plants.mockResolvedValue(plants);
  api.live.mockResolvedValue([row]);
});

describe('Plant / Unit Routing', () => {
  it('shows the cards from the database and refuses to save an incomplete route with a reason', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><PlantUnitRoutingPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Plant / Unit Routing' })).toBeInTheDocument();
    expect(await screen.findByText('9')).toBeInTheDocument();
    for (const b of ['New Route', 'Duplicate', 'Reset Sketch Template', '+ Add Step']) {
      expect(screen.getByRole('button', { name: new RegExp(b.replace('+', '\\+')) })).toBeInTheDocument();
    }
    const save = screen.getByRole('button', { name: /Save Route/ });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('title', 'Enter the route name first.');
    await user.type(screen.getByLabelText('Route Name'), 'Shaft route');
    expect(screen.getByRole('button', { name: /Save Route/ })).toHaveAttribute('title', 'Add at least one step first.');
    await user.click(screen.getByRole('button', { name: '+ Add Step' }));
    await waitFor(() => expect(screen.getByLabelText('Process of step 1')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Save Route/ })).toHaveAttribute('title', 'Every step needs a process.');
    await user.type(screen.getByLabelText('Process of step 1'), 'Turning');
    expect(screen.getByRole('button', { name: 'Save Route' })).toBeEnabled();
  });
});

describe('Multi-Unit Part Routing', () => {
  it('shows our plants by name as Unit tabs and the live row with good / plan, balance and yield', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><MfgUnitRoutePage /></MemoryRouter>);
    expect(await screen.findByRole('tab', { name: 'Unit 1: Talegaon' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Unit 2: Sawantwadi' })).toBeInTheDocument();
    for (const t of ['Live Routing', 'WIP', 'Transfers', 'Quality', 'Dispatch']) expect(screen.getByRole('tab', { name: t })).toBeInTheDocument();
    for (const c of ['Job / Batch', 'Part', 'Current Operation', 'Next Operation', 'Good / Plan', 'Loss / Balance', 'Yield', 'Transfer Receipt', 'Quality / DC', 'Action']) {
      expect(screen.getByRole('columnheader', { name: c })).toBeInTheDocument();
    }
    expect(await screen.findByText('470.000 / 500.000')).toBeInTheDocument();
    expect(screen.getByText('10.000 / 20.000')).toBeInTheDocument();
    expect(screen.getByText('94.0%')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Unit 1: Talegaon' }));
    await waitFor(() => expect(api.live).toHaveBeenLastCalledWith(expect.objectContaining({ unitId: 'u1' })));
    expect(screen.getByRole('button', { name: /^Record/ })).toHaveAttribute('title', 'Enter a good or scrap quantity.');
  });

  it('blocks the next step while the transfer note is not received', async () => {
    api.live.mockResolvedValue([{ ...row, id: 'j2', jobNo: 'MO/TAL/0002', nextProcess: null, nextUnitName: null, transferNo: 'MTN/TAL/0001', transferStatus: 'PENDING' }]);
    render(<MemoryRouter><MfgUnitRoutePage /></MemoryRouter>);
    const btn = await screen.findByRole('button', { name: /Complete Route/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Transfer note MTN/TAL/0001 is not received yet.');
  });
});
