// Phase 21 PWA, Realtime Bell, Broadcast Banner/Ack & Notification Prefs Frontend Tests
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BroadcastBannerHost } from '../components/BroadcastBannerHost';
import { ToastProvider } from '../components/Toast';
import { NotificationPrefsPage } from '../pages/notifications/NotificationPrefsPage';
import { RT_EVENT_BADGE } from '../lib/realtime';
import { NotificationBell } from '../shell/NotificationBell';
import { sanitizeSameOriginUrl } from '../sw';
import { pwaPluginOptions } from '../lib/pwaManifest';

const mockUnread = vi.fn().mockResolvedValue(2);
const mockListNotif = vi.fn().mockResolvedValue({ rows: [], total: 0, unread: 2 });
const mockActiveBroadcasts = vi.fn();
const mockAckBroadcast = vi.fn();
const mockGetPrefs = vi.fn();
const mockGetSettings = vi.fn();
const mockListDevices = vi.fn();

vi.mock('../lib/approvalsApi', async (orig) => {
  const actual = await orig<any>();
  return {
    ...actual,
    getUnreadCount: () => mockUnread(),
    listNotifications: (q: any) => mockListNotif(q),
    markNotificationRead: vi.fn().mockResolvedValue({}),
    markAllNotificationsRead: vi.fn().mockResolvedValue(2),
  };
});

vi.mock('../lib/phase21Api', async (orig) => {
  const actual = await orig<any>();
  return {
    ...actual,
    phase21Api: {
      ...actual.phase21Api,
      listActiveBroadcasts: () => mockActiveBroadcasts(),
      acknowledgeBroadcast: (id: string) => mockAckBroadcast(id),
      getMyPrefs: () => mockGetPrefs(),
      getMySettings: () => mockGetSettings(),
      listMyDevices: () => mockListDevices(),
    },
  };
});

describe('Phase 21 PWA, Realtime Bell, Broadcast & Preferences UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUnread.mockResolvedValue(2);
    mockListNotif.mockResolvedValue({ rows: [], total: 0, unread: 2 });
    mockActiveBroadcasts.mockResolvedValue([]);
    mockAckBroadcast.mockResolvedValue({ ok: true });
    mockGetSettings.mockResolvedValue({
      quietStart: '22:00',
      quietEnd: '07:00',
      quietCustomised: false,
      digestEnabled: true,
      language: 'en',
      softAskDismissedAt: null,
    });
    mockListDevices.mockResolvedValue([]);
  });

  it('PWA manifest configures standalone display, start_url /?source=pwa & prompt updates, and SW click rejects external redirect', () => {
    expect(pwaPluginOptions.manifest.start_url).toBe('/?source=pwa');
    expect(pwaPluginOptions.manifest.display).toBe('standalone');
    expect(pwaPluginOptions.registerType).toBe('prompt');
    expect(pwaPluginOptions.strategies).toBe('injectManifest');
    expect(pwaPluginOptions.manifest.shortcuts.length).toBeGreaterThanOrEqual(4);

    // Open redirect guard in sw.ts
    expect(sanitizeSameOriginUrl('https://evil.example/phish', 'https://erp.sawant.local')).toBe(
      'https://erp.sawant.local/notifications',
    );
    expect(sanitizeSameOriginUrl('/approvals?id=1', 'https://erp.sawant.local')).toBe('/approvals?id=1');
  });

  it('NotificationBell updates badge count live on SSE badge event and renders All/Approvals/Alerts/Announcements tabs', async () => {
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    const badge = await screen.findByTestId('bell-badge');
    expect(badge.textContent).toBe('2');

    // Simulate live SSE badge event
    window.dispatchEvent(new CustomEvent(RT_EVENT_BADGE, { detail: { unread: 105 } }));
    await waitFor(() => expect(screen.getByTestId('bell-badge').textContent).toBe('99+'));

    // Open drawer and check §7 tabs
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(await screen.findByRole('tab', { name: 'All' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Approvals' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Alerts' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Announcements' })).toBeTruthy();
  });

  it('BroadcastBannerHost displays pinned banner and blocking ack modal until user clicks "I have read this"', async () => {
    mockActiveBroadcasts.mockResolvedValue([
      {
        id: 'brc-1',
        number: 'BRC-001',
        title: 'Plant Gate Relocation',
        body_md: 'Use Gate 2 starting Monday.',
        severity: 'CRITICAL',
        pin_banner: true,
        require_ack: true,
        sent_at: new Date().toISOString(),
        expires_at: null,
        read_at: null,
        acked_at: null,
      },
    ]);

    render(
      <MemoryRouter>
        <BroadcastBannerHost />
      </MemoryRouter>,
    );

    const ackBtn = await screen.findByRole('button', { name: 'I have read this' });
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(ackBtn);
    await waitFor(() => expect(mockAckBroadcast).toHaveBeenCalledWith('brc-1'));
  });

  it('NotificationPrefsPage enforces mandatory In-App lock and renders Push soft-ask card', async () => {
    mockGetPrefs.mockResolvedValue([
      {
        code: 'APPROVAL_ASSIGNED',
        module: 'Approvals',
        category: 'APPROVAL',
        label: 'Approval waiting for me',
        labelHi: 'अनुमोदन लंबित है',
        priority: 'HIGH',
        enabled: true,
        digestAllowed: true,
        channels: {
          IN_APP: { allowed: true, mandatory: true, enabled: true, mode: 'IMMEDIATE' },
          PUSH: { allowed: true, mandatory: false, enabled: true, mode: 'IMMEDIATE' },
          EMAIL: { allowed: true, mandatory: false, enabled: true, mode: 'IMMEDIATE' },
          SMS: { allowed: false, mandatory: false, enabled: false, mode: 'IMMEDIATE' },
        },
      },
    ]);

    render(
      <MemoryRouter>
        <ToastProvider>
          <NotificationPrefsPage />
        </ToastProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Approval waiting for me')).toBeTruthy();
    expect(screen.getByText('🔒 Always')).toBeTruthy();
    expect(screen.getByText(/Enable instant approval & breakdown alerts/i)).toBeTruthy();
  });
});

