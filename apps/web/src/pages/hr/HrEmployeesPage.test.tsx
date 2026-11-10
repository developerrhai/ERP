// HrEmployeesPage tests: verifies camelCase API contract for list, onboarding create
// (with real unitId and department instead of placeholder UUID), detail view, and PII reveal.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authOk, DEPARTMENTS, json, makeUser, mockFetch, renderApp } from '../../test/helpers';

const admin = makeUser({ id: 'sa', name: 'Owner', loginId: 'owner', role: 'SUPER_ADMIN' });

const existingEmp = {
  id: 'emp-1',
  empCode: 'EMP-001',
  firstName: 'Asha',
  lastName: 'Kulkarni',
  gender: 'FEMALE',
  dob: '1994-05-12',
  joiningDate: '2025-04-01',
  mobile: '9876543210',
  department: 'Production',
  designationName: 'Supervisor',
  unitId: 'unit-tal',
  unitName: 'Talwade',
  status: 'ACTIVE',
  aadhaarLast4: '4321',
  pan: 'ABCDE1234F',
};

describe('HrEmployeesPage', () => {
  it('lists employees, submits camelCase onboard payload with unitId & department, and reveals Aadhaar via /reveal', async () => {
    const employees = [existingEmp];
    const { calls } = mockFetch({
      'POST /api/v1/auth/refresh': () => authOk(admin),
      'GET /api/v1/meta/departments': () => json(200, { data: DEPARTMENTS }),
      'GET /api/v1/hr/employees': () =>
        json(200, { data: employees, meta: { total: employees.length } }),
      'GET /api/v1/hr/employees/emp-1': () => json(200, { data: existingEmp }),
      'POST /api/v1/hr/employees': (call) => {
        const b = call.body as Record<string, unknown>;
        const created = {
          ...existingEmp,
          id: 'emp-2',
          empCode: 'EMP-002',
          firstName: b.firstName,
          lastName: b.lastName,
          mobile: b.mobile,
          department: b.department,
        };
        employees.push(created as typeof existingEmp);
        return json(201, { data: created });
      },
      'POST /api/v1/hr/employees/emp-1/reveal': () =>
        json(200, { data: { value: '234567890123' } }),
    });

    const user = userEvent.setup();
    renderApp('/m/hr-employees');

    expect(await screen.findByText('EMP-001')).toBeInTheDocument();
    expect(screen.getByText('Asha Kulkarni')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Onboard Employee' }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText('First Name *'), 'Rohan');
    await user.type(within(dialog).getByLabelText('Last Name *'), 'Deshmukh');
    await user.selectOptions(within(dialog).getByLabelText('Gender *'), 'MALE');
    await user.selectOptions(within(dialog).getByLabelText('Unit *'), 'unit-tal');
    await user.selectOptions(within(dialog).getByLabelText('Department *'), 'Production');
    await user.type(within(dialog).getByLabelText('Date of Birth *'), '1992-08-15');
    await user.type(within(dialog).getByLabelText('Date of Joining *'), '2026-04-10');
    await user.type(within(dialog).getByLabelText('Mobile (10 digits) *'), '9822012345');
    await user.type(within(dialog).getByLabelText('Personal Email'), 'rohan@example.com');
    await user.type(within(dialog).getByLabelText('Aadhaar (12 digits) *'), '462261196921');
    await user.type(within(dialog).getByLabelText('PAN Card *'), 'ABCDE1234F');

    await user.click(within(dialog).getByRole('button', { name: 'Save & Encrypt Vault' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const postCall = calls.find((c) => c.method === 'POST' && c.path === '/api/v1/hr/employees');
    expect(postCall?.body).toEqual({
      firstName: 'Rohan',
      lastName: 'Deshmukh',
      gender: 'MALE',
      dob: '1992-08-15',
      joiningDate: '2026-04-10',
      mobile: '9822012345',
      personalEmail: 'rohan@example.com',
      aadhaar: '462261196921',
      pan: 'ABCDE1234F',
      unitId: 'unit-tal',
      department: 'Production',
    });

    await user.click(screen.getByText('EMP-001'));
    expect(await screen.findByText(/XXXX-XXXX-4321/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Audit reveal reason'), 'Statutory KYC check');
    await user.click(screen.getByRole('button', { name: 'Reveal Full Aadhaar' }));
    expect(await screen.findByText(/234567890123/)).toBeInTheDocument();

    const revealCall = calls.find(
      (c) => c.method === 'POST' && c.path === '/api/v1/hr/employees/emp-1/reveal',
    );
    expect(revealCall?.body).toEqual({ field: 'aadhaar', purpose: 'Statutory KYC check' });
  });
});
