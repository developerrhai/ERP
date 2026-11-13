import { describe, expect, it } from 'vitest';
import { LOCK_OPS, assertCanDo, canDo, lockTable } from '../src/engine/lock-matrix';

describe('lock matrix (Phase 4 C6)', () => {
  it('Draft transactional record may do everything except nothing is blocked', () => {
    for (const op of LOCK_OPS) {
      expect(canDo(op, { status: 'Draft', master: false, fyOpen: true }).ok).toBe(true);
    }
  });

  it('Pending is locked for update, remove and documents but may be cancelled/moved on', () => {
    const base = { status: 'Pending', master: false, fyOpen: true } as const;
    expect(canDo('update', base).ok).toBe(false);
    expect(canDo('remove', base).ok).toBe(false);
    expect(canDo('documents', base).ok).toBe(false);
    expect(canDo('submit', base).ok).toBe(false);
    expect(canDo('status', base).ok).toBe(true);
  });

  it.each(['Completed', 'Cancelled', 'Pending Approval', 'Approved', 'Posted', 'Unknown'])(
    '%s is fully locked',
    (status) => {
      for (const op of LOCK_OPS) {
        const r = canDo(op, { status, master: false, fyOpen: true });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('RECORD_LOCKED');
      }
    },
  );

  it('Phase 5: a Rejected document is editable, deletable and can be resubmitted, but not moved by hand', () => {
    const base = { status: 'Rejected', master: false, fyOpen: true } as const;
    expect(canDo('update', base).ok).toBe(true);
    expect(canDo('remove', base).ok).toBe(true);
    expect(canDo('submit', base).ok).toBe(true);
    expect(canDo('documents', base).ok).toBe(true);
    expect(canDo('status', base).ok).toBe(false);
  });

  it('Phase 5: approval statuses answer with the exact RECORD_LOCKED text', () => {
    for (const status of ['Pending Approval', 'Approved', 'Posted']) {
      const r = canDo('update', { status, master: false, fyOpen: true });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toBe(`This document is ${status} and cannot be changed.`);
    }
  });

  it('transactional records can only be removed in Draft', () => {
    for (const status of ['Active', 'Inactive', 'Open', 'Pending', 'Cancelled', 'Approved']) {
      expect(canDo('remove', { status, master: false, fyOpen: true }).ok).toBe(false);
    }
  });

  it('masters can be edited and removed while Active / Inactive but never submitted', () => {
    for (const status of ['Active', 'Inactive']) {
      expect(canDo('update', { status, master: true, fyOpen: true }).ok).toBe(true);
      expect(canDo('remove', { status, master: true, fyOpen: true }).ok).toBe(true);
      expect(canDo('submit', { status, master: true, fyOpen: true }).ok).toBe(false);
    }
  });

  it('a closed financial year blocks every operation with PERIOD_CLOSED', () => {
    for (const op of LOCK_OPS) {
      const r = canDo(op, { status: 'Draft', master: false, fyOpen: false });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('PERIOD_CLOSED');
    }
  });

  it('assertCanDo throws the 409 codes', () => {
    expect(() => assertCanDo('update', { status: 'Pending', master: false, fyOpen: true })).toThrow(
      /cannot be edited/,
    );
    expect(() => assertCanDo('update', { status: 'Draft', master: false, fyOpen: false })).toThrow(
      /closed/,
    );
  });

  it('lockTable exposes every status with every op', () => {
    const table = lockTable(false);
    for (const row of Object.values(table))
      expect(Object.keys(row).sort()).toEqual([...LOCK_OPS].sort());
  });
});
