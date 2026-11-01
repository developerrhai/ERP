// In-memory session store (access token + current user). The token lives only in this module
// variable — never localStorage/sessionStorage — so it cannot be read back from storage (CONTRACT §8).
import type { AuthResult, User } from '../types';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  user: User | null;
  /** Why the user is signed out (shown on the login page), e.g. server unreachable. */
  notice: string | null;
}

let accessToken: string | null = null;
let state: SessionState = { status: 'loading', user: null, notice: null };
const listeners = new Set<() => void>();

function emit(next: SessionState): void {
  state = next;
  for (const l of listeners) l();
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getSession(): SessionState {
  return state;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSession(result: AuthResult): void {
  accessToken = result.accessToken;
  emit({ status: 'authenticated', user: result.user, notice: null });
}

export function setUser(user: User): void {
  emit({ status: 'authenticated', user, notice: null });
}

/** Drops the token and user. `notice` (optional) explains why on the login page. */
export function clearSession(notice: string | null = null): void {
  accessToken = null;
  if (state.status === 'anonymous' && state.user === null && state.notice === notice) return;
  emit({ status: 'anonymous', user: null, notice });
}

/** Test helper: back to the initial "restoring" state. */
export function resetSessionForTests(): void {
  accessToken = null;
  state = { status: 'loading', user: null, notice: null };
  listeners.clear();
}
