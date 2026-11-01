// The prototype's two-column login frame (left brand panel + right card area) with the
// Phase 1 text from CONTRACT §8; shared by the Sign In and forced Change Password screens.
import type { ReactNode } from 'react';

const FEATURES: ReadonlyArray<{ title: string; text: string }> = [
  {
    title: '🔐 Secure Sign-In',
    text: 'Server-side authentication with account lockout and session control.',
  },
  { title: '🏢 Role Hierarchy', text: 'Super Admin, Admin, Manager, Lead and Member levels.' },
  { title: '✅ Approval Matrix', text: 'Department + amount + role-based approvals.' },
  {
    title: '⚙ System Controls',
    text: 'Module enable/edit/delete/approval settings from one master.',
  },
];

export function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <section className="login">
      <div className="login-left">
        <div className="login-brand">
          <div className="login-logo" aria-hidden="true">
            SG
          </div>
          <div>
            <b>Sawant Group ERP</b>
            <small>ENTERPRISE ERP</small>
          </div>
        </div>
        <div className="login-copy">
          <h1>Complete ERP with department control.</h1>
          <p>
            One secure workspace for every department. Your role and department decide what you can
            see and do, every action is recorded in the audit trail, and approvals follow your
            company&apos;s authority matrix.
          </p>
          <div className="features">
            {FEATURES.map((f) => (
              <div className="feature" key={f.title}>
                <b>{f.title}</b>
                <small>{f.text}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="login-foot">Authorised users only. All sign-ins are logged.</div>
      </div>
      <main className="login-right">
        <div className="login-card">{children}</div>
      </main>
    </section>
  );
}
