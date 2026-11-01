// Left navigation (prototype .sidebar/.menu): brand, "Search menu..." filter and the families
// from GET /me/menu (server decides access), titles/icons from the registry, collapsible sections.
import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { refreshMenu, resetMenu, useMenu } from '../lib/menu';
import { filterMenu, withRegistryLabels } from '../lib/registry';
import type { User } from '../types';

interface SidebarProps {
  user: User;
  open: boolean;
  onNavigate: () => void;
}

export function Sidebar({ user, open, onNavigate }: SidebarProps) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const menu = useMenu();
  // Reload whenever the signed-in identity or its role/department changes.
  useEffect(() => {
    void refreshMenu();
    return () => resetMenu();
  }, [user.id, user.role, user.department]);
  const families = useMemo(() => withRegistryLabels(menu.families), [menu.families]);
  const visible = useMemo(() => filterMenu(families, filter), [families, filter]);

  const toggle = (name: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <aside className={open ? 'sidebar show' : 'sidebar'} id="sidebar" aria-label="Main menu">
      <div className="brand">
        <div className="logo" aria-hidden="true">
          SG
        </div>
        <div>
          <b>Sawant Group ERP</b>
          <small>ENTERPRISE ERP</small>
        </div>
      </div>
      <div className="side-search-wrap">
        <input
          className="side-search"
          type="search"
          placeholder="Search menu..."
          aria-label="Search menu"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <nav className="menu">
        {visible.map((fam) => {
          const isCollapsed = collapsed.has(fam.name);
          const listId = `menu-${fam.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
          return (
            <div className="menu-section" key={fam.name}>
              <button
                type="button"
                className="menu-head"
                aria-expanded={!isCollapsed}
                aria-controls={listId}
                onClick={() => toggle(fam.name)}
              >
                <span>
                  {fam.icon} {fam.name}
                </span>
                <span aria-hidden="true">⌄</span>
              </button>
              <div className={isCollapsed ? 'menu-items hidden' : 'menu-items'} id={listId}>
                {fam.items.map((item) => (
                  <NavLink
                    key={item.id}
                    to={`/m/${item.id}`}
                    className={({ isActive }) => (isActive ? 'menu-item active' : 'menu-item')}
                    onClick={onNavigate}
                  >
                    {item.title}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
        {menu.status === 'loading' || menu.status === 'idle' ? (
          <p className="menu-empty" role="status">
            Loading menu…
          </p>
        ) : null}
        {menu.status === 'error' ? (
          <div className="menu-empty" role="alert">
            {menu.error}{' '}
            <button type="button" className="auth-link" onClick={() => void refreshMenu()}>
              Retry
            </button>
          </div>
        ) : null}
        {menu.status === 'ready' && visible.length === 0 ? (
          <p className="menu-empty">
            {filter ? 'No menu items match.' : 'No modules are available.'}
          </p>
        ) : null}
      </nav>
    </aside>
  );
}
