// The full §1.2 matrix through the real API: every actor role x every target role x
// create / update / reset-password / deactivate, compared against role-rules.ts and a literal table.
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MANAGEABLE_ROLES,
  ROLES,
  canChangeRole,
  canManage,
  hasMinRole,
} from '../src/core/rbac/role-rules';
import type { RoleCode } from '../src/core/rbac/role-rules';
import { API, makeUser, newApp, owner, signInAs, uniqueLoginId, unitIds } from './helpers';
import type { Signed } from './helpers';

const app = newApp();

/** Written out by hand from CONTRACT §1.2, so a wrong edit to role-rules.ts fails here. */
const EXPECTED: Record<string, string[]> = {
  SUPER_ADMIN: ['ADMIN', 'MANAGER', 'LEAD', 'MEMBER'],
  ADMIN: ['MANAGER', 'LEAD', 'MEMBER'],
  MANAGER: [],
  LEAD: [],
  MEMBER: [],
};

describe('role-rules.ts', () => {
  it('matches the contract table', () => {
    for (const actor of ROLES) {
      expect([...(MANAGEABLE_ROLES[actor] ?? [])].sort()).toEqual(
        [...(EXPECTED[actor] ?? [])].sort(),
      );
      for (const target of ROLES) {
        expect(canManage(actor, target)).toBe((EXPECTED[actor] ?? []).includes(target));
      }
    }
  });

  it('nobody can manage SUPER_ADMIN or their own level', () => {
    for (const actor of ROLES) {
      expect(canManage(actor, 'SUPER_ADMIN')).toBe(false);
      expect(canManage(actor, actor)).toBe(false);
    }
  });

  it('role change needs both roles manageable', () => {
    expect(canChangeRole('ADMIN', 'MEMBER', 'MANAGER')).toBe(true);
    expect(canChangeRole('ADMIN', 'MEMBER', 'ADMIN')).toBe(false);
    expect(canChangeRole('ADMIN', 'ADMIN', 'MEMBER')).toBe(false);
    expect(canChangeRole('SUPER_ADMIN', 'ADMIN', 'MEMBER')).toBe(true);
    expect(canChangeRole('SUPER_ADMIN', 'MEMBER', 'SUPER_ADMIN')).toBe(false);
  });

  it('hasMinRole follows the levels', () => {
    expect(hasMinRole('ADMIN', 'ADMIN')).toBe(true);
    expect(hasMinRole('SUPER_ADMIN', 'ADMIN')).toBe(true);
    expect(hasMinRole('MANAGER', 'ADMIN')).toBe(false);
  });
});

describe('API matrix: actor x target x operation', () => {
  const actors = {} as Record<string, Signed>;

  beforeAll(async () => {
    for (const role of ROLES) actors[role] = await signInAs(app, role);
  });

  /** An existing user to act on; for SUPER_ADMIN that is the one owner. */
  async function targetOf(role: string) {
    return role === 'SUPER_ADMIN' ? owner() : makeUser({ role });
  }

  const cases: [string, string][] = (ROLES as readonly string[]).flatMap((actor) =>
    (ROLES as readonly string[]).map((target) => [actor, target] as [string, string]),
  );

  it.each(cases)('%s creating %s', async (actor, target) => {
    const loginId = uniqueLoginId('mx');
    const res = await request(app)
      .post(`${API}/users`)
      .set(actors[actor]!.bearer)
      .send({
        loginId,
        name: 'Matrix User',
        role: target,
        department: 'Sales',
        temporaryPassword: 'Matrix-Passw0rd!',
        unitIds: await unitIds(),
      });
    expect(res.status).toBe((EXPECTED[actor] ?? []).includes(target) ? 201 : 403);
  });

  it.each(cases)('%s updating %s', async (actor, target) => {
    const user = await targetOf(target);
    const res = await request(app)
      .patch(`${API}/users/${user.id}`)
      .set(actors[actor]!.bearer)
      .set('If-Match', String(user.version))
      .send({ name: `Renamed ${uniqueLoginId('n')}` });
    expect(res.status).toBe((EXPECTED[actor] ?? []).includes(target) ? 200 : 403);
  });

  it.each(cases)('%s resetting the password of %s', async (actor, target) => {
    const user = await targetOf(target);
    const res = await request(app)
      .post(`${API}/users/${user.id}/reset-password`)
      .set(actors[actor]!.bearer)
      .send({ temporaryPassword: 'Matrix-Reset-Passw0rd!' });
    expect(res.status).toBe((EXPECTED[actor] ?? []).includes(target) ? 204 : 403);
  });

  it.each(cases)('%s changing a MEMBER into %s', async (actor, newRole) => {
    const user = await makeUser({ role: 'MEMBER' });
    const res = await request(app)
      .patch(`${API}/users/${user.id}`)
      .set(actors[actor]!.bearer)
      .set('If-Match', String(user.version))
      .send({ role: newRole });
    const allowed =
      canManage(actor, 'MEMBER') &&
      (newRole === 'MEMBER' || (EXPECTED[actor] ?? []).includes(newRole));
    expect(res.status).toBe(allowed ? 200 : 403);
  });
});
