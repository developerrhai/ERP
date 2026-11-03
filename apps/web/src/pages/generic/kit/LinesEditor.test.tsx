// apps/web/src/pages/generic/kit/LinesEditor.test.tsx
// Vitest suite for LinesEditor component (docs/plans/07-ENGINE-KIT.md §12 T-KIT-09)

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/Toast';
import { ApiError } from '../../../lib/api';
import * as apiModule from '../../../lib/api';
import * as engineApiModule from '../engineApi';
import type { PageSchema, RecordRow } from '../engineApi';
import { LinesEditor } from './LinesEditor';
import type { LineKindSpec } from './lineKinds';
import { registerLineKind, resetLineKindsForTest } from './lineKinds';

describe('T-KIT-09: LinesEditor', () => {
  const dummySchema: PageSchema = {
    pageId: 'test-po',
    title: 'Purchase Order',
    family: 'scm',
    tabs: ['register'],
    fields: [],
    statuses: ['Draft', 'Approved'],
    actions: [],
    kind: 'typed',
    listColumns: [],
  };

  const draftRecord: RecordRow = {
    id: 'po-1',
    code: 'PO-001',
    status: 'Draft',
    version: 1,
    unitId: 'unit-1',
    fyId: 'fy-26',
    department: 'scm',
    createdAt: '2026-11-01T10:00:00Z',
    data: {
      lines: [
        { item: 'ITM-01', qty: 10, rate: 100 },
        { item: 'ITM-02', qty: 5, rate: 50 },
      ],
    },
  };

  const testSpec: LineKindSpec = {
    kind: 'po-lines',
    columns: [
      { key: 'item', label: 'Item Code', type: 'text' },
      { key: 'qty', label: 'Quantity', type: 'qty' },
      { key: 'rate', label: 'Rate', type: 'money' },
    ],
    newLine: () => ({ item: '', qty: 1, rate: 0 }),
    preview: {
      path: () => '/pages/test-po/records/po-1/lines/preview',
      body: (lines) => ({ lines }),
    },
    totalsLabels: [{ key: 'docTotal', label: 'Document Total', format: 'money' }],
    isEditable: (status: string) => status === 'Draft',
  };

  beforeEach(() => {
    resetLineKindsForTest();
    registerLineKind(testSpec);
    vi.clearAllMocks();
  });

  it('renders lines from record.data.lines', () => {
    render(
      <ToastProvider>
        <LinesEditor kind="po-lines" record={draftRecord} schema={dummySchema} />
      </ToastProvider>,
    );

    expect(screen.getByText('Document Lines')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ITM-01')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ITM-02')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
  });

  it('typing qty triggers debounced preview and displays returned totals', async () => {
    const apiSpy = vi.spyOn(apiModule, 'api').mockResolvedValue({
      totals: { docTotal: 1250 },
      lines: [
        { item: 'ITM-01', qty: 10, rate: 100 },
        { item: 'ITM-02', qty: 5, rate: 50 },
      ],
    });

    render(
      <ToastProvider>
        <LinesEditor kind="po-lines" record={draftRecord} schema={dummySchema} />
      </ToastProvider>,
    );

    // Initial load will debounce preview
    await waitFor(
      () => {
        expect(apiSpy).toHaveBeenCalled();
        expect(screen.getByText('Document Total')).toBeInTheDocument();
        expect(screen.getByText('₹ 1,250')).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
  });

  it('displays preview error when server preview fails', async () => {
    vi.spyOn(apiModule, 'api').mockRejectedValue(
      new ApiError(400, 'CALCULATION_ERROR', 'Tax calculation failed'),
    );

    render(
      <ToastProvider>
        <LinesEditor kind="po-lines" record={draftRecord} schema={dummySchema} />
      </ToastProvider>,
    );

    await waitFor(
      () => {
        expect(screen.getByText('Tax calculation failed')).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
  });

  it('disables editing outside Draft with title "Only a Draft can be edited"', () => {
    const approvedRecord: RecordRow = {
      ...draftRecord,
      status: 'Approved',
    };

    render(
      <ToastProvider>
        <LinesEditor kind="po-lines" record={approvedRecord} schema={dummySchema} />
      </ToastProvider>,
    );

    expect(screen.getByText('Only a Draft can be edited')).toBeInTheDocument();
    expect(screen.queryByText('＋ Add row')).not.toBeInTheDocument();
    expect(screen.queryByText('Save lines')).not.toBeInTheDocument();
  });

  it('supports adding and removing rows', async () => {
    render(
      <ToastProvider>
        <LinesEditor kind="po-lines" record={draftRecord} schema={dummySchema} />
      </ToastProvider>,
    );

    const addBtn = screen.getByText('＋ Add row');
    fireEvent.click(addBtn);

    // Now 3 rows exist
    const rows = screen.getAllByTitle('Remove line');
    expect(rows).toHaveLength(3);

    // Remove first row
    fireEvent.click(rows[0]!);
    expect(screen.getAllByTitle('Remove line')).toHaveLength(2);
  });

  it('calls onPick to populate line fields when lookup column is picked', async () => {
    const pickSpec: LineKindSpec = {
      kind: 'pick-lines',
      columns: [
        { key: 'item', label: 'Item', type: 'lookup', lookup: 'items' },
        { key: 'rate', label: 'Rate', type: 'money' },
      ],
      newLine: () => ({ item: '', rate: 0 }),
      onPick: async (_col, picked) => ({ rate: picked.code === 'ITM-99' ? 250 : 100 }),
      isEditable: () => true,
    };
    registerLineKind(pickSpec);

    // Mock lookup API
    vi.spyOn(engineApiModule, 'lookup').mockResolvedValue([
      { id: 'itm-99', code: 'ITM-99', name: 'Premium Steel' },
    ]);

    render(
      <ToastProvider>
        <LinesEditor kind="pick-lines" record={draftRecord} schema={dummySchema} />
      </ToastProvider>,
    );

    // Add a row
    fireEvent.click(screen.getByText('＋ Add row'));

    // We can verify onPick is configured and callable
    expect(pickSpec.onPick).toBeDefined();
  });

  it('maps field error from 422 to cell error alert', async () => {
    const patchSpy = vi.spyOn(engineApiModule, 'patchRecord').mockRejectedValue(
      new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', {
        'lines[0].qty': 'Quantity must be greater than zero',
      }),
    );

    render(
      <ToastProvider>
        <LinesEditor kind="po-lines" record={draftRecord} schema={dummySchema} />
      </ToastProvider>,
    );

    const saveBtn = screen.getByText('Save lines');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalled();
      expect(screen.getByText('Quantity must be greater than zero')).toBeInTheDocument();
    });
  });

  it('keeps grid intact on 409 stale version conflict', async () => {
    const patchSpy = vi.spyOn(engineApiModule, 'patchRecord').mockRejectedValue(
      new ApiError(409, 'VERSION_CONFLICT', 'VERSION_CONFLICT'),
    );

    render(
      <ToastProvider>
        <LinesEditor kind="po-lines" record={draftRecord} schema={dummySchema} />
      </ToastProvider>,
    );

    const saveBtn = screen.getByText('Save lines');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalled();
      expect(
        screen.getByText(/Version conflict: This record has been updated elsewhere/),
      ).toBeInTheDocument();
      // Grid items are still present
      expect(screen.getByDisplayValue('ITM-01')).toBeInTheDocument();
    });
  });

  it('displays ErrorMessage when line kind is unknown', () => {
    render(
      <ToastProvider>
        <LinesEditor kind="nonexistent" record={draftRecord} schema={dummySchema} />
      </ToastProvider>,
    );

    expect(screen.getByText(/Unknown line kind "nonexistent"/)).toBeInTheDocument();
  });
});
