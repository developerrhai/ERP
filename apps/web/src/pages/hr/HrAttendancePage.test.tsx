// HrAttendancePage (also the Shifts screen): shift times arrive as HH:MM, the day table reads the camelCase API fields.
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { authOk, json, makeUser, mockFetch, renderApp } from '../../test/helpers';

const admin = makeUser({ id: 'sa', name: 'Owner', loginId: 'owner', role: 'SUPER_ADMIN' });

describe('HrAttendancePage', () => {
  it('shows each shift with its start and end time, and the worked hours of a day in India time', async () => {
    mockFetch({
      'POST /api/v1/auth/refresh': () => authOk(admin),
      'GET /api/v1/hr/shifts': () =>
        json(200, {
          data: [
            { id: 's1', code: 'GEN', name: 'General Shift', startTime: '09:00', endTime: '17:30', breakMinutes: 30, isNight: false },
            { id: 's2', code: 'NIGHT', name: 'Night Shift', startTime: '23:00', endTime: '07:30', breakMinutes: 30, isNight: true },
          ],
        }),
      'GET /api/v1/hr/attendance/days': () =>
        json(200, {
          data: [
            {
              id: 'd1',
              attendanceDate: '2027-03-10',
              empCode: 'E-1',
              employeeName: 'Asha K',
              shiftCode: 'GEN',
              firstIn: '2027-03-10T03:35:00.000Z',
              lastOut: '2027-03-10T12:10:00.000Z',
              workedMinutes: 485,
              lateMinutes: 5,
              earlyMinutes: 0,
              status: 'P',
            },
          ],
        }),
    });
    renderApp('/m/hr-shifts');

    const shiftTable = await screen.findByRole('table', { name: 'Shifts' });
    const gen = (await within(shiftTable).findByText('GEN')).closest('tr')!;
    expect(within(gen).getByText('09:00')).toBeInTheDocument();
    expect(within(gen).getByText('17:30')).toBeInTheDocument();
    const night = within(shiftTable).getByText('NIGHT').closest('tr')!;
    expect(within(night).getByText('23:00')).toBeInTheDocument();
    expect(within(night).getByText(/07:30/)).toBeInTheDocument();
    expect(within(night).getByText(/next day/)).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).toBeNull();

    // the day: 09:05 to 17:40 India time, 8.1 hours (not 24)
    expect(await screen.findByText('E-1 - Asha K')).toBeInTheDocument();
    expect(screen.getByText('09:05')).toBeInTheDocument();
    expect(screen.getByText('17:40')).toBeInTheDocument();
    expect(screen.getByText('8.1 hrs')).toBeInTheDocument();
    expect(screen.getByText('Present')).toBeInTheDocument();
  });
});
