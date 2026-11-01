// Menu filtering per role and department (CONTRACT §2): admins see all 22 families, others
// only DEPT_FAMILIES[department]; plus the prototype's menu search behaviour.
import { describe, expect, it } from 'vitest';
import { familiesFor, filterMenu, findPage, menuFor, registry } from './registry';

const names = (fs: { name: string }[]): string[] => fs.map((f) => f.name);

describe('familiesFor', () => {
  it('registry has 22 families and 11 departments', () => {
    expect(registry.families).toHaveLength(22);
    expect(registry.departments).toHaveLength(11);
  });

  it.each(['SUPER_ADMIN', 'ADMIN'] as const)('%s sees all 22 families', (role) => {
    expect(familiesFor(role, null)).toHaveLength(22);
    expect(familiesFor(role, 'Sales')).toHaveLength(22);
  });

  it.each(['MANAGER', 'LEAD', 'MEMBER'] as const)(
    '%s in Sales sees only the Sales families',
    (role) => {
      expect(names(familiesFor(role, 'Sales'))).toEqual([
        'Executive',
        'CRM',
        'Sales',
        'Service / Support',
        'Business Intelligence',
        'AI & Automation',
        'Communication',
      ]);
    },
  );

  it('keeps the registry family order, not the deptFamilies order', () => {
    const order = names(registry.families);
    const got = names(familiesFor('MEMBER', 'HR'));
    expect([...got].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(got);
    expect(got).toEqual(expect.arrayContaining(['HRMS', 'Payroll']));
    expect(got).not.toContain('Administration');
  });

  it('every department maps exactly to deptFamilies for a MEMBER', () => {
    for (const dept of registry.departments) {
      const allowed = registry.deptFamilies[dept] ?? [];
      const got = names(familiesFor('MEMBER', dept));
      if (allowed.includes('*')) expect(got).toHaveLength(22);
      else expect(new Set(got)).toEqual(new Set(allowed));
    }
  });

  it('Administration department ("*") sees every family', () => {
    expect(familiesFor('MANAGER', 'Administration')).toHaveLength(22);
  });

  it('a non-admin without a known department sees nothing', () => {
    expect(familiesFor('MEMBER', null)).toEqual([]);
    expect(familiesFor('LEAD', 'Nowhere')).toEqual([]);
  });
});

describe('filterMenu', () => {
  it('matches family names (all items) and item titles', () => {
    const all = familiesFor('ADMIN', null);
    const crm = filterMenu(all, 'crm');
    expect(crm.find((f) => f.name === 'CRM')?.items).toHaveLength(8);
    const users = filterMenu(all, 'users');
    expect(users.flatMap((f) => f.items.map((i) => i.id))).toContain('admin-users');
    expect(filterMenu(all, 'zzzz-nothing')).toEqual([]);
    expect(filterMenu(all, '  ')).toBe(all);
  });
});

describe('findPage', () => {
  it('finds a visible page and refuses one outside the user families', () => {
    expect(findPage('admin-users', familiesFor('ADMIN', null))?.item.title).toBe('Users');
    expect(findPage('admin-users', familiesFor('MEMBER', 'Sales'))).toBeNull();
    expect(findPage('no-such-page', familiesFor('ADMIN', null))).toBeNull();
  });
});

describe('menuFor', () => {
  const ids = (fs: { items: { id: string }[] }[]): string[] =>
    fs.flatMap((f) => f.items.map((i) => i.id));

  it.each(['SUPER_ADMIN', 'ADMIN'] as const)('%s sees the Users item', (role) => {
    expect(ids(menuFor(role, 'Administration'))).toContain('admin-users');
  });

  it.each(['MANAGER', 'LEAD', 'MEMBER'] as const)(
    '%s in Administration sees every family but not the Users item',
    (role) => {
      const menu = menuFor(role, 'Administration');
      expect(menu).toHaveLength(22);
      expect(ids(menu)).not.toContain('admin-users');
      expect(ids(menu)).toContain('admin-roles');
    },
  );
});
