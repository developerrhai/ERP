import { describe, it, expect } from 'vitest';
import { computeCpm, computeEvm } from '../src/projects/index.js';

describe('Phase 17 Projects Unit Tests', () => {
  it('CPM Algorithm §5: 4-task project with FS, SS and lag', () => {
    // Tasks: A (3d), B (2d FS A), C (3d SS A+1), D (2d FS B and FS C)
    const tasks = [
      { id: 'A', durationDays: 3 },
      { id: 'B', durationDays: 2 },
      { id: 'C', durationDays: 3 },
      { id: 'D', durationDays: 2 },
    ];

    const dependencies = [
      { predecessor: 'A', successor: 'B', type: 'FS' as const, lagDays: 0 },
      { predecessor: 'A', successor: 'C', type: 'SS' as const, lagDays: 1 },
      { predecessor: 'B', successor: 'D', type: 'FS' as const, lagDays: 0 },
      { predecessor: 'C', successor: 'D', type: 'FS' as const, lagDays: 0 },
    ];

    const result = computeCpm(tasks, dependencies);

    expect(result.projectDurationDays).toBe(7);

    // Forward pass
    expect(result.tasks['A']?.earlyStart).toBe(0);
    expect(result.tasks['A']?.earlyFinish).toBe(3);

    expect(result.tasks['B']?.earlyStart).toBe(3);
    expect(result.tasks['B']?.earlyFinish).toBe(5);

    expect(result.tasks['C']?.earlyStart).toBe(1);
    expect(result.tasks['C']?.earlyFinish).toBe(4);

    expect(result.tasks['D']?.earlyStart).toBe(5);
    expect(result.tasks['D']?.earlyFinish).toBe(7);

    // Float & Critical Path
    expect(result.tasks['C']?.totalFloat).toBe(1); // C has float 1
    expect(result.tasks['A']?.isCritical).toBe(true);
    expect(result.tasks['B']?.isCritical).toBe(true);
    expect(result.tasks['C']?.isCritical).toBe(false);
    expect(result.tasks['D']?.isCritical).toBe(true);

    expect(result.criticalPathTaskIds).toEqual(['A', 'B', 'D']);
  });

  it('CPM Dependency cycle detection throws PRJ_DEP_CYCLE', () => {
    const tasks = [
      { id: 'T1', durationDays: 2 },
      { id: 'T2', durationDays: 3 },
    ];

    const dependencies = [
      { predecessor: 'T1', successor: 'T2' },
      { predecessor: 'T2', successor: 'T1' },
    ];

    expect(() => computeCpm(tasks, dependencies)).toThrow('PRJ_DEP_CYCLE');
  });

  it('EVM Algorithm §5: Comprehensive EVM calculations to 4 decimals', () => {
    // Example from §5: BAC 10,00,000; PV 4,00,000; EV 3,00,000; AC 3,60,000
    const res = computeEvm({
      bac: 1000000,
      pv: 400000,
      ev: 300000,
      ac: 360000,
    });

    expect(res.cv).toBe(-60000);
    expect(res.sv).toBe(-100000);
    expect(res.cpi).toBe(0.8333);
    expect(res.spi).toBe(0.75);
    expect(res.eac).toBe(1200000);
    expect(res.etc).toBe(840000);
    expect(res.vac).toBe(-200000);
    expect(res.tcpi).toBe(1.0938);
    expect(res.health).toBe('RED'); // CPI < 0.85
  });

  it('EVM Health classifies GREEN, AMBER and RED properly', () => {
    const green = computeEvm({ bac: 100000, pv: 50000, ev: 51000, ac: 50000 });
    expect(green.health).toBe('GREEN');

    const amber = computeEvm({ bac: 100000, pv: 50000, ev: 46000, ac: 50000 }); // CPI 0.92
    expect(amber.health).toBe('AMBER');
  });
});

