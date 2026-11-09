// Phase 6B UI: the Settings button on a module page, read-only for people who are not the Department
// Head ("Only the Department Head can change this"), publishing with a reason (If-Match +
// Idempotency-Key), plain-English formula errors, the Excel import report, the admin-formats list
// and the customer-wise format switching the form.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
  type Call,
} from '../../test/helpers';
import type { SettingsVersion } from '../../lib/settingsApi';
import { LEAD_SCHEMA } from '../../test/engine-fixtures';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const P = '/api/v1/pages/service-tickets';
const S = `${P}/settings`;

function version(over: Partial<SettingsVersion> = {}): SettingsVersion {
  return {
    id: 'f-1',
    target: 'FORMAT',
    pageId: 'service-tickets',
    version: 3,
    versionNo: 2,
    status: 'ACTIVE',
    name: 'Lead form',
    reason: 'First layout',
    content: {
      header: [{ key: 'name', label: 'Lead name (client)', type: 'text', required: true }],
      columns: [],
      totals: [],
      print: {
        paper: 'A4',
        orientation: 'portrait',
        showLetterhead: true,
        showAmountInWords: true,
        signatures: [],
      },
      validations: [],
    },
    kind: 'FORM',
    code: null,
    moneyAffecting: null,
    customer: null,
    unit: null,
    sourceFileId: null,
    createdAt: '2026-11-06T04:30:00.000Z',
    createdBy: { id: 'u1', name: 'Hema Head' },
    updatedAt: '2026-11-06T04:30:00.000Z',
    publishedAt: '2026-11-06T05:00:00.000Z',
    publishedBy: { id: 'u1', name: 'Hema Head' },
    retiredAt: null,
    ...over,
  };
}

const listRes = (items: SettingsVersion[], canEdit: boolean, extra: object = {}) =>
  json(200, {
    data: items,
    meta: { ownerDepartment: 'Sales', canEdit, approvalRequired: true, ...extra },
  });

function setup(
  canEdit: boolean,
  extra: Record<string, (c: Call) => Response | Promise<Response>> = {},
) {
  return signedIn(owner, {
    'GET /api/v1/me/permissions': permissionsRoute({ view: true, add: true }),
    [`GET ${P}/schema`]: () => json(200, { data: LEAD_SCHEMA }),
    [`GET ${P}/records`]: () => json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
    'GET /api/v1/approvals/requests': () =>
      json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
    [`GET ${S}/formats`]: () => listRes([version()], canEdit),
    [`GET ${S}/rules`]: () => listRes([], canEdit),
    ...extra,
  });
}

async function openSettings() {
  renderApp('/m/service-tickets');
  const button = await screen.findByRole('button', { name: /Settings/ });
  await userEvent.click(button);
  return screen.findByRole('dialog', { name: /Settings — / });
}

describe('Settings panel', () => {
  it('is read-only for a non-head: buttons are disabled and say why', async () => {
    setup(false);
    const dialog = await openSettings();
    expect(await within(dialog).findByText('Lead form')).toBeInTheDocument();
    expect(within(dialog).getByText(/Owned by/)).toHaveTextContent('Owned by Sales');
    const add = within(dialog).getByRole('button', { name: '+ New format' });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', 'Only the Department Head can change this');
    expect(within(dialog).getByRole('button', { name: 'Edit Lead form v2' })).toBeDisabled();
    // history stays available to everybody
    expect(within(dialog).getByRole('button', { name: 'History of Lead form' })).toBeEnabled();
  });

  it('lets the Department Head publish a new version with a reason (If-Match + Idempotency-Key)', async () => {
    const { calls } = setup(true, {
      [`PUT ${S}/formats`]: (c) =>
        json(200, {
          data: version({
            id: 'f-2',
            status: 'DRAFT',
            versionNo: 3,
            version: 1,
            name: (c.body as { name: string }).name,
          }),
        }),
      [`POST ${S}/formats/f-2/publish`]: () =>
        json(200, { data: version({ id: 'f-2', versionNo: 3, version: 2 }) }),
    });
    const dialog = await openSettings();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Edit Lead form v2' }));
    const editor = await screen.findByRole('dialog', { name: /Lead form — new version/ });
    // the live preview shows the field
    expect(within(editor).getByLabelText('Preview Lead name (client)')).toBeDisabled();
    await userEvent.click(within(editor).getByRole('button', { name: 'Publish new version' }));
    await userEvent.click(within(editor).getByRole('button', { name: 'Confirm publish' }));
    expect(
      await within(editor).findByText('Give a short reason (at least 3 characters).'),
    ).toBeInTheDocument();
    await userEvent.type(
      within(editor).getByLabelText('Reason for this change *'),
      'New client layout',
    );
    await userEvent.click(within(editor).getByRole('button', { name: 'Confirm publish' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === `${S}/formats/f-2/publish`)).toBe(true),
    );
    const put = calls.find((c) => c.method === 'PUT' && c.path === `${S}/formats`);
    expect(put?.headers['If-Match']).toBe('0'); // a new draft of the active version
    expect(put?.headers['Idempotency-Key']).toBeTruthy();
    const pub = calls.find((c) => c.path === `${S}/formats/f-2/publish`);
    expect(pub?.body).toEqual({ reason: 'New client layout' });
    expect(pub?.headers['If-Match']).toBe('1');
    expect(pub?.headers['Idempotency-Key']).toBeTruthy();
    expect(await screen.findByText(/Published v3/)).toBeInTheDocument();
  });

  it('shows a formula problem in plain English and keeps the editor open', async () => {
    setup(true, {
      [`PUT ${S}/rules`]: () =>
        apiError(
          422,
          'FORMULA_INVALID',
          'The formula for marked is not valid: "nope" is not an input, a parameter or an earlier result.',
        ),
    });
    const dialog = await openSettings();
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Rules' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: '+ New rule set' }));
    const editor = await screen.findByRole('dialog', { name: 'New rule set' });
    await userEvent.type(within(editor).getByLabelText('Code *'), 'quotation');
    await userEvent.type(within(editor).getByLabelText('Name *'), 'Quotation');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save draft' }));
    expect(await within(editor).findByRole('alert')).toHaveTextContent(
      'The formula for marked is not valid: "nope" is not an input, a parameter or an earlier result.',
    );
    expect(screen.getByRole('dialog', { name: 'New rule set' })).toBeInTheDocument();
  });

  it('shows the Excel import report with row numbers', async () => {
    setup(true, {
      [`POST ${S}/import`]: () =>
        json(200, {
          data: {
            report: {
              valid: false,
              errors: [
                {
                  row: 3,
                  message:
                    'Section "Sidebar" is not known. Use Title, Header, Column, Total, Signature or Print.',
                },
              ],
              warnings: [],
              summary: '1 problem(s) found.',
            },
            draft: null,
          },
        }),
    });
    const dialog = await openSettings();
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Import from Excel' }));
    const file = new File(['x'], 'f.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(within(dialog).getByLabelText('Excel file (.xlsx)'), file);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    const report = await within(dialog).findByLabelText('Import report');
    expect(report).toHaveTextContent('The file has problems. Nothing was imported.');
    expect(report).toHaveTextContent('Row 3: Section "Sidebar" is not known.');
  });

  it('the history offers "Restore as new version" to the head only', async () => {
    const old = version({
      id: 'f-0',
      versionNo: 1,
      status: 'RETIRED',
      retiredAt: '2026-11-05T00:00:00.000Z',
    });
    const { calls } = setup(true, {
      [`GET ${S}/formats/versions`]: () => json(200, { data: [version(), old] }),
      [`POST ${S}/formats/f-0/restore`]: () =>
        json(200, { data: version({ id: 'f-3', status: 'DRAFT', versionNo: 3 }) }),
    });
    const dialog = await openSettings();
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'History of Lead form' }),
    );
    const history = await screen.findByRole('dialog', { name: /History — Lead form/ });
    await userEvent.click(
      await within(history).findByRole('button', { name: 'Restore v1 as new version' }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.path === `${S}/formats/f-0/restore`)).toBe(true),
    );
    expect(await screen.findByText(/Restored as a new draft/)).toBeInTheDocument();
  });
});

describe('admin-formats', () => {
  it('lists formats and rule sets, versions and who changed what', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': permissionsRoute({ view: true }),
      'GET /api/v1/formats': () =>
        json(200, {
          data: [
            version(),
            version({
              id: 'r-1',
              target: 'RULE_SET',
              kind: null,
              code: 'quotation',
              name: 'Quotation rules',
            }),
          ],
          meta: { page: 1, size: 20, total: 2 },
        }),
      'GET /api/v1/formats/changes': () =>
        json(200, {
          data: [
            {
              id: 'c1',
              targetType: 'RULE_SET',
              targetId: 'r-1',
              pageId: 'service-tickets',
              versionNo: 2,
              action: 'PUBLISHED',
              reason: 'Rate review',
              changedBy: { id: 'u1', name: 'Hema Head' },
              at: '2026-11-06T05:00:00.000Z',
            },
          ],
          meta: { page: 1, size: 20, total: 1 },
        }),
      'GET /api/v1/formats/r-1/versions': () =>
        json(200, { data: [version({ id: 'r-1', versionNo: 2 })] }),
    });
    renderApp('/m/admin-formats');
    await screen.findByRole('heading', { name: 'Formats & Rules' });
    expect(await screen.findByText('Quotation rules')).toBeInTheDocument();
    expect(screen.getByText('Rule set (quotation)')).toBeInTheDocument();
    // there is no Settings launcher on this page itself
    expect(screen.queryByRole('button', { name: /⚙ Settings/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Versions of Quotation rules' }));
    expect(
      await screen.findByRole('dialog', { name: /Versions — Quotation rules/ }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement);
    await userEvent.click(screen.getByRole('tab', { name: 'Who changed what' }));
    expect(await screen.findByText('Rate review')).toBeInTheDocument();
    expect(screen.getByText('Hema Head')).toBeInTheDocument();
  });
});

describe('customer-wise format on a form', () => {
  it('asks for the customer format when the customer changes and re-labels the form', async () => {
    const resolves: string[] = [];
    const leadFields = LEAD_SCHEMA.fields;
    const customerKey = leadFields.find((f) => /^customer/i.test(f.key))?.key;
    // The Lead fixture has no customer field: add one, labelled by the default format.
    const schema = {
      ...LEAD_SCHEMA,
      fields: [
        ...leadFields,
        { key: 'customer', label: 'Customer', type: 'text', required: false, readOnly: false },
      ],
    };
    expect(customerKey).toBeUndefined();
    signedIn(owner, {
      'GET /api/v1/me/permissions': permissionsRoute({ view: true, add: true }),
      [`GET ${P}/schema`]: () => json(200, { data: schema }),
      [`GET ${P}/records`]: () => json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
      'GET /api/v1/approvals/requests': () =>
        json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
      'GET /api/v1/customers': () =>
        json(200, {
          data: [{ id: 'cust-1', name: 'Acme Works' }],
          meta: { page: 1, size: 5, total: 1 },
        }),
      [`GET ${S}/formats/resolve`]: (c) => {
        const id = new URL(c.url, 'http://test').searchParams.get('customerId');
        resolves.push(id ?? '');
        return json(200, {
          data: id
            ? {
                id: 'f-acme',
                versionNo: 4,
                kind: 'FORM',
                name: 'Acme form',
                matchedBy: 'customer',
                schema: {
                  ...(version().content as object),
                  header: [
                    { key: 'customer', label: 'Acme account name', type: 'text', required: true },
                  ],
                },
              }
            : null,
        });
      },
    });
    renderApp('/m/service-tickets?tab=Ticket%20Queue');
    await userEvent.click(await screen.findByRole('button', { name: '＋ Add' }));
    const form = await screen.findByRole('dialog', { name: 'Add Service Tickets' });
    expect(within(form).queryByText(/Format:/)).toBeNull();
    expect(await within(form).findByLabelText('Customer')).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText('Customer'), 'Acme Works');
    expect(
      await within(form).findByText('Format: Acme form v4 (for this customer)'),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText('Acme account name')).toBeInTheDocument();
    expect(resolves).toContain('cust-1');
    // clearing the customer goes back to the standard form
    await userEvent.clear(within(form).getByLabelText('Acme account name'));
    await waitFor(() => expect(within(form).queryByText(/Format:/)).toBeNull());
    expect(within(form).getByLabelText('Customer')).toBeInTheDocument();
  });
});
