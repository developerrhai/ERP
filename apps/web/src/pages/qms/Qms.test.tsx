// Phase 12 screens: the incoming inspection sheet with its readings and the usage decision, the calibration list, and the
// PPM monitor with its target verdict.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  countCalls,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
} from '../../test/helpers';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const ALL = permissionsRoute({
  view: true,
  add: true,
  edit: true,
  delete: true,
  approve: true,
  submit: true,
  post: true,
  cancel: true,
  controls: true,
});

const header = [
  { key: 'supplier', label: 'Supplier', type: 'supplier', required: true },
  { key: 'invoice_no', label: 'Invoice no', type: 'text', required: true },
  { key: 'item', label: 'Item', type: 'item', required: true },
];
const sheet = (status: string) => ({
  id: 's1',
  version: 3,
  number: 'IQC/TAL/26-27/0001',
  kind: 'INCOMING',
  status,
  result: status === 'Draft' ? null : 'ACCEPTED',
  docDate: '2026-11-08',
  lotQty: '100',
  sourceType: 'GRN_LINE',
  sourceId: 'g1',
  templateId: 't1',
  templateSnapshot: {
    name: 'Incoming (RM) inspection sheet',
    version: 1,
    headerFields: header,
    rowConfig: { readings: 1, readingLabel: 'Result', labelHeader: 'Characteristic' },
  },
  header: { supplier: 'sup1', invoice_no: 'VINV-1', item: 'it1' },
  headerLabels: { supplier: 'S1 · Steel Co', item: 'RM1 · Plate' },
  grn: { grnNo: 'GRN/TAL/26-27/0004', uom: 'Kg' },
  rows: [
    {
      id: 'r1',
      label: 'Thickness',
      spec: '10 +/- 0.5',
      method: 'Vernier',
      rowType: 'NUMERIC',
      lsl: '9.5',
      usl: '10.5',
      readings: ['10.7'],
      rowStatus: 'NOT_OK',
    },
  ],
});
const listRow = {
  id: 's1',
  number: 'IQC/TAL/26-27/0001',
  kind: 'INCOMING',
  status: 'Submitted',
  result: 'ACCEPTED',
  docDate: '2026-11-08',
  itemName: 'Plate',
  supplierName: 'Steel Co',
  lotQty: '100',
};

describe('Incoming Quality', () => {
  it('shows the readings with their status and records the usage decision once', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/qms/inspections': () =>
        json(200, { data: [listRow], meta: { page: 1, size: 50, total: 1 } }),
      'GET /api/v1/qms/inspections/s1': () => json(200, { data: sheet('Submitted') }),
      'POST /api/v1/qms/inspections/s1/decide': () =>
        json(200, {
          data: {
            ...sheet('Decided'),
            decision: 'PARTIAL',
            acceptedQty: '98',
            rejectedQty: '2',
            version: 4,
          },
        }),
    });
    renderApp('/m/qms-incoming');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'IQC/TAL/26-27/0001' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('NOT OK')).toBeInTheDocument();
    expect(within(dialog).getByText(/stays in/)).toBeInTheDocument();
    const acc = within(dialog).getByLabelText('Accepted quantity *');
    await ue.clear(acc);
    await ue.type(acc, '98');
    const rej = within(dialog).getByLabelText('Rejected quantity *');
    await ue.clear(rej);
    await ue.type(rej, '2');
    await ue.type(within(dialog).getByLabelText(/Reason/), 'Cracked edge');
    await ue.click(within(dialog).getByRole('button', { name: 'Record usage decision' }));
    expect(await within(dialog).findByText(/Decision:/)).toBeInTheDocument();
    expect(countCalls(calls, 'POST', '/qms/inspections/s1/decide')).toBe(1);
  });

  it('does not offer the usage decision to someone who cannot approve', async () => {
    const noApprove = permissionsRoute({ view: true, add: true, edit: true, submit: true });
    signedIn(owner, {
      'GET /api/v1/me/permissions': noApprove,
      'GET /api/v1/qms/inspections': () =>
        json(200, { data: [listRow], meta: { page: 1, size: 50, total: 1 } }),
      'GET /api/v1/qms/inspections/s1': () => json(200, { data: sheet('Submitted') }),
    });
    renderApp('/m/qms-incoming');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'IQC/TAL/26-27/0001' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('NOT OK');
    expect(within(dialog).queryByRole('button', { name: 'Record usage decision' })).toBeNull();
  });
});

describe('Calibration', () => {
  it('shows the calibration status of each instrument', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/qms/instruments': () =>
        json(200, {
          data: [
            {
              id: 'i1',
              historyCardNo: 'HC-1',
              equipmentNo: 'EQ-1',
              name: 'Vernier',
              validUntil: '2026-11-01',
              calibrationStatus: 'EXPIRED',
              status: 'ACTIVE',
            },
            {
              id: 'i2',
              historyCardNo: 'HC-2',
              equipmentNo: 'EQ-2',
              name: 'Micrometer',
              validUntil: '2027-05-01',
              calibrationStatus: 'VALID',
              status: 'ACTIVE',
            },
          ],
          meta: { page: 1, size: 50, total: 2, reminderDays: 15 },
        }),
    });
    renderApp('/m/qms-calibration');
    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('In calibration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add instrument' })).toBeInTheDocument();
  });
});

describe('PPM monitor', () => {
  it('shows PPM against the target', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/qms/rejections': () =>
        json(200, { data: [], meta: { page: 1, size: 50, total: 0 } }),
      'GET /api/v1/qms/rejections/summary': () =>
        json(200, {
          data: {
            month: '2026-11',
            total: { entries: 0, qty: '0' },
            byProcess: [],
            byDefectType: [],
            byDisposition: [],
          },
        }),
      'GET /api/v1/qms/reports/ppm': () =>
        json(200, {
          data: {
            internalTarget: '3000',
            customerTarget: '400',
            months: [
              {
                month: '2026-03',
                produced: '10000',
                rejected: '25',
                customerRejected: '5',
                internalPpm: '2500.00',
                customerPpm: '500.00',
                internalVsTarget: 'OK',
                customerVsTarget: 'OVER',
              },
            ],
            totals: {
              produced: '10000',
              rejected: '25',
              customerRejected: '5',
              internalPpm: '2500.00',
              customerPpm: '500.00',
            },
          },
        }),
    });
    renderApp('/m/qms-ncr');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('tab', { name: 'PPM monitor' }));
    expect(await screen.findByText('Within target')).toBeInTheDocument();
    expect(screen.getByText('Above target')).toBeInTheDocument();
    expect(screen.getAllByText('2500.00').length).toBeGreaterThan(0);
  });
});
