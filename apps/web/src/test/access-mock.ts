// Test double of the server's Phase 2 access rules (seed defaults, CONTRACT §2.4–2.5) so tests
// that do not care about permissions still get a realistic GET /me/menu and /me/permissions.
import { familiesFor, lookupPage, registry } from '../lib/registry';
import {
  ACTIONS,
  type ActionSet,
  type MenuFamily,
  type PagePermissions,
  type Scope,
  type User,
} from '../types';

const all = (v: boolean): ActionSet => Object.fromEntries(ACTIONS.map((a) => [a, v])) as ActionSet;

const ROLE_DEFAULTS: Record<string, { actions: ActionSet; scope: Scope }> = {
  SUPER_USER: { actions: all(true), scope: 'ALL' },
  SUPER_ADMIN: { actions: all(true), scope: 'ALL' },
  ADMINISTRATOR: { actions: { ...all(true), approve: false, post: false, cancel: false }, scope: 'ALL' },
  ADMIN: { actions: all(true), scope: 'ALL' },
  MANAGER: { actions: { ...all(true), controls: false }, scope: 'DEPARTMENT' },
  DEPT_MANAGER: { actions: { ...all(true), controls: false, import: false }, scope: 'DEPARTMENT' },
  LEAD: {
    actions: { ...all(true), delete: false, approve: false, controls: false },
    scope: 'DEPARTMENT',
  },
  SUPERVISOR: {
    actions: { ...all(false), view: true, add: true, edit: true, submit: true, export: true, print: true },
    scope: 'DEPARTMENT',
  },
  MEMBER: { actions: { ...all(false), view: true, add: true, edit: true }, scope: 'OWN' },
  EMPLOYEE: { actions: { ...all(false), view: true, add: true, edit: true, submit: true, print: true }, scope: 'OWN' },
};

export function mockPermissions(user: User, pageId: string): PagePermissions {
  const page = lookupPage(pageId);
  const none = { pageId, actions: all(false), scope: 'OWN' as Scope };
  if (!page) return none;
  if (user.role === 'SUPER_ADMIN' || user.role === 'SUPER_USER' || user.role === 'ADMIN' || user.role === 'ADMINISTRATOR') {
    return { pageId, actions: all(true), scope: 'ALL' };
  }
  const fallback: { actions: ActionSet; scope: Scope } = {
    actions: { ...all(false), view: true, add: true, edit: true },
    scope: 'OWN',
  };
  const defaults = ROLE_DEFAULTS[user.role] ?? fallback;
  if (page.family.name === 'Administration') return { ...none, scope: defaults.scope };
  const allowed = familiesFor(user.role, user.department).some((f) => f.name === page.family.name);
  if (!allowed) return { ...none, scope: defaults.scope };
  return { pageId, actions: { ...defaults.actions }, scope: defaults.scope };
}

export function mockMenu(user: User): MenuFamily[] {
  return registry.families
    .map((f) => ({
      name: f.name,
      icon: f.icon,
      items: f.items.filter((i) => mockPermissions(user, i.id).actions.view),
    }))
    .filter((f) => f.items.length > 0);
}
