// Top bar (prototype .top): menu toggle, global search and context selects shown but disabled
// until later phases, live health pill, and the account button that opens the drawer.
import { initials, roleLine } from '../lib/format';
import type { User } from '../types';
import { HealthPill } from './HealthPill';

const LATER = 'Available in a later phase';

interface TopbarProps {
  user: User;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenAccount: () => void;
}

export function Topbar({ user, sidebarOpen, onToggleSidebar, onOpenAccount }: TopbarProps) {
  return (
    <header className="top">
      <button
        type="button"
        className="menu-toggle"
        aria-controls="sidebar"
        aria-expanded={sidebarOpen}
        onClick={onToggleSidebar}
      >
        ☰ Menu
      </button>
      <div className="global">
        <input
          placeholder="Search all ERP records..."
          aria-label="Search all ERP records"
          title={LATER}
          disabled
        />
      </div>
      <select className="hide-mobile" aria-label="Company" title="Active Company">
        <option>Sawant Group</option>
      </select>
      <select className="hide-mobile" aria-label="Branch" title="Select Unit">
        <option>Talwade - Unit 1</option>
        <option>Sawardari - Unit 2</option>
        <option>Varale - Unit 3</option>
      </select>
      <select className="hide-mobile" aria-label="Financial year" title="Financial Year">
        <option>FY 2026-27</option>
        <option>FY 2025-26</option>
      </select>
      <div className="top-actions">
        <HealthPill />
        <button type="button" className="icon" aria-label="Quick add" title={LATER} disabled>
          ＋
        </button>
        <button type="button" className="icon" aria-label="Notifications" title={LATER} disabled>
          🔔
        </button>
        <button
          type="button"
          className="user"
          aria-label={`Account: ${user.name}`}
          aria-haspopup="dialog"
          onClick={onOpenAccount}
        >
          <span className="avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <span>
            <b>{user.name}</b>
            <small className="user-role">{roleLine(user)}</small>
          </span>
        </button>
      </div>
    </header>
  );
}
