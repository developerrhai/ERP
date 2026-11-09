// Registers what the manufacturing module does when the quality module records a Usage Decision on a production lot:
// a finished-goods lot releases or blocks the received stock, an in-process lot trims the job card to the accepted pieces.
import { query } from '../procurement/core';
import { registerLotDecisionHook } from '../qms/inspection-service';
import { onOpLotDecided } from './jobcard-service';
import { S } from './master-service';
import { onFgLotDecided } from './order-service';

registerLotDecisionHook(async (tx, caller, lotId, accepted, rejected) => {
  const lot = (await query(tx, `SELECT kind FROM mfg_lots WHERE id=$1::uuid`, lotId))[0];
  if (!lot) return;
  if (S(lot.kind) === 'FG') await onFgLotDecided(tx, caller, lotId, accepted, rejected);
  else await onOpLotDecided(tx, lotId, rejected);
});
