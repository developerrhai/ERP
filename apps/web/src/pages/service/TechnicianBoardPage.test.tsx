// The technician board can add, edit and deactivate technicians.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';

const create = vi.fn();
const update = vi.fn();
const deactivate = vi.fn();
vi.mock('../../lib/serviceApi', async (orig) => {
  const real = await orig<typeof import('../../lib/serviceApi')>();
  return {
    ...real,
    serviceApi: {
      ...real.serviceApi,
      getTechnicianBoard: () =>
        Promise.resolve({
          unassignedTickets: [],
          lanes: [{ technician: { id: 't1', name: 'Ravi K', empCode: 'E1', maxOpenJobs: 4, skills: [{ skillCode: 'WELD', level: 2 }] }, assignedTickets: [] }],
        }),
      technicianEmployeeOptions: () => Promise.resolve([{ id: 'emp1', label: 'E2 - Sita P' }]),
      createTechnician: (b: unknown) => create(b) as Promise<unknown>,
      updateTechnician: (id: string, b: unknown) => update(id, b) as Promise<unknown>,
      deactivateTechnician: (id: string) => deactivate(id) as Promise<unknown>,
    },
  };
});

import { TechnicianBoardPage } from './TechnicianBoardPage';

beforeEach(() => {
  create.mockReset();
  update.mockReset();
  deactivate.mockReset();
});

describe('TechnicianBoardPage', () => {
  it('adds a technician from an employee, with skills parsed from CODE:level', async () => {
    create.mockResolvedValue({});
    render(<TechnicianBoardPage />);
    expect(await screen.findByText('Ravi K')).toBeInTheDocument();
    expect(screen.getByText('Load: 0/4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Add technician' }));
    await userEvent.selectOptions(await screen.findByLabelText(/Employee/), 'emp1');
    await userEvent.type(screen.getByLabelText(/Skills/), 'pump_mech:4, weld');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        employeeId: 'emp1',
        maxOpenJobs: 5,
        skills: [{ skillCode: 'PUMP_MECH', level: 4 }, { skillCode: 'WELD', level: 1 }],
      }),
    );
  });

  it('shows the API message when the technician cannot be added, and edits and deactivates one', async () => {
    create.mockImplementation(() => Promise.reject(new ApiError(422, 'VALIDATION_ERROR', 'Fix', { employeeId: 'This employee does not work in the plant you are signed in to.' })));
    update.mockResolvedValue({});
    deactivate.mockResolvedValue({});
    render(<TechnicianBoardPage />);
    await screen.findByText('Ravi K');
    await userEvent.click(screen.getByRole('button', { name: '+ Add technician' }));
    await userEvent.selectOptions(await screen.findByLabelText(/Employee/), 'emp1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/does not work in the plant/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /close|cancel/i })[0]!);

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('t1', { maxOpenJobs: 4, skills: [{ skillCode: 'WELD', level: 2 }] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(deactivate).toHaveBeenCalledWith('t1'));
  });
});
