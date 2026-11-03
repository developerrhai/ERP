// apps/api/src/kit/audit.ts
// Registration of module audit actions and target types (docs/plans/07-ENGINE-KIT.md §2.2, §6 KR-14)

import { AUDIT_ACTIONS } from '../core/audit/audit-service';

const registeredTargets = new Set<string>();

export function registerAuditVocabulary(
  actions: readonly string[],
  targets: readonly string[] = [],
): void {
  for (const act of actions) {
    if (!AUDIT_ACTIONS.includes(act)) {
      AUDIT_ACTIONS.push(act);
    }
  }
  for (const tgt of targets) {
    registeredTargets.add(tgt);
  }
}

export function registeredAuditTargets(): ReadonlySet<string> {
  return registeredTargets;
}
