// apps/api/src/kit/panels/types.ts
// Panel DTO vocabulary and builder contracts (docs/plans/07-ENGINE-KIT.md §2.3)

import type { Db } from '../../core/db/prisma';
import type { Caller } from '../../modules/records/service';
import type { PayloadField, Requires } from '../types';

export type Format =
  | 'text'
  | 'number'
  | 'qty'
  | 'money'
  | 'pct'
  | 'date'
  | 'datetime'
  | 'bool'
  | 'status';

export interface Kpi {
  key?: string;
  label: string;
  value: string | number | null;
  format: Format;
  tone?: 'good' | 'warn' | 'bad' | null;
  hint?: string;
}

export type PanelCall =
  | { kind: 'action'; name: string; target: 'row' | 'rec' }
  | { kind: 'command'; name: string }
  | { kind: 'post'; path: string };

export interface Column {
  key: string;
  label: string;
  format: Format;
  align?: 'left' | 'right';
  editable?: { type: 'qty' | 'money' | 'text'; action: PanelCall };
}

export interface PanelAction {
  key: string;
  label: string;
  variant?: 'primary' | 'default' | 'danger';
  requires?: Requires;
  confirm?: string | null;
  call: PanelCall;
  payloadFields?: PayloadField[];
}

export type Row = {
  id?: string;
  refs?: Record<string, { id: string; code: string; name: string }>;
} & Record<string, string | number | boolean | null | undefined | unknown>;

export type Section =
  | {
      type: 'table';
      title?: string;
      columns: Column[];
      rows: Row[];
      empty?: string;
      meta?: { page: number; size: number; total: number };
      totals?: Record<string, number>;
      rowActions?: PanelAction[];
      headerActions?: PanelAction[];
    }
  | {
      type: 'stepper';
      title?: string;
      steps: {
        label: string;
        state: 'done' | 'current' | 'pending' | 'rejected';
        note?: string;
      }[];
    }
  | { type: 'facts'; title?: string; items: { label: string; value: string }[] }
  | { type: 'notice'; tone: 'info' | 'warn' | 'bad'; text: string }
  | { type: 'lines'; lineKind: string; editable: boolean }
  | {
      type: 'funnel';
      title?: string;
      stages: { label: string; count: number; valueText?: string }[];
    }
  | {
      type: 'bars';
      title?: string;
      rows: {
        label: string;
        value: number;
        max?: number;
        format?: Format;
        tone?: Kpi['tone'];
      }[];
    }
  | {
      type: 'chart';
      title?: string;
      chartType: 'bar' | 'line';
      labels: string[];
      series: { name: string; data: number[] }[];
    }
  | {
      type: 'timeline';
      title?: string;
      events: {
        at: string;
        title: string;
        detail?: string;
        by?: string;
        tone?: Kpi['tone'];
      }[];
    }
  | {
      type: 'calendar';
      title?: string;
      month: string; // YYYY-MM
      days: {
        date: string;
        items: { label: string; tone?: Kpi['tone']; ref?: string }[];
      }[];
    }
  | {
      type: 'board';
      title?: string;
      draggable: boolean;
      move?: PanelCall;
      lanes: {
        key: string;
        label: string;
        cards: {
          id: string;
          title: string;
          subtitle?: string;
          badge?: string;
          amount?: number;
        }[];
      }[];
    }
  | { type: 'custom'; component: string; props: Record<string, unknown> };

export interface PanelDto {
  key: string;
  title: string;
  subtitle?: string;
  kpis?: Kpi[];
  sections: Section[];
  actions?: PanelAction[];
  notice?: string | null;
}

export interface PanelContext {
  db: Db;
  caller: Caller;
  pageId: string;
  recId?: string;
  query: Record<string, unknown>;
}

export type PanelBuilder = (ctx: PanelContext) => Promise<PanelDto>;

export interface PanelOpts {
  requires?: Requires;
  params?: string[];
}

export interface PanelDef {
  pageId: string;
  key: string;
  scope: 'record' | 'page';
  builder: PanelBuilder;
  opts?: PanelOpts;
  moduleName?: string;
}
