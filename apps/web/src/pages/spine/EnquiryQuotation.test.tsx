// An enquiry line has no HSN: Create Quotation asks for the GST % and shows the server's message under the field.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';

const calls: Array<[string, number | undefined]> = [];
let outcome: 'ok' | 'refused' = 'ok';
// a plain function (not vi.fn): vitest's mock bookkeeping reports a rejected promise as unhandled
async function toQuotation(id: string, gst?: number): Promise<unknown> {
  calls.push([id, gst]);
  if (outcome === 'refused') throw new ApiError(422, 'VALIDATION_ERROR', 'Fix', { gstPct: 'No GST rate is known for "Widget".' });
  return {};
}
vi.mock('../../lib/spineApi', async (orig) => {
  const real = await orig<typeof import('../../lib/spineApi')>();
  return {
    ...real,
    spineApi: {
      ...real.spineApi,
      enquiries: () =>
        Promise.resolve([
          { id: 'e1', number: 'ENQ/1', enq_date: '2026-11-01', prospect_name: 'Acme', customer_name: 'Acme', product: 'Widget', qty: '2', status: 'New', project_id: null },
        ]),
      toQuotation,
    },
  };
});

import { SalesEnquiriesPage } from './SpinePages';

beforeEach(() => {
  calls.length = 0;
  outcome = 'ok';
});

describe('Create Quotation from an enquiry', () => {
  it('asks for the GST %, refuses a rate above 28 without calling the API, and sends a valid one', async () => {
    render(<MemoryRouter><SalesEnquiriesPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Create Quotation' }));
    const dialog = screen.getByRole('dialog', { name: 'Create quotation' });
    const input = dialog.querySelector('input') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '40');
    await userEvent.click(dialog.querySelectorAll('button')[1]!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/between 0 and 28/);
    expect(calls).toEqual([]);
    await userEvent.clear(input);
    await userEvent.type(input, '12');
    await userEvent.click(dialog.querySelectorAll('button')[1]!);
    await waitFor(() => expect(calls).toEqual([['e1', 12]]));
  });

  it("shows the server's message when the rate is refused", async () => {
    outcome = 'refused';
    render(<MemoryRouter><SalesEnquiriesPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Create Quotation' }));
    const dialog = screen.getByRole('dialog', { name: 'Create quotation' });
    await userEvent.click(dialog.querySelectorAll('button')[1]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('No GST rate is known for "Widget".');
  });
});
