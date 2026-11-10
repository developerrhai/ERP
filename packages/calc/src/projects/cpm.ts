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

  // Build adjacency graph for topological sort & dependency lookups
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

  // Kahn's algorithm for topological sorting and cycle detection
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

  // 1. Forward Pass
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

  // 2. Backward Pass
  const lateStart = new Map<string, number>();
  const lateFinish = new Map<string, number>();

  // Process in reverse topological order
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

  // 3. Float & Critical Path
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

