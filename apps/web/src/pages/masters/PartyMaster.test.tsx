// Phase 6 UI: the GSTIN is decoded offline when you leave the field (chip, state, PAN), duplicates show
// inline and block / warn, and a new supplier can be submitted for approval.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { json, makeUser, renderApp, signedIn } from '../../test/helpers';

const owner = makeUser({
  role: 'SUPER_ADMIN',
  roleLabel: 'Super Admin',
  name: 'Owner Person',
  roleLevel: 99,
});
const perms = (call: { url: string }) => {
  const pageId = new URL(call.url, 'http://test').searchParams.get('pageId') ?? '';
  const actions = Object.fromEntries(
    ['view', 'add', 'edit', 'delete', 'approve', 'export', 'controls', 'submit'].map((a) => [
      a,
      true,
    ]),
  );
  return json(200, { data: { pageId, actions, scope: 'ALL' } });
};
const empty = () => json(200, { data: [], meta: { page: 1, size: 20, total: 0 } });

describe('Customer Master', () => {
  it('decodes the GSTIN offline, shows the chip, and saves with the state taken from it', async () => {
    let saved: unknown = null;
    signedIn(owner, {
      'GET /api/v1/me/permissions': perms,
      'GET /api/v1/customers': empty,
      'GET /api/v1/statutory/gstin/27AAPFU0939F1ZV': () =>
        json(200, {
          data: {
            ok: true,
            gstin: '27AAPFU0939F1ZV',
            stateCode: '27',
            state: 'Maharashtra',
            pan: 'AAPFU0939F',
            registrationType: 'REGULAR',
            note: 'GSTIN format OK — not checked on portal',
          },
        }),
      'POST /api/v1/parties/check-duplicates': () => json(200, { data: [] }),
      'POST /api/v1/customers': (call) => {
        saved = call.body;
        return json(200, { data: { id: 'c1', code: 'CUS/00001', version: 1 } });
      },
    });
    renderApp('/m/crm-customer360');
    const ue = userEvent.setup();
    await screen.findByRole('heading', { name: 'Customer Master' });
    expect(await screen.findByText(/No customers yet/)).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: /Add Customer/ }));
    const dialog = screen.getByRole('dialog');
    await ue.type(within(dialog).getByLabelText('Name *'), 'Sawant Engineering');
    await ue.type(within(dialog).getByLabelText('GSTIN *'), '27aapfu0939f1zv');
    await ue.tab();
    expect(
      await within(dialog).findByText(
        /GSTIN format OK — not checked on portal: Maharashtra • PAN AAPFU0939F/,
      ),
    ).toBeInTheDocument();
    await ue.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('CUS/00001 saved.')).toBeInTheDocument();
    expect(saved).toMatchObject({
      name: 'Sawant Engineering',
      gstin: '27AAPFU0939F1ZV',
      stateCode: '27',
      gstRegistrationType: 'REGULAR',
    });
  });

  it('shows the checksum message for a typing mistake and a blocking duplicate disables Save', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': perms,
      'GET /api/v1/customers': empty,
      'GET /api/v1/statutory/gstin/27AAPFU0939F1ZO': () =>
        json(200, {
          data: {
            ok: false,
            gstin: '27AAPFU0939F1ZO',
            code: 'GSTIN_CHECKSUM',
            message:
              'This GSTIN has a typing mistake (last character does not match). Please re-check.',
          },
        }),
      'POST /api/v1/parties/check-duplicates': () =>
        json(200, {
          data: [
            {
              level: 'BLOCK',
              field: 'gstin',
              message: 'Customer CUS/00007 – Old Name already has this GSTIN.',
              matchId: 'm1',
              matchKind: 'CUSTOMER',
              matchCode: 'CUS/00007',
            },
          ],
        }),
    });
    renderApp('/m/crm-customer360');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: /Add Customer/ }));
    const dialog = screen.getByRole('dialog');
    await ue.type(within(dialog).getByLabelText('GSTIN *'), '27AAPFU0939F1ZO');
    await ue.tab();
    expect(await within(dialog).findByText(/typing mistake/)).toBeInTheDocument();
    expect(
      await within(dialog).findByText(/Customer CUS\/00007 – Old Name already has this GSTIN\./),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled(),
    );
  });
});

describe('Supplier Master', () => {
  it('lists a pending supplier with Submit for Approval, and sends it', async () => {
    let submitted = false;
    signedIn(owner, {
      'GET /api/v1/me/permissions': perms,
      'GET /api/v1/suppliers': () =>
        json(200, {
          data: [
            {
              id: 's1',
              code: 'SUP/00001',
              name: 'Shivam Test',
              legalName: null,
              gstRegistrationType: 'REGULAR',
              gstin: '27AAPFU0939F1ZV',
              pan: 'AAPFU0939F',
              stateCode: '27',
              currencyCode: 'INR',
              approvalStatus: 'PENDING',
              status: 'ACTIVE',
              version: 1,
              supplierType: 'CONTRACTOR',
              msmeUdyamNo: null,
              msmeCategory: null,
              msmeActivity: null,
              msmeAgreedDays: null,
              msme45dayApplies: null,
              purchaseHold: false,
            },
          ],
          meta: { page: 1, size: 20, total: 1 },
        }),
      'POST /api/v1/suppliers/s1/submit': () => {
        submitted = true;
        return json(200, { data: { id: 'req1' } });
      },
    });
    renderApp('/m/scm-suppliers');
    const ue = userEvent.setup();
    expect(await screen.findByText('SUP/00001')).toBeInTheDocument();
    expect(screen.getByText('Pending approval')).toBeInTheDocument();
    expect(screen.getByText('Contractor')).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: 'Submit SUP/00001 for approval' }));
    expect(await screen.findByText('SUP/00001 sent for approval.')).toBeInTheDocument();
    expect(submitted).toBe(true);
  });
});
