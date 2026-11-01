// Test fixtures: user/role factories, a route-table fetch mock and an app renderer, so each
// test states only the API behaviour it cares about.
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, type Mock } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { getSession } from '../auth/session';
import { ToastProvider } from '../components/Toast';
import type { RoleMeta, User } from '../types';
import { mockMenu, mockPermissions } from './access-mock';

export function makeUser(over: Partial<User> = {}): User {
  return {
    id: 'u-1',
    loginId: 'asha',
    email: 'asha@rhai.local',
    name: 'Asha Patil',
    role: 'ADMIN',
    roleLabel: 'Admin',
    roleLevel: 80,
    department: 'Administration',
    status: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    version: 1,
    ...over,
  };
}

export const ROLES_FOR_ADMIN: RoleMeta[] = [
  { code: 'SUPER_ADMIN', label: 'Super Admin', level: 100, canManage: false },
  { code: 'ADMIN', label: 'Admin', level: 80, canManage: false },
  { code: 'MANAGER', label: 'Manager', level: 60, canManage: true },
  { code: 'LEAD', label: 'Lead', level: 40, canManage: true },
  { code: 'MEMBER', label: 'Member', level: 20, canManage: true },
];

export const DEPARTMENTS = [
  'Administration',
  'Sales',
  'Purchase',
  'Finance',
  'HR',
  'Production',
  'Quality',
  'Maintenance',
  'Warehouse',
  'Projects',
  'Service',
];

export function json(status: number, body?: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): Response {
  return json(status, {
    error: { code, message, status, requestId: 'test', ...(fields ? { fields } : {}) },
  });
}

export interface Call {
  method: string;
  path: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  credentials: RequestCredentials | undefined;
  signal: AbortSignal | undefined;
}

export type Handler = (call: Call) => Response | Promise<Response>;

/**
 * Routes are keyed "METHOD /api/v1/path" (query string ignored). Unmatched routes return 404,
 * except GET /me/menu and /me/permissions, which default to the seed rules for the signed-in user.
 */
export function mockFetch(routes: Record<string, Handler>): { fn: Mock; calls: Call[] } {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.split('?')[0] ?? url;
    const headers = { ...(init?.headers as Record<string, string> | undefined) };
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: Call = {
      method,
      path,
      url,
      headers,
      body,
      credentials: init?.credentials,
      signal: init?.signal ?? undefined,
    };
    calls.push(call);
    const handler = routes[`${method} ${path}`];
    if (!handler) {
      const user = getSession().user;
      if (user && method === 'GET' && path === '/api/v1/me/menu') {
        return json(200, { data: { families: mockMenu(user) } });
      }
      if (user && method === 'GET' && path === '/api/v1/me/permissions') {
        const pageId = new URL(url, 'http://test').searchParams.get('pageId') ?? '';
        return json(200, { data: mockPermissions(user, pageId) });
      }
      return apiError(404, 'NOT_FOUND', `No mock for ${method} ${path}`);
    }
    return handler(call);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function authOk(user: User, token = 'tok-1'): Response {
  return json(200, { data: { accessToken: token, expiresIn: 900, user } });
}

export function renderApp(path: string): RenderResult {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Signs `user` in through /auth/refresh, answers /health, and adds the given routes. */
export function signedIn(user: User, routes: Record<string, Handler> = {}) {
  return mockFetch({
    'POST /api/v1/auth/refresh': () => authOk(user),
    'GET /api/v1/health': () => json(200, { data: { status: 'ok', db: 'ok' } }),
    ...routes,
  });
}

/** A /me/permissions handler granting `actions` (others false) on every page. */
export function permissionsRoute(actions: Partial<Record<string, boolean>>): Handler {
  return (call) => {
    const pageId = new URL(call.url, 'http://test').searchParams.get('pageId') ?? '';
    const all = ['view', 'add', 'edit', 'delete', 'approve', 'export', 'controls'];
    return json(200, {
      data: {
        pageId,
        actions: Object.fromEntries(all.map((a) => [a, actions[a] ?? false])),
        scope: 'ALL',
      },
    });
  };
}

export const countCalls = (calls: Call[], method: string, pathEnd: string): number =>
  calls.filter((c) => c.method === method && c.path.endsWith(pathEnd)).length;
