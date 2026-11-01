// Restores the session on page load via /auth/refresh (the cookie survives a reload, the
// in-memory token does not) and listens for logout broadcasts from other tabs.
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { NETWORK_MESSAGE, refreshSession } from '../lib/api';
import { onRemoteLogout } from './channel';
import { clearSession, getSession, subscribeSession, type SessionState } from './session';

export function useSession(): SessionState {
  return useSyncExternalStore(subscribeSession, getSession, getSession);
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  useEffect(() => {
    if (getSession().status === 'loading') {
      void refreshSession().then((outcome) => {
        // Unreachable API on load: show the login page with the network message (not a crash).
        if (outcome === 'network') clearSession(NETWORK_MESSAGE);
      });
    }
    return onRemoteLogout(() => clearSession());
  }, []);
  return <>{children}</>;
}
