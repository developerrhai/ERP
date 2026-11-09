import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { json, makeUser, renderApp, signedIn, type Handler } from '../../test/helpers';
import { LEAD_ROWS, LEAD_SCHEMA, recordsHandler } from '../../test/engine-fixtures';
import type { PageSchema } from './engineApi';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const P = '/api/v1/pages/service-tickets';

const DEMO_SCHEMA: PageSchema = {
  ...LEAD_SCHEMA,
  tabPanels: [
    { tab: 'Lead Extra Tab', key: 'lead-extra', scope: 'page' },
    { tab: 'Lead Workspace', key: 'lead-ws', scope: 'record' },
  ],
};

function setup(schema: PageSchema = DEMO_SCHEMA, extra: Record<string, Handler> = {}) {
  return signedIn(owner, {
    [`GET ${P}/schema`]: () => json(200, { data: schema }),
    [`GET ${P}/records`]: recordsHandler(LEAD_ROWS),
    [`GET ${P}/panels/lead-extra`]: () =>
      json(200, {
        data: {
          key: 'lead-extra',
          title: 'Extra Page Panel',
          sections: [{ type: 'notice', tone: 'info', text: 'Live page panel loaded' }],
        },
      }),
    [`GET ${P}/records/r1/panels/lead-ws`]: () =>
      json(200, {
        data: {
          key: 'lead-ws',
          title: 'Lead Workspace Panel',
          sections: [
            { type: 'facts', title: 'Details', items: [{ label: 'Lead Code', value: 'LD-001' }] },
          ],
        },
      }),
    ...extra,
  });
}

beforeEach(() => {
  window.print = vi.fn();
});

describe('GenericModulePage with Engine Kit extensions', () => {
  it('places [ADD] tabs after Audit Trail', async () => {
    setup();
    renderApp('/m/service-tickets');
    await screen.findByRole('heading', { name: 'Service Tickets' });

    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    const tabNames = tabs.map((t) => t.textContent);

    const auditTrailIdx = tabNames.indexOf('Audit Trail');
    const addTabIdx = tabNames.indexOf('Lead Extra Tab');
    const recWsIdx = tabNames.indexOf('Lead Workspace');

    expect(auditTrailIdx).toBeGreaterThan(-1);
    expect(addTabIdx).toBeGreaterThan(auditTrailIdx);
    expect(recWsIdx).toBeGreaterThan(auditTrailIdx);
  });

  it('renders PanelView for declared tabPanels and PhaseNotice for undeclared tabs', async () => {
    setup();
    renderApp('/m/service-tickets');
    await screen.findByRole('heading', { name: 'Service Tickets' });

    // Undeclared profile tab shows PhaseNotice
    const unbuiltTab = screen.getByRole('tab', { name: 'Qualification Desk' });
    fireEvent.click(unbuiltTab);
    expect(await screen.findByText(/This view is built in Phase/i)).toBeInTheDocument();

    // Declared tabPanels tab renders live panel
    const liveTab = screen.getByRole('tab', { name: 'Lead Extra Tab' });
    fireEvent.click(liveTab);
    expect(await screen.findByText('Live page panel loaded')).toBeInTheDocument();
  });

  it('hides ＋ Add button when readOnlyCreate is true', async () => {
    setup({ ...DEMO_SCHEMA, readOnlyCreate: true });
    renderApp('/m/service-tickets');
    await screen.findByRole('heading', { name: 'Service Tickets' });

    expect(screen.queryByRole('button', { name: '＋ Add' })).not.toBeInTheDocument();
  });

  it('shows ＋ Add button when readOnlyCreate is false or omitted', async () => {
    setup({ ...DEMO_SCHEMA, readOnlyCreate: false });
    renderApp('/m/service-tickets');
    await screen.findByRole('heading', { name: 'Service Tickets' });

    expect(screen.getByRole('button', { name: '＋ Add' })).toBeInTheDocument();
  });

  it('shows Open workspace button on rows when record panels exist, navigates with ?rec=', async () => {
    const user = userEvent.setup();
    setup();
    renderApp('/m/service-tickets?tab=Ticket%20Queue');
    await screen.findByRole('heading', { name: 'Service Tickets' });
    await screen.findByText('Lead 1');

    const wsBtns = await screen.findAllByRole('button', { name: /Open workspace/i });
    expect(wsBtns.length).toBe(LEAD_ROWS.length);

    await user.click(wsBtns[0]!);

    // Should switch to 'Lead Workspace' tab with recId r1
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Lead Workspace' })).toHaveClass('active');
    });
    expect(await screen.findByText('LD-001')).toBeInTheDocument();
  });

  it('does NOT show Open workspace button when schema has no record-scoped panels', async () => {
    const pageOnlySchema: PageSchema = {
      ...DEMO_SCHEMA,
      tabPanels: [{ tab: 'Lead Extra Tab', key: 'lead-extra', scope: 'page' }],
    };
    setup(pageOnlySchema);
    renderApp('/m/service-tickets?tab=Ticket%20Queue');
    await screen.findByRole('heading', { name: 'Service Tickets' });
    await screen.findByText('Lead 1');

    expect(screen.queryByRole('button', { name: /Open workspace/i })).not.toBeInTheDocument();
  });
});
