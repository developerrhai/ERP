/**
 * Pure calculation engine for Projects (CPM & EVM)
 * CommonJS compatible for apps/api
 */

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface CpmTaskInput {
  id: string;
  durationDays: number;
  baselineStart?: string;
  baselineEnd?: string;
}

export interface CpmDependencyInput {
  predecessor: string;
  successor: string;
  type?: DependencyType;
  lagDays?: number;
}

export interface CpmTaskResult {
  id: string;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  isCritical: boolean;
  baselineVarianceDays?: number;
}

export interface CpmScheduleResult {
  projectDurationDays: number;
  criticalPathTaskIds: string[];
  tasks: Record<string, CpmTaskResult>;
}

export function computeCpm(
  tasks: CpmTaskInput[],
  dependencies: CpmDependencyInput[],
): CpmScheduleResult {
  if (tasks.length === 0) {
    return {
      projectDurationDays: 0,
      criticalPathTaskIds: [],
      tasks: {},
    };
  }

  const taskMap = new Map<string, CpmTaskInput>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const adj = new Map<string, Array<{ to: string; type: DependencyType; lag: number }>>();
  const inDegree = new Map<string, number>();
  const predecessorsMap = new Map<string, Array<{ from: string; type: DependencyType; lag: number }>>();

  for (const t of tasks) {
    adj.set(t.id, []);
    inDegree.set(t.id, 0);
    predecessorsMap.set(t.id, []);
  }

  for (const d of dependencies) {
    if (!taskMap.has(d.predecessor) || !taskMap.has(d.successor)) {
      continue;
    }
    if (d.predecessor === d.successor) {
      throw new Error(`PRJ_DEP_CYCLE: Self-dependency detected on task ${d.predecessor}`);
    }
    const type = d.type ?? 'FS';
    const lag = d.lagDays ?? 0;

    adj.get(d.predecessor)!.push({ to: d.successor, type, lag });
    predecessorsMap.get(d.successor)!.push({ from: d.predecessor, type, lag });
    inDegree.set(d.successor, (inDegree.get(d.successor) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id);
    }
  }

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    topoOrder.push(curr);

    for (const edge of adj.get(curr)!) {
      const next = edge.to;
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) {
        queue.push(next);
      }
    }
  }

  if (topoOrder.length !== tasks.length) {
    throw new Error('PRJ_DEP_CYCLE: A dependency creates a loop');
  }

  const earlyStart = new Map<string, number>();
  const earlyFinish = new Map<string, number>();

  for (const id of topoOrder) {
    const t = taskMap.get(id)!;
    const dur = Math.max(0, t.durationDays);
    const preds = predecessorsMap.get(id)!;

    if (preds.length === 0) {
      earlyStart.set(id, 0);
      earlyFinish.set(id, dur);
    } else {
      let maxEs = 0;
      for (const p of preds) {
        const pEs = earlyStart.get(p.from) ?? 0;
        const pEf = earlyFinish.get(p.from) ?? 0;

        let candEs = 0;
        if (p.type === 'FS') {
          candEs = pEf + p.lag;
        } else if (p.type === 'SS') {
          candEs = pEs + p.lag;
        } else if (p.type === 'FF') {
          candEs = pEf + p.lag - dur;
        } else if (p.type === 'SF') {
          candEs = pEs + p.lag - dur;
        }
        maxEs = Math.max(maxEs, candEs);
      }
      maxEs = Math.max(0, maxEs);
      earlyStart.set(id, maxEs);
      earlyFinish.set(id, maxEs + dur);
    }
  }

  let projectDuration = 0;
  for (const ef of earlyFinish.values()) {
    if (ef > projectDuration) {
      projectDuration = ef;
    }
  }

  const lateStart = new Map<string, number>();
  const lateFinish = new Map<string, number>();

  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i]!;
    const t = taskMap.get(id)!;
    const dur = Math.max(0, t.durationDays);
    const succs = adj.get(id)!;

    if (succs.length === 0) {
      lateFinish.set(id, projectDuration);
      lateStart.set(id, projectDuration - dur);
    } else {
      let minLf = Number.POSITIVE_INFINITY;
      for (const s of succs) {
        const sLs = lateStart.get(s.to) ?? projectDuration;
        const sLf = lateFinish.get(s.to) ?? projectDuration;

        let candLf = projectDuration;
        if (s.type === 'FS') {
          candLf = sLs - s.lag;
        } else if (s.type === 'SS') {
          const candLs = sLs - s.lag;
          candLf = candLs + dur;
        } else if (s.type === 'FF') {
          candLf = sLf - s.lag;
        } else if (s.type === 'SF') {
          const candLs = sLf - s.lag;
          candLf = candLs + dur;
        }
        minLf = Math.min(minLf, candLf);
      }
      lateFinish.set(id, minLf);
      lateStart.set(id, minLf - dur);
    }
  }

  const results: Record<string, CpmTaskResult> = {};
  const criticalPathIds: string[] = [];

  for (const t of tasks) {
    const es = earlyStart.get(t.id) ?? 0;
    const ef = earlyFinish.get(t.id) ?? 0;
    const ls = lateStart.get(t.id) ?? 0;
    const lf = lateFinish.get(t.id) ?? 0;
    const totalFloat = Math.round((ls - es) * 10000) / 10000;
    const isCritical = totalFloat === 0;

    if (isCritical) {
      criticalPathIds.push(t.id);
    }

    results[t.id] = {
      id: t.id,
      earlyStart: es,
      earlyFinish: ef,
      lateStart: ls,
      lateFinish: lf,
      totalFloat,
      isCritical,
    };
  }

  return {
    projectDurationDays: projectDuration,
    criticalPathTaskIds: criticalPathIds,
    tasks: results,
  };
}

export interface EvmInput {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
}

export type ProjectHealth = 'GREEN' | 'AMBER' | 'RED';

export interface EvmResult {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  cv: number;
  sv: number;
  cpi: number;
  spi: number;
  eac: number;
  etc: number;
  vac: number;
  tcpi: number;
  health: ProjectHealth;
}

export function computeEvm(input: EvmInput): EvmResult {
  const { bac, pv, ev, ac } = input;

  const cv = Math.round((ev - ac) * 100) / 100;
  const sv = Math.round((ev - pv) * 100) / 100;

  const rawCpi = ac === 0 ? 1.0 : ev / ac;
  const cpi = Math.round(rawCpi * 10000) / 10000;

  const rawSpi = pv === 0 ? 1.0 : ev / pv;
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

