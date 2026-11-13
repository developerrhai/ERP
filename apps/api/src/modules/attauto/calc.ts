// Phase 28 pure rules: the ZKTeco push parser, the geo-fence, the late-mark counter, device health and the lock date.

export interface ParsedPunch {
  code: string;
  at: Date;
  status: string;
  direction: 'IN' | 'OUT' | null;
}

/** ZK status 0 / 4 = in, 1 / 5 = out, anything else (break, unknown) is not a direction. */
export function directionOf(status: string): 'IN' | 'OUT' | null {
  if (status === '0' || status === '4') return 'IN';
  if (status === '1' || status === '5') return 'OUT';
  return null;
}

/** Device clock text "YYYY-MM-DD HH:MM:SS" in the device time zone (IST = +05:30 by default). */
export function parseDeviceTime(text: string, offsetMinutes = 330): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) - offsetMinutes * 60_000;
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The body of POST /iclock/cdata?table=ATTLOG: one punch per line, tab separated: PIN, time, status, verify, ... */
export function parsePushBody(body: string, offsetMinutes = 330): { punches: ParsedPunch[]; bad: number } {
  const punches: ParsedPunch[] = [];
  let bad = 0;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const f = line.split('\t');
    const at = f.length >= 2 ? parseDeviceTime(f[1]!, offsetMinutes) : null;
    const code = (f[0] ?? '').trim();
    if (!code || !at) {
      bad += 1;
      continue;
    }
    const status = (f[2] ?? '').trim();
    punches.push({ code, at, status, direction: directionOf(status) });
  }
  return { punches, bad };
}

/** Distance in metres between two GPS points (haversine). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Inside when the distance is at most the radius (exactly on the radius is inside). */
export function insideSite(distance: number, radiusM: number): boolean {
  return Math.round(distance * 1000) / 1000 <= radiusM;
}

/** The late mark that triggers a deduction: every Nth mark of the month (3rd, 6th ...). */
export function lateMarkTriggers(lateDaysInMonth: number, everyN: number): boolean {
  return everyN > 0 && lateDaysInMonth > 0 && lateDaysInMonth % everyN === 0;
}

export type DeviceHealth = 'ONLINE' | 'STALE' | 'OFFLINE';

/** No data for 30 minutes = STALE, for 2 hours = OFFLINE. Outside shift hours a quiet device is not an alarm. */
export function deviceHealth(lastSeen: Date | null, now: Date, inShiftHours: boolean): DeviceHealth {
  if (!lastSeen) return 'OFFLINE';
  const mins = (now.getTime() - lastSeen.getTime()) / 60_000;
  if (!inShiftHours) return mins > 120 ? 'STALE' : 'ONLINE';
  if (mins >= 120) return 'OFFLINE';
  if (mins >= 30) return 'STALE';
  return 'ONLINE';
}

/** IST local parts of a date. */
export function istParts(d: Date): { date: string; hour: number; minute: number; day: number; month: string } {
  const l = new Date(d.getTime() + 330 * 60_000);
  const iso = l.toISOString();
  return { date: iso.slice(0, 10), hour: l.getUTCHours(), minute: l.getUTCMinutes(), day: l.getUTCDate(), month: iso.slice(0, 7) };
}

export function previousMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

export function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** True when the month is due to lock: the lock day of the following month at or after the lock hour (IST), or any time later. */
export function lockDue(now: Date, ym: string, day = 2, hour = 18): boolean {
  const p = istParts(now);
  const due = nextMonth(ym);
  if (p.month > due) return true;
  if (p.month < due) return false;
  return p.day > day || (p.day === day && p.hour >= hour);
}
