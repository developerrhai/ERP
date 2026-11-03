// apps/api/src/kit/panels/registry.ts
// Panel registration and lookup (docs/plans/07-ENGINE-KIT.md §2.3, §6 KR-04)

import type { PanelBuilder, PanelDef, PanelOpts } from './types';

export const PANEL_REGISTRY = new Map<string, PanelDef>();
export const PANEL_MODULE_OWNERS = new Map<string, string>(); // 'pageId:key' -> moduleName

export function panelRegistryKey(pageId: string, key: string): string {
  return `${pageId}:${key}`;
}

export function registerPanel(
  pageId: string,
  key: string,
  scope: 'record' | 'page',
  builder: PanelBuilder,
  opts?: PanelOpts,
  moduleName = 'core',
): void {
  const regKey = panelRegistryKey(pageId, key);
  const existingMod = PANEL_MODULE_OWNERS.get(regKey);
  if (existingMod) {
    throw new Error(`KIT: panel ${pageId}.${key} registered twice (${existingMod}, ${moduleName})`);
  }

  const def: PanelDef = {
    pageId,
    key,
    scope,
    builder,
    opts,
    moduleName,
  };

  PANEL_REGISTRY.set(regKey, def);
  PANEL_MODULE_OWNERS.set(regKey, moduleName);
}

export function getPanelDef(pageId: string, key: string): PanelDef | undefined {
  return PANEL_REGISTRY.get(panelRegistryKey(pageId, key));
}

export function clearKitPanelsForTest(): void {
  PANEL_REGISTRY.clear();
  PANEL_MODULE_OWNERS.clear();
}
