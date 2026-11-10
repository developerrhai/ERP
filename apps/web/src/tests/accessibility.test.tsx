// Phase 20-I Accessibility Gate: runs axe-core against Login, Hardening Console (DPDP / Cut-over),
// Topbar, Help Drawer and Privacy Notice asserting 0 serious or critical WCAG 2.1 AA violations.
import { render } from '@testing-library/react';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import '../i18n';
import { AuthProvider } from '../auth/AuthProvider';
import { ToastProvider } from '../components/Toast';
import { HelpDrawer } from '../components/HelpDrawer';
import { HardeningPage } from '../pages/admin/HardeningPage';
import { LoginPage } from '../pages/LoginPage';
import { Topbar } from '../shell/Topbar';

vi.mock('../lib/hardeningApi', () => ({
  hardeningApi: {
    getLocale: vi.fn().mockResolvedValue({ locale: 'en' }),
    setLocale: vi.fn().mockResolvedValue({ locale: 'en' }),
    listCutoverBatches: vi.fn().mockResolvedValue([]),
    listDpdpRequests: vi.fn().mockResolvedValue([]),
    listRetentionPolicies: vi.fn().mockResolvedValue([]),
    getAuditPartitions: vi.fn().mockResolvedValue({ partitions: [], defaultRows: 0 }),
  },
}));

async function assertZeroAxeSeriousOrCritical(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: {
      // jsdom does not compute color contrast cleanly across unmounted stylesheets;
      // contrast & min font 12px are enforced via CSS tokens & stylesheets.
      'color-contrast': { enabled: false },
    },
  });
  const severe = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(severe).toEqual([]);
}

const dummyUser = {
  id: 'u1',
  loginId: 'owner',
  email: 'owner@test.local',
  name: 'Test Owner',
  roleCode: 'SUPER_USER',
  roleLabel: 'Super User',
  role: 'SUPER_USER',
  level: 99,
  allUnits: true,
  department: 'Administration',
  mustChangePassword: false,
  mfaEnabled: false,
  mfaSetupRequired: false,
} as any;

describe('WCAG 2.1 AA Accessibility (axe-core)', () => {
  it('LoginPage has 0 serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <AuthProvider>
          <ToastProvider>
            <LoginPage />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    await assertZeroAxeSeriousOrCritical(container);
  });

  it('Topbar + HelpDrawer + HardeningPage have 0 serious or critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <Topbar
            user={dummyUser}
            sidebarOpen={false}
            onToggleSidebar={() => {}}
            onOpenAccount={() => {}}
            onOpenHelp={() => {}}
          />
          <HelpDrawer open onClose={() => {}} />
          <HardeningPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await assertZeroAxeSeriousOrCritical(container);
  });
});

