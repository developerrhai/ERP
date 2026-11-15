// Sales Reservations (V40 sales-reservations). Inside the V40 tab frame every tab is a view of the stock reservations
// (the API reads stock_reservations, the sales order they serve and the stock on hand); outside the frame the
// inventory reservation page is shown unchanged. Needs one line in ModulePage.tsx:
//   case 'sales-reservations': return <SalesReservationsPage actions={actions} />;
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { extendReservation, releaseReservation } from '../../lib/inventoryApi';
import type { ActionSet } from '../../types';
import { ReservationsPage } from '../inventory/StockPages';
import { V40Register } from './V40Register';

const OPEN = ['Waiting', 'Partial', 'Reserved'];

export function SalesReservationsPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  return (
    <V40Register
      pageId="sales-reservations"
      actions={actions}
      fallback={<ReservationsPage actions={actions} />}
      rowExtra={(r, reload) =>
        OPEN.includes(r.status) && actions.edit ? (
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
                  .catch((e: unknown) => toast(toUiError(e).message))
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
                  .catch((e: unknown) => toast(toUiError(e).message))
              }
            >
              Release
            </button>
          </>
        ) : null
      }
    />
  );
}
