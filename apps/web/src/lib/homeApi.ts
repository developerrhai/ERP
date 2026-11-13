// Phase 23: Menu page, search, Home, favourites and recent pages.
import { api } from './api';

export interface MenuPageDto {
  id: string;
  title: string;
  favourite: boolean;
}
export interface MenuFamilyDto {
  name: string;
  icon: string;
  pages: MenuPageDto[];
  badge: number | null;
}
export interface HomePrefsDto {
  pinnedPages: string[];
  hiddenFamilies: string[];
  familyOrder: string[];
  favourites: string[];
  landing: string;
  theme: 'light' | 'dark';
  density: 'comfortable' | 'compact';
}
export interface TileDto {
  id: string;
  title: string;
}
export interface HomeDto {
  user: { name: string; role: string | null; department: string | null };
  work: {
    toReceive: number | null;
    toAccept: number | null;
    inWork: number | null;
    myApprovals: number | null;
    myTasks: number | null;
    returnedToMe: number | null;
    myDrafts: number | null;
    overdue: number | null;
  };
  quickCreate: { pageId: string; label: string }[];
  shortcuts: TileDto[];
  recent: TileDto[];
  announcements: { id: string; title: string; severity: string }[];
  whatsNew: { title: string; lines: string[] } | null;
  landing: string;
  landingPage: string;
}
export interface SearchDto {
  pages: { id: string; title: string; family: string }[];
  create: { id: string; label: string }[];
  recent: TileDto[];
}

export const homeApi = {
  menu: () => api<{ families: MenuFamilyDto[]; prefs: HomePrefsDto }>('/me/menu-v2'),
  search: (q: string) => api<SearchDto>(`/me/search?q=${encodeURIComponent(q)}`),
  home: () => api<HomeDto>('/me/home'),
  putPrefs: (patch: Partial<HomePrefsDto>) => api<HomePrefsDto>('/me/home-prefs', { method: 'PUT', body: patch }),
  favourite: (pageId: string) => api<HomePrefsDto>(`/me/favourites/${pageId}`, { method: 'POST' }),
  unfavourite: (pageId: string) => api<HomePrefsDto>(`/me/favourites/${pageId}`, { method: 'DELETE' }),
  touchRecent: (pageId: string) => api<unknown>(`/me/recent/${pageId}`, { method: 'POST' }).catch(() => undefined),
};
