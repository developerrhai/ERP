// Shared rules of the Quality module (docs2/ERP_Quality_QMS_Visual_Specification): the three priorities, the feature
// switches, who has full Quality rights, the approval trail and the alerts.
import type { Db } from '../../core/db/prisma';
import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { accessUserOf } from '../../core/rbac/access';
import { isQualityAdmin } from '../../core/rbac/permission-model';
import { ADMIN_LEVEL } from '../../core/rbac/role-rules';
import { notificationService } from '../notifications/service';
import { exec, query } from '../procurement/core';
import type { Caller } from '../records/service';

export const PRIORITIES = ['MINOR', 'MAJOR', 'CRITICAL'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const FEATURES = {
  CONDITIONED_CHECKS: {
    label: 'Conditioned checkpoints',
    description: 'An inspection checkpoint can be marked Conditioned: if it is out of limit the sheet becomes conditionally accepted instead of rejected.',
  },
  CRITICAL_ALERT: {
    label: 'Alert on Critical priority',
    description: 'The Quality Head and the Management Representative are alerted at once when a record is marked Critical.',
  },
  CRITICAL_BLOCK: {
    label: 'Block release of Critical records',
    description: 'Only the Quality Head, the Management Representative or an administrator can decide or close a Critical record.',
  },
} as const;
export type FeatureKey = keyof typeof FEATURES;

export async function featureOn(db: Db, key: FeatureKey): Promise<boolean> {
  const r = (await query(db, `SELECT enabled FROM qms_features WHERE key=$1`, key))[0];
  return r ? r.enabled === true : true;
}

/** Management Representative, Quality Head, or an administrator: may override and release Critical records. */
export function hasQualityOverride(caller: Caller): boolean {
  const u = accessUserOf(caller.auth.user);
  return u.level >= ADMIN_LEVEL || isQualityAdmin(u);
}

export async function assertCriticalAllowed(db: Db, caller: Caller, priority: unknown): Promise<void> {
  if (priority !== 'CRITICAL' || hasQualityOverride(caller)) return;
  if (!(await featureOn(db, 'CRITICAL_BLOCK'))) return;
  throw new AppError(
    422,
    'QMS_CRITICAL_BLOCK',
    'This is a Critical record: only the Quality Head, the Management Representative or an administrator can release it.',
    { priority: 'Critical records are released by the Quality Head or the Management Representative.' },
  );
}

/** One line of the approval trail. */
export async function event(
  db: Db,
  entity: 'NCR' | 'INSPECTION' | 'REVOKE',
  entityId: string,
  action: string,
  byId: string,
  note?: string | null,
): Promise<void> {
  await exec(
    db,
    `INSERT INTO qms_events (entity, entity_id, action, note, by_id) VALUES ($1,$2::uuid,$3,$4,$5::uuid)`,
    entity,
    entityId,
    action,
    note?.trim() || null,
    byId,
  );
}

export async function trail(entity: 'NCR' | 'INSPECTION' | 'REVOKE', entityId: string) {
  return (
    // unpaginated: the trail of one record
    await query(
      prisma,
      `SELECT e.action, e.note, e.at, u.name AS by_name FROM qms_events e LEFT JOIN users u ON u.id=e.by_id
        WHERE e.entity=$1 AND e.entity_id=$2::uuid ORDER BY e.at, e.id`,
      entity,
      entityId,
    )
  ).map((r) => ({
    action: String(r.action),
    note: r.note === null ? null : String(r.note),
    at: new Date(r.at as string | Date).toISOString(),
    byName: r.by_name === null ? null : String(r.by_name),
  }));
}

/** The people who answer for quality at a plant: Management Representatives and Quality Heads. */
export async function qualityLeads(db: Db, unitId: string): Promise<string[]> {
  // unpaginated: the few role holders to alert
  const rows = await query(
    db,
    `SELECT u.id::text AS id FROM users u JOIN roles r ON r.id=u.role_id
      WHERE u.status='ACTIVE' AND (r.code IN ('MR','QUALITY_HEAD') OR (r.code='DEPT_HEAD' AND u.department='Quality'))
        AND (r.all_units OR EXISTS (SELECT 1 FROM user_units uu WHERE uu.user_id=u.id AND uu.unit_id=$1::uuid))`,
    unitId,
  );
  return rows.map((r) => String(r.id));
}

export async function alertPeople(
  db: Db,
  userIds: string[],
  type: 'quality.critical' | 'quality.pending' | 'quality.returned',
  title: string,
  body: string,
  entity: { type: string; id: string },
  link: string,
  dedupe: string,
): Promise<void> {
  if (userIds.length === 0) return;
  await notificationService.notify(db, userIds, {
    type,
    title,
    body,
    link,
    entityType: entity.type,
    entityId: entity.id,
    dedupeKey: dedupe,
  });
}

/** A record has just been marked Critical: tell the quality leads (when the switch is on). */
export async function escalate(
  db: Db,
  r: { id: string; number: string; unitId: string; type: string; what: string; link: string },
): Promise<void> {
  if (!(await featureOn(db, 'CRITICAL_ALERT'))) return;
  await alertPeople(
    db,
    await qualityLeads(db, r.unitId),
    'quality.critical',
    `Critical: ${r.number}`,
    r.what.slice(0, 300),
    { type: r.type, id: r.id },
    r.link,
    `quality-critical:${r.id}`,
  );
}
