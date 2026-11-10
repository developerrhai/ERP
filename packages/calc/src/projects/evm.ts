export interface EvmInput {
  bac: number; // Budget At Completion
  pv: number; // Planned Value
  ev: number; // Earned Value
  ac: number; // Actual Cost
}

export type ProjectHealth = 'GREEN' | 'AMBER' | 'RED';

export interface EvmResult {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  cv: number; // Cost Variance: EV - AC
  sv: number; // Schedule Variance: EV - PV
  cpi: number; // Cost Performance Index: EV / AC
  spi: number; // Schedule Performance Index: EV / PV
  eac: number; // Estimate At Completion: BAC / CPI
  etc: number; // Estimate To Complete: EAC - AC
  vac: number; // Variance At Completion: BAC - EAC
  tcpi: number; // To-Complete Performance Index: (BAC - EV) / (BAC - AC)
  health: ProjectHealth;
}

export function computeEvm(input: EvmInput): EvmResult {
  const { bac, pv, ev, ac } = input;

  const cv = Math.round((ev - ac) * 100) / 100;
  const sv = Math.round((ev - pv) * 100) / 100;

  const rawCpi = ac === 0 ? (ev === 0 ? 1.0 : 1.0) : ev / ac;
  const cpi = Math.round(rawCpi * 10000) / 10000;

  const rawSpi = pv === 0 ? (ev === 0 ? 1.0 : 1.0) : ev / pv;
  const spi = Math.round(rawSpi * 10000) / 10000;

  const rawEac = rawCpi === 0 ? bac : bac / rawCpi;
  const eac = Math.round(rawEac * 100) / 100;

  const etc = Math.round((eac - ac) * 100) / 100;
  const vac = Math.round((bac - eac) * 100) / 100;

  const tcpiDenominator = bac - ac;
  const rawTcpi = tcpiDenominator <= 0 ? 1.0 : (bac - ev) / tcpiDenominator;
  const tcpi = Math.round(rawTcpi * 10000) / 10000;

  let health: ProjectHealth = 'GREEN';
  if (cpi < 0.85 || spi < 0.85) {
    health = 'RED';
  } else if (cpi < 0.95 || spi < 0.95) {
    health = 'AMBER';
  }

  return {
    bac,
    pv,
    ev,
    ac,
    cv,
    sv,
    cpi,
    spi,
    eac,
    etc,
    vac,
    tcpi,
    health,
  };
}

