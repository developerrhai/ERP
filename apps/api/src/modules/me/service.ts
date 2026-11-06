// What the signed-in user may see and do: the server-built sidebar menu (pages with `view`, in
// registry order) and the per-page action flags + scope the UI uses to enable buttons.
import type { User } from '@prisma/client';
import { accessProfile, accessUserOf } from '../../core/rbac/access';
import type { PageAccess } from '../../core/rbac/access';
import { Errors } from '../../core/http/errors';
import { pageInfo, registry } from '../../core/registry';

export interface MenuFamily {
  name: string;
  icon: string;
  items: { id: string; title: string }[];
}

export const meService = {
  async menu(user: any): Promise<{ families: MenuFamily[] }> {
    const profile = await accessProfile(accessUserOf(user));
    const families: MenuFamily[] = [];
    for (const family of registry.data.families) {
      const items = family.items
        .filter((item) => profile.get(item.id)?.actions.view === true)
        .map((item) => ({ id: item.id, title: item.title }));
      if (items.length > 0) families.push({ name: family.name, icon: family.icon, items });
    }
    return { families };
  },

  async permissions(user: any, pageId: string): Promise<PageAccess & { pageId: string }> {
    if (!pageInfo(pageId)) throw Errors.notFound('Unknown page.');
    const access = (await accessProfile(accessUserOf(user))).get(pageId);
    if (!access) throw Errors.notFound('Unknown page.');
    return { pageId, actions: { ...access.actions }, scope: access.scope, reasons: access.reasons ?? [] };
  },
};
