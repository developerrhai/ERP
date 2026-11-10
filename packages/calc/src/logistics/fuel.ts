/**
 * Fuel Efficiency (Full-Tank Method) & Anomaly Detector
 */

export type FuelAnomalyCode =
  | 'ODO_BACKWARD'
  | 'OVER_TANK'
  | 'RAPID_REFILL'
  | 'LOW_EFFICIENCY'
  | 'HIGH_KM';

export interface PrevFuelLog {
  odometer: number;
  litres: number;
  filledAt: string;
  isFullTank: boolean;
}

export interface FuelAnalysisInput {
  odometer: number;
  litres: number;
  filledAt: string;
  isFullTank: boolean;
  tankCapacity: number;
  stdKmpl: number;
  /** Previous logs sorted chronologically ascending (oldest -> latest before current) */
  prevLogs: PrevFuelLog[];
}

export interface FuelAnalysisResult {
  kmpl: number | null;
  variancePct: number | null;
  anomalies: FuelAnomalyCode[];
  blocked: boolean;
  blockReason: string | null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function analyzeFuelLog(input: FuelAnalysisInput): FuelAnalysisResult {
  const anomalies: FuelAnomalyCode[] = [];
  let blocked = false;
  let blockReason: string | null = null;

  const sortedPrev = [...input.prevLogs].sort(
    (a, b) => new Date(a.filledAt).getTime() - new Date(b.filledAt).getTime(),
  );
  const lastLog = sortedPrev.length > 0 ? sortedPrev[sortedPrev.length - 1] : null;

  // 1. Odometer check
  if (lastLog && input.odometer < lastLog.odometer) {
    anomalies.push('ODO_BACKWARD');
    blocked = true;
    blockReason = `Odometer ${input.odometer} is lower than last reading ${lastLog.odometer}.`;
  }

  // 2. Tank capacity check (> 105% of capacity)
  if (input.tankCapacity > 0 && input.litres > input.tankCapacity * 1.05) {
    anomalies.push('OVER_TANK');
    blocked = true;
    if (!blockReason) {
      blockReason = `Fuel ${input.litres} L exceeds tank capacity ${input.tankCapacity} L.`;
    }
  }

  // 3. Rapid refill (< 2 hours) & High daily distance (> 1200 km/day)
  if (lastLog) {
    const currTs = new Date(input.filledAt).getTime();
    const lastTs = new Date(lastLog.filledAt).getTime();
    const diffHours = (currTs - lastTs) / (1000 * 60 * 60);
    if (diffHours >= 0 && diffHours < 2) {
      anomalies.push('RAPID_REFILL');
    }

    const dist = input.odometer - lastLog.odometer;
    const diffDays = Math.max(diffHours / 24, 1);
    if (dist > 0 && dist / diffDays > 1200) {
      anomalies.push('HIGH_KM');
    }
  }

  // 4. Full-tank km/l calculation
  let kmpl: number | null = null;
  let variancePct: number | null = null;

  if (input.isFullTank && !blocked) {
    // Find the last full tank fill
    let lastFullIdx = -1;
    for (let i = sortedPrev.length - 1; i >= 0; i--) {
      if (sortedPrev[i]!.isFullTank) {
        lastFullIdx = i;
        break;
      }
    }

    if (lastFullIdx >= 0) {
      const baseFull = sortedPrev[lastFullIdx]!;
      const distance = input.odometer - baseFull.odometer;

      // Sum partial fills after baseFull plus current full fill
      let totalLitres = input.litres;
      for (let i = lastFullIdx + 1; i < sortedPrev.length; i++) {
        totalLitres += sortedPrev[i]!.litres;
      }

      if (distance > 0 && totalLitres > 0) {
        kmpl = round2(distance / totalLitres);
        if (input.stdKmpl > 0) {
          variancePct = round2(((kmpl - input.stdKmpl) / input.stdKmpl) * 100);
          if (variancePct < -15) {
            anomalies.push('LOW_EFFICIENCY');
          }
        }
      }
    }
  }

  return {
    kmpl,
    variancePct,
    anomalies,
    blocked,
    blockReason,
  };
}

