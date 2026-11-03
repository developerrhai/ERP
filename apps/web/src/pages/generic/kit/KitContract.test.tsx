// apps/web/src/pages/generic/kit/KitContract.test.tsx
// Contract test: mounts GenericModulePage with kit test fixture and verifies tabs, panels, command bar, print menu (docs/plans/07-ENGINE-KIT.md §12 T-KIT-12)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GenericModulePage } from '../GenericModulePage';
import * as engineApi from '../engineApi';
import * as kitApi from './kitApi';
import { mockKitTestSchema, mockRecords } from './kit.fixture';

// Mock context hook
vi.mock('../../../lib/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/context')>();
  const ctxData = {
    company: { id: 'co-1', code: 'SAWANT', tradeName: 'Sawant Group' },
    units: [{ id: 'unit-1', code: 'TAL', name: 'Talwandi' }],
    allUnitsAllowed: true,
    fys: [
      { id: 'fy-2026', code: '2025-26', label: 'FY 2025-26', status: 'OPEN', isCurrent: true },
    ],
    current: { unitId: 'unit-1', fyId: 'fy-2026' },
  };
  return {
    ...actual,
    useAppContext: () => ({
      status: 'ready',
      data: ctxData,
      current: ctxData.current,
      user: {
        id: 'usr-1',
        name: 'Test Owner',
        role: 'OWNER',
        roleLabel: 'Owner',
        department: 'Quality',
      },
      activeUnitId: 'unit-1',
      activeFyId: 'fy-2026',
      units: ctxData.units,
      financialYears: ctxData.fys,
      permissions: {
        can: () => true,
      },
    }),
  };
});

describe('T-KIT-12 — Web Kit Contract Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(engineApi, 'getSchema').mockResolvedValue(mockKitTestSchema);
    vi.spyOn(engineApi, 'listRecords').mockResolvedValue({
      rows: mockRecords,
      meta: { page: 1, size: 20, total: 1 },
    });
    vi.spyOn(engineApi, 'getRecord').mockResolvedValue(mockRecords[0]!);

    vi.spyOn(kitApi, 'getPanel').mockImplementation(async (_pageId, key) => {
      if (key === 'kpis') {
        return {
          key: 'kpis',
          title: 'Overall KPIs',
          kpis: [{ label: 'Total Audited', value: 42, format: 'number' }],
          sections: [],
        };
      }
      if (key === 'board') {
        return {
          key: 'board',
          title: 'Issue Board',
          sections: [
            {
              type: 'board',
              draggable: true,
              lanes: [
                {
                  key: 'Draft',
                  label: 'Draft Lane',
                  cards: [{ id: 'card-1', title: 'Bearing Defect' }],
                },
              ],
            },
          ],
        };
      }
      return {
        key,
        title: 'Empty Panel',
        sections: [],
      };
    });
  });

  const mockUser = {
    id: 'usr-1',
    name: 'Test Owner',
    loginId: 'owner@sawant.com',
    email: 'owner@sawant.com',
    role: 'ADMIN' as const,
    roleLabel: 'Admin',
    roleLevel: 10,
    department: 'Quality',
    status: 'ACTIVE' as const,
    mustChangePassword: false,
    lastLoginAt: null,
    version: 1,
    createdAt: '2026-11-04T00:00:00Z',
    updatedAt: '2026-11-04T00:00:00Z',
  };

  const mockPerms = {
    view: true,
    add: true,
    edit: true,
    delete: true,
    approve: true,
    export: true,
    controls: true,
  };

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/m/kit-test']}>
        <Routes>
          <Route
            path="/m/:pageId"
            element={
              <GenericModulePage
                pageId="kit-test"
                user={mockUser}
                perms={mockPerms}
                fallback={<div>Fallback</div>}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('1. renders full module header, custom tabs, command bar, and print menu', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Kit Test Fixture Page')).toBeDefined();
    });

    // Verify Tab strip has all tabs from schema
    expect(screen.getByRole('tab', { name: 'Register' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Metrics' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Kanban' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Lines' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'History' })).toBeDefined();

    // Verify CommandBar rendered command button
    expect(screen.getByRole('button', { name: 'Recalculate All' })).toBeDefined();

    // Verify PrintMenu rendered page-scoped print button
    expect(screen.getByRole('button', { name: 'Print ▾' })).toBeDefined();
  });

  it('2. switching to Metrics tab renders PanelView with KPIs', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Metrics' })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Metrics' }));

    await waitFor(() => {
      expect(screen.getByText('Total Audited')).toBeDefined();
      expect(screen.getByText('42')).toBeDefined();
    });
  });

  it('3. switching to Kanban tab renders board section', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Kanban' })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Kanban' }));

    await waitFor(() => {
      expect(screen.getByText('Draft Lane')).toBeDefined();
      expect(screen.getByText('Bearing Defect')).toBeDefined();
    });
  });

  it('4. clicking command button opens PayloadDialog with multiplier field', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Recalculate All' })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Recalculate All' }));

    await waitFor(() => {
      expect(screen.getByText('Multiplier')).toBeDefined();
    });
  });
});
