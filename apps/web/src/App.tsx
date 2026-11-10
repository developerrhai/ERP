// Route table and guards (CONTRACT §8): /login, /reset-password, /, /m/:pageId, /account/security, * -> 404.
// Signed-out users go to /login?next=…, and a user who must change their password sees only that screen.
// A user with mfaSetupRequired is forced to /account/security.
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './i18n';
import { useSession } from './auth/AuthProvider';
import { loginPathFor } from './lib/next-path';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { AccountSecurityPage } from './pages/account/AccountSecurityPage';
import { ModulePage } from './pages/ModulePage';
import { GateKioskPage } from './pages/logistics/GateKioskPage';
import { ApprovalCenterPage } from './pages/approvals/ApprovalCenterPage';
import { HardeningPage } from './pages/admin/HardeningPage';
import { InstallGuidePage } from './pages/notifications/InstallGuidePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AppShell } from './shell/AppShell';
import { IdleWarningModal } from './components/IdleWarningModal';

function Restoring() {
  return (
    <div className="restoring" role="status" aria-live="polite">
      Restoring your session…
    </div>
  );
}

function ProtectedApp() {
  const session = useSession();
  const location = useLocation();
  if (session.status === 'loading') return <Restoring />;
  if (session.status === 'anonymous' || !session.user) {
    return <Navigate to={loginPathFor(location.pathname, location.search)} replace />;
  }
  const user = session.user;
  if (user.mustChangePassword) return <ChangePasswordPage user={user} />;

  // Forced MFA guard per Phase 01 §5 & §8
  if (user.mfaSetupRequired && location.pathname !== '/account/security') {
    return <Navigate to="/account/security" replace />;
  }

  return (
    <>
      <IdleWarningModal />
      <Routes>
        <Route element={<AppShell user={user} />}>
          <Route index element={<DashboardPage user={user} />} />
          <Route path="account/security" element={<AccountSecurityPage user={user} />} />
          <Route path="approvals" element={<ApprovalCenterPage user={user} />} />
          <Route path="hardening" element={<HardeningPage />} />
          <Route path="install" element={<InstallGuidePage />} />
          <Route path="notifications" element={<Navigate to="/m/notif-center" replace />} />
          <Route path="gate/kiosk" element={<GateKioskPage />} />
          <Route path="m/approval-matrix" element={<Navigate to="/m/admin-approval" replace />} />
          <Route path="m/:pageId" element={<ModulePage user={user} />} />
          <Route path="m/:pageId/:sub" element={<ModulePage user={user} />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}

function LoginRoute() {
  const session = useSession();
  if (session.status === 'loading') return <Restoring />;
  return <LoginPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/*" element={<ProtectedApp />} />
    </Routes>
  );
}
