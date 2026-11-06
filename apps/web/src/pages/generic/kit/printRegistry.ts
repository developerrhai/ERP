// apps/web/src/pages/generic/kit/printRegistry.ts
// Client-side print template component registry (docs/plans/07-ENGINE-KIT.md §2.9, §12 T-KIT-11)

import type { ComponentType } from 'react';

export interface PrintDto {
  templateKey: string;
  title: string;
  docNo: string;
  docDate: string;
  revision?: string;
  unit: { code: string; name: string; gstin?: string; address?: string };
  letterhead: Record<string, string>;
  parties: { role: string; name: string; gstin?: string; address?: string; contact?: string }[];
  facts: { label: string; value: string }[];
  lines: {
    columns: { key: string; label: string; format: string; align?: 'left' | 'right' }[];
    rows: Record<string, string | number | null>[];
  } | null;
  sections: { title: string; rows?: { label: string; value: string }[]; text?: string }[];
  totals: { label: string; value: string; bold?: boolean }[];
  amountInWords?: string;
  notes?: string;
  signatures: { label: string; name?: string }[];
}

export type PrintTemplateComponent = ComponentType<{ dto: PrintDto }>;

const TEMPLATE_REGISTRY = new Map<string, PrintTemplateComponent>();

export function registerPrintTemplate(
  pageId: string,
  key: string,
  Component: PrintTemplateComponent,
): void {
  TEMPLATE_REGISTRY.set(`${pageId}:${key}`, Component);
}

export function getPrintTemplate(pageId: string, key: string): PrintTemplateComponent | undefined {
  return TEMPLATE_REGISTRY.get(`${pageId}:${key}`);
}

export function resetPrintTemplatesForTest(): void {
  TEMPLATE_REGISTRY.clear();
}
