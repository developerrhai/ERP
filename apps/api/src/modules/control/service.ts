// Phase 31: owner and admin control. Everything is data; there is no eval and there are no user scripts.
import { createHash, randomBytes } from 'node:crypto';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { registry } from '../../core/registry';
import { accessUserOf } from '../../core/rbac/access';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { checkValue, effectiveRules, hoursMessage, ipAllowed, moduleOn, numberLengthOk, previewNumber, ruleViolations, SYSTEM_KEYS, validCidr, withinHours } from './calc';
import type { Effect, FieldDef, FieldType } from './calc';

const S = (v: unknown): string => String(v ?? '');
const N = (v: unknown): number => Number(v ?? 0);

const pageTitle = (pageId: string): string => {
  for (const f of registry.data.families) {
    const it = f.items.find((i) => i.id === pageId);
    if (it) return it.title;
  }
  return pageId;
};
function pageExists(pageId: string): boolean {
  return registry.data.families.some((f) => f.items.some((i) => i.id === pageId));
}
export const moduleOffError = (module: string, plant: string): AppError => new AppError(403, 'MODULE_OFF', `${module} is turned off for ${plant}.`);

const toDef = (r: Row): FieldDef => ({ key: S(r.key), label: S(r.label), type: S(r.type) as FieldType, options: ((r.options as unknown[]) ?? []).map(S), required: Boolean(r.required), lookupKind: r.lookup_kind ? S(r.lookup_kind) : null });

const moduleCache = new Map<string, { at: number; on: boolean }>();

export const controlService = {
  // ------------------------------------------------------------------------------------------ custom fields
  async fieldDefs(pageId: string, f: { unitId?: string | null; roleId?: string | null; all?: boolean } = {}): Promise<Row[]> {
    return query(
      prisma,
      `SELECT * FROM custom_field_defs WHERE page_id = $1 AND ($2::boolean OR active)
          AND ($2::boolean OR cardinality(unit_ids) = 0 OR $3::uuid = ANY(unit_ids)) AND ($2::boolean OR cardinality(role_ids) = 0 OR $4::uuid = ANY(role_ids)) ORDER BY sort, key`,
      pageId, Boolean(f.all), f.unitId ?? null, f.roleId ?? null,
    );
  },
  async createFieldDef(caller: Caller, b: { pageId: string; key: string; label: string; labelHi?: string | null; type: FieldType; options?: string[]; lookupKind?: string | null; required?: boolean; defaultValue?: string | null; help?: string | null; unitIds?: string[]; roleIds?: string[]; inList?: boolean; inFilter?: boolean; inPdf?: boolean; inExcel?: boolean; inImport?: boolean; sort?: number }): Promise<Row> {
    if (!pageExists(b.pageId)) throw Errors.validation({ pageId: 'That page does not exist.' });
    if ((b.type === 'select' || b.type === 'multiselect') && (b.options ?? []).length === 0) throw Errors.validation({ options: 'Give the choices for a select field.' });
    if (b.type === 'lookup' && !b.lookupKind) throw Errors.validation({ lookupKind: 'Choose what the lookup points to.' });
    const n = N((await query(prisma, `SELECT count(*)::int AS n FROM custom_field_defs WHERE page_id = $1 AND active`, b.pageId))[0]!.n);
    if (n >= 50) throw Errors.validation({ key: 'A page can have at most 50 custom fields.' });
    const r = await query(
      prisma,
      `INSERT INTO custom_field_defs (page_id, key, label, label_hi, type, options, lookup_kind, required, default_value, help, unit_ids, role_ids, in_list, in_filter, in_pdf, in_excel, in_import, sort, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::uuid[],$12::uuid[],$13,$14,$15,$16,$17,$18,$19::uuid) RETURNING *`,
      b.pageId, b.key, b.label, b.labelHi ?? null, b.type, JSON.stringify(b.options ?? []), b.lookupKind ?? null, b.required ?? false, b.defaultValue ?? null, b.help ?? null, b.unitIds ?? [], b.roleIds ?? [],
      b.inList ?? false, b.inFilter ?? false, b.inPdf ?? true, b.inExcel ?? true, b.inImport ?? true, b.sort ?? 0, caller.auth.user.id,
    ).catch((e: { meta?: { code?: string } }) => { if (e.meta?.code === '23505') throw Errors.conflict('This page already has a field with that key.'); throw e; });
    await recordAudit({ action: 'control.field_created', actorId: caller.auth.user.id, targetType: 'custom_field', targetId: S(r[0]!.id), detail: { page: b.pageId, key: b.key, type: b.type } });
    return r[0]!;
  },
  async updateFieldDef(caller: Caller, id: string, b: { label?: string; labelHi?: string | null; required?: boolean; help?: string | null; active?: boolean; options?: string[]; unitIds?: string[]; roleIds?: string[]; inList?: boolean; inFilter?: boolean; inPdf?: boolean; inExcel?: boolean; sort?: number }): Promise<Row> {
    const before = (await query(prisma, `SELECT * FROM custom_field_defs WHERE id = $1::uuid`, id))[0];
    if (!before) throw Errors.notFound('Field not found.');
    const r = await query(
      prisma,
      `UPDATE custom_field_defs SET label = COALESCE($2, label), label_hi = CASE WHEN $3::boolean THEN $4 ELSE label_hi END, required = COALESCE($5, required), help = CASE WHEN $6::boolean THEN $7 ELSE help END, active = COALESCE($8, active),
              options = COALESCE($9::jsonb, options), unit_ids = COALESCE($10::uuid[], unit_ids), role_ids = COALESCE($11::uuid[], role_ids), in_list = COALESCE($12, in_list), in_filter = COALESCE($13, in_filter), in_pdf = COALESCE($14, in_pdf), in_excel = COALESCE($15, in_excel), sort = COALESCE($16, sort)
        WHERE id = $1::uuid RETURNING *`,
      id, b.label ?? null, b.labelHi !== undefined, b.labelHi ?? null, b.required ?? null, b.help !== undefined, b.help ?? null, b.active ?? null, b.options ? JSON.stringify(b.options) : null, b.unitIds ?? null, b.roleIds ?? null, b.inList ?? null, b.inFilter ?? null, b.inPdf ?? null, b.inExcel ?? null, b.sort ?? null,
    );
    await recordAudit({ action: 'control.field_changed', actorId: caller.auth.user.id, targetType: 'custom_field', targetId: id, detail: { before: { label: S(before.label), required: Boolean(before.required), active: Boolean(before.active) }, after: b } });
    return r[0]!;
  },

  /** Values of the custom fields of one record. */
  async values(pageId: string, recordId: string): Promise<Record<string, unknown>> {
    const rows = await query(prisma, `SELECT key, value FROM custom_field_values WHERE page_id = $1 AND record_id = $2::uuid`, pageId, recordId);
    return Object.fromEntries(rows.map((r) => [S(r.key), r.value]));
  },
  /** Save custom values: each is checked against its definition and the plant / role it is visible for; form rules apply too. */
  async setValues(caller: Caller, pageId: string, recordId: string, input: Record<string, unknown>, status: string | null): Promise<Record<string, unknown>> {
    const user = accessUserOf(caller.auth.user);
    const defs = await controlService.fieldDefs(pageId, { unitId: caller.ctx.unitId, roleId: S(user.roleId ?? caller.auth.roleId) });
    const byKey = new Map(defs.map((d) => [S(d.key), d]));
    const errors: Record<string, string> = {};
    const toSave: [string, unknown][] = [];
    for (const k of Object.keys(input)) {
      const d = byKey.get(k);
      if (!d) { errors[k] = `${k} is not a field of this page.`; continue; }
      const c = checkValue(toDef(d), input[k]);
      if (!c.ok) errors[k] = c.error;
      else toSave.push([k, c.value]);
    }
    const existing = await controlService.values(pageId, recordId);
    const merged = { ...existing, ...Object.fromEntries(toSave) };
    for (const d of defs) if (Boolean(d.required) && (merged[S(d.key)] === undefined || merged[S(d.key)] === null)) errors[S(d.key)] = `${S(d.label)} is required.`;
    const rules = await controlService.rulesFor(pageId, S(caller.auth.roleId), status, caller.ctx.unitId ?? null);
    Object.assign(errors, ruleViolations(rules, toSave.map(([k]) => k), merged, Object.fromEntries(defs.map((d) => [S(d.key), S(d.label)]))));
    if (Object.keys(errors).length > 0) throw Errors.validation(errors);
    for (const [k, v] of toSave) {
      if (v === null) await query(prisma, `DELETE FROM custom_field_values WHERE page_id = $1 AND record_id = $2::uuid AND key = $3`, pageId, recordId, k);
      else await query(prisma, `INSERT INTO custom_field_values (page_id, record_id, key, value, updated_by_id) VALUES ($1,$2::uuid,$3,$4::jsonb,$5::uuid) ON CONFLICT (page_id, record_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by_id = EXCLUDED.updated_by_id`, pageId, recordId, k, JSON.stringify(v), caller.auth.user.id);
    }
    return controlService.values(pageId, recordId);
  },
  /** For print and export: label and value of the custom fields that are switched on for that output. */
  async printFacts(pageId: string, recordId: string, kind: 'pdf' | 'excel'): Promise<{ label: string; value: string }[]> {
    const rows = await query(
      prisma,
      `SELECT d.label, d.type, d.options, v.value FROM custom_field_defs d JOIN custom_field_values v ON v.page_id = d.page_id AND v.key = d.key
        WHERE d.page_id = $1 AND v.record_id = $2::uuid AND d.active AND (CASE WHEN $3 = 'pdf' THEN d.in_pdf ELSE d.in_excel END) ORDER BY d.sort, d.key`,
      pageId, recordId, kind,
    );
    return rows.map((r) => ({ label: S(r.label), value: Array.isArray(r.value) ? (r.value as unknown[]).map(S).join(', ') : typeof r.value === 'boolean' ? (r.value ? 'Yes' : 'No') : S(r.value) }));
  },

  // ------------------------------------------------------------------------------------------ form rules
  async rulesFor(pageId: string, roleId: string, status: string | null, unitId: string | null): Promise<Map<string, Effect>> {
    const rows = await query(prisma, `SELECT field_key, effect, role_id::text AS role_id, status, unit_id::text AS unit_id FROM form_rules WHERE page_id = $1`, pageId);
    return effectiveRules(rows.map((r) => ({ fieldKey: S(r.field_key), effect: S(r.effect) as Effect, roleId: r.role_id ? S(r.role_id) : null, status: r.status ? S(r.status) : null, unitId: r.unit_id ? S(r.unit_id) : null })), { roleId, status, unitId });
  },
  async listRules(pageId?: string): Promise<Row[]> {
    return query(prisma, `SELECT f.*, r.name AS role, u.code AS unit_code FROM form_rules f LEFT JOIN roles r ON r.id = f.role_id LEFT JOIN units u ON u.id = f.unit_id WHERE ($1::text IS NULL OR f.page_id = $1) ORDER BY f.page_id, f.field_key`, pageId ?? null);
  },
  async createRule(caller: Caller, b: { pageId: string; fieldKey: string; effect: Effect; roleId?: string | null; status?: string | null; unitId?: string | null }): Promise<Row> {
    if (!pageExists(b.pageId)) throw Errors.validation({ pageId: 'That page does not exist.' });
    if (SYSTEM_KEYS.has(b.fieldKey) && b.effect !== 'REQUIRED') throw Errors.validation({ fieldKey: `${b.fieldKey} is required by the system and can't be made optional.` });
    const r = await query(prisma, `INSERT INTO form_rules (page_id, role_id, status, unit_id, field_key, effect, created_by_id) VALUES ($1,$2::uuid,$3,$4::uuid,$5,$6,$7::uuid) RETURNING *`, b.pageId, b.roleId ?? null, b.status ?? null, b.unitId ?? null, b.fieldKey, b.effect, caller.auth.user.id)
      .catch((e: { meta?: { code?: string } }) => { if (e.meta?.code === '23505') throw Errors.conflict('This rule already exists.'); throw e; });
    await recordAudit({ action: 'control.rule_created', actorId: caller.auth.user.id, targetType: 'form_rule', targetId: S(r[0]!.id), detail: b });
    return r[0]!;
  },
  async deleteRule(caller: Caller, id: string): Promise<void> {
    const r = await query(prisma, `DELETE FROM form_rules WHERE id = $1::uuid RETURNING *`, id);
    if (!r[0]) throw Errors.notFound('Rule not found.');
    await recordAudit({ action: 'control.rule_deleted', actorId: caller.auth.user.id, targetType: 'form_rule', targetId: id, detail: { page: S(r[0].page_id), field: S(r[0].field_key), effect: S(r[0].effect) } });
  },
  /** The enforcement hook the shared record engine calls on every create and update (the API, not just the screen). */
  async assertFormRules(caller: Caller, pageId: string, status: string | null, changed: string[], values: Record<string, unknown>): Promise<void> {
    const rows = await query(prisma, `SELECT 1 FROM form_rules WHERE page_id = $1 LIMIT 1`, pageId);
    if (!rows[0]) return;
    const rules = await controlService.rulesFor(pageId, S(caller.auth.roleId), status, caller.ctx.unitId ?? null);
    if (rules.size === 0) return;
    const v = ruleViolations(rules, changed, values);
    if (Object.keys(v).length > 0) throw Errors.validation(v);
  },
  /** GET /meta/form/:pageId: what the form shows for this person: custom fields and the rules in force. */
  async formMeta(caller: Caller, pageId: string, status: string | null): Promise<Row> {
    const defs = await controlService.fieldDefs(pageId, { unitId: caller.ctx.unitId, roleId: S(caller.auth.roleId) });
    const rules = await controlService.rulesFor(pageId, S(caller.auth.roleId), status, caller.ctx.unitId ?? null);
    return { pageId, customFields: defs.map((d) => ({ key: d.key, label: d.label, labelHi: d.label_hi, type: d.type, options: d.options, required: d.required, help: d.help, default: d.default_value, inList: d.in_list, inFilter: d.in_filter })), rules: Object.fromEntries(rules) };
  },

  // ------------------------------------------------------------------------------------------ modules per plant and role
  async moduleControls(): Promise<Row[]> {
    return query(prisma, `SELECT m.*, u.code AS unit_code, r.name AS role FROM module_plant_controls m JOIN units u ON u.id = m.unit_id LEFT JOIN roles r ON r.id = m.role_id ORDER BY m.page_id, u.code`);
  },
  async setModule(caller: Caller, b: { pageId: string; unitId: string; roleId?: string | null; enabled: boolean }): Promise<Row> {
    if (!pageExists(b.pageId)) throw Errors.validation({ pageId: 'That page does not exist.' });
    const r = await query(prisma, `INSERT INTO module_plant_controls (page_id, unit_id, role_id, enabled, updated_by_id) VALUES ($1,$2::uuid,$3::uuid,$4,$5::uuid) ON CONFLICT (page_id, unit_id, coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by_id = EXCLUDED.updated_by_id RETURNING *`, b.pageId, b.unitId, b.roleId ?? null, b.enabled, caller.auth.user.id);
    await recordAudit({ action: 'control.module_switched', actorId: caller.auth.user.id, targetType: 'module', targetId: b.pageId, detail: b });
    return r[0]!;
  },
  /** Is the page on for this plant and role? Used by the API guard and the menu. */
  async isModuleOn(pageId: string, unitId: string | null, roleId: string): Promise<boolean> {
    if (!unitId) return true;
    const key = `${pageId}|${unitId}|${roleId}`;
    const hit = moduleCache.get(key);
    if (hit && Date.now() - hit.at < 15_000) return hit.on;
    const on = await controlService.isModuleOnFresh(pageId, unitId, roleId);
    moduleCache.set(key, { at: Date.now(), on });
    return on;
  },
  clearModuleCache(): void {
    moduleCache.clear();
  },
  async isModuleOnFresh(pageId: string, unitId: string, roleId: string): Promise<boolean> {
    const rows = await query(prisma, `SELECT unit_id::text AS unit_id, role_id::text AS role_id, enabled FROM module_plant_controls WHERE page_id = $1 AND unit_id = $2::uuid`, pageId, unitId);
    return moduleOn(rows.map((r) => ({ unitId: S(r.unit_id), roleId: r.role_id ? S(r.role_id) : null, enabled: Boolean(r.enabled) })), unitId, roleId);
  },
  async assertModuleOn(pageId: string, unitId: string | null, roleId: string, plantName?: string): Promise<void> {
    if (await controlService.isModuleOn(pageId, unitId, roleId)) return;
    const plant = plantName ?? S((await query(prisma, `SELECT name FROM units WHERE id = $1::uuid`, unitId))[0]?.name);
    throw moduleOffError(pageTitle(pageId), plant);
  },
  /** Pages hidden in the menu: off for every plant the user chose. */
  async hiddenPages(unitIds: string[], roleId: string): Promise<Set<string>> {
    if (unitIds.length === 0) return new Set();
    const rows = await query(prisma, `SELECT DISTINCT page_id FROM module_plant_controls WHERE unit_id = ANY($1::uuid[])`, unitIds);
    const hidden = new Set<string>();
    for (const r of rows) {
      let on = false;
      for (const u of unitIds) if (await controlService.isModuleOn(S(r.page_id), u, roleId)) { on = true; break; }
      if (!on) hidden.add(S(r.page_id));
    }
    return hidden;
  },

  // ------------------------------------------------------------------------------------------ numbering
  async series(): Promise<Row[]> {
    const rows = await query(prisma, `SELECT s.*, u.code AS unit_code FROM number_series s LEFT JOIN units u ON u.id = s.unit_id ORDER BY s.page_id, u.code NULLS FIRST`);
    return rows.map((s) => ({ ...s, preview: previewNumber({ prefix: S(s.prefix), suffix: s.suffix ? S(s.suffix) : null, padding: N(s.padding) || 5, next: N(s.next_value) || 1 }) }));
  },
  async previewSeries(b: { prefix: string; suffix?: string | null; padding: number; next?: number; plant?: string; fy?: string; gst?: boolean }): Promise<{ preview: string; length: number; ok: boolean }> {
    const preview = previewNumber({ prefix: b.prefix, suffix: b.suffix ?? null, padding: b.padding, next: b.next ?? 1, ...(b.plant ? { plant: b.plant } : {}), ...(b.fy ? { fy: b.fy } : {}) });
    return { preview, length: preview.length, ok: numberLengthOk(preview, Boolean(b.gst)) };
  },

  // ------------------------------------------------------------------------------------------ sessions
  async sessions(f: { userId?: string }): Promise<Row[]> {
    return query(prisma, `SELECT s.id, s.user_id, u.name, u.login_id, s.ip, s.user_agent, s.created_at, s.last_used_at, s.mfa_verified FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.revoked_at IS NULL AND s.expires_at > now() AND ($1::uuid IS NULL OR s.user_id = $1::uuid) ORDER BY s.last_used_at DESC NULLS LAST LIMIT 300`, f.userId ?? null);
  },
  async forceLogout(caller: Caller, sessionId: string): Promise<Row> {
    const r = await query(prisma, `UPDATE sessions SET revoked_at = now(), revoked_reason = 'ADMIN_FORCE_LOGOUT', revoked_by_id = $2::uuid WHERE id = $1::uuid AND revoked_at IS NULL RETURNING id, user_id`, sessionId, caller.auth.user.id);
    if (!r[0]) throw Errors.notFound('Session not found or already ended.');
    await recordAudit({ action: 'control.force_logout', actorId: caller.auth.user.id, targetType: 'session', targetId: sessionId, detail: { userId: S(r[0].user_id) } });
    return r[0];
  },

  // ------------------------------------------------------------------------------------------ login policies
  async loginPolicies(): Promise<Row[]> {
    return query(prisma, `SELECT p.role_id, r.name AS role, p.hours_from::text AS hours_from, p.hours_to::text AS hours_to, p.ip_cidrs, p.mfa_required, p.inactive_days FROM role_login_policies p JOIN roles r ON r.id = p.role_id ORDER BY r.level DESC`);
  },
  async setLoginPolicy(caller: Caller, b: { roleId: string; hoursFrom?: string | null; hoursTo?: string | null; ipCidrs?: string[]; mfaRequired?: boolean; inactiveDays?: number | null }): Promise<Row> {
    const bad = (b.ipCidrs ?? []).filter((c) => !validCidr(c));
    if (bad.length > 0) throw Errors.validation({ ipCidrs: `Not a valid address range: ${bad.join(', ')}. Use 203.0.113.0/24.` });
    if (Boolean(b.hoursFrom) !== Boolean(b.hoursTo)) throw Errors.validation({ hoursTo: 'Give both the start and the end of the sign-in hours.' });
    const r = await query(prisma, `INSERT INTO role_login_policies (role_id, hours_from, hours_to, ip_cidrs, mfa_required, inactive_days, updated_by_id) VALUES ($1::uuid,$2::time,$3::time,$4::text[],$5,$6,$7::uuid) ON CONFLICT (role_id) DO UPDATE SET hours_from = EXCLUDED.hours_from, hours_to = EXCLUDED.hours_to, ip_cidrs = EXCLUDED.ip_cidrs, mfa_required = EXCLUDED.mfa_required, inactive_days = EXCLUDED.inactive_days, updated_at = now(), updated_by_id = EXCLUDED.updated_by_id RETURNING *`, b.roleId, b.hoursFrom ?? null, b.hoursTo ?? null, b.ipCidrs ?? [], b.mfaRequired ?? false, b.inactiveDays ?? null, caller.auth.user.id);
    await recordAudit({ action: 'control.login_policy_set', actorId: caller.auth.user.id, targetType: 'role', targetId: b.roleId, detail: b });
    return r[0]!;
  },
  /** Called at sign-in after the password is right: hours and the IP allow-list of the user's role. */
  async assertLoginPolicy(roleId: string, ip: string | null | undefined, now: Date = new Date(), userId: string | null = null): Promise<void> {
    const p = (await query(prisma, `SELECT hours_from::text AS hours_from, hours_to::text AS hours_to, ip_cidrs FROM role_login_policies WHERE role_id = $1::uuid`, roleId))[0];
    if (!p) return;
    const refuse = async (message: string): Promise<never> => {
      await recordAudit({ action: 'LOGIN_BLOCKED_POLICY', actorId: userId, targetType: 'User', targetId: userId ?? roleId, detail: { message, ip: ip ?? null } });
      throw Errors.forbidden(message);
    };
    if (!withinHours(now, p.hours_from ? S(p.hours_from) : null, p.hours_to ? S(p.hours_to) : null)) await refuse(hoursMessage(S(p.hours_from), S(p.hours_to)));
    if (!ipAllowed(ip, (p.ip_cidrs as string[]) ?? [])) await refuse('Sign-in from this address is not allowed for your role.');
  },

  // ------------------------------------------------------------------------------------------ View as (read-only, 30 minutes, with a reason)
  async startViewAs(caller: Caller, targetUserId: string, reason: string): Promise<Row> {
    if (!reason || reason.trim().length < 5) throw Errors.validation({ reason: 'Give a reason (at least 5 characters).' });
    const t = (await query(prisma, `SELECT id, name, status FROM users WHERE id = $1::uuid`, targetUserId))[0];
    if (!t || S(t.status) !== 'ACTIVE') throw Errors.validation({ targetUserId: 'Choose an active user.' });
    if (S(t.id) === caller.auth.user.id) throw Errors.validation({ targetUserId: 'Choose another person.' });
    const r = await query(prisma, `INSERT INTO view_as_sessions (owner_user_id, target_user_id, reason, expires_at) VALUES ($1::uuid,$2::uuid,$3, now() + interval '30 minutes') RETURNING *`, caller.auth.user.id, targetUserId, reason.trim());
    await recordAudit({ action: 'control.view_as_started', actorId: caller.auth.user.id, targetType: 'user', targetId: targetUserId, detail: { reason: reason.trim(), sessionId: S(r[0]!.id) } });
    return { ...r[0]!, targetName: S(t.name), banner: `Viewing as ${S(t.name)} — read-only.` };
  },
  async endViewAs(caller: Caller, id: string): Promise<void> {
    const r = await query(prisma, `UPDATE view_as_sessions SET ended_at = now() WHERE id = $1::uuid AND owner_user_id = $2::uuid AND ended_at IS NULL RETURNING id`, id, caller.auth.user.id);
    if (!r[0]) throw Errors.notFound('View-as session not found.');
    await recordAudit({ action: 'control.view_as_ended', actorId: caller.auth.user.id, targetType: 'view_as_session', targetId: id });
  },

  // ------------------------------------------------------------------------------------------ API keys
  async apiKeys(): Promise<Row[]> {
    return query(prisma, `SELECT id, name, prefix, scopes, unit_ids, expires_at, last_used_at, revoked_at, created_at FROM api_keys ORDER BY created_at DESC`);
  },
  /** The key is shown once; only its hash is stored. */
  async createApiKey(caller: Caller, b: { name: string; scopes?: string[]; unitIds?: string[]; expiresAt?: string | null }): Promise<{ id: string; key: string }> {
    const secret = randomBytes(24).toString('hex');
    const prefix = `rhk_${randomBytes(4).toString('hex')}`;
    const key = `${prefix}.${secret}`;
    const r = await query(prisma, `INSERT INTO api_keys (name, prefix, key_hash, scopes, unit_ids, expires_at, created_by_id) VALUES ($1,$2,$3,$4::text[],$5::uuid[],$6::timestamptz,$7::uuid) RETURNING id`, b.name, prefix, createHash('sha256').update(secret).digest('hex'), b.scopes ?? [], b.unitIds ?? [], b.expiresAt ?? null, caller.auth.user.id);
    await recordAudit({ action: 'control.api_key_created', actorId: caller.auth.user.id, targetType: 'api_key', targetId: S(r[0]!.id), detail: { name: b.name, prefix } });
    return { id: S(r[0]!.id), key };
  },
  async revokeApiKey(caller: Caller, id: string): Promise<void> {
    const r = await query(prisma, `UPDATE api_keys SET revoked_at = now() WHERE id = $1::uuid AND revoked_at IS NULL RETURNING id`, id);
    if (!r[0]) throw Errors.notFound('API key not found or already revoked.');
    await recordAudit({ action: 'control.api_key_revoked', actorId: caller.auth.user.id, targetType: 'api_key', targetId: id });
  },

  // ------------------------------------------------------------------------------------------ owner console cards and health
  async consoleCards(): Promise<Row> {
    const one = async (sql: string): Promise<number> => N((await query(prisma, sql).catch(() => [{ n: 0 }]))[0]?.n);
    return {
      rulesActive: await one(`SELECT count(*)::int AS n FROM form_rules`),
      customFields: await one(`SELECT count(*)::int AS n FROM custom_field_defs WHERE active`),
      automationsOn: await one(`SELECT count(*)::int AS n FROM mail_automation_library WHERE enabled`),
      automationsOff: await one(`SELECT count(*)::int AS n FROM mail_automation_library WHERE NOT enabled`),
      modulesOffByPlant: await one(`SELECT count(*)::int AS n FROM module_plant_controls WHERE NOT enabled`),
      sessionsNow: await one(`SELECT count(*)::int AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > now()`),
      failedLoginsToday: await one(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'LOGIN_FAILED' AND at >= date_trunc('day', now())`),
      devicesOffline: await one(`SELECT count(*)::int AS n FROM attendance_devices WHERE active AND status = 'OFFLINE' AND connection <> 'MANUAL'`),
      needsReviewRows: await one(`SELECT count(*)::int AS n FROM cl_min_wages WHERE needs_review`),
      viewAsToday: await one(`SELECT count(*)::int AS n FROM view_as_sessions WHERE started_at >= date_trunc('day', now())`),
      apiKeysActive: await one(`SELECT count(*)::int AS n FROM api_keys WHERE revoked_at IS NULL`),
      openExceptions: await one(`SELECT count(*)::int AS n FROM process_exceptions WHERE resolved_at IS NULL`),
    };
  },
  async health(): Promise<Row> {
    const t0 = Date.now();
    await query(prisma, 'SELECT 1');
    const db = Date.now() - t0;
    const queues = await query(prisma, `SELECT name, count(*) FILTER (WHERE state = 'failed')::int AS failed, count(*) FILTER (WHERE state IN ('created','retry'))::int AS waiting FROM pgboss.job GROUP BY name ORDER BY failed DESC, waiting DESC LIMIT 15`).catch(() => []);
    const outbox = await query(prisma, `SELECT count(*) FILTER (WHERE sent_at IS NULL)::int AS pending FROM email_outbox`).catch(() => [{ pending: 0 }]);
    return { dbMs: db, queues, emailPending: N(outbox[0]?.pending), time: new Date().toISOString() };
  },
};
