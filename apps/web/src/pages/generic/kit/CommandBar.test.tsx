// apps/web/src/pages/generic/kit/CommandBar.test.tsx
// Unit tests for CommandBar component (docs/plans/07-ENGINE-KIT.md §12 T-KIT-10)

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/Toast';
import type { ActionSet } from '../../../types';
import type { PageSchema } from '../engineApi';
import { CommandBar } from './CommandBar';
import * as kitApiModule from './kitApi';

describe('T-KIT-10: CommandBar', () => {
  const dummySchema: PageSchema = {
    pageId: 'qms-insp',
    title: 'Inspection',
    family: 'quality',
    tabs: ['register'],
    fields: [],
    statuses: ['Open'],
    actions: [],
    kind: 'typed',
    listColumns: [],
    commands: [
      { key: 'reopen', label: 'Reopen All', requires: 'edit', confirm: 'Reopen all inspections?' },
      { key: 'recalc', label: 'Recalculate Stats', requires: 'approve' },
      {
        key: 'bulkAssign',
        label: 'Bulk Assign',
        requires: 'edit',
        fields: [{ key: 'inspector', label: 'Inspector', type: 'text', required: true }],
      },
    ],
  };

  const memberPerms: ActionSet = {
    view: true,
    add: true,
    edit: true,
    delete: false,
    approve: false,
    export: true,
    controls: false,
    submit: true,
    post: false,
    cancel: false,
    print: true,
    import: false,
  };

  const managerPerms: ActionSet = {
    ...memberPerms,
    approve: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides commands when user does not have requires permission', () => {
    render(
      <ToastProvider>
        <CommandBar schema={dummySchema} perms={memberPerms} />
      </ToastProvider>,
    );

    // Member has 'edit' but not 'approve'
    expect(screen.getByText('Reopen All')).toBeInTheDocument();
    expect(screen.getByText('Bulk Assign')).toBeInTheDocument();
    expect(screen.queryByText('Recalculate Stats')).not.toBeInTheDocument();
  });

  it('shows approve command when user has approve permission', () => {
    render(
      <ToastProvider>
        <CommandBar schema={dummySchema} perms={managerPerms} />
      </ToastProvider>,
    );

    expect(screen.getByText('Recalculate Stats')).toBeInTheDocument();
  });

  it('opens confirmation modal when command has confirm message', async () => {
    const runSpy = vi.spyOn(kitApiModule, 'runCommand').mockResolvedValue({ message: 'Reopened.' });
    render(
      <ToastProvider>
        <CommandBar schema={dummySchema} perms={memberPerms} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Reopen All'));

    expect(screen.getByText('Reopen all inspections?')).toBeInTheDocument();

    // Confirm execution
    const confirmBtn = screen.getAllByRole('button', { name: 'Reopen All' })[1]!;
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(runSpy).toHaveBeenCalledWith('qms-insp', 'reopen', undefined, expect.any(String));
    });
  });

  it('opens PayloadDialog when command has fields', async () => {
    render(
      <ToastProvider>
        <CommandBar schema={dummySchema} perms={memberPerms} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Bulk Assign'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Inspector/)).toBeInTheDocument();
  });
});
