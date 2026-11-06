// Phase 5 UI (docs/phases/PHASE-05.md §10 "UI"): the bell updates after an action, inline matrix
// errors, Approve/Reject/Return only for assignees, the journey drawer with names and times, the
// Notification Center preferences and the 10-character reason rule.
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
  type Call,
} from '../../test/helpers';
import type { ApprovalRequest } from '../../lib/approvalsApi';

const owner = makeUser({
  role: 'SUPER_ADMIN',
  roleLabel: 'Super Admin',
  name: 'Owner Person',
  roleLevel: 99,
});

function request(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'req-1',
    docType: 'scm-po',
    moduleTitle: 'Purchase Orders',
    docId: 'doc-1',
    docCode: 'PUR/TAL/2026-27/0001',
    docTitle: 'Purchase Orders',
    unitId: 'unit-tal',
    department: 'Purchase',
    amount: '75000',
    cycle: 1,
    status: 'PENDING',
    currentLevel: 1,
    totalLevels: 2,
    requestedBy: { id: 'u-emp', name: 'Esha Employee' },
    requestedAt: '2026-11-06T04:30:00.000Z',
    decidedAt: null,
    version: 3,
    waitingOn: 'Manoj Manager',
    dueAt: '2026-11-08T04:30:00.000Z',
    overdue: false,
    steps: [
      {
        id: 's1',
        level: 1,
        status: 'PENDING',
        threshold: '0',
        approver: 'Department Manager',
        limitRequired: null,
        slaHours: 48,
        activatedAt: '2026-11-06T04:30:00.000Z',
        dueAt: '2026-11-08T04:30:00.000Z',
        overdue: false,
        escalatedAt: null,
        assignees: [{ id: 'u-mgr', name: 'Manoj Manager', via: 'ROLE', onBehalfOf: null }],
        actedBy: null,
        onBehalfOf: null,
        actedAt: null,
        comment: null,
      },
      {
        id: 's2',
        level: 2,
        status: 'WAITING',
        threshold: '50000',
        approver: 'Department Head',
        limitRequired: '75000',
        slaHours: 48,
        activatedAt: null,
        dueAt: null,
        overdue: false,
        escalatedAt: null,
        assignees: [],
        actedBy: null,
        onBehalfOf: null,
        actedAt: null,
        comment: null,
      },
    ],
    timeline: [
      {
        id: 'a1',
        action: 'SUBMIT',
        level: null,
        actor: { id: 'u-emp', name: 'Esha Employee' },
        onBehalfOf: null,
        comment: null,
        fromStatus: 'Draft',
        toStatus: 'Pending Approval',
        at: '2026-11-06T04:30:00.000Z',
      },
    ],
    can: { approve: true, reject: true, return: true, withdraw: false },
    ...over,
  };
}

const page = (rows: ApprovalRequest[]) =>
  json(200, { data: rows, meta: { page: 1, size: 20, total: rows.length } });
const counts = (waiting: number) => () =>
  json(200, { data: { waitingForMe: waiting, submittedPending: 0, overdue: 0 } });

describe('Approval Center', () => {
  it('shows Approve / Reject / Return only on rows the server marks as actionable', async () => {
    const mine = request();
    const other = request({
      id: 'req-2',
      docCode: 'PUR/TAL/2026-27/0002',
      can: { approve: false, reject: false, return: false, withdraw: false },
    });
    signedIn(owner, {
      'GET /api/v1/approvals/counts': counts(2),
      'GET /api/v1/approvals/inbox': () => page([mine, other]),
    });
    renderApp('/approvals');
    await screen.findByRole('heading', { name: 'Approval Center' });
    expect(
      await screen.findByRole('button', { name: 'Approve PUR/TAL/2026-27/0001' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject PUR/TAL/2026-27/0001' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return PUR/TAL/2026-27/0001' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve PUR/TAL/2026-27/0002' })).toBeNull();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Waiting for me',
      'Submitted by me',
      'All (in my scope)',
      'Delegations',
    ]);
    expect(screen.getByText('Waiting for me', { selector: 'small' })).toBeInTheDocument();
  });

  it('Approve asks to confirm and sends If-Match + Idempotency-Key; the bell is refreshed', async () => {
    let unread = 3;
    const { calls } = signedIn(owner, {
      'GET /api/v1/notifications/unread-count': () => json(200, { data: { count: unread } }),
      'GET /api/v1/approvals/counts': counts(1),
      'GET /api/v1/approvals/inbox': () => page([request()]),
      'POST /api/v1/approvals/requests/req-1/approve': () => {
        unread = 0;
        return json(200, { data: request({ status: 'PENDING', currentLevel: 2, version: 4 }) });
      },
    });
    renderApp('/approvals');
    const ue = userEvent.setup();
    const bell = await screen.findByRole('button', { name: /Notifications, 3 unread/ });
    expect(within(bell).getByTestId('bell-badge')).toHaveTextContent('3');
    await ue.click(await screen.findByRole('button', { name: 'Approve PUR/TAL/2026-27/0001' }));
    expect(await screen.findByText(/Approve level 1 of 2/)).toBeInTheDocument();
    await ue.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls.some((c: Call) => c.path.endsWith('/approve'))).toBe(true));
    const post = calls.find((c: Call) => c.path.endsWith('/approve'));
    expect(post?.headers['If-Match']).toBe('3');
    expect(post?.headers['Idempotency-Key']).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument(),
    );
  });

  it('Reject needs a reason of at least 10 characters before anything is sent', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/approvals/counts': counts(1),
      'GET /api/v1/approvals/inbox': () => page([request()]),
      'POST /api/v1/approvals/requests/req-1/reject': () =>
        json(200, {
          data: request({
            status: 'REJECTED',
            can: { approve: false, reject: false, return: false, withdraw: false },
          }),
        }),
    });
    renderApp('/approvals');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Reject PUR/TAL/2026-27/0001' }));
    const dialog = screen.getByRole('dialog');
    await ue.type(within(dialog).getByLabelText('Reason *'), 'no');
    await ue.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(
      await within(dialog).findByText('Please write a reason (at least 10 characters).'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/reject'))).toBe(false);
    await ue.type(within(dialog).getByLabelText('Reason *'), ' the quote is missing');
    await ue.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/reject'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/reject'))?.body).toEqual({
      comment: 'no the quote is missing',
    });
  });

  it('the journey drawer shows each level with role, person, time, comment and "on behalf of"', async () => {
    const done = request({
      status: 'APPROVED',
      currentLevel: 2,
      version: 6,
      can: { approve: false, reject: false, return: false, withdraw: false },
      steps: request().steps.map((s, i) => ({
        ...s,
        status: 'APPROVED',
        actedBy: { id: `a${i}`, name: i === 0 ? 'Ravi Deputy' : 'Hema Head' },
        onBehalfOf: i === 0 ? { id: 'u-mgr', name: 'Meena Manager' } : null,
        actedAt: '2026-11-06T06:15:00.000Z',
        comment: i === 0 ? 'Looks fine' : null,
      })),
    });
    signedIn(owner, {
      'GET /api/v1/approvals/counts': counts(0),
      'GET /api/v1/approvals/inbox': () => page([]),
      'GET /api/v1/approvals/requests/req-1': () => json(200, { data: done }),
    });
    renderApp('/approvals?request=req-1');
    const drawer = await screen.findByRole('dialog', { name: /Purchase Orders/ });
    expect(await within(drawer).findByText('Level 1 · Department Manager')).toBeInTheDocument();
    expect(
      within(drawer).getByText('Ravi Deputy (on behalf of Meena Manager)'),
    ).toBeInTheDocument();
    expect(within(drawer).getByText('Hema Head')).toBeInTheDocument();
    expect(within(drawer).getByText('“Looks fine”')).toBeInTheDocument();
    expect(within(drawer).getAllByText(/2026|Nov/).length).toBeGreaterThan(0);
    expect(within(drawer).queryByRole('button', { name: /Approve/ })).toBeNull();
  });
});

describe('Approval Matrix page', () => {
  const sets = [
    {
      id: 'set-1',
      department: 'Purchase',
      departmentId: 'd1',
      docType: null,
      docTitle: null,
      unitId: null,
      unitCode: null,
      noAmountLevels: 1,
      active: true,
      version: 2,
      isDefault: true,
      levels: [
        {
          level: 1,
          threshold: '0',
          approverRoleId: 'r1',
          approverRoleName: 'Department Manager',
          approverUserId: null,
          approverUserName: null,
          slaHours: 48,
          escalateRoleId: 'r2',
          escalateRoleName: 'Department Head',
          escalateUserId: null,
          escalateUserName: null,
        },
        {
          level: 2,
          threshold: '50000',
          approverRoleId: 'r2',
          approverRoleName: 'Department Head',
          approverUserId: null,
          approverUserName: null,
          slaHours: 48,
          escalateRoleId: null,
          escalateRoleName: null,
          escalateUserId: null,
          escalateUserName: null,
        },
      ],
    },
  ];
  const routes = {
    'GET /api/v1/approval-matrix': () => json(200, { data: sets }),
    'GET /api/v1/meta/departments': () => json(200, { data: ['Purchase', 'Sales'] }),
    'GET /api/v1/units': () => json(200, { data: [] }),
    'GET /api/v1/roles': () =>
      json(200, {
        data: [
          {
            id: 'r1',
            code: 'DEPT_MANAGER',
            name: 'Department Manager',
            level: 50,
            userCount: 1,
            canManage: false,
          },
          {
            id: 'r2',
            code: 'DEPT_HEAD',
            name: 'Department Head',
            level: 60,
            userCount: 1,
            canManage: false,
          },
        ],
      }),
  };

  it('shows the matrix (Department / Level / Threshold / Approver), not a list of requests', async () => {
    signedIn(owner, {
      ...routes,
      'GET /api/v1/me/permissions': permissionsRoute({ view: true, controls: true }),
    });
    renderApp('/m/admin-approval');
    await screen.findByRole('heading', { name: 'Approval Matrix' });
    const head = within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(head).toEqual([
      'Department',
      'Document',
      'Unit',
      'Level',
      'Threshold (₹)',
      'Approver',
      'SLA (h)',
      'Escalate to',
      'Actions',
    ]);
    expect(await screen.findByText('₹ 50,000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Approval Center' })).toHaveAttribute(
      'href',
      '/approvals',
    );
  });

  it('is read-only without "controls"', async () => {
    signedIn(owner, { ...routes, 'GET /api/v1/me/permissions': permissionsRoute({ view: true }) });
    renderApp('/m/admin-approval');
    await screen.findByRole('heading', { name: 'Approval Matrix' });
    await screen.findByText('₹ 50,000');
    expect(screen.queryByRole('button', { name: /Add Rule Set/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit set/ })).toBeNull();
  });

  it('shows the server error for a gap inline in the dialog', async () => {
    signedIn(owner, {
      ...routes,
      'GET /api/v1/me/permissions': permissionsRoute({ view: true, controls: true }),
      'PUT /api/v1/approval-matrix/sets': () =>
        apiError(
          422,
          'MATRIX_LEVEL_GAP',
          'Levels must run 1, 2, 3… without gaps. Level 2 is missing.',
          {
            level2: 'Level 2 is missing.',
          },
        ),
    });
    renderApp('/m/admin-approval');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: /Add Rule Set/ }));
    const dialog = screen.getByRole('dialog');
    await ue.selectOptions(within(dialog).getByLabelText('Department *'), 'Purchase');
    await ue.selectOptions(within(dialog).getByLabelText('Level 1 approver'), 'Department Manager');
    await ue.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('Levels must run 1, 2, 3… without gaps. Level 2 is missing.'),
    ).toBeInTheDocument();
  });
});

describe('Notification Center', () => {
  const prefs = [
    {
      type: 'APPROVAL_ASSIGNED',
      label: 'Approval waiting for me',
      description: 'A request needs your decision.',
      group: 'Approvals',
      inApp: true,
      inAppLocked: true,
      email: 'INSTANT',
    },
    {
      type: 'APPROVAL_DECIDED',
      label: 'My request was decided',
      description: 'Decided.',
      group: 'Approvals',
      inApp: true,
      inAppLocked: false,
      email: 'INSTANT',
    },
  ];

  it('lists notifications with chips and saves preferences; APPROVAL_ASSIGNED in-app is locked on', async () => {
    let saved: unknown = null;
    signedIn(owner, {
      'GET /api/v1/notifications': () =>
        json(200, {
          data: [
            {
              id: 'n1',
              type: 'APPROVAL_ASSIGNED',
              severity: 'ACTION',
              title: 'PO 1 needs your approval',
              body: 'Level 1 of 2',
              link: '/approvals?request=req-1',
              entityType: 'ApprovalRequest',
              entityId: 'req-1',
              createdAt: '2026-11-06T04:30:00.000Z',
              readAt: null,
            },
          ],
          meta: { page: 1, size: 20, total: 1, unread: 1 },
        }),
      'GET /api/v1/notification-preferences': () => json(200, { data: prefs }),
      'PUT /api/v1/notification-preferences': (call) => {
        saved = call.body;
        return json(200, {
          data: prefs.map((p) => (p.type === 'APPROVAL_DECIDED' ? { ...p, email: 'DIGEST' } : p)),
        });
      },
    });
    renderApp('/m/notifications');
    const ue = userEvent.setup();
    await screen.findByRole('heading', { name: 'Notification Center' });
    expect(await screen.findByText('PO 1 needs your approval')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['Unread (1)', 'Approvals', 'System']),
    );
    await ue.click(screen.getByRole('tab', { name: 'Preferences' }));
    const locked = await screen.findByLabelText('In-app: Approval waiting for me');
    expect(locked).toBeDisabled();
    expect(locked).toBeChecked();
    await ue.selectOptions(screen.getByLabelText('Email: My request was decided'), 'DIGEST');
    await ue.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByText('Notification preferences saved.')).toBeInTheDocument();
    expect(saved).toEqual({
      items: [
        { type: 'APPROVAL_ASSIGNED', inApp: true, email: 'INSTANT' },
        { type: 'APPROVAL_DECIDED', inApp: true, email: 'DIGEST' },
      ],
    });
    expect(screen.getByLabelText('Email: My request was decided')).toHaveValue('DIGEST');
  });
});
