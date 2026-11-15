// The V40 tab strip: real tab names, the open tab in the URL, Audit / Approvals tabs with real data, own-layout pages skipped.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../generic/engineApi', () => ({
  listPageAudit: () => Promise.resolve({ rows: [{ id: 'a1', at: '2026-11-14T09:00:00Z', actorName: 'Pia', action: 'SO_CREATED', targetId: 'SO-1' }], meta: { page: 1, size: 20, total: 1 } }),
}));
vi.mock('../../lib/approvalsApi', async (orig) => {
  const real = await orig<typeof import('../../lib/approvalsApi')>();
  return { ...real, getRequests: () => Promise.resolve({ rows: [{ id: 'r1', docCode: 'SO-1', department: 'Sales', amount: '100', currentLevel: 1, totalLevels: 2, waitingOn: 'Head', status: 'PENDING' }], meta: { page: 1, size: 25, total: 1 } }) };
});

import { genericTabFor, tabKind, V40TabFrame, v40TabsFor } from './V40TabFrame';

const TABS = ['Order Register', 'Order Items', 'Approvals', 'Audit Trail'];
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('V40 tab frame', () => {
  it('knows the real V40 tabs of a page, and skips pages that own their layout', () => {
    expect(v40TabsFor('sales-orders')[0]).toBe('Order Register');
    expect(v40TabsFor('sales-orders')).toContain('Audit Trail');
    expect(v40TabsFor('my-approvals')).toEqual([]);
    expect(v40TabsFor('dept-inbox-sales')).toEqual([]);
    expect(v40TabsFor('no-such-page')).toEqual([]);
  });

  it('maps tab names to kinds: first = register, Audit Trail = audit, Approvals = approvals', () => {
    expect(tabKind('Order Register', 0)).toBe('register');
    expect(tabKind('Audit Trail', 3)).toBe('audit');
    expect(tabKind('Approvals', 2)).toBe('approvals');
    expect(tabKind('Delivery Balance', 4)).toBe('register');
    expect(genericTabFor('Analytics & Graphs', 6)).toBe('dashboard');
    expect(genericTabFor('Reports', 9)).toBe('Reports');
    expect(genericTabFor('Whatever', 0)).toBe('register');
  });

  it('shows every tab, the register body on tab 0, real audit rows and real approvals on those tabs', async () => {
    const user = userEvent.setup();
    wrap(
      <V40TabFrame pageId="sales-orders" tabs={TABS}>
        <p>REGISTER BODY</p>
      </V40TabFrame>,
    );
    for (const t of TABS) expect(screen.getByRole('tab', { name: t })).toBeInTheDocument();
    expect(screen.getByText('REGISTER BODY')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Audit Trail' }));
    expect(await screen.findByText('SO_CREATED')).toBeInTheDocument();
    expect(screen.queryByText('REGISTER BODY')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Approvals' }));
    expect(await screen.findByText('PENDING')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Order Items' }));
    await waitFor(() => expect(screen.getByText('REGISTER BODY')).toBeInTheDocument());
  });
});
