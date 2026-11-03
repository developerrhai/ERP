import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionSet } from '../../../types';
import type { PageSchema, TabPanelRef } from '../engineApi';
import { PanelView } from './PanelView';
import * as kitApi from './kitApi';
import type { PanelDto } from './panelTypes';

const dummySchema: PageSchema = {
  pageId: 'scm-po',
  title: 'Purchase Orders',
  family: 'procurement',
  fields: [],
  tabs: ['PO Register', 'Item Schedule'],
  statuses: ['Draft', 'Active'],
  actions: [],
  kind: 'typed',
  listColumns: [],
};

const fullPerms: ActionSet = {
  view: true,
  add: true,
  edit: true,
  delete: true,
  approve: true,
  export: true,
  controls: true,
};

const pageTab: TabPanelRef = {
  tab: 'Overview',
  key: 'overview',
  scope: 'page',
};

const recordTab: TabPanelRef = {
  tab: 'Item Schedule',
  key: 'item-schedule',
  scope: 'record',
};

describe('PanelView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows placeholder when record scope has no recId', () => {
    render(
      <PanelView
        pageId="scm-po"
        tab={recordTab}
        recId={undefined}
        schema={dummySchema}
        perms={fullPerms}
      />,
    );
    expect(
      screen.getByText('Select a record in the register to see its Item Schedule.'),
    ).toBeInTheDocument();
  });

  it('renders KPIs and basic sections (table, stepper, facts, notice)', async () => {
    const mockPanel: PanelDto = {
      key: 'overview',
      title: 'Procurement Overview',
      subtitle: 'Key indicators and milestones',
      kpis: [
        { label: 'Total Value', value: 50000, format: 'money', hint: '+5% vs last month', tone: 'good' },
        { label: 'Open POs', value: 12, format: 'number' },
      ],
      sections: [
        {
          type: 'notice',
          tone: 'info',
          text: 'Supplier audit scheduled for next Monday.',
        },
        {
          type: 'stepper',
          title: 'Approval Pipeline',
          steps: [
            { label: 'Draft', state: 'done' },
            { label: 'Technical Review', state: 'current' },
            { label: 'Finance Approval', state: 'pending' },
          ],
        },
        {
          type: 'facts',
          title: 'Header Details',
          items: [
            { label: 'Vendor', value: 'Acme Steel Corp' },
            { label: 'Currency', value: 'INR' },
          ],
        },
        {
          type: 'table',
          title: 'Line Items',
          columns: [
            { key: 'item', label: 'Item Name', format: 'text' },
            { key: 'qty', label: 'Quantity', format: 'qty' },
            { key: 'rate', label: 'Rate', format: 'money' },
          ],
          rows: [
            { id: '1', item: 'Steel Rod 12mm', qty: 100, rate: 500 },
          ],
          totals: {
            rate: 500,
          },
        },
      ],
    };

    vi.spyOn(kitApi, 'getPanel').mockResolvedValue(mockPanel);

    render(
      <PanelView
        pageId="scm-po"
        tab={pageTab}
        schema={dummySchema}
        perms={fullPerms}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Procurement Overview' })).toBeInTheDocument();
    });

    // KPI check
    expect(screen.getByText('Total Value')).toBeInTheDocument();
    expect(screen.getByText('₹ 50,000')).toBeInTheDocument();
    expect(screen.getByText('+5% vs last month')).toBeInTheDocument();

    // Notice check
    expect(screen.getByText('Supplier audit scheduled for next Monday.')).toBeInTheDocument();

    // Stepper check
    expect(screen.getByText('Technical Review')).toBeInTheDocument();

    // Facts check
    expect(screen.getByText('Acme Steel Corp')).toBeInTheDocument();

    // Table check
    expect(screen.getByText('Steel Rod 12mm')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('renders table empty state when rows are empty', async () => {
    const mockPanel: PanelDto = {
      key: 'overview',
      title: 'Empty Overview',
      sections: [
        {
          type: 'table',
          columns: [{ key: 'item', label: 'Item', format: 'text' }],
          rows: [],
          empty: 'No items in schedule.',
        },
      ],
    };

    vi.spyOn(kitApi, 'getPanel').mockResolvedValue(mockPanel);

    render(
      <PanelView
        pageId="scm-po"
        tab={pageTab}
        schema={dummySchema}
        perms={fullPerms}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('No items in schedule.')).toBeInTheDocument();
    });
  });

  it('re-requests panel on page change when meta is present', async () => {
    const getPanelMock = vi.spyOn(kitApi, 'getPanel').mockResolvedValue({
      key: 'overview',
      title: 'Paged Overview',
      sections: [
        {
          type: 'table',
          columns: [{ key: 'item', label: 'Item', format: 'text' }],
          rows: [{ id: '1', item: 'Item 1' }],
          meta: { page: 1, size: 10, total: 25 },
        },
      ],
    });

    render(
      <PanelView
        pageId="scm-po"
        tab={pageTab}
        schema={dummySchema}
        perms={fullPerms}
      />,
    );

    await screen.findByText('Item 1');
    expect(getPanelMock).toHaveBeenCalledWith('scm-po', 'overview', { recId: undefined, params: { page: 1 } });

    // Click next page
    const nextBtn = screen.getByRole('button', { name: /Next/i });
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(getPanelMock).toHaveBeenCalledWith('scm-po', 'overview', { recId: undefined, params: { page: 2 } });
    });
  });

  it('runs row action with confirm dialog and triggers onChanged', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const postCallMock = vi.spyOn(kitApi, 'postCall').mockResolvedValue({ ok: true });

    const mockPanel: PanelDto = {
      key: 'overview',
      title: 'Action Overview',
      sections: [
        {
          type: 'table',
          columns: [{ key: 'code', label: 'Code', format: 'text' }],
          rows: [{ id: 'row-1', code: 'PO-001' }],
          rowActions: [
            {
              key: 'cancel',
              label: 'Cancel PO',
              confirm: 'Are you sure you want to cancel PO-001?',
              call: { kind: 'action', name: 'cancel', target: 'row' },
            },
          ],
        },
      ],
    };

    vi.spyOn(kitApi, 'getPanel').mockResolvedValue(mockPanel);

    render(
      <PanelView
        pageId="scm-po"
        tab={pageTab}
        schema={dummySchema}
        perms={fullPerms}
        onChanged={onChanged}
      />,
    );

    const cancelBtn = await screen.findByRole('button', { name: 'Cancel PO' });
    await user.click(cancelBtn);

    // Modal should show
    expect(screen.getByText('Are you sure you want to cancel PO-001?')).toBeInTheDocument();
    const modal = screen.getByRole('dialog');
    const confirmBtn = within(modal).getByRole('button', { name: 'Cancel PO' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(postCallMock).toHaveBeenCalledWith(
        'scm-po',
        { kind: 'action', name: 'cancel', target: 'row' },
        { rowId: 'row-1', recId: undefined, payload: undefined },
      );
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it('renders error message for unknown custom section component', async () => {
    const mockPanel: PanelDto = {
      key: 'overview',
      title: 'Custom Section',
      sections: [
        {
          type: 'custom',
          component: 'NonExistentComponent',
          props: {},
        },
      ],
    };

    vi.spyOn(kitApi, 'getPanel').mockResolvedValue(mockPanel);

    render(
      <PanelView
        pageId="scm-po"
        tab={pageTab}
        schema={dummySchema}
        perms={fullPerms}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Custom component "NonExistentComponent" is not registered/i),
      ).toBeInTheDocument();
    });
  });
});
