// QmsInboundPort (PHASE-09 §5): the hook Phase 12 (QMS) plugs into. Until then it is a no-op, so a posted GRN
// only leaves its Quality-Inspection stock waiting for qcDecide (called by Phase 12 on usage decision).
import type { Db } from '../../core/db/prisma';

export interface GrnPostedEvent {
  grnId: string;
  grnNo: string;
  unitId: string;
  lines: {
    grnLineId: string;
    itemId: string;
    baseQty: string;
    qcRequired: boolean;
    batchIds: string[];
  }[];
}
export interface QmsInboundPortImpl {
  onGrnPosted(tx: Db, e: GrnPostedEvent): Promise<void>;
}

let impl: QmsInboundPortImpl = { async onGrnPosted() {} };
export const QmsInboundPort: QmsInboundPortImpl = {
  onGrnPosted: (tx, e) => impl.onGrnPosted(tx, e),
};
/** Phase 12 registers its inspection-lot creator here. */
export function setQmsInboundPort(next: QmsInboundPortImpl | null): void {
  impl = next ?? { async onGrnPosted() {} };
}
