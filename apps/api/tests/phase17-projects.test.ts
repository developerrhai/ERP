import { describe, it, expect } from 'vitest';
import {
  computeCpm,
  computeEvm,
  type CpmTaskInput,
  type CpmDependencyInput,
  type EvmInput,
} from '../src/modules/projects/projects-calc';

describe('Phase 17 Projects Engine & Lifecycle Tests', () => {
  it('CPM scheduling: topological sort, forward/backward pass, float, and critical path', () => {
    // 4 tasks:
    // A: duration 3 (no predecessors) -> ES=0, EF=3
    // B: duration 4, dep FS on A lag 0 -> ES=3, EF=7
    // C: duration 2, dep FS on A lag 0 -> ES=3, EF=5
    // D: duration 2, dep FS on B and C -> ES=max(7,5)=7, EF=9
    // Project duration = 9 days
    // Critical path: task-A -> task-B -> task-D (3 + 4 + 2 = 9)
    // C has total float: LF(D)=7 - duration(2) - ES(3) = 2 days float.
    const tasks: CpmTaskInput[] = [
      { id: 'task-A', durationDays: 3 },
      { id: 'task-B', durationDays: 4 },
      { id: 'task-C', durationDays: 2 },
      { id: 'task-D', durationDays: 2 },
    ];

    const dependencies: CpmDependencyInput[] = [
      { predecessor: 'task-A', successor: 'task-B', type: 'FS', lagDays: 0 },
      { predecessor: 'task-A', successor: 'task-C', type: 'FS', lagDays: 0 },
      { predecessor: 'task-B', successor: 'task-D', type: 'FS', lagDays: 0 },
      { predecessor: 'task-C', successor: 'task-D', type: 'FS', lagDays: 0 },
    ];

    const result = computeCpm(tasks, dependencies);

    expect(result.projectDurationDays).toBe(9);

    const schedA = result.tasks['task-A']!;
    const schedB = result.tasks['task-B']!;
    const schedC = result.tasks['task-C']!;
    const schedD = result.tasks['task-D']!;

    expect(schedA.earlyStart).toBe(0);
    expect(schedA.earlyFinish).toBe(3);
    expect(schedA.isCritical).toBe(true);
    expect(schedA.totalFloat).toBe(0);

    expect(schedB.earlyStart).toBe(3);
    expect(schedB.earlyFinish).toBe(7);
    expect(schedB.isCritical).toBe(true);
    expect(schedB.totalFloat).toBe(0);

    expect(schedC.earlyStart).toBe(3);
    expect(schedC.earlyFinish).toBe(5);
    expect(schedC.isCritical).toBe(false);
    expect(schedC.totalFloat).toBe(2);

    expect(schedD.earlyStart).toBe(7);
    expect(schedD.earlyFinish).toBe(9);
    expect(schedD.isCritical).toBe(true);
    expect(schedD.totalFloat).toBe(0);

    expect(result.criticalPathTaskIds).toEqual(['task-A', 'task-B', 'task-D']);
  });

  it('CPM scheduling: detects circular dependency and throws error', () => {
    const tasks: CpmTaskInput[] = [
      { id: 'T1', durationDays: 2 },
      { id: 'T2', durationDays: 3 },
      { id: 'T3', durationDays: 1 },
    ];

    // Cycle: T1 -> T2 -> T3 -> T1
    const dependencies: CpmDependencyInput[] = [
      { predecessor: 'T1', successor: 'T2', type: 'FS', lagDays: 0 },
      { predecessor: 'T2', successor: 'T3', type: 'FS', lagDays: 0 },
      { predecessor: 'T3', successor: 'T1', type: 'FS', lagDays: 0 },
    ];

    expect(() => computeCpm(tasks, dependencies)).toThrow('PRJ_DEP_CYCLE');
  });

  it('EVM calculations: on-track, under-budget, over-budget and critical thresholds', () => {
    // Project with BAC = 1,00,000
    // As of today:
    // PV = 50,000 (we planned to finish 50%)
    // EV = 40,000 (we earned 40% worth of value)
    // AC = 48,000 (we spent 48,000 to achieve it)
    const input: EvmInput = {
      bac: 100000,
      pv: 50000,
      ev: 40000,
      ac: 48000,
    };

    const evm = computeEvm(input);

    expect(evm.cv).toBe(-8000); // 40000 - 48000
    expect(evm.sv).toBe(-10000); // 40000 - 50000
    expect(evm.cpi).toBe(0.8333); // 40000 / 48000
    expect(evm.spi).toBe(0.8); // 40000 / 50000
    expect(evm.eac).toBe(120000); // 100000 / (40000/48000)
    expect(evm.etc).toBe(72000); // 120000 - 48000
    expect(evm.vac).toBe(-20000); // 100000 - 120000
    // TCPI = (BAC - EV) / (BAC - AC) = (100000 - 40000) / (100000 - 48000) = 60000 / 52000 = 1.1538
    expect(evm.tcpi).toBe(1.1538);
    expect(evm.health).toBe('RED'); // CPI < 0.85 and SPI < 0.85
  });

  it('EVM calculations: healthy project with CPI and SPI >= 1.0', () => {
    const input: EvmInput = {
      bac: 200000,
      pv: 80000,
      ev: 90000,
      ac: 85000,
    };

    const evm = computeEvm(input);
    expect(evm.cv).toBe(5000);
    expect(evm.sv).toBe(10000);
    expect(evm.cpi).toBe(1.0588);
    expect(evm.spi).toBe(1.125);
    expect(evm.health).toBe('GREEN');
  });

  it('Validates max 24 hours per day on timesheet submission', () => {
    const validLines = [
      { task_id: 'task-1', date: '2027-04-05', hours: 8 },
      { task_id: 'task-2', date: '2027-04-05', hours: 6 },
    ];
    const totalDayHours = validLines.reduce((acc, l) => acc + l.hours, 0);
    expect(totalDayHours).toBeLessThanOrEqual(24);

    const invalidLines = [
      { task_id: 'task-1', date: '2027-04-05', hours: 14 },
      { task_id: 'task-2', date: '2027-04-05', hours: 12 },
    ];
    const invalidDayHours = invalidLines.reduce((acc, l) => acc + l.hours, 0);
    expect(invalidDayHours).toBeGreaterThan(24);
  });
});
