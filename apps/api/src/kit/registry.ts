// apps/api/src/kit/registry.ts
// In-memory typed-page and module registrations for Kit modules (docs/plans/07-ENGINE-KIT.md §2.2)

import type { Router } from 'express';
import type { TypedSchema } from '../modules/inventory/definitions';
import type { TypedHandler } from '../modules/inventory/typed';
import type { Requires } from './types';

export type PanelBuilder = (...args: any[]) => any;
import type { CommandRunner, CommandOpts } from './commands';
export type { CommandRunner, CommandOpts };
import type { LookupDef } from './lookups';
export type PrintBuilder = (...args: any[]) => any;
export type PdfRenderer = (...args: any[]) => any;

export interface KitRegistrar {
  page(p: { schema: TypedSchema; handler: TypedHandler }): void;
  panel(
    pageId: string,
    key: string,
    scope: 'record' | 'page',
    builder: PanelBuilder,
    opts?: { requires?: Requires },
  ): void;
  command(
    pageId: string,
    key: string,
    run: CommandRunner,
    opts?: { allowAllUnits?: boolean },
  ): void;
  lookup(def: LookupDef): void;
  printData(pageId: string, key: string, build: PrintBuilder): void;
  pdf(pageId: string, key: string, render: PdfRenderer): void;
  audit(v: { actions: readonly string[]; targets?: readonly string[] }): void;
  routes(mount: (api: Router) => void): void;
}

export type KitModuleFn = (kit: KitRegistrar) => void;

export interface KitModuleRegistration {
  name: string;
  fn: KitModuleFn;
}

export const REGISTERED_MODULES: KitModuleRegistration[] = [];

export const TYPED_SCHEMAS = new Map<string, TypedSchema>();
export const TYPED_HANDLERS = new Map<string, TypedHandler>();

export function registerKitModule(name: string, fn: KitModuleFn): void {
  if (REGISTERED_MODULES.some((m) => m.name === name)) {
    throw new Error(`Kit module "${name}" is already registered`);
  }
  REGISTERED_MODULES.push({ name, fn });
}

export function kitSchemaFor(pageId: string): TypedSchema | null {
  return TYPED_SCHEMAS.get(pageId) ?? null;
}

export function kitHandlerFor(pageId: string): TypedHandler | null {
  return TYPED_HANDLERS.get(pageId) ?? null;
}

import { resetTypedPagesForTest } from '../engine/kinds';
import { clearKitLookupsForTest } from './lookups';
import { clearKitPanelsForTest } from './panels/registry';
import { clearKitCommandsForTest } from './commands';

const testResetters: Array<() => void> = [];

export function registerTestResetter(fn: () => void): void {
  testResetters.push(fn);
}

export function clearKitRegistrationsForTest(): void {
  REGISTERED_MODULES.length = 0;
  TYPED_SCHEMAS.clear();
  TYPED_HANDLERS.clear();
  resetTypedPagesForTest();
  clearKitLookupsForTest();
  clearKitPanelsForTest();
  clearKitCommandsForTest();
  for (const fn of testResetters) {
    fn();
  }
}
