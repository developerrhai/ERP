// usePagePermissions(pageId): the signed-in user's actions on a page from GET /me/permissions,
// used to hide/disable buttons and to show "Access denied". The server still enforces all.
import { api } from './api';
import { useLoad } from './useLoad';
import { ACTIONS, type ActionSet, type PagePermissions } from '../types';

export const NO_ACTIONS: ActionSet = Object.fromEntries(
  ACTIONS.map((a) => [a, false]),
) as ActionSet;

export function fetchPagePermissions(pageId: string): Promise<PagePermissions> {
  return api<PagePermissions>(`/me/permissions?pageId=${encodeURIComponent(pageId)}`);
}

export interface PagePermissionsState {
  loading: boolean;
  error: string;
  actions: ActionSet;
  scope: PagePermissions['scope'] | null;
}

export function usePagePermissions(pageId: string): PagePermissionsState {
  const { data, loading, error } = useLoad(() => fetchPagePermissions(pageId), [pageId]);
  // Ignore a previous page's answer while the new one loads.
  const current = data && data.pageId === pageId ? data : null;
  return {
    loading: !current && (loading || !error),
    error: current ? '' : error,
    actions: current ? { ...NO_ACTIONS, ...current.actions } : NO_ACTIONS,
    scope: current?.scope ?? null,
  };
}
