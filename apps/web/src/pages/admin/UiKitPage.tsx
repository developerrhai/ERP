// /m/admin-ui-kit - every Phase 36 component and state on one page, for client approval.
import { useState } from 'react';
import {
  ActionRow,
  Button,
  Combobox,
  ConfirmDialog,
  DataTable,
  DateInput,
  EmptyState,
  Field,
  KpiCard,
  MoneyInput,
  PageHeader,
  Skeleton,
  StatusBadge,
  Tabs,
  type ActionDef,
  type Option,
} from '../../ui/components';

const PARTIES: Option[] = [
  { value: '1', label: 'Asha Steel Works (Pune)' },
  { value: '2', label: 'Bharat Fabricators (Nashik)' },
  { value: '3', label: 'Citra Engineering (Mumbai)' },
];
const searchParties = (q: string) =>
  Promise.resolve(PARTIES.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())));

interface Row {
  no: string;
  party: string;
  amount: number;
  status: string;
}
const ROWS: Row[] = [
  { no: 'SO-0001', party: 'Asha Steel Works', amount: 125000, status: 'APPROVED' },
  { no: 'SO-0002', party: 'Bharat Fabricators', amount: 48250.5, status: 'PENDING_APPROVAL' },
  { no: 'SO-0003', party: 'Citra Engineering', amount: 910000, status: 'DRAFT' },
];

export function UiKitPage() {
  const [tab, setTab] = useState('register');
  const [party, setParty] = useState<Option | null>(null);
  const [amount, setAmount] = useState<number | null>(125000);
  const [date, setDate] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const head: ActionDef[] = [
    { key: 'xls', label: 'Excel' },
    { key: 'pdf', label: 'Industry PDF' },
    { key: 'word', label: 'Word' },
    { key: 'print', label: 'Print' },
    { key: 'add', label: '＋ Add', variant: 'primary' },
    { key: 'edit', label: 'Edit' },
    { key: 'del', label: 'Delete', variant: 'danger', onClick: () => setConfirm(true) },
    { key: 'docs', label: 'Documents' },
    {
      key: 'mf',
      label: 'Move Forward',
      reason: 'needs the department chain to be set up for this page',
    },
  ];
  return (
    <div className="ui-kit">
      <PageHeader
        title="UI kit"
        subtitle="Every shared component and state (Phase 36)"
        onReturn={() => undefined}
        actions={head}
      />
      <section>
        <h2>Buttons and badges</h2>
        <div className="ui-kit-row">
          <Button>Default</Button>
          <Button variant="primary">Save Record</Button>
          <Button variant="success">Approve</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="ghost">← Return</Button>
          <Button disabled>Disabled</Button>
          <Button reason="backend arrives in Phase 37">Greyed with reason</Button>
        </div>
        <div className="ui-kit-row">
          {[
            'DRAFT',
            'PENDING_APPROVAL',
            'APPROVED',
            'REJECTED',
            'POSTED',
            'OVERDUE',
            'SOMETHING_NEW',
          ].map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
      </section>
      <section>
        <h2>Tabs</h2>
        <Tabs
          tabs={[
            { key: 'register', label: 'Register' },
            { key: 'insights', label: 'Insights' },
            { key: 'history', label: 'History' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </section>
      <section>
        <h2>KPI cards</h2>
        <div className="ui-kit-grid">
          <KpiCard label="Open orders" value={42} hint="this month" />
          <KpiCard label="Receivable (₹)" value={1250000} />
          <KpiCard label="On-time" value="96%" />
        </div>
      </section>
      <section>
        <h2>Form fields</h2>
        <div className="ui-kit-grid">
          <Field label="Customer" required>
            {(id) => <Combobox id={id} value={party} onPick={setParty} search={searchParties} />}
          </Field>
          <Field label="Amount" required>
            {(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}
          </Field>
          <Field
            label="Order date"
            error={date === null ? 'Enter a date as dd-mm-yyyy' : undefined}
          >
            {(id, d) => <DateInput id={id} aria-describedby={d} value={date} onChange={setDate} />}
          </Field>
        </div>
      </section>
      <section>
        <h2>Action row (folds to More)</h2>
        <ActionRow actions={head} max={4} />
      </section>
      <section>
        <h2>Table</h2>
        <DataTable
          things="orders"
          rows={ROWS}
          rowKey={(r) => r.no}
          columns={[
            { key: 'no', header: 'Order', render: (r) => r.no },
            { key: 'party', header: 'Customer', render: (r) => r.party },
            {
              key: 'amount',
              header: 'Amount (₹)',
              align: 'right',
              render: (r) => r.amount.toLocaleString('en-IN'),
            },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
          rowActions={() => [
            { key: 'open', label: 'Open' },
            { key: 'pdf', label: 'PDF' },
          ]}
        />
      </section>
      <section>
        <h2>Loading and empty states</h2>
        <Skeleton />
        <EmptyState things="orders" onAdd={() => undefined} />
      </section>
      <ConfirmDialog
        open={confirm}
        title="Delete order"
        docNumber="SO-0001"
        onCancel={() => setConfirm(false)}
        onConfirm={() => setConfirm(false)}
      />
    </div>
  );
}
