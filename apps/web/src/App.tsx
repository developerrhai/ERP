// Route table and guards (CONTRACT §8): /login, /, /m/:pageId, * -> 404. Signed-out users go
// to /login?next=…, and a user who must change their password sees only that screen.
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './auth/AuthProvider';
import { loginPathFor } from './lib/next-path';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { ModulePage } from './pages/ModulePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AppShell } from './shell/AppShell';

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
  return (
    <Routes>
      <Route element={<AppShell user={user} />}>
        <Route index element={<DashboardPage user={user} />} />
        <Route path="m/:pageId" element={<ModulePage user={user} />} />
        <Route path="m/:pageId/:sub" element={<ModulePage user={user} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
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
      <Route path="/*" element={<ProtectedApp />} />
    </Routes>
  );
}
