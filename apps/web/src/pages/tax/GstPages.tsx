// Phase 11 screens: GSTR-1, GSTR-3B (with GSTR-2B / ITC and the settlement), e-invoice, e-way bill, TDS returns and
// register exports. The app never talks to GSTN, the IRP, the e-way portal or TRACES: it prepares files and records
// the numbers a person types in from those portals.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { download } from '../../lib/api';
import { toUiError } from '../../lib/errors';
import { getJson, lookupSuppliers, post } from '../../lib/scmApi';
import type { Row } from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, inr, PageHead, Pill, todayIso } from '../finance/shared';
import { DateField } from '../../ui/components';

const s = (v: unknown): string =>
  v === null || v === undefined
    ? ''
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v as string);
/** now as yyyy-MM-ddTHH:mm in the browser's own time zone (what datetime-local expects) */
const localNow = (): string => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const thisMonth = (): string => todayIso().slice(0, 7);

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
function saveText(text: string, name: string) {
  saveBlob(new Blob([text], { type: 'application/json' }), name);
}

interface AskField {
  key: string;
  label: string;
  type?: 'text' | 'number';
}
function AskDialog({
  title,
  fields,
  onClose,
  onSubmit,
}: {
  title: string;
  fields: AskField[];
  onClose: () => void;
  onSubmit: (v: Record<string, string>) => void;
}) {
  const [v, setV] = useState<Record<string, string>>({});
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={fields.some((f) => !(v[f.key] ?? '').trim())}
          onClick={() => onSubmit(v)}
        >
          Continue
        </button>
      }
    >
      {fields.map((f) => (
        <div className="field" key={f.key}>
          <label htmlFor={`ask-${f.key}`}>{f.label} *</label>
          <input
            id={`ask-${f.key}`}
            type={f.type ?? 'text'}
            value={v[f.key] ?? ''}
            onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
          />
        </div>
      ))}
    </Modal>
  );
}
/** Replaces window.prompt: ask(title, fields, cb) shows a small dialog and calls cb with the answers. */
function useAsk() {
  const [cfg, setCfg] = useState<{
    title: string;
    fields: AskField[];
    cb: (v: Record<string, string>) => void;
  } | null>(null);
  const node = cfg ? (
    <AskDialog
      title={cfg.title}
      fields={cfg.fields}
      onClose={() => setCfg(null)}
      onSubmit={(v) => {
        const cb = cfg.cb;
        setCfg(null);
        cb(v);
      }}
    />
  ) : null;
  const ask = (title: string, fields: AskField[], cb: (v: Record<string, string>) => void) =>
    setCfg({ title, fields, cb });
  return { node, ask };
}

function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: [T, string][];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          className={value === k ? 'tab active' : 'tab'}
          onClick={() => onChange(k)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Issues({ list }: { list: Row[] }) {
  if (!list.length) return <div className="msg success show static">No problems found.</div>;
  return (
    <ul className="issues">
      {list.map((i, n) => (
        <li key={n} className={s(i.level) === 'error' ? 'row-red' : undefined}>
          <strong>{s(i.level) === 'error' ? 'Error' : 'Check'}</strong>
          {i.doc ? ` · ${s(i.doc)}` : ''} — {s(i.message)}
        </li>
      ))}
    </ul>
  );
}

function Simple({
  cols,
  rows,
  empty,
}: {
  cols: [string, string, boolean?][];
  rows: Row[];
  empty: string;
}) {
  return (
    <div className="card table-wrap">
      <table>
        <thead>
          <tr>
            {cols.map(([k, label]) => (
              <th key={k}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <Empty cols={cols.length}>{empty}</Empty> : null}
          {rows.map((r, n) => (
            <tr key={n}>
              {cols.map(([k, , money]) => (
                <td key={k}>{money ? inr(s(r[k])) : s(r[k])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonthBar({
  month,
  onChange,
  children,
}: {
  month: string;
  onChange: (m: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="toolbar">
      <label htmlFor="tax-month">Month</label>
      <input
        id="tax-month"
        type="month"
        value={month}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
      {children}
    </div>
  );
}

function FileDialog({
  type,
  month,
  onClose,
  onDone,
}: {
  type: 'GSTR1' | 'GSTR3B';
  month: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [arn, setArn] = useState('');
  const [on, setOn] = useState(todayIso());
  const [msg, setMsg] = useState('');
  return (
    <Modal
      title={`Mark ${type === 'GSTR1' ? 'GSTR-1' : 'GSTR-3B'} ${month} as filed`}
      sub="After you file on the GST portal, enter the ARN. This locks the month's taxable documents."
      size="sm"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={arn.trim().length < 8}
          onClick={() => {
            setMsg('');
            post('/tax/returns/file', { type, month, arn: arn.trim(), filedOn: on })
              .then(onDone)
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Mark as filed
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="field">
        <label htmlFor="farn">ARN from the portal *</label>
        <input id="farn" value={arn} onChange={(e) => setArn(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="fon">Filed on *</label>
        <DateField id="fon" value={on} onChange={(e) => setOn(e.target.value)} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------------- GSTR-1
export function Gstr1Page({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [filing, setFiling] = useState(false);
  const [msg, setMsg] = useState('');
  const r = useLoad(() => getJson<Row>(`/tax/gstr1?month=${month}`), [month]);
  const d = r.data;
  const status = (d?.status ?? {}) as Row;
  const summary = (d?.summary ?? {}) as Record<string, Row>;
  async function file() {
    try {
      const { blob, filename } = await download(`/tax/gstr1/file?month=${month}`);
      saveBlob(blob, filename ?? `GSTR1_${month}.json`);
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  return (
    <>
      <PageHead
        title="GSTR-1"
        sub="Outward supplies of the month, built from the sales register. Download the file for the GST offline tool; the app does not file anything."
      >
        <button type="button" className="btn" disabled={!d?.canPrepare} onClick={() => void file()}>
          Download GSTR-1 JSON
        </button>
        {actions.post && s(status.status) !== 'Filed' ? (
          <button
            type="button"
            className="btn primary"
            disabled={!d?.canPrepare}
            onClick={() => setFiling(true)}
          >
            Mark as filed
          </button>
        ) : null}
      </PageHead>
      <MonthBar month={month} onChange={setMonth}>
        <span>
          {s(d?.gstin)} · <Pill>{s(status.status) || '…'}</Pill>
          {status.arn ? ` · ARN ${s(status.arn)}` : ''}
        </span>
      </MonthBar>
      <ErrorBox message={r.error || msg} />
      {d ? (
        <>
          <h3>Checks</h3>
          <Issues list={(d.issues as Row[]) ?? []} />
          <h3>Summary</h3>
          <Simple
            cols={[
              ['section', 'Section'],
              ['count', 'Documents'],
              ['taxable', 'Taxable value', true],
              ['igst', 'IGST', true],
              ['cgst', 'CGST', true],
              ['sgst', 'SGST', true],
            ]}
            rows={Object.entries(summary).map(([k, v]) => ({ section: k.toUpperCase(), ...v }))}
            empty="Nothing in this month."
          />
          <h3>B2B invoices</h3>
          <Simple
            cols={[
              ['docNo', 'Invoice'],
              ['date', 'Date'],
              ['customer', 'Customer'],
              ['gstin', 'GSTIN'],
              ['value', 'Value', true],
              ['taxable', 'Taxable', true],
            ]}
            rows={(d.b2b as Row[]) ?? []}
            empty="No B2B invoices."
          />
          <h3>Credit / debit notes</h3>
          <Simple
            cols={[
              ['docNo', 'Note'],
              ['date', 'Date'],
              ['customer', 'Customer'],
              ['against', 'Against invoice'],
              ['value', 'Value', true],
            ]}
            rows={(d.cdnr as Row[]) ?? []}
            empty="No notes."
          />
          <h3>HSN summary</h3>
          <Simple
            cols={[
              ['hsn', 'HSN'],
              ['rate', 'Rate %'],
              ['qty', 'Quantity'],
              ['taxable', 'Taxable', true],
              ['cgst', 'CGST', true],
              ['sgst', 'SGST', true],
              ['igst', 'IGST', true],
            ]}
            rows={(d.hsn as Row[]) ?? []}
            empty="No HSN lines."
          />
        </>
      ) : null}
      {filing ? (
        <FileDialog
          type="GSTR1"
          month={month}
          onClose={() => setFiling(false)}
          onDone={() => {
            setFiling(false);
            toast('GSTR-1 marked as filed');
            r.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------------- GSTR-3B
type T3 = 'return' | 'itc' | 'settle';
export function Gstr3bPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [tab, setTab] = useState<T3>('return');
  const [filing, setFiling] = useState(false);
  const r = useLoad(() => getJson<Row>(`/tax/gstr3b?month=${month}`), [month]);
  const status = (r.data?.status ?? {}) as Row;
  return (
    <>
      <PageHead
        title="GSTR-3B"
        sub="Monthly summary: output tax, input tax credit and what is payable in cash. The app prepares figures; you file on the portal."
      >
        {actions.post && s(status.status) !== 'Filed' ? (
          <button type="button" className="btn primary" onClick={() => setFiling(true)}>
            Mark as filed
          </button>
        ) : null}
      </PageHead>
      <MonthBar month={month} onChange={setMonth}>
        <span>
          {s(r.data?.gstin)} · <Pill>{s(status.status) || '…'}</Pill>
          {status.arn ? ` · ARN ${s(status.arn)}` : ''}
        </span>
      </MonthBar>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['return', 'Return'],
          ['itc', 'GSTR-2B & ITC'],
          ['settle', 'Settlement'],
        ]}
      />
      <ErrorBox message={r.error} />
      {tab === 'return' && r.data ? <ReturnTab d={r.data} /> : null}
      {tab === 'itc' ? <ItcTab month={month} actions={actions} /> : null}
      {tab === 'settle' ? <SettleTab month={month} actions={actions} onChange={r.reload} /> : null}
      {filing ? (
        <FileDialog
          type="GSTR3B"
          month={month}
          onClose={() => setFiling(false)}
          onDone={() => {
            setFiling(false);
            toast('GSTR-3B marked as filed');
            r.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ReturnTab({ d }: { d: Row }) {
  const s31 = d.s31 as Record<string, Row>;
  const s4 = d.s4 as Record<string, Row>;
  const s61 = d.s61 as Record<string, Row>;
  const labels31: Record<string, string> = {
    a_taxable: '3.1(a) Taxable outward supplies',
    b_zeroRated: '3.1(b) Zero rated',
    c_nilExempt: '3.1(c) Nil rated / exempt',
    d_reverseCharge: '3.1(d) Inward supplies on reverse charge',
    e_nonGst: '3.1(e) Non-GST outward',
  };
  const labels4: Record<string, string> = {
    a3_reverseCharge: '4A(3) Reverse charge',
    a5_other: '4A(5) All other ITC',
    b1_section175: '4B(1) Reversed: Section 17(5)',
    b2_other: '4B(2) Reversed: other (rule 37, notes)',
    c_net: '4C Net ITC available',
    d_ineligible: '4D Ineligible ITC',
  };
  const cols: [string, string, boolean?][] = [
    ['name', 'Item'],
    ['taxable', 'Taxable', true],
    ['igst', 'IGST', true],
    ['cgst', 'CGST', true],
    ['sgst', 'SGST', true],
  ];
  const fin = (o: Record<string, Row>, l?: Record<string, string>) =>
    Object.entries(o).map(([k, v]) => ({ name: l?.[k] ?? k, ...v }));
  return (
    <>
      <Issues list={(d.issues as Row[]) ?? []} />
      <h3>3.1 Outward and reverse-charge supplies</h3>
      <Simple cols={cols} rows={fin(s31, labels31)} empty="" />
      <h3>4 Input tax credit</h3>
      <Simple cols={cols.slice(0, 1).concat(cols.slice(2))} rows={fin(s4, labels4)} empty="" />
      <h3>6.1 Payment of tax</h3>
      <Simple
        cols={cols.slice(0, 1).concat(cols.slice(2))}
        rows={fin(s61, {
          outputTax: 'Output tax (net of notes)',
          reverseCharge: 'Reverse charge (cash only)',
          cashPayable: 'Payable in cash',
          creditAvailable: 'Credit left after set-off',
        }).filter((x) => x.name !== 'itcSetOff')}
        empty=""
      />
      <p>
        Interest {inr(s((d.s51 as Row).interest))} · late fee {inr(s((d.s51 as Row).lateFee))} (
        {s((d.s51 as Row).daysLate)} days late, counted to today). Due date {dmy(s(d.dueDate))}.
      </p>
    </>
  );
}

function ItcTab({ month, actions }: { month: string; actions: ActionSet }) {
  const toast = useToast();
  const rep = useLoad(() => getJson<Row>(`/tax/gstr2b?month=${month}`), [month]);
  const rev = useLoad(() => getJson<Row[]>(`/tax/itc/reversals?month=${month}`), [month]);
  const due = useLoad(() => getJson<Row>('/tax/itc/due-180'), []);
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    setMsg('');
    try {
      const payload: unknown = JSON.parse(await file.text());
      const res = await post<Row>('/tax/gstr2b/import', { month, sourceName: file.name, payload });
      toast(
        `Imported: ${s(res.matched)} matched, ${s(res.mismatch)} different, ${s(res.extra)} not in books`,
      );
      rep.reload();
    } catch (e) {
      setMsg(e instanceof SyntaxError ? 'That file is not valid JSON.' : toUiError(e).message);
    }
  }
  const sum = (rep.data?.summary ?? {}) as Row;
  return (
    <>
      <ErrorBox message={rep.error || msg} />
      {actions.add ? (
        <div className="toolbar">
          <label htmlFor="gstr2b-file">GSTR-2B JSON from the portal</label>
          <input
            id="gstr2b-file"
            type="file"
            accept="application/json,.json"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </div>
      ) : null}
      {rep.data?.imported ? (
        <p>
          Matched {s(sum.matched)} · different {s(sum.mismatch)} · in 2B but not in books{' '}
          {s(sum.extra)} · in books but not in 2B {s(sum.missing)} · ITC the portal marks not
          available {inr(s(sum.notEligible))}
        </p>
      ) : (
        <p>No GSTR-2B has been imported for this month.</p>
      )}
      <Simple
        cols={[
          ['supplierGstin', 'Supplier GSTIN'],
          ['docNo', 'Invoice'],
          ['docDate', 'Date'],
          ['taxable', 'Taxable', true],
          ['status', 'Match'],
          ['note', 'Note'],
        ]}
        rows={(rep.data?.rows as Row[]) ?? []}
        empty="Nothing imported."
      />
      <h3>In the books but not in GSTR-2B</h3>
      <Simple
        cols={[
          ['number', 'Our no.'],
          ['vendorInvoiceNo', 'Supplier invoice'],
          ['supplier', 'Supplier'],
          ['tax', 'Tax', true],
        ]}
        rows={(rep.data?.missing as Row[]) ?? []}
        empty="None."
      />
      <h3>ITC reversals of the month</h3>
      {actions.add ? (
        <button type="button" className="btn sm" onClick={() => setAdding(true)}>
          Add ITC reversal
        </button>
      ) : null}
      <Simple
        cols={[
          ['date', 'Date'],
          ['kind', 'Rule'],
          ['invoice', 'Invoice'],
          ['cgst', 'CGST', true],
          ['sgst', 'SGST', true],
          ['igst', 'IGST', true],
          ['note', 'Reason'],
        ]}
        rows={rev.data ?? []}
        empty="No reversals."
      />
      <h3>Invoices near the {s(due.data?.days)}-day line</h3>
      <Simple
        cols={[
          ['number', 'Invoice'],
          ['supplier', 'Supplier'],
          ['ageDays', 'Age (days)'],
          ['unpaid', 'Unpaid', true],
          ['tax', 'GST', true],
        ]}
        rows={(due.data?.rows as Row[]) ?? []}
        empty="Nothing close to the limit."
      />
      {adding ? (
        <ReversalDialog
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            toast('ITC reversal posted');
            rev.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ReversalDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState('R37A');
  const [date, setDate] = useState(todayIso());
  const [cgst, setCgst] = useState('');
  const [sgst, setSgst] = useState('');
  const [igst, setIgst] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <Modal
      title="ITC reversal"
      sub="Posts Dr ITC reversed / Cr Input GST. Use it for rule 37A, section 17(5) and other manual reversals."
      size="sm"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={note.trim().length < 5 || !(Number(cgst) || Number(sgst) || Number(igst))}
          onClick={() => {
            setMsg('');
            post('/tax/itc/reversals', {
              kind,
              date,
              cgst: cgst || '0',
              sgst: sgst || '0',
              igst: igst || '0',
              note: note.trim(),
            })
              .then(onDone)
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Post reversal
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="field">
        <label htmlFor="rk">Reason code *</label>
        <select id="rk" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="R37A">Rule 37A (supplier did not pay tax)</option>
          <option value="S17_5">Section 17(5) (blocked credit)</option>
          <option value="MANUAL">Other</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="rd">Date *</label>
        <DateField id="rd" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {[
        ['CGST', cgst, setCgst],
        ['SGST', sgst, setSgst],
        ['IGST', igst, setIgst],
      ].map(([l, v, f]) => (
        <div className="field" key={l as string}>
          <label htmlFor={`rv-${l as string}`}>{l as string}</label>
          <input
            id={`rv-${l as string}`}
            type="number"
            value={v as string}
            onChange={(e) => (f as (x: string) => void)(e.target.value)}
          />
        </div>
      ))}
      <div className="field">
        <label htmlFor="rn">Reason *</label>
        <input id="rn" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

function SettleTab({
  month,
  actions,
  onChange,
}: {
  month: string;
  actions: ActionSet;
  onChange: () => void;
}) {
  const toast = useToast();
  const [paidOn, setPaidOn] = useState(todayIso());
  const p = useLoad(
    () => getJson<Row>(`/tax/settlement?month=${month}&paidOn=${paidOn}`),
    [month, paidOn],
  );
  const banks = useLoad(
    () => getJson<{ id: string; name: string }[]>('/finance/bank-accounts'),
    [],
  );
  const [bank, setBank] = useState('');
  const [challan, setChallan] = useState('');
  const [msg, setMsg] = useState('');
  const plan = (p.data?.plan ?? {}) as Row;
  const done = p.data?.status as Row | null | undefined;
  return (
    <>
      <ErrorBox message={p.error || msg} />
      {done ? (
        <div className="msg success show static">
          Settled with challan {s(done.challanNo)}: cash {inr(s(done.cashPaid))}, interest{' '}
          {inr(s(done.interest))}, late fee {inr(s(done.lateFee))}.
        </div>
      ) : null}
      {p.data ? (
        <Simple
          cols={[
            ['name', 'Item'],
            ['igst', 'IGST', true],
            ['cgst', 'CGST', true],
            ['sgst', 'SGST', true],
          ]}
          rows={[
            { name: 'Output tax to settle', ...(plan.output as Row) },
            { name: 'Reverse charge (paid in cash)', ...(plan.rcm as Row) },
            { name: 'To pay in cash after ITC set-off', ...(plan.cash as Row) },
            {
              name: 'ITC used',
              igst: s((p.data.creditUsed as Row).igst),
              cgst: s((p.data.creditUsed as Row).cgst),
              sgst: s((p.data.creditUsed as Row).sgst),
            },
          ]}
          empty=""
        />
      ) : null}
      <p>
        Interest {inr(s(plan.interest))} · late fee {inr(s(plan.lateFee))} · total from bank{' '}
        {inr(s(p.data?.bankTotal))}. The set-off order is IGST credit first, then CGST and SGST
        credit against their own head and IGST.
      </p>
      {actions.post && !done ? (
        <div className="toolbar">
          <label htmlFor="st-date">Paid on</label>
          <DateField
            id="st-date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
          <label htmlFor="st-bank">Bank</label>
          <select id="st-bank" value={bank} onChange={(e) => setBank(e.target.value)}>
            <option value="">Choose…</option>
            {(banks.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <label htmlFor="st-ch">Challan (PMT-06) no.</label>
          <input id="st-ch" value={challan} onChange={(e) => setChallan(e.target.value)} />
          <button
            type="button"
            className="btn primary"
            disabled={!bank || challan.trim().length < 3}
            onClick={() => {
              setMsg('');
              post('/tax/settlement', {
                month,
                paidOn,
                bankAccountId: bank,
                challanNo: challan.trim(),
              })
                .then(() => {
                  toast('Settlement posted');
                  p.reload();
                  onChange();
                })
                .catch((e: unknown) => setMsg(toUiError(e).message));
            }}
          >
            Post settlement
          </button>
        </div>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------------ e-invoice
export function EinvoicePage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { node: askNode, ask } = useAsk();
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const pend = useLoad(() => getJson<Row>('/tax/einvoice/pending'), []);
  const recs = useLoad(() => getJson<Row[]>('/tax/einvoice/records'), []);
  const [entering, setEntering] = useState<Row | null>(null);
  const [msg, setMsg] = useState('');
  async function json(r: Row) {
    setMsg('');
    try {
      const out = await getJson<Row>(
        `/tax/einvoice/request-json?docType=${s(r.docType)}&docId=${s(r.id)}`,
      );
      saveText(
        JSON.stringify(out.json, null, 2),
        `einvoice_${s(r.docNo).replace(/[^A-Za-z0-9]/g, '_')}.json`,
      );
      const miss = (out.missing as string[]) ?? [];
      if (miss.length) setMsg(`File saved, but check: ${miss.join(' ')}`);
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  return (
    <>
      <PageHead
        title="E-Invoice"
        sub="Make the IRP request file, upload it on the e-invoice portal, then type the IRN and acknowledgement here. The app does not connect to the portal."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['pending', 'Waiting for an IRN'],
          ['done', 'Recorded'],
        ]}
      />
      <ErrorBox message={msg || pend.error || recs.error} />
      {tab === 'pending' ? (
        <>
          {pend.data && !pend.data.enabled ? (
            <p>E-invoice is not switched on for this unit's GST registration (GST Setup).</p>
          ) : null}
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Value</th>
                  <th>Age (days)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {((pend.data?.rows as Row[]) ?? []).length === 0 && !pend.loading ? (
                  <Empty cols={6}>No B2B document is waiting.</Empty>
                ) : null}
                {((pend.data?.rows as Row[]) ?? []).map((r) => (
                  <tr key={s(r.id)} className={r.late ? 'row-red' : undefined}>
                    <td>
                      {s(r.docType)} {s(r.docNo)}
                    </td>
                    <td>{dmy(s(r.date))}</td>
                    <td>{s(r.customer)}</td>
                    <td>{inr(s(r.total))}</td>
                    <td>
                      {s(r.ageDays)}
                      {r.late ? ' (late)' : ''}
                    </td>
                    <td>
                      <button type="button" className="btn sm" onClick={() => void json(r)}>
                        Download request JSON
                      </button>{' '}
                      {actions.add ? (
                        <button
                          type="button"
                          className="btn sm primary"
                          onClick={() => setEntering(r)}
                        >
                          Enter IRN
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>IRN</th>
                <th>Ack no.</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(recs.data ?? []).length === 0 && !recs.loading ? (
                <Empty cols={5}>No IRN recorded yet.</Empty>
              ) : null}
              {(recs.data ?? []).map((r) => (
                <tr key={s(r.id)}>
                  <td>
                    {s(r.docType)} {s(r.docNo)}
                  </td>
                  <td title={s(r.irn)}>{s(r.irn).slice(0, 16)}…</td>
                  <td>{s(r.ackNo)}</td>
                  <td>
                    <Pill>{s(r.status)}</Pill>
                    {r.lateReported ? ' late' : ''}
                  </td>
                  <td>
                    {actions.cancel && s(r.status) === 'Generated' ? (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() =>
                          ask(
                            'Cancel IRN',
                            [{ key: 'reason', label: 'Why is this IRN cancelled? (5+ letters)' }],
                            (v) => {
                              post(`/tax/einvoice/${s(r.id)}/cancel`, { reason: v.reason })
                                .then(() => {
                                  toast('IRN cancelled');
                                  recs.reload();
                                })
                                .catch((e: unknown) => setMsg(toUiError(e).message));
                            },
                          )
                        }
                      >
                        Cancel IRN
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {askNode}
      {entering ? (
        <IrnDialog
          row={entering}
          onClose={() => setEntering(null)}
          onDone={() => {
            setEntering(null);
            toast('IRN recorded');
            pend.reload();
            recs.reload();
          }}
        />
      ) : null}
    </>
  );
}

function IrnDialog({
  row,
  onClose,
  onDone,
}: {
  row: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const [irn, setIrn] = useState('');
  const [ack, setAck] = useState('');
  const [when, setWhen] = useState(localNow());
  const [msg, setMsg] = useState('');
  return (
    <Modal
      title={`IRN for ${s(row.docNo)}`}
      sub="Type what the e-invoice portal returned."
      size="sm"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={irn.trim().length !== 64 || ack.trim().length < 6}
          onClick={() => {
            setMsg('');
            post('/tax/einvoice', {
              docType: s(row.docType),
              docId: s(row.id),
              irn: irn.trim(),
              ackNo: ack.trim(),
              ackDate: new Date(when).toISOString(),
            })
              .then(onDone)
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Save IRN
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="field">
        <label htmlFor="irn">IRN (64 characters) *</label>
        <input id="irn" value={irn} onChange={(e) => setIrn(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ack">Acknowledgement no. *</label>
        <input id="ack" value={ack} onChange={(e) => setAck(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ackd">Acknowledgement date and time *</label>
        <input
          id="ackd"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------------ e-way bill
export function EwayPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { node: askNode, ask } = useAsk();
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const pend = useLoad(() => getJson<Row>('/tax/eway/pending'), []);
  const list = useLoad(() => getJson<Row[]>('/tax/eway'), []);
  const [entering, setEntering] = useState<Row | null>(null);
  const [msg, setMsg] = useState('');
  async function json(r: Row, km: string) {
    try {
      const out = await getJson<Row>(
        `/tax/eway/request-json?invoiceId=${s(r.id)}&distanceKm=${encodeURIComponent(km)}`,
      );
      saveText(
        JSON.stringify({ version: '1.0.0621', billLists: [out.json] }, null, 2),
        `ewaybill_${s(r.docNo).replace(/[^A-Za-z0-9]/g, '_')}.json`,
      );
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  return (
    <>
      <PageHead
        title="E-Way Bill"
        sub="Make the Part-A / Part-B file for the e-way bill portal, then type the e-way bill number here. The app does not connect to the portal."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['pending', 'Invoices without a bill'],
          ['done', 'E-way bills'],
        ]}
      />
      <ErrorBox message={msg || pend.error || list.error} />
      {tab === 'pending' ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {((pend.data?.rows as Row[]) ?? []).length === 0 && !pend.loading ? (
                <Empty cols={5}>
                  Every invoice above {inr(s(pend.data?.minValue))} has an e-way bill.
                </Empty>
              ) : null}
              {((pend.data?.rows as Row[]) ?? []).map((r) => (
                <tr key={s(r.id)}>
                  <td>{s(r.docNo)}</td>
                  <td>{dmy(s(r.date))}</td>
                  <td>{s(r.customer)}</td>
                  <td>{inr(s(r.total))}</td>
                  <td>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() =>
                        ask(
                          'Distance',
                          [{ key: 'km', label: 'Distance in kilometres', type: 'number' }],
                          (v) => void json(r, v.km ?? ''),
                        )
                      }
                    >
                      Download request JSON
                    </button>{' '}
                    {actions.add ? (
                      <button
                        type="button"
                        className="btn sm primary"
                        onClick={() => setEntering(r)}
                      >
                        Enter e-way bill
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>E-way bill</th>
                <th>Km</th>
                <th>Valid until</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).length === 0 && !list.loading ? (
                <Empty cols={6}>No e-way bill recorded.</Empty>
              ) : null}
              {(list.data ?? []).map((r) => (
                <tr key={s(r.id)} className={r.expired ? 'row-red' : undefined}>
                  <td>{s(r.docNo)}</td>
                  <td>{s(r.ewbNo)}</td>
                  <td>{s(r.distanceKm)}</td>
                  <td>{new Date(s(r.validUntil)).toLocaleString('en-IN')}</td>
                  <td>
                    <Pill>{r.expired ? 'Expired' : s(r.status)}</Pill>
                  </td>
                  <td>
                    {actions.edit && s(r.status) === 'Active' ? (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() =>
                          ask(
                            'Extend e-way bill',
                            [
                              { key: 'km', label: 'Remaining distance (km)', type: 'number' },
                              { key: 'reason', label: 'Reason for the extension' },
                            ],
                            (v) => {
                              post(`/tax/eway/${s(r.id)}/extend`, {
                                remainingKm: Number(v.km),
                                reason: v.reason,
                              })
                                .then(() => {
                                  toast('Validity extended');
                                  list.reload();
                                })
                                .catch((e: unknown) => setMsg(toUiError(e).message));
                            },
                          )
                        }
                      >
                        Extend
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {askNode}
      {entering ? (
        <EwbDialog
          row={entering}
          onClose={() => setEntering(null)}
          onDone={() => {
            setEntering(null);
            toast('E-way bill recorded');
            pend.reload();
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function EwbDialog({
  row,
  onClose,
  onDone,
}: {
  row: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const [no, setNo] = useState('');
  const [km, setKm] = useState('');
  const [veh, setVeh] = useState('');
  const [when, setWhen] = useState(localNow());
  const [msg, setMsg] = useState('');
  return (
    <Modal
      title={`E-way bill for ${s(row.docNo)}`}
      sub="Type what the e-way bill portal returned."
      size="sm"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={no.trim().length !== 12 || !Number(km)}
          onClick={() => {
            setMsg('');
            post('/tax/eway', {
              invoiceId: s(row.id),
              ewbNo: no.trim(),
              ewbDate: new Date(when).toISOString(),
              distanceKm: Number(km),
              vehicleNo: veh || undefined,
            })
              .then(onDone)
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Save e-way bill
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="field">
        <label htmlFor="ewn">E-way bill no. (12 digits) *</label>
        <input id="ewn" value={no} onChange={(e) => setNo(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ewd">Generated on *</label>
        <input
          id="ewd"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ewk">Distance (km) *</label>
        <input id="ewk" type="number" value={km} onChange={(e) => setKm(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ewv">Vehicle no.</label>
        <input id="ewv" value={veh} onChange={(e) => setVeh(e.target.value)} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------ TDS returns + exports
export function TdsReturnsSection({ kind, actions }: { kind: 'tds' | 'tcs'; actions: ActionSet }) {
  const k = kind.toUpperCase();
  const now = new Date();
  const fy0 = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [fy, setFy] = useState(String(fy0));
  const [q, setQ] = useState('1');
  const ret = useLoad(
    () => getJson<Row>(`/tax/tds/return?kind=${k}&fy=${fy}&quarter=${q}`),
    [k, fy, q],
  );
  const map = useLoad(() => getJson<Row[]>(`/tax/tds/challan-map?kind=${k}`), [k]);
  const [msg] = useState('');
  return (
    <>
      <h3>Quarterly return data ({s(ret.data?.form)})</h3>
      <div className="toolbar">
        <label htmlFor="tr-fy">Financial year starting</label>
        <input id="tr-fy" type="number" value={fy} onChange={(e) => setFy(e.target.value)} />
        <label htmlFor="tr-q">Quarter</label>
        <select id="tr-q" value={q} onChange={(e) => setQ(e.target.value)}>
          {['1', '2', '3', '4'].map((x) => (
            <option key={x} value={x}>
              Q{x}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={!ret.data}
          onClick={() =>
            saveText(JSON.stringify(ret.data, null, 2), `${s(ret.data?.form)}_${fy}_Q${q}.json`)
          }
        >
          Download return data
        </button>
      </div>
      <ErrorBox message={ret.error || map.error || msg} />
      {ret.data ? (
        <>
          <p>
            {s(ret.data.entries)} entries · tax {inr(s(ret.data.totalTds))} · interest on late
            deposit {inr(s(ret.data.interestLateDeposit))}. {s(ret.data.note)}
          </p>
          <Issues list={(ret.data.issues as Row[]) ?? []} />
          <Simple
            cols={[
              ['deductee', 'Deductee'],
              ['pan', 'PAN'],
              ['section', 'Section'],
              ['deductedOn', 'Deducted'],
              ['base', 'Amount', true],
              ['tds', 'Tax', true],
              ['challanNo', 'Challan'],
              ['interest', 'Interest', true],
            ]}
            rows={(ret.data.rows as Row[]) ?? []}
            empty="No deductions in this quarter."
          />
        </>
      ) : null}
      <h3>Challan to entry mapping</h3>
      <Simple
        cols={[
          ['challanNo', 'Challan'],
          ['paidOn', 'Paid on'],
          ['amount', 'Amount', true],
          ['mapped', 'Mapped to entries', true],
          ['difference', 'Difference', true],
        ]}
        rows={map.data ?? []}
        empty="No challan yet."
      />
      {kind === 'tds' ? <LdcBlock canAdd={actions.add} /> : null}
    </>
  );
}

function LdcBlock({ canAdd }: { canAdd: boolean }) {
  const toast = useToast();
  const list = useLoad(() => getJson<Row[]>('/tax/tds/ldc'), []);
  const sups = useLoad(() => lookupSuppliers(), []);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({
    supplierId: '',
    sectionCode: '194C',
    certNo: '',
    ratePct: '',
    validFrom: todayIso(),
    validTo: todayIso(),
  });
  const [msg, setMsg] = useState('');
  return (
    <>
      <h3>Lower-deduction certificates</h3>
      <p>
        A certificate that is valid on the invoice date and matches the section sets the rate at
        deduction.
      </p>
      <ErrorBox message={list.error} />
      {canAdd ? (
        <button type="button" className="btn sm" onClick={() => setAdding(true)}>
          Add certificate
        </button>
      ) : null}
      <Simple
        cols={[
          ['supplier', 'Supplier'],
          ['section', 'Section'],
          ['certNo', 'Certificate'],
          ['ratePct', 'Rate %'],
          ['validFrom', 'From'],
          ['validTo', 'To'],
        ]}
        rows={list.data ?? []}
        empty="No certificate recorded."
      />
      {adding ? (
        <Modal
          title="Lower-deduction certificate"
          sub="Enter it as the tax office issued it."
          size="sm"
          onClose={() => setAdding(false)}
          footer={
            <button
              type="button"
              className="btn primary"
              disabled={!f.supplierId || f.certNo.trim().length < 3 || !f.ratePct}
              onClick={() => {
                setMsg('');
                post('/tax/tds/ldc', f)
                  .then(() => {
                    setAdding(false);
                    toast('Certificate saved');
                    list.reload();
                  })
                  .catch((e: unknown) => setMsg(toUiError(e).message));
              }}
            >
              Save certificate
            </button>
          }
        >
          <ErrorBox message={msg} />
          <div className="field">
            <label htmlFor="ld-s">Supplier *</label>
            <select
              id="ld-s"
              value={f.supplierId}
              onChange={(e) => setF({ ...f, supplierId: e.target.value })}
            >
              <option value="">Choose…</option>
              {(sups.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {(
            [
              ['sectionCode', 'Section *', 'text'],
              ['certNo', 'Certificate no. *', 'text'],
              ['ratePct', 'Rate % *', 'number'],
              ['validFrom', 'Valid from *', 'date'],
              ['validTo', 'Valid to *', 'date'],
            ] as const
          ).map(([k, l, t]) => (
            <div className="field" key={k}>
              <label htmlFor={`ld-${k}`}>{l}</label>
              <input
                id={`ld-${k}`}
                type={t}
                value={f[k]}
                onChange={(e) => setF({ ...f, [k]: e.target.value })}
              />
            </div>
          ))}
        </Modal>
      ) : null}
    </>
  );
}

export function RegisterExport({ kind }: { kind: 'sales' | 'purchase' | 'tds' | 'tcs' }) {
  const [from, setFrom] = useState(`${thisMonth()}-01`);
  const [to, setTo] = useState(todayIso());
  const [msg, setMsg] = useState('');
  return (
    <div className="toolbar">
      <label htmlFor="rx-from">Export from</label>
      <DateField id="rx-from" value={from} onChange={(e) => setFrom(e.target.value)} />
      <label htmlFor="rx-to">to</label>
      <DateField id="rx-to" value={to} onChange={(e) => setTo(e.target.value)} />
      <button
        type="button"
        className="btn"
        onClick={() => {
          setMsg('');
          download(`/tax/registers/${kind}/export.xlsx?from=${from}&to=${to}`)
            .then(({ blob, filename }) => saveBlob(blob, filename ?? `${kind}-register.xlsx`))
            .catch((e: unknown) => setMsg(toUiError(e).message));
        }}
      >
        Export to Excel
      </button>
      <ErrorBox message={msg} />
    </div>
  );
}
