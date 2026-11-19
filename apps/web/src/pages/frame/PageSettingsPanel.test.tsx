import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageSettingsPanel } from './PageSettingsPanel';
import { hiddenOf, registerColumns, setHiddenColumns } from '../../lib/pageSettings';

const put = vi.fn();
vi.mock('../../components/Toast', () => ({ useToast: () => vi.fn() }));
vi.mock('../../lib/api', async (orig) => {
  const mod = await orig<typeof import('../../lib/api')>();
  return {
    ...mod,
    api: vi.fn((path: string, opts?: { method?: string; body?: { values?: string[] } }) => {
      if (path === '/settings/lists' && !opts?.method)
        return Promise.resolve({ item: ['Bolt'], category: [], vendor: ['Acme'], manufacturer: [] });
      if (path.startsWith('/settings/lists/')) {
        put(path, opts?.body?.values);
        return Promise.resolve({ item: ['Bolt'], category: [], vendor: opts?.body?.values ?? [], manufacturer: [] });
      }
      return Promise.resolve({ hidden: {} });
    }),
  };
});

describe('page Settings tab', () => {
  beforeEach(() => {
    put.mockClear();
    setHiddenColumns('t-page', []);
    registerColumns('t-page', [
      { key: 'a', label: 'Alpha' },
      { key: 'b', label: 'Beta' },
    ]);
  });

  it('hides and shows columns, but never all of them', () => {
    render(<PageSettingsPanel pageId="t-page" />);
    fireEvent.click(screen.getByLabelText('Beta'));
    expect(hiddenOf('t-page')).toEqual(['b']);
    fireEvent.click(screen.getByLabelText('Alpha')); // would hide the last visible column: refused
    expect(hiddenOf('t-page')).toEqual(['b']);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(hiddenOf('t-page')).toEqual([]);
  });

  it('adds a vendor, refuses a duplicate and a blank name', async () => {
    render(<PageSettingsPanel pageId="t-page" />);
    await screen.findByText('Acme');
    const box = screen.getByLabelText('New vendor');
    fireEvent.change(box, { target: { value: '  acme ' } });
    fireEvent.click(screen.getAllByRole('button', { name: '＋ Add' })[2]!);
    expect(await screen.findByText(/already in the list/)).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'Zenith Steel' } });
    fireEvent.click(screen.getAllByRole('button', { name: '＋ Add' })[2]!);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/settings/lists/vendor', ['Acme', 'Zenith Steel']));
  });
});
