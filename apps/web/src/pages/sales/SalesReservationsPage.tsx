// Sales Reservations (V40 sales-reservations). Inside the V40 tab frame every tab is a view of the stock reservations
// (the API reads stock_reservations, the sales order they serve and the stock on hand); outside the frame the
// inventory reservation page is shown unchanged. Needs one line in ModulePage.tsx:
//   case 'sales-reservations': return <SalesReservationsPage actions={actions} />;
import { useToast } from '../../components/Toast';
import { toUiMessage } from '../../lib/errors';
import { extendReservation, releaseReservation } from '../../lib/inventoryApi';
import { api } from '../../lib/api';
import { useState } from 'react';
import { ReservationEdit } from './SalesEditDialogs';
import { usePagePermissions } from '../../lib/usePagePermissions';
import type { ActionSet } from '../../types';
import { ReservationsPage } from '../inventory/StockPages';
import { V40Register } from './V40Register';

const OPEN = ['Waiting', 'Partial', 'Reserved'];

export function SalesReservationsPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [editing, setEditing] = useState<{ id: string; code: string } | null>(null);
  // bumped after an edit, so the register reads the rows again
  const [saved, setSaved] = useState(0);
  // changing reserved stock is an Inventory right: this page's own "add" and "edit" do not carry it
  const stock = usePagePermissions('inv-reservation');
  const mayChange = stock.actions.edit;
  const reallocate = (id: string): void =>
    void api<{ code: string; added: number }>(`/inventory/reservations/${id}/reallocate`, { method: 'POST', body: {} })
      .then((r) => {
        toast(r.added > 0 ? `${r.added} more reserved for ${r.code}.` : `No free stock for ${r.code} yet.`);
        setSaved((n) => n + 1);
      })
      .catch((e: unknown) => toast(toUiMessage(e)));
  // wait for the answer: the hidden Inventory screen must not be opened by someone who may not read it
  if (stock.loading) return <p className="muted">Loading…</p>;
  return (
    <>
      {editing ? (
        <ReservationEdit
          id={editing.id}
          code={editing.code}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setSaved((n) => n + 1);
          }}
        />
      ) : null}
      <V40Register
        pageId="sales-reservations"
        host={stock.actions.view}
        actions={{ ...actions, add: actions.add && stock.actions.add }}
        reloadKey={saved}
        onEdit={actions.edit ? (id, row) => setEditing({ id, code: row?.number ?? '' }) : undefined}
        canEditRow={(st) => mayChange && OPEN.includes(st)}
        onAllocate={actions.edit && mayChange ? reallocate : undefined}
        allocateOff={mayChange ? undefined : 'Changing reserved stock needs the Inventory reservation right.'}
        fallback={<ReservationsPage actions={{ ...actions, add: actions.add && stock.actions.add, edit: actions.edit && mayChange }} />}
        rowExtra={(r, reload) =>
          OPEN.includes(r.status) && actions.edit && mayChange ? (
            <>
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  void extendReservation(r.id, Number(r.version), 7)
                    .then(() => {
                      toast('Extended by 7 days.');
                      reload();
                    })
                    .catch((e: unknown) => toast(toUiMessage(e)))
                }
              >
                +7 days
              </button>
              <button
                type="button"
                className="btn sm danger"
                onClick={() =>
                  void releaseReservation(r.id, Number(r.version), 'Released by user')
                    .then(() => {
                      toast('Reservation released.');
                      reload();
                    })
                    .catch((e: unknown) => toast(toUiMessage(e)))
                }
              >
                Release
              </button>
            </>
          ) : null
        }
      />
    </>
  );
}
