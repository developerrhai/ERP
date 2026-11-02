// Shared test helpers: make users straight in the DB (fast, any role), sign in through the real API,
// and read the `rt` cookie. Every user gets a unique login ID so test files never collide. Like the
// Phase 3 migration, non-admin users get all seeded units unless the test says otherwise.
import { randomUUID } from 'node:crypto';
import type { Role, User, UserStatus } from '@prisma/client';
import request from 'supertest';
import type { Response } from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { hashPassword } from '../src/core/auth/password';
import { prisma } from '../src/core/db/prisma';
import { TEST_OWNER } from './test-env';

export { prisma };
export const API = '/api/v1';
export const XRW = { 'X-Requested-With': 'rhai-web' };
export const PASSWORD = 'Test-Passw0rd!';

let sharedHash: Promise<string> | null = null;
function passwordHash(): Promise<string> {
  sharedHash ??= hashPassword(PASSWORD);
  return sharedHash;
}

export const SEEDED_UNIT_CODES = ['TAL', 'SAW', 'VAR'] as const;

/** Unit ids by code (TAL, SAW, VAR, or any unit a test created). */
export async function unitIds(codes: readonly string[] = SEEDED_UNIT_CODES): Promise<string[]> {
  const rows = await prisma.unit.findMany({ where: { code: { in: [...codes] } } });
  return codes.map((code) => {
    const row = rows.find((r) => r.code === code);
    if (!row) throw new Error(`No unit ${code}`);
    return row.id;
  });
}

export function uniqueLoginId(prefix = 'u'): string {
  return `${prefix}-${randomUUID().slice(0, 12)}`;
}

export async function makeUser(
  overrides: Partial<{
    role: Role;
    department: string | null;
    status: UserStatus;
    mustChangePassword: boolean;
    loginId: string;
    email: string | null;
    name: string;
    /** Unit codes to assign. Default: all seeded units for MANAGER/LEAD/MEMBER, none for ADMIN+. */
    unitCodes: string[];
    defaultUnitCode: string | null;
  }> = {},
): Promise<User> {
  const loginId = overrides.loginId ?? uniqueLoginId(overrides.role?.toLowerCase() ?? 'member');
  const role = overrides.role ?? 'MEMBER';
  const codes =
    overrides.unitCodes ??
    (role === 'ADMIN' || role === 'SUPER_ADMIN' ? [] : [...SEEDED_UNIT_CODES]);
  const ids = codes.length > 0 ? await unitIds(codes) : [];
  const defaultUnitId = overrides.defaultUnitCode
    ? ((await unitIds([overrides.defaultUnitCode]))[0] ?? null)
    : null;
  return prisma.user.create({
    data: {
      loginId,
      email: overrides.email === undefined ? `${loginId}@test.local` : overrides.email,
      name: overrides.name ?? `User ${loginId}`,
      role,
      department: overrides.department === undefined ? 'Sales' : overrides.department,
      status: overrides.status ?? 'ACTIVE',
      mustChangePassword: overrides.mustChangePassword ?? false,
      passwordHash: await passwordHash(),
      defaultUnitId,
      units: { create: ids.map((unitId) => ({ unitId })) },
    },
  });
}

export function refreshCookieOf(res: Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown;
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return list.find((c) => c.startsWith('rt='));
}

/** "rt=value" only, ready for a Cookie header. */
export function cookiePair(setCookie: string | undefined): string {
  if (!setCookie) throw new Error('No rt cookie in response');
  const pair = setCookie.split(';')[0];
  if (!pair) throw new Error('Malformed cookie');
  return pair;
}

export interface Signed {
  user: User;
  token: string;
  cookie: string;
  bearer: { Authorization: string };
}

export async function login(
  app: Express,
  identifier: string,
  password = PASSWORD,
): Promise<Response> {
  return request(app).post(`${API}/auth/login`).send({ identifier, password });
}

export async function signIn(app: Express, user: User, password = PASSWORD): Promise<Signed> {
  const res = await login(app, user.loginId, password);
  if (res.status !== 200) throw new Error(`login failed for ${user.loginId}: ${res.status}`);
  const body = res.body as { data: { accessToken: string } };
  const token = body.data.accessToken;
  return {
    user,
    token,
    cookie: cookiePair(refreshCookieOf(res)),
    bearer: { Authorization: `Bearer ${token}` },
  };
}

export async function signInAs(
  app: Express,
  role: Role,
  overrides: Parameters<typeof makeUser>[0] = {},
): Promise<Signed> {
  if (role === 'SUPER_ADMIN') return signInOwner(app);
  return signIn(app, await makeUser({ ...overrides, role }));
}

export async function owner(): Promise<User> {
  return prisma.user.findUniqueOrThrow({ where: { loginId: TEST_OWNER.loginId } });
}

export async function signInOwner(app: Express): Promise<Signed> {
  return signIn(app, await owner(), TEST_OWNER.password);
}

export function newApp(options: Parameters<typeof createApp>[0] = {}): Express {
  return createApp(options);
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    status: number;
    requestId: string;
    fields?: Record<string, string>;
  };
}

export function errorOf(res: Response): ErrorBody['error'] {
  return (res.body as ErrorBody).error;
}

export async function auditRows(
  action: string,
  where: { actorId?: string; targetId?: string } = {},
) {
  return prisma.auditLog.findMany({ where: { action, ...where }, orderBy: { at: 'asc' } });
}
