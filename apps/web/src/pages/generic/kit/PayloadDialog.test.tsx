// apps/web/src/pages/generic/kit/PayloadDialog.test.tsx
// Unit tests for PayloadDialog component (docs/plans/07-ENGINE-KIT.md §12 T-KIT-10)

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api';
import type { PayloadField } from '../engineApi';
import { PayloadDialog } from './PayloadDialog';

describe('T-KIT-10: PayloadDialog', () => {
  const fields: PayloadField[] = [
    { key: 'reason', label: 'Reason', type: 'text', required: true },
    { key: 'priority', label: 'Priority', type: 'enum', required: false, options: ['Low', 'High'] },
    { key: 'item', label: 'Material', type: 'lookup', lookup: 'items', required: false },
    { key: 'qty', label: 'Quantity', type: 'qty', required: false, min: 1, max: 100 },
  ];

  it('validates required fields client-side before submit', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PayloadDialog
        title="Discard Material"
        fields={fields}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    // Click submit without entering required "reason"
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Reason is required.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('validates min and max on number fields', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PayloadDialog
        title="Discard Material"
        fields={fields}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Defective batch' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Quantity cannot exceed 100.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders enum dropdown and lookup combobox properly', () => {
    render(
      <PayloadDialog title="Sample Dialog" fields={fields} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );

    expect(screen.getByLabelText(/Priority/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search items/)).toBeInTheDocument();
  });

  it('submits parsed payload on valid input', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <PayloadDialog
        title="Discard Material"
        fields={fields}
        confirmText="Confirm Discard"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Out of spec' } });
    fireEvent.change(screen.getByLabelText(/Priority/), { target: { value: 'High' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '45' } });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Discard' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        reason: 'Out of spec',
        priority: 'High',
        qty: 45,
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('places server field errors from 422 under the respective inputs', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', {
        'payload.reason': 'Reason must not contain profane words',
      }),
    );

    render(
      <PayloadDialog
        title="Discard Material"
        fields={fields}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Bad word' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('Reason must not contain profane words');
    });
  });
});
