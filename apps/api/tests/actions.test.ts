// Phase 22-C: actionsFor() and the SQL bitmask must agree for every state x permission profile
// (the spec matrix: 9 roles x sample pages x 4 states), with the exact reasons.
import { describe, expect, it } from 'vitest';
import {
  ACTION_BIT,
  ACTION_KEYS,
  actionMaskSql,
  actionsFor,
  decodeMask,
  maskOf,
  maskOfBlocked,
  type PagePerms,
} from '../src/core/actions';
import { prisma } from './helpers';

const none: PagePerms = {
  view: false,
  edit: false,
  delete: false,
  submit: false,
  approve: false,
  print: false,
  export: false,
};
const ROLES: Record<string, PagePerms> = {
  'Super User': {
    view: true,
    edit: true,
    delete: true,
    submit: true,
    approve: true,
    print: true,
    export: true,
  },
  Administrator: {
    view: true,
    edit: true,
    delete: true,
    submit: true,
    approve: true,
    print: true,
    export: true,
  },
  Director: {
    view: true,
    edit: false,
    delete: false,
    submit: false,
    approve: true,
    print: true,
    export: true,
  },
  CFO: {
    view: true,
    edit: true,
    delete: false,
    submit: true,
    approve: true,
    print: true,
    export: true,
  },
  'General Manager': {
    view: true,
    edit: true,
    delete: false,
    submit: true,
    approve: true,
    print: true,
    export: false,
  },
  'Dept Head': {
    view: true,
    edit: true,
    delete: true,
    submit: true,
    approve: true,
    print: true,
    export: true,
  },
  'Dept Manager': {
    view: true,
    edit: true,
    delete: false,
    submit: true,
    approve: false,
    print: true,
    export: false,
  },
  Supervisor: {
    view: true,
    edit: true,
    delete: false,
    submit: true,
    approve: false,
    print: false,
    export: false,
  },
  Employee: { ...none, view: true },
};
const STATES = ['Draft', 'Pending Approval', 'Posted', 'Cancelled', 'Active'];

describe('actionsFor', () => {
  it('hides what the role may not do and explains what the state blocks', () => {
    const a = actionsFor(ROLES['Dept Manager']!, 'Posted');
    expect(a.allowed).toContain('open');
    expect(a.blocked.edit).toBe("Posted documents can't be edited — use Cancel/Reverse.");
    expect(a.blocked.submit).toBeTruthy();
    expect(a.allowed).not.toContain('approve');
    expect('approve' in a.blocked).toBe(false); // no permission: hidden, not greyed
    expect('delete' in a.blocked).toBe(false);
    const p = actionsFor(ROLES['Dept Manager']!, 'Pending Approval');
    expect(p.blocked.edit).toBe('Pending approval — wait for the decision.');
    expect(actionsFor(ROLES['Employee']!, 'Draft').allowed).toEqual(['open', 'documents']);
  });

  it('Word and Move Forward are greyed with the phase that brings them', () => {
    const a = actionsFor(ROLES['Super User']!, 'Draft');
    expect(a.blocked.word).toBe('Arrives in Phase 27.');
    expect(a.blocked.moveForward).toBe('Arrives in Phase 25.');
    expect(a.allowed).toContain('edit');
    expect(a.allowed).toContain('submit');
  });

  it('approve is open only while the record waits for a decision', () => {
    expect(actionsFor(ROLES['CFO']!, 'Pending Approval').allowed).toContain('approve');
    expect(actionsFor(ROLES['CFO']!, 'Draft').blocked.approve).toBeTruthy();
  });

  it('decodeMask round-trips the allowed set', () => {
    const a = actionsFor(ROLES['Super User']!, 'Draft');
    expect(decodeMask(maskOf(a) | maskOfBlocked(a)).allowed).toEqual(a.allowed);
    expect(ACTION_BIT.open).toBe(1);
  });
});

describe('SQL mask equals actionsFor (no per-row call)', () => {
  for (const [role, perms] of Object.entries(ROLES)) {
    it(`${role}`, async () => {
      for (const st of STATES) {
        const rows = await prisma.$queryRaw<
          { m: number }[]
        >`SELECT ${actionMaskSql(`'${st}'`, perms)}::int AS m`;
        const mask = Number(rows[0]?.m);
        const want = actionsFor(perms, st);
        const got = decodeMask(mask);
        expect(got.allowed, `${role}/${st}`).toEqual(want.allowed);
        expect(Object.keys(got.blocked).sort(), `${role}/${st}`).toEqual(
          Object.keys(want.blocked).sort(),
        );
      }
    });
  }

  it('lists every action key once', () => {
    expect(new Set(ACTION_KEYS).size).toBe(ACTION_KEYS.length);
  });
});
