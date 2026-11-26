// The KPI cards and Validation Controls of the Item / Product / Material masters, Stock Balance and Lead Sources.
import { api } from './api';

export interface ControlRule {
  name: string;
  state: 'Enabled' | 'Optional';
  detail: string;
}

export interface WorkspaceSummary {
  records: number;
  completeness: number;
  openPending: number;
  atRisk: number;
  /** atRisk as a score out of 100. */
  riskScore: number;
  primary?: { label: string; value: number; format: 'money' };
  hints: { completeness: string; openPending: string; atRisk: string };
  controls: ControlRule[];
}

export const getWorkspaceSummary = (pageId: string): Promise<WorkspaceSummary> =>
  api<WorkspaceSummary>(
    pageId === 'crm-sources' ? '/crm/sources/summary' : `/inventory/v40/${encodeURIComponent(pageId)}/summary`,
  );
