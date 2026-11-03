// apps/api/src/kit/boot.ts
// Bootstraps and validates all Kit modules (docs/plans/07-ENGINE-KIT.md §2.2, §4.1, §6 KR-01)

import type { Router } from 'express';
import { pageInfo } from '../core/registry';
import { addTypedPage } from '../engine/kinds';
import { registerAuditVocabulary } from './audit';
import { loadKitModules } from './modules';
import {
  REGISTERED_MODULES,
  TYPED_HANDLERS,
  TYPED_SCHEMAS,
  type CommandRunner,
  type KitRegistrar,
  type PanelBuilder,
  type PdfRenderer,
  type PrintBuilder,
} from './registry';
import type { Requires } from './types';
import type { TypedSchema } from '../modules/inventory/definitions';
import type { TypedHandler } from '../modules/inventory/typed';
import { LOOKUP_REGISTRY, toKebabCase, type LookupDef } from './lookups';
import { getPanelDef, registerPanel } from './panels/registry';
import { getCommandDef, registerCommand, type CommandOpts } from './commands';
import {
  registerPrintData,
  registerPdf,
  getPrintDataBuilder,
  getPdfRenderer,
} from './print';

export function bootKit(api: Router): void {
  // 1. Load active modules
  loadKitModules();

  const pageOwners = new Map<string, string>();
  const pageDefs = new Map<string, { schema: TypedSchema; handler: TypedHandler; moduleName: string }>();
  const lookupOwners = new Map<string, string>();
  const lookupDefs: Array<{ def: LookupDef; moduleName: string }> = [];
  const panelDefs: Array<{ pageId: string; key: string; moduleName: string }> = [];
  const commandDefs: Array<{ pageId: string; key: string; moduleName: string }> = [];
  const routeMounts: Array<(r: Router) => void> = [];

  for (const mod of REGISTERED_MODULES) {
    const registrar: KitRegistrar = {
      page(p: { schema: TypedSchema; handler: TypedHandler }) {
        const pageId = p.schema.pageId ?? p.handler.pageId;
        const existing = pageOwners.get(pageId);
        if (existing) {
          throw new Error(`KIT: page ${pageId} registered twice (${existing}, ${mod.name})`);
        }
        pageOwners.set(pageId, mod.name);
        pageDefs.set(pageId, { schema: p.schema, handler: p.handler, moduleName: mod.name });
      },
      panel(pageId: string, key: string, scope: 'record' | 'page', builder: PanelBuilder, opts?: { requires?: Requires; params?: string[] }) {
        registerPanel(pageId, key, scope, builder, opts, mod.name);
        panelDefs.push({ pageId, key, moduleName: mod.name });
      },
      command(pageId: string, key: string, run: CommandRunner, opts?: CommandOpts) {
        registerCommand(pageId, key, run, opts, mod.name);
        commandDefs.push({ pageId, key, moduleName: mod.name });
      },
      lookup(def: LookupDef) {
        const existing = lookupOwners.get(def.name);
        if (existing) {
          throw new Error(`KIT: lookup ${def.name} registered twice (${existing}, ${mod.name})`);
        }
        lookupOwners.set(def.name, mod.name);
        lookupDefs.push({ def, moduleName: mod.name });
      },
      printData(pageId: string, key: string, build: PrintBuilder) {
        registerPrintData(pageId, key, build);
      },
      pdf(pageId: string, key: string, render: PdfRenderer) {
        registerPdf(pageId, key, render);
      },
      audit(v: { actions: readonly string[]; targets?: readonly string[] }) {
        registerAuditVocabulary(v.actions, v.targets);
      },
      routes(mount: (r: Router) => void) {
        routeMounts.push(mount);
      },
    };

    mod.fn(registrar);
  }

  // 2. Validate registrations (KR-01)
  const allowTestPages = process.env.KIT_ALLOW_TEST_PAGES === 'true';

  for (const [pageId, def] of pageDefs.entries()) {
    // KR-01 (a): Page id must exist in registry unless testing
    if (!allowTestPages && !pageInfo(pageId)) {
      throw new Error(`KIT: page ${pageId} does not exist in registry`);
    }

    // Add to global sets and maps
    addTypedPage(pageId);
    TYPED_SCHEMAS.set(pageId, def.schema);
    TYPED_HANDLERS.set(pageId, def.handler);
  }

  // Register lookups into registry and build lookup set
  const registeredLookups = new Set<string>(['items', 'warehouses']);
  for (const { def } of lookupDefs) {
    const slug = toKebabCase(def.name);
    registeredLookups.add(def.name);
    registeredLookups.add(slug);
    LOOKUP_REGISTRY.set(slug, def);
  }

  // KR-01 (d): every FieldMeta.lookup, KitFilter.lookup, PayloadField.lookup names a registered lookup
  for (const [pageId, def] of pageDefs.entries()) {
    const schema = def.schema;
    for (const f of schema.fields ?? []) {
      if (f.lookup && !registeredLookups.has(f.lookup)) {
        throw new Error(`KIT: field ${pageId}.${f.key} names unregistered lookup ${f.lookup}`);
      }
    }
    for (const flt of schema.filters ?? []) {
      if (flt.lookup && !registeredLookups.has(flt.lookup)) {
        throw new Error(`KIT: filter ${pageId}.${flt.key} names unregistered lookup ${flt.lookup}`);
      }
    }
    for (const a of schema.actions ?? []) {
      for (const pf of a.payloadFields ?? []) {
        if (pf.lookup && !registeredLookups.has(pf.lookup)) {
          throw new Error(`KIT: action ${pageId}.${a.key}.${pf.key} names unregistered lookup ${pf.lookup}`);
        }
      }
    }
    for (const cmd of schema.commands ?? []) {
      for (const f of cmd.fields ?? []) {
        if (f.lookup && !registeredLookups.has(f.lookup)) {
          throw new Error(`KIT: command ${pageId}.${cmd.key}.${f.key} names unregistered lookup ${f.lookup}`);
        }
      }
    }
  }

  // KR-01 (b): every tabPanels entry without component has a builder, and key matches regex;
  // every builder is referenced by a tabPanels entry (unused builder error).
  const referencedPanelKeys = new Set<string>();

  for (const [pageId, def] of pageDefs.entries()) {
    const schema = def.schema;
    for (const tp of schema.tabPanels ?? []) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tp.key)) {
        throw new Error(`KIT: panel key ${tp.key} does not match kebab-case`);
      }
      referencedPanelKeys.add(`${pageId}:${tp.key}`);
      if (!tp.component) {
        if (!getPanelDef(pageId, tp.key)) {
          throw new Error(`KIT: panel ${pageId}.${tp.key} has no builder`);
        }
      }
    }
  }

  for (const p of panelDefs) {
    if (!referencedPanelKeys.has(`${p.pageId}:${p.key}`)) {
      throw new Error(`KIT: builder ${p.pageId}.${p.key} not referenced in tabPanels`);
    }
  }

  // KR-01 (e): every commands[].key has a registered runner; unused command runner throws
  const referencedCommandKeys = new Set<string>();

  for (const [pageId, def] of pageDefs.entries()) {
    const schema = def.schema;
    for (const cmd of schema.commands ?? []) {
      referencedCommandKeys.add(`${pageId}:${cmd.key}`);
      if (!getCommandDef(pageId, cmd.key)) {
        throw new Error(`KIT: command ${pageId}.${cmd.key} has no runner`);
      }
    }
  }

  for (const c of commandDefs) {
    if (!referencedCommandKeys.has(`${c.pageId}:${c.key}`)) {
      throw new Error(`KIT: command runner ${c.pageId}.${c.key} not referenced in schema commands`);
    }
  }

  // KR-01 (g) & (h): print templates validation
  for (const [pageId, def] of pageDefs.entries()) {
    const schema = def.schema;
    const webKeys = new Set<string>();
    const pdfKeys = new Set<string>();

    for (const t of schema.printTemplates ?? []) {
      if (t.kind === 'web') {
        if (webKeys.has(t.key)) {
          throw new Error(`KIT: web print template ${t.key} duplicated on ${pageId}`);
        }
        webKeys.add(t.key);
        if (!getPrintDataBuilder(pageId, t.key)) {
          throw new Error(`KIT: print template ${pageId}.${t.key} has no builder`);
        }
      } else if (t.kind === 'pdf') {
        if (pdfKeys.has(t.key)) {
          throw new Error(`KIT: pdf template ${t.key} duplicated on ${pageId}`);
        }
        pdfKeys.add(t.key);
        if (!getPdfRenderer(pageId, t.key)) {
          throw new Error(`KIT: pdf template ${pageId}.${t.key} has no renderer`);
        }
      }
    }
  }

  // 3. Mount extra routes
  for (const mount of routeMounts) {
    mount(api);
  }
}
