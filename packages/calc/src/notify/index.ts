// Phase 21 pure calculation & decision engine (packages/calc/notify):
// decideChannels, quietHours, collapseKey, audienceResolve, payslipPassword, template safety & PII lint.

export type NotifyChannel = 'IN_APP' | 'PUSH' | 'EMAIL' | 'SMS';
export type NotifyPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type NotifyCategory =
  | 'APPROVAL'
  | 'ALERT'
  | 'DOCUMENT'
  | 'ANNOUNCEMENT'
  | 'SECURITY'
  | 'REMINDER'
  | 'DIGEST'
  | 'MARKETING';

export type DeliveryDecisionStatus = 'QUEUED' | 'HELD' | 'SKIPPED' | 'SUPPRESSED' | 'SUMMARY_COLLAPSED';
export type DeliverySkipReason =
  | 'TYPE_OFF'
  | 'CHANNEL_NOT_ALLOWED'
  | 'CHANNEL_KILLED'
  | 'PREF_OFF'
  | 'NO_DEVICE'
  | 'NO_ADDRESS'
  | 'NO_CONSENT'
  | 'SUPPRESSED'
  | 'QUIET_HOURS'
  | 'RATE_LIMIT'
  | 'DIGEST_HELD';

export interface NotificationTypeConfig {
  code: string;
  category: NotifyCategory;
  priority: NotifyPriority;
  enabled: boolean;
  allowedChannels: readonly NotifyChannel[];
  defaultChannels: readonly NotifyChannel[];
  mandatoryChannels: readonly NotifyChannel[];
  sensitive: boolean;
  digestAllowed: boolean;
}

export interface NotificationGlobalSettings {
  emailEnabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
  quietStart: string; // HH:MM
  quietEnd: string;   // HH:MM
  pushMaxPerUserHour: number;
}

export interface UserChannelPrefInput {
  enabled?: boolean;
  mode?: 'IMMEDIATE' | 'DIGEST';
}

export interface UserNotificationPolicyInput {
  quietStart?: string | null;
  quietEnd?: string | null;
  recentPushCountLastHour?: number;
  prefsByChannel?: Partial<Record<NotifyChannel, UserChannelPrefInput>>;
}

export interface UserEndpointsInput {
  pushDeviceCount: number;
  email?: string | null;
  emailSuppressed?: boolean;
  mobile?: string | null;
  smsConsent?: boolean;
}

export interface ChannelDecision {
  channel: NotifyChannel;
  status: DeliveryDecisionStatus;
  reason?: DeliverySkipReason;
  releaseAt?: Date;
}

function parseHm(hm: string, fallbackMinutes: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return fallbackMinutes;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return fallbackMinutes;
  return h * 60 + min;
}

/** Converts a UTC Date into Asia/Kolkata minute-of-day (UTC+05:30 = +330 min). */
export function istMinutesOfDay(now: Date): number {
  const istMs = now.getTime() + 330 * 60_000;
  const d = new Date(istMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function isWithinQuietHours(now: Date, quietStart: string, quietEnd: string): boolean {
  const s = parseHm(quietStart, 22 * 60);
  const e = parseHm(quietEnd, 7 * 60);
  if (s === e) return false;
  const cur = istMinutesOfDay(now);
  if (s < e) {
    return cur >= s && cur < e;
  }
  // Crosses midnight (e.g. 22:00 -> 07:00)
  return cur >= s || cur < e;
}

export function nextQuietEndUtc(now: Date, quietEnd: string): Date {
  const e = parseHm(quietEnd, 7 * 60);
  const cur = istMinutesOfDay(now);
  const deltaMin = e > cur ? e - cur : 24 * 60 - cur + e;
  return new Date(now.getTime() + deltaMin * 60_000);
}

const ALL_CHANNELS: readonly NotifyChannel[] = ['IN_APP', 'PUSH', 'EMAIL', 'SMS'];

/**
 * Pure 9-rule channel decision matrix (PHASE-21 §5.2):
 * In-app is always delivered when type is active (SECURITY types cannot be disabled).
 */
export function decideChannels(
  type: NotificationTypeConfig,
  userPolicy: UserNotificationPolicyInput,
  settings: NotificationGlobalSettings,
  now: Date,
  endpoints: UserEndpointsInput,
): Record<NotifyChannel, ChannelDecision> {
  const typeActive = type.category === 'SECURITY' ? true : type.enabled;
  const qStart = userPolicy.quietStart || settings.quietStart;
  const qEnd = userPolicy.quietEnd || settings.quietEnd;
  const inQuiet = isWithinQuietHours(now, qStart, qEnd);

  const out = {} as Record<NotifyChannel, ChannelDecision>;

  for (const ch of ALL_CHANNELS) {
    if (ch === 'IN_APP') {
      if (!typeActive) {
        out[ch] = { channel: ch, status: 'SKIPPED', reason: 'TYPE_OFF' };
      } else {
        const mandatoryInApp = type.category === 'SECURITY' || type.mandatoryChannels.includes('IN_APP');
        const inAppPref = userPolicy.prefsByChannel?.IN_APP;
        const inAppEnabled = mandatoryInApp ? true : (inAppPref?.enabled ?? true);
        out[ch] = inAppEnabled
          ? { channel: ch, status: 'QUEUED' }
          : { channel: ch, status: 'SKIPPED', reason: 'PREF_OFF' };
      }
      continue;
    }

    // 1. Type disabled -> nothing at all
    if (!typeActive) {
      out[ch] = { channel: ch, status: 'SKIPPED', reason: 'TYPE_OFF' };
      continue;
    }

    // 2. Channel not allowed on type
    if (!type.allowedChannels.includes(ch)) {
      out[ch] = { channel: ch, status: 'SKIPPED', reason: 'CHANNEL_NOT_ALLOWED' };
      continue;
    }

    // 3. Global channel kill switch
    const killed =
      (ch === 'EMAIL' && !settings.emailEnabled) ||
      (ch === 'PUSH' && !settings.pushEnabled) ||
      (ch === 'SMS' && !settings.smsEnabled);
    if (killed) {
      out[ch] = { channel: ch, status: 'SKIPPED', reason: 'CHANNEL_KILLED' };
      continue;
    }

    // 4. Not mandatory and user pref off (falls back to defaultChannels inclusion if pref unset)
    const mandatory = type.mandatoryChannels.includes(ch);
    const userPref = userPolicy.prefsByChannel?.[ch];
    const defaultEnabled = type.defaultChannels.includes(ch);
    const prefEnabled = mandatory ? true : (userPref?.enabled ?? defaultEnabled);
    if (!prefEnabled) {
      out[ch] = { channel: ch, status: 'SKIPPED', reason: 'PREF_OFF' };
      continue;
    }

    // 5 & 6. Missing endpoint or suppressed email
    if (ch === 'PUSH' && endpoints.pushDeviceCount <= 0) {
      out[ch] = { channel: ch, status: 'SKIPPED', reason: 'NO_DEVICE' };
      continue;
    }
    if (ch === 'EMAIL') {
      if (!endpoints.email || !endpoints.email.trim()) {
        out[ch] = { channel: ch, status: 'SKIPPED', reason: 'NO_ADDRESS' };
        continue;
      }
      if (endpoints.emailSuppressed) {
        out[ch] = { channel: ch, status: 'SUPPRESSED', reason: 'SUPPRESSED' };
        continue;
      }
    }
    if (ch === 'SMS') {
      if (!endpoints.mobile || !endpoints.mobile.trim()) {
        out[ch] = { channel: ch, status: 'SKIPPED', reason: 'NO_ADDRESS' };
        continue;
      }
      if (endpoints.smsConsent === false && type.priority !== 'URGENT') {
        out[ch] = { channel: ch, status: 'SKIPPED', reason: 'NO_CONSENT' };
        continue;
      }
    }

    // 7. Quiet hours hold Push & SMS when priority < URGENT (Email ignores quiet hours)
    if ((ch === 'PUSH' || ch === 'SMS') && inQuiet && type.priority !== 'URGENT') {
      out[ch] = {
        channel: ch,
        status: 'HELD',
        reason: 'QUIET_HOURS',
        releaseAt: nextQuietEndUtc(now, qEnd),
      };
      continue;
    }

    // 8. Push hourly cap -> collapse into summary push
    if (
      ch === 'PUSH' &&
      (userPolicy.recentPushCountLastHour ?? 0) >= settings.pushMaxPerUserHour &&
      type.priority !== 'URGENT'
    ) {
      out[ch] = { channel: ch, status: 'SUMMARY_COLLAPSED', reason: 'RATE_LIMIT' };
      continue;
    }

    // 9. User digest mode on EMAIL
    if (ch === 'EMAIL' && !mandatory && type.digestAllowed && userPref?.mode === 'DIGEST') {
      out[ch] = { channel: ch, status: 'HELD', reason: 'DIGEST_HELD' };
      continue;
    }

    out[ch] = { channel: ch, status: 'QUEUED' };
  }

  return out;
}

/** Encodes a collapse key into <= 32 URL-safe Web Push Topic bytes. */
export function buildCollapseKey(rawKey: string): string {
  const b64 = Buffer.from(rawKey, 'utf8')
    .toString('base64url')
    .replace(/=+$/, '');
  return b64.slice(0, 32);
}

export interface AudienceSpec {
  all?: boolean;
  unitIds?: string[];
  departmentIds?: string[];
  roleIds?: string[];
  userIds?: string[];
}

export interface AudienceCandidateUser {
  id: string;
  active: boolean;
  unitIds: string[];
  departments: string[];
  roleId: string;
}

/** Resolves unique active user IDs from union of unit/department/role/explicit user selectors. */
export function resolveAudienceUsers(
  audience: AudienceSpec,
  users: readonly AudienceCandidateUser[],
): string[] {
  const unitSet = new Set(audience.unitIds ?? []);
  const deptSet = new Set((audience.departmentIds ?? []).map((d) => d.toLowerCase()));
  const roleSet = new Set(audience.roleIds ?? []);
  const explicitSet = new Set(audience.userIds ?? []);
  const matched: string[] = [];

  for (const u of users) {
    if (!u.active) continue;
    if (
      audience.all ||
      explicitSet.has(u.id) ||
      roleSet.has(u.roleId) ||
      u.unitIds.some((id) => unitSet.has(id)) ||
      u.departments.some((d) => deptSet.has(d.toLowerCase()))
    ) {
      matched.push(u.id);
    }
  }
  return matched;
}

/**
 * Payslip PDF encryption password (§5.7):
 * First 4 letters of PAN in capitals + DDMM of DOB (e.g., ABCD0507).
 * Fallback if no PAN: uppercase alphanumeric employee code prefix + DDMM.
 */
export function buildPayslipPassword(
  pan: string | null | undefined,
  empCode: string,
  dob: Date | string,
): string {
  const d = dob instanceof Date ? dob : new Date(dob);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const cleanPan = (pan ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const prefix = cleanPan.length >= 4 ? cleanPan.slice(0, 4) : empCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `${prefix}${dd}${mm}`;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderEscapedTemplate(template: string, vars: Record<string, unknown>, htmlEscape = true): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const val = vars[key];
    const text = val === null || val === undefined ? '' : String(val);
    return htmlEscape ? escapeHtml(text) : text;
  });
}

const FORBIDDEN_PII_VARS = ['aadhaar', 'aadhar', 'pan', 'bankAccount', 'accountNumber', 'ifsc', 'salary', 'netPay', 'grossPay'];

/** Checks notification/push template text to enforce §5.9 zero-PII rule. */
export function findPiiVariablesInTemplate(template: string): string[] {
  const lower = template.toLowerCase();
  return FORBIDDEN_PII_VARS.filter((v) => lower.includes(`{{${v.toLowerCase()}}}`));
}

