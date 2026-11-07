// System Setup (admin-settings): the prototype's 9-tile master grid with its original texts;
// built tiles navigate, not-yet-built ones are disabled with the phase they arrive in.
import { useNavigate } from 'react-router-dom';

interface Tile {
  title: string;
  text: string;
  to?: string;
  phase?: string;
}

export const SETUP_TILES: readonly Tile[] = [
  {
    title: 'System Controls',
    text: 'Enable modules, owner department, approvals, edit/delete/export.',
    to: '/m/admin-settings/controls',
  },
  { title: 'Company Master', text: 'Legal company setup.', to: '/m/admin-company' },
  { title: 'Unit Master', text: 'Unit setup.', to: '/m/admin-branches' },
  { title: 'Department Master', text: 'Department login and routing.', to: '/m/admin-departments' },
  { title: 'User Master', text: 'Department users and roles.', to: '/m/admin-users' },
  { title: 'Role Master', text: 'Authority hierarchy.', to: '/m/admin-roles' },
  {
    title: 'Permission Master',
    text: 'View/Add/Edit/Delete/Approve rights.',
    to: '/m/admin-permissions',
  },
  { title: 'Approval Matrix', text: 'Department and amount thresholds.', phase: 'Phase 6' },
  {
    title: 'Finance Approval Limits',
    text: 'Amounts from which journals and notes need approval.',
    to: '/m/admin-settings/finance-limits',
  },
  {
    title: 'Letterhead & PDF',
    text: 'Company PDF template settings.',
    to: '/m/admin-settings/letterhead',
  },
];

export function SystemSetupPage() {
  const navigate = useNavigate();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>System Setup &amp; Controls</h1>
          <p>Central master setup and module behavior.</p>
        </div>
      </div>
      <div className="master-grid">
        {SETUP_TILES.map((t) => (
          <button
            type="button"
            key={t.title}
            className="master"
            disabled={!t.to}
            title={t.phase ? `Arrives in ${t.phase}` : undefined}
            onClick={() => {
              if (t.to) navigate(t.to);
            }}
          >
            {/* Block wrapper keeps the prototype's line box (16px strut) inside a top-aligned button. */}
            <span className="master-inner">
              <b>{t.title}</b>
              <small>{t.text}</small>
            </span>
            {t.phase ? <span className="chip master-badge">{t.phase}</span> : null}
          </button>
        ))}
      </div>
    </>
  );
}
