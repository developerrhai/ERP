// apps/web/src/pages/generic/kit/PrintMenu.test.tsx
// Tests for PrintMenu component (docs/plans/07-ENGINE-KIT.md §2.9, §12 T-KIT-11)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PrintMenu } from './PrintMenu';
import { resetPrintTemplatesForTest } from './printRegistry';

describe('PrintMenu', () => {
  beforeEach(() => {
    resetPrintTemplatesForTest();
    vi.restoreAllMocks();
  });

  it('1. does not render anything when no visible templates are available', () => {
    const { container } = render(<PrintMenu pageId="test-page" templates={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('2. renders button and opens dropdown menu listing templates', () => {
    const templates = [
      { key: 't1', label: 'Inspection Report', kind: 'web' as const, scope: 'record' as const },
      { key: 't2', label: 'Certificate PDF', kind: 'pdf' as const, scope: 'record' as const },
    ];

    render(<PrintMenu pageId="test-page" recordId="rec-1" templates={templates} />);

    const button = screen.getByRole('button', { name: 'Print ▾' });
    expect(button).toBeDefined();

    // Dropdown initially closed
    expect(screen.queryByRole('menuitem', { name: /Inspection Report/ })).toBeNull();

    // Click to open
    fireEvent.click(button);

    expect(screen.getByRole('menuitem', { name: /Inspection Report/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /Certificate PDF/ })).toBeDefined();
  });

  it('3. clicking a PDF template opens window with PDF url', () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const templates = [
      { key: 'cert-pdf', label: 'Certificate PDF', kind: 'pdf' as const, scope: 'record' as const },
    ];

    render(<PrintMenu pageId="test-page" recordId="rec-123" templates={templates} />);

    fireEvent.click(screen.getByRole('button', { name: 'Print ▾' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Certificate PDF/ }));

    expect(windowOpenSpy).toHaveBeenCalledWith(
      '/api/v1/pages/test-page/records/rec-123/pdf/cert-pdf',
      '_blank',
    );
  });

  it('4. clicking a web template fetches data and renders PrintLayout', async () => {
    const mockPrintDto = {
      templateKey: 'custom-web',
      title: 'Custom Inspection Sheet',
      docNo: 'INS-001',
      docDate: '2026-11-04',
      unit: { code: 'TAL', name: 'Talwandi Unit' },
      letterhead: { companyName: 'Sawant Testing' },
      parties: [],
      facts: [{ label: 'Priority', value: 'High' }],
      lines: null,
      sections: [],
      totals: [],
      signatures: [],
    };

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: mockPrintDto }),
    } as any);

    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    const templates = [
      {
        key: 'custom-web',
        label: 'Custom Web Sheet',
        kind: 'web' as const,
        scope: 'record' as const,
      },
    ];

    render(<PrintMenu pageId="test-page" recordId="rec-123" templates={templates} />);

    fireEvent.click(screen.getByRole('button', { name: 'Print ▾' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Custom Web Sheet/ }));

    await waitFor(() => {
      expect(screen.getByText('Custom Inspection Sheet')).toBeDefined();
      expect(screen.getByText('Sawant Testing')).toBeDefined();
      expect(screen.getByText('Doc No: INS-001')).toBeDefined();
      expect(printSpy).toBeDefined();
    });
  });
});
