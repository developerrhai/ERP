// apps/web/src/pages/generic/kit/lineKinds.ts
// Client-side registry of document line kinds (docs/plans/07-ENGINE-KIT.md §2.5, §12 T-KIT-09)

import type { LookupItem, PageSchema, RecordRow } from '../engineApi';
import type { Format } from './panelTypes';

export type Line = Record<string, unknown>;

export interface LineCtx {
  pageId: string;
  record: RecordRow;
  schema: PageSchema;
}

export interface LineColumn {
  key: string;
  label: string;
  type: 'lookup' | 'text' | 'qty' | 'money' | 'pct' | 'date' | 'select' | 'readonly';
  lookup?: string;
  options?: string[];
  width?: string;
  format?: Format;
  editableWhen?: (line: Line, ctx: LineCtx) => boolean;
}

export interface LineKindSpec {
  kind: string;
  columns: LineColumn[];
  newLine: (ctx: LineCtx) => Line;
  onPick?: (col: string, picked: LookupItem, line: Line, ctx: LineCtx) => Promise<Partial<Line>>;
  preview?: {
    path: (ctx: LineCtx) => string;
    body: (lines: Line[], ctx: LineCtx) => unknown;
  };
  totalsLabels?: { key: string; label: string; format: Format }[];
  isEditable: (status: string) => boolean;
}

const LINE_KINDS = new Map<string, LineKindSpec>();

export function registerLineKind(spec: LineKindSpec): void {
  if (LINE_KINDS.has(spec.kind)) {
    throw new Error(`KIT: Line kind "${spec.kind}" is already registered.`);
  }
  LINE_KINDS.set(spec.kind, spec);
}

export function getLineKind(kind: string): LineKindSpec | undefined {
  return LINE_KINDS.get(kind);
}

export function resetLineKindsForTest(): void {
  LINE_KINDS.clear();
}
