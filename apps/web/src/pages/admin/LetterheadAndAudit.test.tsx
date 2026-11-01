// Letterhead (11 labelled fields, live preview, client + 422 validation, If-Match PUT, Test PDF
// disabled) and Audit Trail (filters → query, table, details drawer with before/after, paging).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
} from '../../test/helpers';
import { describeDetail, humanAction } from './AuditTrailPage';
import { validateLetterhead } from './LetterheadPage';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', department: null });

const letterhead = {
  companyName: 'RHAI Industries Pvt. Ltd.',
  legalName: '',
  address: 'Configure registered address in System Settings',
  phone: '',
  email: '',
  website: '',
  gstin: '',
  pan: '',
  cin: '',
  footer: 'System-generated document from RHAI Enterprise ERP',
  signatory: 'Authorized Signatory',
};

describe('LetterheadPage', () => {
  it('renders 11 labelled fields, a live preview and a disabled Test PDF', async () => {
    signedIn(owner, {
      'GET /api/v1/settings/letterhead': () =>
        json(200, { data: { value: letterhead, version: 3 } }),
    });
    renderApp('/m/admin-settings/letterhead');
    const company = await screen.findByLabelText('Company Name');
    expect(company).toHaveValue('RHAI Industries Pvt. Ltd.');
    for (const l of [
      'Legal Name',
      'Address',
      'Phone',
      'Email',
      'Website',
      'GSTIN',
      'PAN',
      'CIN',
      'Footer',
      'Signatory',
    ]) {
      expect(screen.getByLabelText(l)).toBeInTheDocument();
    }
    const testPdf = screen.getByRole('button', { name: 'Test PDF' });
    expect(testPdf).toBeDisabled();
    expect(testPdf).toHaveAttribute('title', 'PDF generation arrives in Phase 4');
    const preview = screen.getByTestId('letterhead-preview');
    const ue = userEvent.setup();
    await ue.type(screen.getByLabelText('GSTIN'), '27abcde1234f1z5');
    expect(within(preview).getByText('GSTIN: 27ABCDE1234F1Z5')).toBeInTheDocument();
    await ue.clear(company);
    await ue.type(company, 'Acme Ltd');
    expect(within(preview).getByRole('heading', { name: 'Acme Ltd' })).toBeInTheDocument();
    expect(within(preview).getByText('Authorized Signatory')).toBeInTheDocument();
  });

  it('validates locally, then PUTs with If-Match and shows 422 field errors', async () => {
    let n = 0;
    const { calls } = signedIn(owner, {
      'GET /api/v1/settings/letterhead': () =>
        json(200, { data: { value: letterhead, version: 3 } }),
      'PUT /api/v1/settings/letterhead': () =>
        ++n === 1
          ? apiError(422, 'VALIDATION_ERROR', 'Some fields are invalid.', { website: 'Bad URL.' })
          : json(200, { data: { value: letterhead, version: 4 } }),
    });
    renderApp('/m/admin-settings/letterhead');
    const ue = userEvent.setup();
    await ue.type(await screen.findByLabelText('PAN'), 'abc');
    await ue.click(screen.getByRole('button', { name: 'Save Letterhead' }));
    expect(screen.getByText('PAN must look like ABCDE1234F.')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    await ue.clear(screen.getByLabelText('PAN'));
    await ue.click(screen.getByRole('button', { name: 'Save Letterhead' }));
    expect(await screen.findByText('Bad URL.')).toBeInTheDocument();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.headers['If-Match']).toBe('3');
    expect(put?.body).toEqual(letterhead);
    await ue.click(screen.getByRole('button', { name: 'Save Letterhead' }));
    expect(await screen.findByText('Letterhead saved.')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PUT').at(-1)?.headers['If-Match']).toBe('3');
  });

  it('is read-only without the controls permission', async () => {
    signedIn(owner, {
      'GET /api/v1/settings/letterhead': () =>
        json(200, { data: { value: letterhead, version: 1 } }),
      'GET /api/v1/me/permissions': permissionsRoute({ view: true }),
    });
    renderApp('/m/admin-settings/letterhead');
    expect(await screen.findByLabelText('Company Name')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Save Letterhead' })).toBeNull();
  });

  it('validateLetterhead follows the contract patterns', () => {
    expect(validateLetterhead({ ...letterhead, companyName: ' ' }).companyName).toBeTruthy();
    expect(validateLetterhead({ ...letterhead, gstin: '27ABCDE1234F1Z5' }).gstin).toBeUndefined();
    expect(validateLetterhead({ ...letterhead, gstin: '27ABCDE1234F1Y5' }).gstin).toBeTruthy();
    expect(validateLetterhead({ ...letterhead, cin: 'U12345MH2020PTC123456' }).cin).toBeUndefined();
    expect(validateLetterhead({ ...letterhead, email: 'x@' }).email).toBeTruthy();
    expect(
      validateLetterhead({ ...letterhead, website: 'https://rhai.example' }).website,
    ).toBeUndefined();
    expect(validateLetterhead({ ...letterhead, phone: '1'.repeat(31) }).phone).toBeTruthy();
  });
});

describe('AuditTrailPage', () => {
  const logs = [
    {
      id: 'a1',
      at: '2026-11-01T10:00:00.000Z',
      actor: { id: 'u1', name: 'Owner Person', loginId: 'owner' },
      action: 'DEPARTMENT_UPDATED',
      targetType: 'Department',
      targetId: 'd2',
      ip: '127.0.0.1',
      userAgent: 'test',
      detail: {
        before: { name: 'Sales', head: null },
        after: { name: 'Sales & CRM', head: null },
        reason: 'rename',
      },
    },
    {
      id: 'a2',
      at: '2026-11-01T09:00:00.000Z',
      actor: null,
      action: 'LOGIN_FAILED',
      targetType: null,
      targetId: null,
      ip: '10.0.0.1',
      userAgent: null,
      detail: { identifier: 'ghost' },
    },
  ];

  function setup() {
    return signedIn(owner, {
      'GET /api/v1/audit-logs': () =>
        json(200, { data: logs, meta: { page: 1, size: 25, total: 60 } }),
      'GET /api/v1/users': () =>
        json(200, {
          data: [makeUser({ id: 'u1', name: 'Owner Person', loginId: 'owner' })],
          meta: { page: 1, size: 100, total: 1 },
        }),
    });
  }

  it('lists entries with the contract columns and paginates', async () => {
    const { calls } = setup();
    renderApp('/m/admin-audit');
    await screen.findByText('Owner Person (owner)', { selector: 'td' });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Date Time',
      'User',
      'Action',
      'Target',
      'IP',
      'Details',
    ]);
    expect(screen.getByText('Department Updated', { selector: '.chip' })).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–25 of 60')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.path.endsWith('/audit-logs')).at(-1)?.url).toContain('page=2'),
    );
  });

  it('sends the filters as query parameters (to = end of that day)', async () => {
    const { calls } = setup();
    renderApp('/m/admin-audit');
    const ue = userEvent.setup();
    await screen.findByText('Owner Person (owner)', { selector: 'td' });
    await ue.selectOptions(screen.getByLabelText('Filter by action'), 'LOGIN_FAILED');
    await ue.selectOptions(await screen.findByLabelText('Filter by user'), 'u1');
    await ue.type(screen.getByLabelText('Search audit details'), 'ghost');
    await ue.type(screen.getByLabelText('To'), '2026-11-01');
    await waitFor(() => {
      const url = calls.filter((c) => c.path.endsWith('/audit-logs')).at(-1)?.url ?? '';
      const p = new URL(url, 'http://t').searchParams;
      expect(p.get('action')).toBe('LOGIN_FAILED');
      expect(p.get('actorId')).toBe('u1');
      expect(p.get('q')).toBe('ghost');
      expect(p.get('page')).toBe('1');
      expect(new Date(p.get('to') ?? '').getTime()).toBe(
        new Date('2026-11-01T23:59:59.999').getTime(),
      );
    });
  });

  it('opens a details drawer with before/after side by side', async () => {
    setup();
    renderApp('/m/admin-audit');
    await screen.findByText('Owner Person (owner)', { selector: 'td' });
    await userEvent
      .setup()
      .click(
        screen.getAllByRole('button', { name: /^Details of Department Updated/ })[0] as HTMLElement,
      );
    const drawer = await screen.findByRole('dialog', { name: 'Department Updated — details' });
    const changes = within(drawer).getAllByRole('table')[0] as HTMLElement;
    const nameRow = within(changes).getByText('name').closest('tr');
    expect(nameRow).toHaveClass('changed');
    expect(within(nameRow as HTMLElement).getByText('Sales')).toBeInTheDocument();
    expect(within(nameRow as HTMLElement).getByText('Sales & CRM')).toBeInTheDocument();
    expect(within(drawer).getByText('reason')).toBeInTheDocument();
    expect(within(drawer).getByText('rename')).toBeInTheDocument();
  });

  it('helpers format actions and details', () => {
    expect(humanAction('MODULE_CONTROL_UPDATED')).toBe('Module Control Updated');
    expect(describeDetail({ identifier: 'x', n: 2 }).pairs).toEqual([
      ['identifier', 'x'],
      ['n', '2'],
    ]);
    expect(describeDetail(null)).toEqual({ pairs: [], changes: [] });
  });
});
