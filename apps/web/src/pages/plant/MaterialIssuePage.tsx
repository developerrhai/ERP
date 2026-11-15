// Material Issue (mfg-material-issue): the V40 tabs of the order material lines. Outside the tab frame (and under "Classic view")
// the page keeps what it always showed: the stock transactions page, where material is issued to and returned from orders.
import { Link } from 'react-router-dom';
import type { ActionSet } from '../../types';
import { PlantV40 } from './PlantV40';

export function MaterialIssuePage({ actions }: { actions?: ActionSet }) {
  return (
    <PlantV40
      pageId="mfg-material-issue"
      actions={actions}
      fallback={
        <p>
          Material is issued to and returned from a production order on the order page, and every movement is in{' '}
          <Link to="/m/inv-transactions">Stock Transactions</Link>.
        </p>
      }
    />
  );
}
