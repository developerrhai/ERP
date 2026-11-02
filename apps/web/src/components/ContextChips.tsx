// Prototype context() chips (.context .chip) above a module page: department and role of the
// signed-in user plus the working Unit and FY from the top bar (Phase 3 A3).
import { contextLabels, useAppContext } from '../lib/context';
import type { User } from '../types';

export function ContextChips({
  user,
  owner,
  approval,
}: {
  user: User;
  /** Owner department of the module (from its schema), when known. */
  owner?: string;
  /** Whether the module needs approval, when known. */
  approval?: boolean;
}) {
  const labels = contextLabels(useAppContext().data);
  return (
    <div className="context" aria-label="Working context">
      <span className="chip">Department: {user.department ?? 'Administration'}</span>
      <span className="chip">Role: {user.roleLabel}</span>
      {owner ? <span className="chip">Owner: {owner}</span> : null}
      {approval !== undefined ? (
        <span className="chip">Approval: {approval ? 'Required' : 'No'}</span>
      ) : null}
      {labels ? (
        <>
          <span className="chip">Unit: {labels.unit}</span>
          <span className="chip">FY: {labels.fy}</span>
        </>
      ) : null}
    </div>
  );
}
