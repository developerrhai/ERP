import { describe, expect, it } from 'vitest';
import { notify } from '../src/index.js';

const baseSettings: notify.NotificationGlobalSettings = {
  emailEnabled: true,
  pushEnabled: true,
  smsEnabled: true,
  quietStart: '22:00',
  quietEnd: '07:00',
  pushMaxPerUserHour: 20,
};

const baseEndpoints: notify.UserEndpointsInput = {
  pushDeviceCount: 1,
  email: 'user@sawant.local',
  mobile: '9822001122',
  smsConsent: true,
};

describe('Phase 21 pure notification decisions (§5.2 fixtures)', () => {
  it('holds non-urgent approval push overnight during quiet hours while sending email immediately', () => {
    // 23:10 IST = 17:40 UTC
    const nightIst = new Date('2026-11-10T17:40:00.000Z');
    const type: notify.NotificationTypeConfig = {
      code: 'APPROVAL_ASSIGNED',
      category: 'APPROVAL',
      priority: 'HIGH',
      enabled: true,
      allowedChannels: ['IN_APP', 'PUSH', 'EMAIL'],
      defaultChannels: ['IN_APP', 'PUSH', 'EMAIL'],
      mandatoryChannels: ['IN_APP'],
      sensitive: false,
      digestAllowed: true,
    };
    const res = notify.decideChannels(type, {}, baseSettings, nightIst, baseEndpoints);
    expect(res.IN_APP.status).toBe('QUEUED');
    expect(res.PUSH.status).toBe('HELD');
    expect(res.PUSH.reason).toBe('QUIET_HOURS');
    expect(res.EMAIL.status).toBe('QUEUED');
  });

  it('delivers URGENT breakdown P1 at 02:00 IST on push and SMS ignoring quiet hours', () => {
    // 02:00 IST = 20:30 UTC previous day
    const twoAmIst = new Date('2026-11-09T20:30:00.000Z');
    const type: notify.NotificationTypeConfig = {
      code: 'MAINT_BREAKDOWN_P1',
      category: 'ALERT',
      priority: 'URGENT',
      enabled: true,
      allowedChannels: ['IN_APP', 'PUSH', 'SMS', 'EMAIL'],
      defaultChannels: ['IN_APP', 'PUSH', 'SMS'],
      mandatoryChannels: ['IN_APP', 'PUSH'],
      sensitive: false,
      digestAllowed: false,
    };
    const res = notify.decideChannels(type, {}, baseSettings, twoAmIst, baseEndpoints);
    expect(res.IN_APP.status).toBe('QUEUED');
    expect(res.PUSH.status).toBe('QUEUED');
    expect(res.SMS.status).toBe('QUEUED');
  });

  it('enforces SECURITY mandatory email & type active even when user turns email off', () => {
    const noonIst = new Date('2026-11-10T06:30:00.000Z');
    const secType: notify.NotificationTypeConfig = {
      code: 'SECURITY_NEW_LOGIN',
      category: 'SECURITY',
      priority: 'URGENT',
      enabled: false, // SECURITY cannot be disabled
      allowedChannels: ['IN_APP', 'PUSH', 'EMAIL'],
      defaultChannels: ['IN_APP', 'PUSH', 'EMAIL'],
      mandatoryChannels: ['IN_APP', 'EMAIL'],
      sensitive: false,
      digestAllowed: false,
    };
    const res = notify.decideChannels(
      secType,
      { prefsByChannel: { EMAIL: { enabled: false }, PUSH: { enabled: false } } },
      baseSettings,
      noonIst,
      baseEndpoints,
    );
    expect(res.IN_APP.status).toBe('QUEUED');
    expect(res.EMAIL.status).toBe('QUEUED');
    expect(res.PUSH.status).toBe('SKIPPED');
    expect(res.PUSH.reason).toBe('PREF_OFF');
  });

  it('collapses push at hourly cap and marks suppressed email', () => {
    const noonIst = new Date('2026-11-10T06:30:00.000Z');
    const type: notify.NotificationTypeConfig = {
      code: 'STOCK_REORDER',
      category: 'ALERT',
      priority: 'NORMAL',
      enabled: true,
      allowedChannels: ['IN_APP', 'PUSH', 'EMAIL'],
      defaultChannels: ['IN_APP', 'PUSH', 'EMAIL'],
      mandatoryChannels: ['IN_APP'],
      sensitive: false,
      digestAllowed: true,
    };
    const res = notify.decideChannels(
      type,
      { recentPushCountLastHour: 20 },
      baseSettings,
      noonIst,
      { ...baseEndpoints, emailSuppressed: true },
    );
    expect(res.PUSH.status).toBe('SUMMARY_COLLAPSED');
    expect(res.PUSH.reason).toBe('RATE_LIMIT');
    expect(res.EMAIL.status).toBe('SUPPRESSED');
  });

  it('builds <=32 byte collapse keys, resolves union audience without inactive users, and formats payslip password & escaped templates', () => {
    const ck = notify.buildCollapseKey('very-long-approval-request-key-exceeding-limit-12345');
    expect(ck.length).toBeLessThanOrEqual(32);
    expect(/^[A-Za-z0-9_-]+$/.test(ck)).toBe(true);

    const resolved = notify.resolveAudienceUsers(
      { unitIds: ['u-tal'], departmentIds: ['Production'] },
      [
        { id: '1', active: true, unitIds: ['u-tal'], departments: ['Sales'], roleId: 'r1' },
        { id: '2', active: true, unitIds: ['u-saw'], departments: ['Production'], roleId: 'r1' },
        { id: '3', active: false, unitIds: ['u-tal'], departments: ['Production'], roleId: 'r1' },
        { id: '4', active: true, unitIds: ['u-var'], departments: ['HR'], roleId: 'r1' },
      ],
    );
    expect(resolved).toEqual(['1', '2']);

    expect(notify.buildPayslipPassword('abcde1234f', 'EMP09', '1994-07-05')).toBe('ABCD0507');
    expect(notify.buildPayslipPassword(null, 'EMP-09', '1994-07-05')).toBe('EMP090507');

    const rendered = notify.renderEscapedTemplate('<p>{{party}}</p>', { party: '<script>alert(1)</script>' });
    expect(rendered).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');

    expect(notify.findPiiVariablesInTemplate('Salary {{netPay}} and PAN {{pan}}')).toEqual(['pan', 'netPay']);
  });
});

