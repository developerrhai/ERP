// Phase 2 test helpers: snapshot/restore of the shared configuration tables (role permissions,
// module controls, letterhead) so tests that change global rules leave the DB as they found it, plus
// small API helpers for If-Match round trips. Every restore also clears the access cache.
import type { ModuleControl, RolePermission, Setting } from '@prisma/client';
import request from 'supertest';
import type { Express } from 'express';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { API, prisma, uniqueLoginId } from './helpers';
import type { Signed } from './helpers';

export interface GlobalSnapshot {
  permissions: RolePermission[];
  controls: ModuleControl[];
  settings: Setting[];
}

export async function snapshotGlobal(): Promise<GlobalSnapshot> {
  const [permissions, controls, settings] = await Promise.all([
    prisma.rolePermission.findMany(),
    prisma.moduleControl.findMany(),
    prisma.setting.findMany(),
  ]);
  return { permissions, controls, settings };
}

/** Restores only what differs from the snapshot (fast enough to run after every test). */
export async function restoreGlobal(snap: GlobalSnapshot): Promise<void> {
  const [permissions, controls, settings] = await Promise.all([
    prisma.rolePermission.findMany(),
    prisma.moduleControl.findMany(),
    prisma.setting.findMany(),
  ]);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const byId = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((p, q) => p.id.localeCompare(q.id));
  const currentControls = new Map(controls.map((c) => [c.pageId, c]));
  const currentSettings = new Map(settings.map((x) => [x.key, x]));
  await prisma.$transaction(async (tx) => {
    if (!same(byId(permissions), byId(snap.permissions))) {
      await tx.rolePermission.deleteMany();
      await tx.rolePermission.createMany({ data: snap.permissions });
    }
    for (const c of snap.controls) {
      const now = currentControls.get(c.pageId);
      if (now && same(now, c)) continue;
      if (now) await tx.moduleControl.update({ where: { pageId: c.pageId }, data: c });
      else await tx.moduleControl.create({ data: c });
    }
    for (const x of snap.settings) {
      const now = currentSettings.get(x.key);
      if (now && same(now.value, x.value) && now.version === x.version) continue;
      await tx.setting.upsert({
        where: { key: x.key },
        create: { key: x.key, value: x.value ?? {}, version: x.version },
        update: { value: x.value ?? {}, version: x.version },
      });
    }
  });
  invalidateAccessCache();
}

/** A fresh department (with optional families) so tests never mutate the 11 seeded ones. */
export async function makeDepartment(families: string[] = []) {
  const suffix = uniqueLoginId('d')
    .replace(/[^a-z0-9]/g, '')
    .slice(-8)
    .toUpperCase();
  const department = await prisma.department.create({
    data: { code: `T${suffix}`.slice(0, 10), name: `Dept ${suffix}`, head: 'Test Head' },
  });
  if (families.length > 0) {
    await prisma.departmentFamily.createMany({
      data: families.map((family) => ({ departmentName: department.name, family })),
    });
  }
  invalidateAccessCache();
  return department;
}

export interface MenuBody {
  data: { families: { name: string; items: { id: string; title: string }[] }[] };
}

export async function menuOf(app: Express, s: Signed) {
  const res = await request(app).get(`${API}/me/menu`).set(s.bearer);
  const families = (res.body as MenuBody).data.families;
  return {
    status: res.status,
    families: families.map((f) => f.name),
    pages: families.flatMap((f) => f.items.map((i) => i.id)),
  };
}

export async function permissionsOf(app: Express, s: Signed, pageId: string) {
  const res = await request(app).get(`${API}/me/permissions`).query({ pageId }).set(s.bearer);
  return res.body as {
    data: { pageId: string; actions: Record<string, boolean>; scope: string };
  };
}

export async function roleVersion(app: Express, s: Signed, role: string): Promise<number> {
  const legacyMap: Record<string, string> = {
    SUPER_ADMIN: 'SUPER_USER',
    ADMIN: 'ADMINISTRATOR',
    MANAGER: 'DEPT_MANAGER',
    LEAD: 'SUPERVISOR',
    MEMBER: 'EMPLOYEE',
  };
  const resolved = legacyMap[role] ?? role;
  const res = await request(app).get(`${API}/permissions`).set(s.bearer);
  const roles = (
    res.body as {
      data: { roles: { roleId: string; code: string; role?: string; version: number }[] };
    }
  ).data.roles;
  return (
    roles.find((r) => r.code === role || r.code === resolved || r.role === role || r.role === resolved || r.roleId === role)?.version ?? 0
  );
}

export async function controlVersion(pageId: string): Promise<number> {
  return (await prisma.moduleControl.findUniqueOrThrow({ where: { pageId } })).version;
}
