// Reorder arithmetic (BR-INV-40..44), pure and Decimal-only: average daily usage, safety stock, reorder level, EOQ,
// net requirement and the suggested order quantity. The service feeds it numbers read from the ledger.
import { D, ZERO, round3 } from './money';
import type { Dec } from './money';

/** Service level % -> z (standard normal), linear interpolation between rows. */
const Z_TABLE: readonly (readonly [number, number])[] = [
  [50, 0],
  [80, 0.8416],
  [85, 1.0364],
  [90, 1.2816],
  [92, 1.4051],
  [94, 1.5548],
  [95, 1.6449],
  [96, 1.7507],
  [97, 1.8808],
  [97.5, 1.96],
  [98, 2.0537],
  [99, 2.3263],
  [99.5, 2.5758],
  [99.9, 3.0902],
];

export function zFor(serviceLevelPct: number): Dec {
  const first = Z_TABLE[0]!;
  const last = Z_TABLE[Z_TABLE.length - 1]!;
  if (serviceLevelPct <= first[0]) return D(first[1]);
  if (serviceLevelPct >= last[0]) return D(last[1]);
  for (let i = 1; i < Z_TABLE.length; i++) {
    const [x1, y1] = Z_TABLE[i]!;
    const [x0, y0] = Z_TABLE[i - 1]!;
    if (serviceLevelPct <= x1) {
      return D(y0).plus(D(y1).minus(y0).times(D(serviceLevelPct).minus(x0)).div(D(x1).minus(x0)));
    }
  }
  return D(last[1]);
}

/** Sample standard deviation (n - 1) of daily usage; 0 for fewer than 2 days. */
export function sampleSigma(daily: readonly Dec[]): Dec {
  const n = daily.length;
  if (n < 2) return ZERO;
  const mean = daily.reduce((a, b) => a.plus(b), ZERO).div(n);
  const ss = daily.reduce((a, x) => a.plus(x.minus(mean).pow(2)), ZERO);
  return ss.div(n - 1).sqrt();
}

/** SS = z x sigma_d x sqrt(LT); with lead-time variability: z x sqrt(LT x sigma_d^2 + ADU^2 x sigma_LT^2). */
export function safetyStock(z: Dec, sigmaD: Dec, leadDays: number, adu: Dec, sigmaLt = 0): Dec {
  if (sigmaLt > 0) {
    return round3(
      z.times(
        D(leadDays)
          .times(sigmaD.pow(2))
          .plus(adu.pow(2).times(D(sigmaLt).pow(2)))
          .sqrt(),
      ),
    );
  }
  return round3(z.times(sigmaD).times(D(leadDays).sqrt()));
}

/** ROP = ADU x LT + SS (+ ADU x review days). */
export const reorderLevel = (adu: Dec, leadDays: number, ss: Dec, reviewDays = 0): Dec =>
  round3(adu.times(leadDays).plus(ss).plus(adu.times(reviewDays)));

/** EOQ = sqrt(2 x D x S / H), D = ADU x 365, H = holding % x unit cost; 0 when S or H is 0. */
export function eoq(adu: Dec, orderingCost: Dec, holdingPct: Dec, unitCost: Dec): Dec {
  const h = holdingPct.div(100).times(unitCost);
  if (orderingCost.lessThanOrEqualTo(0) || h.lessThanOrEqualTo(0)) return ZERO;
  return round3(D(2).times(adu.times(365)).times(orderingCost).div(h).sqrt());
}

export const roundUp = (x: Dec, multiple: Dec): Dec =>
  multiple.lessThanOrEqualTo(0) ? x : x.div(multiple).ceil().times(multiple);

export interface ReorderInput {
  method: 'MIN_MAX' | 'ROP_EOQ';
  minQty: Dec;
  maxQty: Dec;
  multiple: Dec;
  rop: Dec;
  eoq: Dec;
  position: Dec;
  available: Dec;
}

export interface ReorderDecision {
  trigger: Dec;
  triggered: boolean;
  netRequirement: Dec;
  suggested: Dec;
  status: 'Stock-out' | 'Reorder Now' | 'Reorder Soon' | 'OK';
}

/** BR-INV-44. */
export function decide(i: ReorderInput): ReorderDecision {
  const trigger = i.method === 'ROP_EOQ' ? i.rop : i.minQty;
  const triggered =
    i.method === 'ROP_EOQ' ? i.position.lessThanOrEqualTo(trigger) : i.position.lessThan(trigger);
  const net = trigger.minus(i.position).greaterThan(0) ? round3(trigger.minus(i.position)) : ZERO;
  let suggested = ZERO;
  if (triggered) {
    if (i.method === 'ROP_EOQ') {
      suggested = i.eoq.greaterThan(0)
        ? roundUp(i.eoq.times(net.div(i.eoq).floor().plus(1)), i.multiple)
        : roundUp(net.greaterThan(i.multiple) ? net : i.multiple, i.multiple);
    } else {
      suggested = roundUp(i.maxQty.minus(i.position), i.multiple);
    }
  }
  const status = i.available.lessThanOrEqualTo(0)
    ? 'Stock-out'
    : triggered
      ? 'Reorder Now'
      : i.position.lessThanOrEqualTo(trigger.times(1.25))
        ? 'Reorder Soon'
        : 'OK';
  return { trigger, triggered, netRequirement: net, suggested: round3(suggested), status };
}
