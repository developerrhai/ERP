// Phase 13 job work: the inward / outward register per customer PO line, and the rework register against the customer's
// delivery challan. The customer's own material is kept on the Customer Material screen (non-valued); these registers keep
// the paperwork balances per PO line and per challan. Balances are calculated on the server.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { mget, mlist, mpost } from '../../lib/mfgApi';
import type { Row } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, PageHead, Pill, todayIso } from '../finance/shared';
import { FileButton, FormModal, ORDER_TONE, s } from './Kit';

// ------------------------------------------------------------------------------------------------ PO lines
function LinePanel({
  id,
  actions,
  onClose,
  onChanged,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const doc = useLoad(() => mget(`/jobwork/lines/${id}`), [id]);
  const [adding, setAdding] = useState<'INWARD' | 'OUTWARD' | null>(null);
  const [msg, setMsg] = useState('');
  const l = doc.data;
  const refresh = () => {
    doc.reload();
    onChanged();
  };
  return (
    <Modal
      title={l ? `${s(l.customerPoNo)} · line ${s(l.poLineNo)}` : 'Customer PO line'}
      sub={l ? `${s(l.customerName)} · ${s(l.part)}` : ''}
      onClose={onClose}
      footer={
        l && actions.post && s(l.status) === 'Open' ? (
          <>
            <button type="button" className="btn primary" onClick={() => setAdding('INWARD')}>
              Material received
            </button>
            <button type="button" className="btn" onClick={() => setAdding('OUTWARD')}>
              Goods sent out
            </button>
          </>
        ) : undefined
      }
    >
      <ErrorBox message={msg || doc.error} />
      {l ? (
        <>
          <p>
            PO quantity <b>{s(l.poQty)}</b> {s(l.uom)} · received <b>{s(l.inwardQty)}</b> · sent out{' '}
            <b>{s(l.outwardQty)}</b> · still to deliver <b>{s(l.openQty)}</b> · held with us{' '}
            <b>{s(l.heldQty)}</b>
          </p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Direction</th>
                <th>Quantity</th>
                <th>Challan / document</th>
                <th>Remark</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(l.moves as Row[]).length === 0 ? (
                <Empty cols={6}>Nothing recorded yet.</Empty>
              ) : null}
              {(l.moves as Row[]).map((m) => (
                <tr key={s(m.id)}>
                  <td>{dmy(s(m.moveDate))}</td>
                  <td>{s(m.direction) === 'INWARD' ? 'Received' : 'Sent out'}</td>
                  <td>{s(m.qty)}</td>
                  <td>{s(m.docNo)}</td>
                  <td>{s(m.remark)}</td>
                  <td>
                    {s(m.status) === 'Cancelled' ? (
                      <Pill tone="cancelled">Cancelled</Pill>
                    ) : actions.cancel ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setMsg('');
                          mpost(`/jobwork/lines/${id}/moves/${s(m.id)}/cancel`, {})
                            .then(() => {
                              toast('Entry cancelled');
                              refresh();
                            })
                            .catch((e: unknown) => setMsg(toUiError(e).message));
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {adding ? (
        <FormModal
          title={
            adding === 'INWARD'
              ? 'Material received from the customer'
              : 'Goods sent out to the customer'
          }
          size="sm"
          fields={[
            { key: 'qty', label: 'Quantity', type: 'number', required: true },
            { key: 'docNo', label: 'Challan / document no.', required: true },
            { key: 'moveDate', label: 'Date', type: 'date' },
            { key: 'remark', label: 'Remark' },
          ]}
          initial={{ moveDate: todayIso() }}
          onClose={() => setAdding(null)}
          onSubmit={async (v) => {
            await mpost(`/jobwork/lines/${id}/moves`, { direction: adding, ...v });
            toast('Recorded');
            setAdding(null);
            refresh();
          }}
        />
      ) : null}
    </Modal>
  );
}

export function JobWorkTab({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [status, setStatus] = useState('Open');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = useLoad(() => mlist('/jobwork/lines', { status }), [status]);
  return (
    <>
      <PageHead
        title="Job work"
        sub="Customer-supplied material: what the customer's PO line asks for, what we received and what we sent back, per PO line."
      />
      <div className="toolbar">
        <label htmlFor="jw-status">Status</label>
        <select id="jw-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option>Open</option>
          <option>Closed</option>
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + Register a customer PO line
          </button>
        ) : null}
        {actions.print ? (
          <FileButton path="/export/jobwork" name="mfg-jobwork.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>PO / line</th>
              <th>Part</th>
              <th>PO qty</th>
              <th>Received</th>
              <th>Sent out</th>
              <th>Open qty</th>
              <th>Held</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={9}>No customer PO lines registered.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>{s(r.customerName)}</td>
                <td>
                  <button type="button" className="link" onClick={() => setOpen(s(r.id))}>
                    {s(r.customerPoNo)} / {s(r.poLineNo)}
                  </button>
                </td>
                <td>{s(r.part)}</td>
                <td>
                  {s(r.poQty)} {s(r.uom)}
                </td>
                <td>{s(r.inwardQty)}</td>
                <td>{s(r.outwardQty)}</td>
                <td>{s(r.openQty)}</td>
                <td>{s(r.heldQty)}</td>
                <td>
                  <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <LinePanel
          id={open}
          actions={actions}
          onClose={() => setOpen(null)}
          onChanged={list.reload}
        />
      ) : null}
      {adding ? (
        <FormModal
          title="Register a customer PO line"
          fields={[
            { key: 'customerId', label: 'Customer', type: 'customer', required: true },
            { key: 'customerPoNo', label: 'Customer PO no.', required: true },
            { key: 'poLineNo', label: 'PO line no.', type: 'number' },
            { key: 'itemId', label: 'Item (optional)', type: 'item' },
            { key: 'part', label: 'Part', required: true },
            { key: 'poQty', label: 'PO quantity', type: 'number', required: true },
            { key: 'uom', label: 'Unit', required: true },
          ]}
          initial={{ poLineNo: '1', uom: 'Nos' }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            await mpost('/jobwork/lines', {
              ...v,
              poLineNo: v.poLineNo ? Number(v.poLineNo) : undefined,
            });
            toast('Registered');
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ rework against the challan
export function ChallanReworkTab({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState<Row | null>(null);
  const [view, setView] = useState<Row | null>(null);
  const list = useLoad(() => mlist('/challan-rework', { open: onlyOpen }), [onlyOpen]);
  return (
    <>
      <div className="toolbar">
        <label htmlFor="cr-open">
          <input
            id="cr-open"
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
          />{' '}
          Only with balance to rework
        </label>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + Customer challan for rework
          </button>
        ) : null}
        {actions.print ? (
          <FileButton
            path="/export/challan-rework"
            name="mfg-challan-rework.xlsx"
            label="Export Excel"
          />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Challan no.</th>
              <th>Date</th>
              <th>Part</th>
              <th>Challan qty</th>
              <th>Reworked</th>
              <th>Balance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={8}>No challans in the rework register.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>{s(r.customerName)}</td>
                <td>{s(r.challanNo)}</td>
                <td>{dmy(s(r.challanDate))}</td>
                <td>{s(r.part)}</td>
                <td>{s(r.challanQty)}</td>
                <td>{s(r.doneQty)}</td>
                <td>{s(r.balanceQty)}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      mget(`/challan-rework/${s(r.id)}`)
                        .then(setView)
                        .catch(() => undefined);
                    }}
                  >
                    History
                  </button>
                  {actions.edit && Number(s(r.balanceQty)) > 0 ? (
                    <button type="button" className="btn" onClick={() => setDone(r)}>
                      Rework done
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view ? (
        <Modal
          title={`Challan ${s(view.challanNo)}`}
          sub={`${s(view.customerName)} · ${s(view.part)}`}
          onClose={() => setView(null)}
          footer={
            <button type="button" className="btn" onClick={() => setView(null)}>
              Close
            </button>
          }
        >
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Quantity</th>
                <th>Rework done at our challan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(view.done as Row[]).length === 0 ? (
                <Empty cols={4}>No rework recorded yet.</Empty>
              ) : null}
              {(view.done as Row[]).map((d) => (
                <tr key={s(d.id)}>
                  <td>{dmy(s(d.doneDate))}</td>
                  <td>{s(d.qty)}</td>
                  <td>{s(d.doneChallanNo)}</td>
                  <td>
                    {s(d.status) === 'Cancelled' ? (
                      <Pill tone="cancelled">Cancelled</Pill>
                    ) : actions.cancel ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          mpost(`/challan-rework/${s(view.id)}/done/${s(d.id)}/cancel`, {})
                            .then((x) => {
                              setView(x);
                              list.reload();
                            })
                            .catch(() => undefined);
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      ) : null}
      {adding ? (
        <FormModal
          title="Customer challan for rework"
          fields={[
            { key: 'customerId', label: 'Customer', type: 'customer', required: true },
            { key: 'challanNo', label: 'Challan no.', required: true },
            { key: 'challanDate', label: 'Challan date', type: 'date', required: true },
            { key: 'itemId', label: 'Item (optional)', type: 'item' },
            { key: 'part', label: 'Part', required: true },
            { key: 'challanQty', label: 'Challan quantity', type: 'number', required: true },
            { key: 'remark', label: 'Remark' },
          ]}
          initial={{ challanDate: todayIso() }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            await mpost('/challan-rework', v);
            toast('Added');
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
      {done ? (
        <FormModal
          title={`Rework done on challan ${s(done.challanNo)}`}
          sub={`Balance to rework: ${s(done.balanceQty)}`}
          size="sm"
          fields={[
            { key: 'qty', label: 'Quantity reworked', type: 'number', required: true },
            { key: 'doneChallanNo', label: 'Our challan no. (delivered back)', required: true },
            { key: 'doneDate', label: 'Date', type: 'date' },
          ]}
          initial={{ doneDate: todayIso() }}
          onClose={() => setDone(null)}
          onSubmit={async (v) => {
            await mpost(`/challan-rework/${s(done.id)}/done`, v);
            toast('Recorded');
            setDone(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}
