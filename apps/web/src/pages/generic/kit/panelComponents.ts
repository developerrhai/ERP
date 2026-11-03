// apps/web/src/pages/generic/kit/panelComponents.ts
// Component registry for custom panel tabs and sections (docs/plans/07-ENGINE-KIT.md §2.3)

import type { ComponentType } from 'react';

const PANEL_COMPONENTS = new Map<string, ComponentType<any>>();

export function registerPanelComponent(name: string, Component: ComponentType<any>): void {
  if (PANEL_COMPONENTS.has(name)) {
    // Replace or warn, allowing HMR in dev
  }
  PANEL_COMPONENTS.set(name, Component);
}

export function getPanelComponent(name: string): ComponentType<any> | undefined {
  return PANEL_COMPONENTS.get(name);
}

export function clearPanelComponentsForTest(): void {
  PANEL_COMPONENTS.clear();
}
