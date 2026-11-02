// Phase 1 dashboard placeholder: the prototype .v8-dash-hero band with the real user's
// department, name and role plus the working unit and FY — no numbers until real data exists.
import { contextLabels, useAppContext } from '../lib/context';
import type { User } from '../types';

export function DashboardPage({ user }: { user: User }) {
  const dept = user.department ?? 'Administration';
  const labels = contextLabels(useAppContext().data);
  return (
    <>
      <section className="v8-dash-hero" aria-labelledby="dash-title">
        <div>
          <small>LOGGED-IN BUSINESS AREA</small>
          <h2 id="dash-title">{dept} Dashboard</h2>
          <p>
            {user.name} • {user.roleLabel}
          </p>
          {labels ? (
            <p className="hero-context" data-testid="hero-context">
              {labels.unit} • {labels.fy}
            </p>
          ) : null}
        </div>
        <div className="v8-health">
          <div>
            <small>Department</small>
            <b>{dept}</b>
          </div>
          <div>
            <small>Role</small>
            <b>{user.roleLabel}</b>
          </div>
          <div>
            <small>Login ID</small>
            <b>{user.loginId}</b>
          </div>
          <div>
            <small>Account</small>
            <b>{user.status === 'ACTIVE' ? 'Active' : 'Inactive'}</b>
          </div>
        </div>
      </section>
      <div className="notice" role="note">
        Modules are being enabled phase by phase. Your account and access are active.
      </div>
    </>
  );
}
