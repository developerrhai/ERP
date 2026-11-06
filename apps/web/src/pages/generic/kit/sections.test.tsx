// apps/web/src/pages/generic/kit/sections.test.tsx
// Vitest suite for extended sections and custom components (docs/plans/07-ENGINE-KIT.md §12 T-KIT-08)

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/Toast';
import { BarsSection } from './sections/BarsSection';
import { BoardSection } from './sections/BoardSection';
import { CalendarSection } from './sections/CalendarSection';
import { ChartSection } from './sections/ChartSection';
import { FunnelSection } from './sections/FunnelSection';
import { InlineCell } from './sections/InlineCell';
import { TimelineSection } from './sections/TimelineSection';

describe('T-KIT-08: Extended Sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('FunnelSection', () => {
    it('renders empty state when stages list is empty', () => {
      render(<FunnelSection title="Sales Funnel" stages={[]} />);
      expect(screen.getByText('Sales Funnel')).toBeInTheDocument();
      expect(screen.getByText('No funnel data.')).toBeInTheDocument();
    });

    it('renders stages and calculates proportional bar heights', () => {
      const stages = [
        { label: 'Leads', count: 100, valueText: '$10,000' },
        { label: 'Qualified', count: 50, valueText: '$5,000' },
        { label: 'Closed', count: 25, valueText: '$2,500' },
      ];
      render(<FunnelSection title="Opportunity Pipeline" stages={stages} />);
      expect(screen.getByText('Opportunity Pipeline')).toBeInTheDocument();
      expect(screen.getByText('Leads')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('$10,000')).toBeInTheDocument();
      expect(screen.getByText('Qualified')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
      expect(screen.getByText('Closed')).toBeInTheDocument();
      expect(screen.getByText('25')).toBeInTheDocument();
    });
  });

  describe('BarsSection', () => {
    it('renders empty state when rows is empty', () => {
      render(<BarsSection title="KPI Metrics" rows={[]} />);
      expect(screen.getByText('KPI Metrics')).toBeInTheDocument();
      expect(screen.getByText('No metric data.')).toBeInTheDocument();
    });

    it('renders metric rows with progress bars and tones', () => {
      const rows = [
        {
          label: 'On-Time Delivery',
          value: 95,
          max: 100,
          format: 'pct' as const,
          tone: 'good' as const,
        },
        { label: 'Scrap Rate', value: 8, max: 20, format: 'pct' as const, tone: 'warn' as const },
      ];
      render(<BarsSection title="Operations" rows={rows} />);
      expect(screen.getByText('On-Time Delivery')).toBeInTheDocument();
      expect(screen.getByText('95%')).toBeInTheDocument();
      expect(screen.getByText('Scrap Rate')).toBeInTheDocument();
      expect(screen.getByText('8%')).toBeInTheDocument();
    });
  });

  describe('ChartSection', () => {
    it('renders empty state when labels or series is empty', () => {
      render(<ChartSection title="Monthly Revenue" chartType="bar" labels={[]} series={[]} />);
      expect(screen.getByText('Monthly Revenue')).toBeInTheDocument();
      expect(screen.getByText('No chart data.')).toBeInTheDocument();
    });

    it('renders bar chart with legend and series data', () => {
      const labels = ['Jan', 'Feb', 'Mar'];
      const series = [
        { name: 'Target', data: [100, 120, 150] },
        { name: 'Actual', data: [90, 130, 140] },
      ];
      render(
        <ChartSection title="Q1 Performance" chartType="bar" labels={labels} series={series} />,
      );
      expect(screen.getByText('Q1 Performance')).toBeInTheDocument();
      expect(screen.getByText('Target')).toBeInTheDocument();
      expect(screen.getByText('Actual')).toBeInTheDocument();
      expect(screen.getByText('Jan')).toBeInTheDocument();
      expect(screen.getByText('Feb')).toBeInTheDocument();
      expect(screen.getByText('Mar')).toBeInTheDocument();
    });
  });

  describe('TimelineSection', () => {
    it('renders empty state when events is empty', () => {
      render(<TimelineSection title="Audit History" events={[]} />);
      expect(screen.getByText('Audit History')).toBeInTheDocument();
      expect(screen.getByText('No timeline events.')).toBeInTheDocument();
    });

    it('renders timeline events in order with author and detail', () => {
      const events = [
        {
          at: '2026-11-01 10:00',
          title: 'Inspection Created',
          detail: 'Incoming batch checked',
          by: 'John Doe',
          tone: 'good' as const,
        },
        {
          at: '2026-11-01 14:00',
          title: 'NCR Logged',
          detail: 'Out of tolerance dimension',
          by: 'Jane Smith',
          tone: 'bad' as const,
        },
      ];
      render(<TimelineSection title="Lot Events" events={events} />);
      expect(screen.getByText('Lot Events')).toBeInTheDocument();
      expect(screen.getByText('Inspection Created')).toBeInTheDocument();
      expect(screen.getByText('Incoming batch checked')).toBeInTheDocument();
      expect(screen.getByText('by John Doe')).toBeInTheDocument();
      expect(screen.getByText('NCR Logged')).toBeInTheDocument();
      expect(screen.getByText('Out of tolerance dimension')).toBeInTheDocument();
      expect(screen.getByText('by Jane Smith')).toBeInTheDocument();
    });
  });

  describe('CalendarSection', () => {
    it('renders empty state when days is empty', () => {
      render(<CalendarSection title="Audit Schedule" month="2026-11" days={[]} />);
      expect(screen.getByText('Audit Schedule')).toBeInTheDocument();
      expect(screen.getByText('No calendar events for 2026-11.')).toBeInTheDocument();
    });

    it('marks correct calendar days with scheduled items', () => {
      const days = [
        { date: '2026-11-05', items: [{ label: 'ISO Internal Audit', tone: 'warn' as const }] },
        { date: '2026-11-18', items: [{ label: 'Supplier Review', tone: 'good' as const }] },
      ];
      render(<CalendarSection title="Quality Events" month="2026-11" days={days} />);
      expect(screen.getByText('Quality Events')).toBeInTheDocument();
      expect(screen.getByText('ISO Internal Audit')).toBeInTheDocument();
      expect(screen.getByText('Supplier Review')).toBeInTheDocument();
      // Weekday headers present
      expect(screen.getByText('Sun')).toBeInTheDocument();
      expect(screen.getByText('Mon')).toBeInTheDocument();
    });
  });

  describe('BoardSection', () => {
    const fixtureLanes = [
      {
        key: 'open',
        label: 'Open',
        cards: [
          { id: 'c1', title: 'NCR-2026-001', subtitle: 'Supplier defect' },
          { id: 'c2', title: 'NCR-2026-002', subtitle: 'Machine wear' },
        ],
      },
      {
        key: 'investigating',
        label: 'Investigating',
        cards: [],
      },
      {
        key: 'closed',
        label: 'Closed',
        cards: [{ id: 'c3', title: 'NCR-2026-003', subtitle: 'Resolved' }],
      },
    ];

    it('renders lanes and cards correctly', () => {
      render(
        <ToastProvider>
          <BoardSection title="NCR Workflow" draggable={true} lanes={fixtureLanes} />
        </ToastProvider>,
      );
      expect(screen.getByText('NCR Workflow')).toBeInTheDocument();
      expect(screen.getByText('Open')).toBeInTheDocument();
      expect(screen.getByText('Investigating')).toBeInTheDocument();
      expect(screen.getByText('Closed')).toBeInTheDocument();
      expect(screen.getByText('NCR-2026-001')).toBeInTheDocument();
      expect(screen.getByText('NCR-2026-002')).toBeInTheDocument();
      expect(screen.getByText('NCR-2026-003')).toBeInTheDocument();
    });

    it('moves card via keyboard navigation (Enter, ArrowRight, Enter)', async () => {
      const mockCall = vi.fn().mockResolvedValue({ status: 'ok' });
      render(
        <ToastProvider>
          <BoardSection
            title="NCR Workflow"
            draggable={true}
            move={{ kind: 'action', name: 'moveCard', target: 'rec' }}
            lanes={fixtureLanes}
            onCall={mockCall}
          />
        </ToastProvider>,
      );

      const card1 = screen.getByText('NCR-2026-001');
      // Pick card with Enter
      fireEvent.keyDown(card1, { key: 'Enter' });
      // Navigate right to "investigating"
      fireEvent.keyDown(card1, { key: 'ArrowRight' });

      await waitFor(() => {
        expect(mockCall).toHaveBeenCalledTimes(1);
        expect(mockCall).toHaveBeenCalledWith(
          { kind: 'action', name: 'moveCard', target: 'rec' },
          { payload: { cardId: 'c1', laneKey: 'investigating' } },
        );
      });
    });

    it('reverts card to original lane on server error', async () => {
      const mockCall = vi.fn().mockRejectedValue(new Error('Permission denied'));
      render(
        <ToastProvider>
          <BoardSection
            title="NCR Workflow"
            draggable={true}
            move={{ kind: 'action', name: 'moveCard', target: 'rec' }}
            lanes={fixtureLanes}
            onCall={mockCall}
          />
        </ToastProvider>,
      );

      const card1 = screen.getByText('NCR-2026-001');
      fireEvent.keyDown(card1, { key: 'Enter' });
      fireEvent.keyDown(card1, { key: 'ArrowRight' });

      await waitFor(() => {
        expect(mockCall).toHaveBeenCalledTimes(1);
      });

      // After failure, error toast is displayed and card is still present in Open lane
      await waitFor(() => {
        expect(screen.getByText('Permission denied')).toBeInTheDocument();
      });
      expect(screen.getByText('NCR-2026-001')).toBeInTheDocument();
    });
  });

  describe('InlineCell', () => {
    it('submits updated value on Enter and calls onCall with payload', async () => {
      const mockCall = vi.fn().mockResolvedValue({ ok: true });
      render(
        <InlineCell
          rowId="row-42"
          initialValue={15}
          editable={{ type: 'qty', action: { kind: 'action', name: 'setQty', target: 'row' } }}
          onCall={mockCall}
        />,
      );

      const input = screen.getByLabelText('Editable cell');
      expect(input).toHaveValue(15);

      fireEvent.change(input, { target: { value: '25' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(mockCall).toHaveBeenCalledTimes(1);
        expect(mockCall).toHaveBeenCalledWith(
          { kind: 'action', name: 'setQty', target: 'row' },
          { payload: { rowId: 'row-42', value: 25 } },
        );
      });
    });

    it('displays error message under cell when update fails', async () => {
      const mockCall = vi
        .fn()
        .mockRejectedValue(new Error('Quantity exceeds available batch stock'));
      render(
        <InlineCell
          rowId="row-42"
          initialValue="old value"
          editable={{ type: 'text', action: { kind: 'action', name: 'updateName', target: 'row' } }}
          onCall={mockCall}
        />,
      );

      const input = screen.getByLabelText('Editable cell');
      fireEvent.change(input, { target: { value: 'new value' } });
      fireEvent.blur(input);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Quantity exceeds available batch stock',
        );
      });
    });
  });
});
