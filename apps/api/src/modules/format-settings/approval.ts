// Publishing a money-affecting rule set goes through the Phase 5 approval engine (PHASE-06B §3.6).
// The document is the rule-set version itself: DRAFT -> Pending Approval -> (approved) ACTIVE.
// A rejection or a return puts it back to DRAFT so the head can change it and submit again.
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../core/audit/audit-service';
import { SETTINGS_APPROVAL_DOC_TYPE } from '../../core/settings/constants';
import { registerApprovalHandler } from '../approvals/handlers';
import type { ApprovalDocHandler, DocSnapshot } from '../approvals/handlers';
import { settingsRepository as repo } from './repository';
import { activateVersion } from './service';

const handler: ApprovalDocHandler = {
  async snapshot(tx, docId): Promise<DocSnapshot | null> {
    const locked = await repo.lock('RULE_SET', docId, tx);
    if (!locked) return null;
    const control = await repo.controlOf(locked.pageId, tx);
    const unitId = (await repo.anyUnitId(tx)) ?? '';
    return {
      code: `${locked.code ?? 'rules'} v${locked.version}`,
      title: `Rule set ${locked.name} v${locked.version} (${locked.pageId})`,
      amount: null,
      department: control?.ownerDepartment ?? 'Administration',
      unitId,
      createdBy: locked.updatedById ?? locked.createdById,
      status: locked.status === 'PENDING_APPROVAL' ? 'Pending Approval' : 'Draft',
      version: locked.rowVersion,
      fyOpen: true,
    };
  },
  async onSubmitted(tx, docId, req) {
    await repo.setStatus('RULE_SET', docId, 'PENDING_APPROVAL', req.actorId, {}, tx);
  },
  async onApproved(tx, docId, req) {
    const row = await repo.lock('RULE_SET', docId, tx);
    if (!row) return;
    // The head who asked for the change is the publisher; the approver is recorded in the audit row.
    const publisher = row.updatedById ?? row.createdById;
    const fresh = await repo.byId('RULE_SET', docId, tx);
    if (fresh)
      await activateVersion(tx, fresh, publisher, fresh.reason, { approvedBy: req.actorId });
  },
  async onRejected(tx, docId, req) {
    await repo.setStatus('RULE_SET', docId, 'DRAFT', req.actorId, {}, tx);
    await recordAudit(
      {
        action: 'RULE_SET_DRAFTED',
        actorId: req.actorId,
        targetType: 'RuleSet',
        targetId: docId,
        detail: { via: 'REJECTED' } as Prisma.InputJsonObject,
      },
      tx,
    );
  },
  async onReturned(tx, docId, req) {
    await repo.setStatus('RULE_SET', docId, 'DRAFT', req.actorId, {}, tx);
  },
};

registerApprovalHandler(SETTINGS_APPROVAL_DOC_TYPE, handler);
