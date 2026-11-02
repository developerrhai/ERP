// Phase 3 context tests: GET /me/context fills the top-bar selects, every call carries
// X-Unit-Id / X-FY-Id, a switch PUTs and refetches, and unsaved edits ask before discarding.
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { contextHeaders, setContextHeaders } from '../lib/context-headers';
import { hasUnsavedChanges, useUnsavedGuard } from '../lib/unsaved';
import {
  apiError,
  countCalls,
  json,
  makeContext,
  makeUser,
  renderApp,
  signedIn,
  type Call,
} from '../test/helpers';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const member = makeUser({
  id: 'm1',
  role: 'MEMBER',
  roleLabel: 'Member',
  department: 'Sales',
  name: 'Ravi Kumar',
});

const DEPTS = [
  {
    id: 'd1',
    code: 'ADM',
    name: 'Administration',
    head: null,
    status: 'ACTIVE',
    userCount: 1,
    version: 1,
  },
];

const optionTexts = (select: HTMLElement): string[] =>
  within(select)
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');

const deptCalls = (calls: Call[]): Call[] =>
  calls.filter((c) => c.method === 'GET' && c.path.endsWith('/departments'));

describe('context headers', () => {
  it('sends X-FY-Id always and omits X-Unit-Id for All Units', () => {
    expect(contextHeaders()).toEqual({});
    setContextHeaders({ unitId: 'u1', fyId: 'f1' });
    expect(contextHeaders()).toEqual({ 'X-Unit-Id': 'u1', 'X-FY-Id': 'f1' });
    setContextHeaders({ unitId: null, fyId: 'f1' });
    expect(contextHeaders()).toEqual({ 'X-FY-Id': 'f1' });
    setContextHeaders(null);
  });
});

describe('useUnsavedGuard', () => {
  it('registers only while dirty and mounted', () => {
    const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedGuard(dirty), {
      initialProps: { dirty: false },
    });
    expect(hasUnsavedChanges()).toBe(false);
    rerender({ dirty: true });
    expect(hasUnsavedChanges()).toBe(true);
    rerender({ dirty: false });
    expect(hasUnsavedChanges()).toBe(false);
    rerender({ dirty: true });
    unmount();
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe('top-bar context selectors', () => {
  it('shows the single company (disabled), units with All Units, and FYs with (closed)', async () => {
    const ctx = makeContext({
      fys: [
        { id: 'fy-2627', code: '2026-27', label: 'FY 2026-27', status: 'OPEN', isCurrent: true },
        { id: 'fy-2526', code: '2025-26', label: 'FY 2025-26', status: 'CLOSED', isCurrent: false },
      ],
    });
    signedIn(owner, { 'GET /api/v1/me/context': () => json(200, { data: ctx }) });
    renderApp('/');
    const unit = await screen.findByRole('combobox', { name: 'Unit' });
    await waitFor(() => expect(unit).toBeEnabled());
    const company = screen.getByRole('combobox', { name: 'Company' });
    expect(company).toBeDisabled();
    expect(optionTexts(company)).toEqual(['Sawant Group']);
    expect(optionTexts(unit)).toEqual(['All Units', 'Talwade', 'Sawardari', 'Varale']);
    expect(unit).toHaveValue('unit-tal');
    const fy = screen.getByRole('combobox', { name: 'Financial year' });
    expect(optionTexts(fy)).toEqual(['FY 2026-27', 'FY 2025-26 (closed)']);
    expect(fy).toHaveValue('fy-2627');
  });

  it('a non-admin sees only the accessible units, without All Units', async () => {
    const ctx = makeContext({
      units: [{ id: 'unit-saw', code: 'SAW', name: 'Sawardari' }],
      allUnitsAllowed: false,
      current: { unitId: 'unit-saw', fyId: 'fy-2627' },
    });
    signedIn(member, { 'GET /api/v1/me/context': () => json(200, { data: ctx }) });
    renderApp('/');
    const unit = await screen.findByRole('combobox', { name: 'Unit' });
    await waitFor(() => expect(optionTexts(unit)).toEqual(['Sawardari']));
  });

  it('API calls after loading carry X-Unit-Id and X-FY-Id', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/departments': () => json(200, { data: DEPTS }),
    });
    renderApp('/');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Unit' })).toBeEnabled());
    await userEvent.setup().click(screen.getByRole('link', { name: 'Departments' }));
    await screen.findByRole('heading', { name: 'Department Master' });
    await waitFor(() => expect(deptCalls(calls).length).toBe(1));
    const call = deptCalls(calls)[0];
    expect(call?.headers['X-Unit-Id']).toBe('unit-tal');
    expect(call?.headers['X-FY-Id']).toBe('fy-2627');
  });

  it('switching unit PUTs /me/context and refetches the page with the new headers', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/departments': () => json(200, { data: DEPTS }),
    });
    renderApp('/m/admin-departments');
    await screen.findByRole('heading', { name: 'Department Master' });
    const unit = screen.getByRole('combobox', { name: 'Unit' });
    await waitFor(() => expect(unit).toBeEnabled());
    await waitFor(() => expect(deptCalls(calls).length).toBeGreaterThan(0));
    const before = deptCalls(calls).length;
    await userEvent.setup().selectOptions(unit, 'unit-var');
    await waitFor(() => expect(deptCalls(calls).length).toBe(before + 1));
    const put = calls.find((c) => c.method === 'PUT' && c.path.endsWith('/me/context'));
    expect(put?.body).toEqual({ unitId: 'unit-var', fyId: 'fy-2627' });
    expect(deptCalls(calls).at(-1)?.headers['X-Unit-Id']).toBe('unit-var');
    expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveValue('unit-var');
  });

  it('All Units sends unitId null and omits X-Unit-Id; the dashboard hero follows', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/departments': () => json(200, { data: DEPTS }),
    });
    renderApp('/');
    expect(await screen.findByTestId('hero-context')).toHaveTextContent('Talwade • FY 2026-27');
    const ue = userEvent.setup();
    await ue.selectOptions(screen.getByRole('combobox', { name: 'Unit' }), '');
    await waitFor(() =>
      expect(screen.getByTestId('hero-context')).toHaveTextContent('All Units • FY 2026-27'),
    );
    const put = calls.find((c) => c.method === 'PUT' && c.path.endsWith('/me/context'));
    expect(put?.body).toEqual({ unitId: null, fyId: 'fy-2627' });
    await ue.click(screen.getByRole('link', { name: 'Departments' }));
    await waitFor(() => expect(deptCalls(calls).length).toBe(1));
    expect(deptCalls(calls)[0]?.headers).not.toHaveProperty('X-Unit-Id');
    expect(deptCalls(calls)[0]?.headers['X-FY-Id']).toBe('fy-2627');
  });

  it('a refused switch shows the server message and keeps the old selection', async () => {
    signedIn(owner, {
      'PUT /api/v1/me/context': () =>
        apiError(403, 'CONTEXT_FORBIDDEN', 'You do not have access to this unit.'),
    });
    renderApp('/');
    const unit = await screen.findByRole('combobox', { name: 'Unit' });
    await waitFor(() => expect(unit).toBeEnabled());
    await userEvent.setup().selectOptions(unit, 'unit-saw');
    expect(await screen.findByText('You do not have access to this unit.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveValue('unit-tal');
  });

  it('with unsaved edits it asks "Discard unsaved changes?" first', async () => {
    const letterhead = {
      value: {
        companyName: 'Sawant Group',
        legalName: '',
        address: '',
        phone: '',
        email: '',
        website: '',
        gstin: '',
        pan: '',
        cin: '',
        footer: '',
        signatory: '',
      },
      version: 1,
    };
    const { calls } = signedIn(owner, {
      'GET /api/v1/settings/letterhead': () => json(200, { data: letterhead }),
    });
    renderApp('/m/admin-settings/letterhead');
    const ue = userEvent.setup();
    const name = await screen.findByLabelText('Company Name');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Unit' })).toBeEnabled());
    await ue.type(name, ' Ltd');
    const fy = screen.getByRole('combobox', { name: 'Financial year' });

    await ue.selectOptions(fy, 'fy-2526');
    const dialog = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
    await ue.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(countCalls(calls, 'PUT', '/me/context')).toBe(0);
    expect(screen.getByLabelText('Company Name')).toHaveValue('Sawant Group Ltd');
    expect(fy).toHaveValue('fy-2627');

    await ue.selectOptions(screen.getByRole('combobox', { name: 'Financial year' }), 'fy-2526');
    await ue.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Discard and switch',
      }),
    );
    await waitFor(() => expect(countCalls(calls, 'PUT', '/me/context')).toBe(1));
    // The page remounts and reloads: the draft is gone.
    await waitFor(() => expect(screen.getByLabelText('Company Name')).toHaveValue('Sawant Group'));
    expect(screen.getByRole('combobox', { name: 'Financial year' })).toHaveValue('fy-2526');
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('without unsaved edits it switches straight away', async () => {
    const { calls } = signedIn(owner);
    renderApp('/');
    const fy = await screen.findByRole('combobox', { name: 'Financial year' });
    await waitFor(() => expect(fy).toBeEnabled());
    await act(async () => {
      await userEvent.setup().selectOptions(fy, 'fy-2526');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(countCalls(calls, 'PUT', '/me/context')).toBe(1));
  });

  it('module placeholder pages show Unit and FY context chips', async () => {
    signedIn(owner);
    renderApp('/m/sales-orders');
    const chips = await screen.findByLabelText('Working context');
    await waitFor(() => expect(within(chips).getByText('Unit: Talwade')).toBeInTheDocument());
    expect(within(chips).getByText('FY: FY 2026-27')).toBeInTheDocument();
  });

  it('a context that cannot load leaves the selects disabled with the reason', async () => {
    signedIn(owner, {
      'GET /api/v1/me/context': () => apiError(500, 'INTERNAL', 'Context service down.'),
    });
    renderApp('/');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveAttribute(
        'title',
        'Context service down.',
      ),
    );
    expect(screen.getByRole('combobox', { name: 'Unit' })).toBeDisabled();
  });
});
