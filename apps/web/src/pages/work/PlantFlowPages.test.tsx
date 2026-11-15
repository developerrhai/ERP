// V40 plant-flow-command / plant-project-forward: hero counters, department buttons, gate rows and Move Forward gating.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlantFlow } from '../../lib/plantFlowApi';

const overview = vi.fn();
vi.mock('../../lib/plantFlowApi', () => ({ plantFlowApi: { overview: (id: string) => overview(id) as Promise<unknown> } }));
vi.mock('../../lib/spineApi', () => ({ spineApi: { options: () => Promise.resolve([{ id: 'p1', code: 'PRJ-1', name: 'Valve Cell', status: 'ACTIVE' }]) } }));
vi.mock('../../lib/workApi', async (orig) => {
  const real = await orig<typeof import('../../lib/workApi')>();
  return {
    ...real,
    workApi: {
      ...real.workApi,
      departments: () =>
        Promise.resolve([
          { id: 'd-sales', name: 'Sales' },
          { id: 'd-prod', name: 'Production' },
        ]),
    },
  };
});

import { PlantFlowCommandPage, PlantProjectForwardPage } from './PlantFlowPages';

const gate = (over: Record<string, unknown>) => ({
  id: 'g1', seq: 1, code: 'G01', name: 'Customer Order', state: 'APPROVED', ownerDepartmentId: 'd-sales', ownerDepartment: 'Sales',
  exitCriteria: 'Order approved', deliverableName: null, linkedPage: 'sales-orders', dependsOn: [], dueDate: null, approvedAt: null,
  nextGateCode: 'G02', nextGateDepartment: 'Production', ...over,
});

function flow(over: Partial<PlantFlow> = {}): PlantFlow {
  const g1 = gate({});
  const g2 = gate({ id: 'g2', seq: 2, code: 'G02', name: 'Build', state: 'IN_WORK', ownerDepartmentId: 'd-prod', ownerDepartment: 'Production', exitCriteria: 'Built', linkedPage: null, dependsOn: ['G01'], nextGateCode: 'G03', nextGateDepartment: 'Quality' });
  const g3 = gate({ id: 'g3', seq: 3, code: 'G03', name: 'Inspect', state: 'LOCKED', ownerDepartmentId: 'd-q', ownerDepartment: 'Quality', dependsOn: ['G02'], nextGateCode: null, nextGateDepartment: null });
  return {
    project: { id: 'p1', code: 'PRJ-1', name: 'Valve Cell', customer: null, status: 'ACTIVE', salesOrder: 'SO-7', manufacturingOrder: 'MO-9', purchaseOrder: null },
    progress: { gatesTotal: 3, gatesDone: 1, progressPct: 33 },
    pendingReceipt: 2,
    pendingAcceptance: 1,
    openMovements: 1,
    currentDepartment: { id: 'd-prod', name: 'Production' },
    currentGate: g2 as PlantFlow['currentGate'],
    lastApprovedGate: g1 as PlantFlow['lastApprovedGate'],
    gates: [g1, g2, g3] as PlantFlow['gates'],
    movements: [
      { id: 'm1', number: 'MOV/1', doc_type: 'sales-orders', doc_id: 'doc1', doc_no: 'SO-7', state: 'ACCEPTED', work_status: 'Work Required', sent_at: '2026-11-14T08:00:00Z', from_department_id: 'd-sales', from_department: 'Sales', to_department_id: 'd-prod', to_department: 'Production', open: true },
    ],
    ...over,
  };
}

const view = (page = <PlantFlowCommandPage />) =>
  render(
    <MemoryRouter>
      {page}
    </MemoryRouter>,
  );

describe('Integrated Plant Flow pages', () => {
  beforeEach(() => {
    overview.mockReset();
    overview.mockResolvedValue(flow());
  });

  it('shows real counters, identity and one row per gate', async () => {
    view();
    expect(await screen.findByText('33%')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('PRJ-1-G02 • Build')).toBeInTheDocument();
    expect(screen.getByText('SO-7', { exact: false })).toBeInTheDocument();
    expect(overview).toHaveBeenCalledWith('p1');
    expect(screen.getByRole('link', { name: 'Open Current Dept Inbox' })).toHaveAttribute('href', '/m/dept-inbox-production');
    expect(screen.getByRole('link', { name: 'Detailed Project Control' })).toBeInTheDocument();
  });

  it('department buttons filter the gates; a locked gate cannot open work', async () => {
    const user = userEvent.setup();
    view(<PlantProjectForwardPage />);
    await screen.findByText('PRJ-1-G02 • Build');
    await user.click(screen.getByRole('tab', { name: 'Sales' }));
    expect(screen.queryByText('PRJ-1-G02 • Build')).not.toBeInTheDocument();
    expect(screen.getByText('PRJ-1-G01 • Customer Order')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'All Departments' }));
    const open = screen.getAllByRole('button', { name: 'Open Work' });
    expect(open).toHaveLength(1);
    expect(open[0]).toBeDisabled();
    expect(screen.getByText('Locked until its earlier gates are approved.')).toBeInTheDocument();
  });

  it('Move Forward is on while a department holds an accepted movement', async () => {
    view();
    const btn = await screen.findByRole('button', { name: 'Move Forward → Next Gate' });
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it('Move Forward is off, with the reason shown, when nothing is accepted', async () => {
    overview.mockResolvedValue(flow({ movements: [], currentDepartment: null }));
    view();
    const btn = await screen.findByRole('button', { name: 'Move Forward → Next Gate' });
    expect(btn).toBeDisabled();
    expect(screen.getAllByText(/after a department has Received and Accepted/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Open Current Dept Inbox' })).toBeDisabled();
  });
});
