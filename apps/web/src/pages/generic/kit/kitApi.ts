// apps/web/src/pages/generic/kit/kitApi.ts
// HTTP client for Kit panels, commands, and call dispatch (docs/plans/07-ENGINE-KIT.md §2.3, §2.6)

import { api } from '../../../lib/api';
import type { PanelCall, PanelDto } from './panelTypes';

export async function getPanel(
  pageId: string,
  key: string,
  opts?: { recId?: string; params?: Record<string, string | number> },
): Promise<PanelDto> {
  const base = opts?.recId
    ? `/pages/${pageId}/records/${opts.recId}/panels/${key}`
    : `/pages/${pageId}/panels/${key}`;

  const q = new URLSearchParams();
  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== null && v !== '') {
        q.set(k, String(v));
      }
    }
  }

  const url = q.toString() ? `${base}?${q.toString()}` : base;
  return api<PanelDto>(url);
}

/** `data` of a command response: `message` is merged into an object result by the server. */
export type CommandResponse = { message?: string } & Record<string, unknown>;

export async function runCommand(
  pageId: string,
  command: string,
  payload?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<CommandResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  return api<CommandResponse>(`/pages/${pageId}/commands/${command}`, {
    method: 'POST',
    body: { payload: payload ?? {} },
    headers,
  });
}

export async function postCall(
  pageId: string,
  call: PanelCall,
  opts?: {
    pageId?: string;
    recId?: string;
    rowId?: string;
    payload?: Record<string, unknown>;
    idempotencyKey?: string;
  },
): Promise<unknown> {
  if (call.kind === 'command') {
    return runCommand(pageId, call.name, opts?.payload, opts?.idempotencyKey);
  }
  if (call.kind === 'action') {
    const targetId = call.target === 'rec' ? opts?.recId : opts?.rowId;
    if (!targetId) throw new Error('Target id is required for action call');
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    return api(`/pages/${pageId}/records/${targetId}/actions/${call.name}`, {
      method: 'POST',
      body: { payload: opts?.payload ?? {} },
      headers,
    });
  }
  if (call.kind === 'post') {
    let path = call.path;
    if (opts?.pageId || pageId)
      path = path.replace('{pageId}', encodeURIComponent(opts?.pageId ?? pageId));
    if (opts?.recId) path = path.replace('{recId}', encodeURIComponent(opts.recId));
    if (opts?.rowId) path = path.replace('{rowId}', encodeURIComponent(opts.rowId));
    return api(path, {
      method: 'POST',
      body: opts?.payload ?? {},
    });
  }
  throw new Error(`Unknown call kind: ${(call as any).kind}`);
}
