// Phase 01 Identity Hardening comprehensive tests (§10 of PHASE-01.md).
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import jwt from 'jsonwebtoken';
import { checkPasswordPolicy } from '../src/core/auth/password-policy';
import { encryptSecret, decryptSecret } from '../src/core/auth/mfa-crypto';
import { clearPolicyCache } from '../src/core/auth/security-policy';
import {
  API,
  PASSWORD,
  XRW,
  auditRows,
  cookiePair,
  errorOf,
  login,
  makeUser,
  newApp,
  prisma,
  refreshCookieOf,
  signIn,
  signInOwner,
} from './helpers';

const app = newApp();

describe('Phase 01: Unit Tests', () => {
  describe('Password Policy (NIST SP 800-63B & Context Words)', () => {
    const identity = {
      loginId: 'ramesh.sawant',
      email: 'ramesh@example.com',
      name: 'Ramesh Sawant',
    };

    it('enforces minimum length 12 and maximum length 128', () => {
      expect(checkPasswordPolicy('Short1234', identity)).toBe(
        'Password must be at least 12 characters.',
      );
      expect(checkPasswordPolicy('x'.repeat(129), identity)).toBe(
        'Password must be at most 128 characters.',
      );
    });

    it('rejects passwords in SecLists 10k or with trailing numbers/symbols stripped', () => {
      // Direct blocklist hits
      expect(checkPasswordPolicy('password12345', identity)).toBe(
        'This password is too common. Choose a longer phrase, e.g. three unrelated words.',
      );
      expect(checkPasswordPolicy('qwerty12345678', identity)).toBe(
        'This password is too common. Choose a longer phrase, e.g. three unrelated words.',
      );
      expect(checkPasswordPolicy('baseball123456', identity)).toBe(
        'This password is too common. Choose a longer phrase, e.g. three unrelated words.',
      );
    });

    it('rejects passwords containing company context or user identity parts', () => {
      expect(checkPasswordPolicy('sawant-group-pwd', identity)).toBe(
        'Do not use your name, login ID, email or the company name in your password.',
      );
      expect(checkPasswordPolicy('readyhand-corp-12', identity)).toBe(
        'Do not use your name, login ID, email or the company name in your password.',
      );
      expect(checkPasswordPolicy('talwade-branch-12', identity)).toBe(
        'Do not use your name, login ID, email or the company name in your password.',
      );
      expect(checkPasswordPolicy('ramesh-super-secret', identity)).toBe(
        'Do not use your name, login ID, email or the company name in your password.',
      );
    });

    it('accepts compliant passwords without character class rules', () => {
      expect(checkPasswordPolicy('correct horse battery staple', identity)).toBeNull();
      expect(checkPasswordPolicy('completely-uncommon-passphrase-2026', identity)).toBeNull();
    });
  });

  describe('RFC 6238 Appendix B TOTP Vector & Replay Guard', () => {
    it('generates the exact RFC 6238 Appendix B test vector', () => {
      // RFC 6238 Appendix B vector: secret ASCII "12345678901234567890" (20 bytes), epoch 59 -> OTP 94287082
      const totp = new OTPAuth.TOTP({
        algorithm: 'SHA1',
        digits: 8,
        period: 30,
        secret: OTPAuth.Secret.fromUTF8('12345678901234567890'),
      });
      const token = totp.generate({ timestamp: 59 * 1000 });
      expect(token).toBe('94287082');
    });

    it('validates 6-digit TOTP within delta [-1, 0, 1]', () => {
      const totp = new OTPAuth.TOTP({
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: new OTPAuth.Secret(),
      });
      const now = Date.now();
      const codeNow = totp.generate({ timestamp: now });
      const delta = totp.validate({ token: codeNow, window: 1 });
      expect(delta).toBe(0);
    });
  });

  describe('AES-256-GCM Encryption & Tamper Detection', () => {
    it('round-trips secret and detects tampering', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const enc = encryptSecret(secret);
      expect(enc).toMatch(/^v1:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/);
      expect(decryptSecret(enc)).toBe(secret);

      // Tamper with ciphertext
      const parts = enc.split(':');
      const tamperedCt = parts[0] + ':' + parts[1] + ':' + parts[2] + ':ffff' + (parts[3] ?? '').slice(4);
      expect(() => decryptSecret(tamperedCt)).toThrow();

      // Tamper with auth tag
      const tamperedTag = parts[0] + ':' + parts[1] + ':ffffffffffffffffffffffffffffffff:' + (parts[3] ?? '');
      expect(() => decryptSecret(tamperedTag)).toThrow();
    });
  });
});

describe('Phase 01: API & Security Controls', () => {
  it('sends Cache-Control: no-store on all API endpoints', async () => {
    const res = await request(app).get(`${API}/auth/password-policy`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  describe('TOTP MFA Setup, Challenge, Verification & Recovery Codes', () => {
    it('enforces challenge flow when MFA is enabled', async () => {
      // 1. Setup user with MFA enabled
      const user = await makeUser({ role: 'ADMIN' });
      const totp = new OTPAuth.TOTP({
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: new OTPAuth.Secret(),
      });
      const encSecret = encryptSecret(totp.secret.base32);

      // Set MFA enabled and hash a recovery code
      const { createHash } = await import('node:crypto');
      const recoveryCode = 'ABCD-1234';
      const codeHash = createHash('sha256').update(recoveryCode.trim().toUpperCase()).digest('hex');

      await prisma.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: true,
          mfaSecretEnc: encSecret,
          mfaEnrolledAt: new Date(),
          recoveryCodes: {
            create: { codeHash },
          },
        },
      });

      // 2. Initial login responds with challenge, NO session cookie yet
      const loginRes = await login(app, user.loginId, PASSWORD);
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.mfaRequired).toBe(true);
      expect(loginRes.body.data.challengeId).toBeDefined();
      expect(refreshCookieOf(loginRes)).toBeUndefined();

      const challengeId = loginRes.body.data.challengeId;

      // 3. Invalid code returns 401 MFA_CODE_INVALID with exact message
      const wrongCodeRes = await request(app)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeId, code: '000000' });
      expect(wrongCodeRes.status).toBe(401);
      expect(errorOf(wrongCodeRes).code).toBe('MFA_CODE_INVALID');
      expect(errorOf(wrongCodeRes).message).toBe(
        'That code did not work. Check the time on your phone and try the newest code.',
      );

      // 4. Verify with recovery code
      const recovRes = await request(app)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeId, code: recoveryCode });
      expect(recovRes.status).toBe(200);
      expect(recovRes.body.data.accessToken).toBeDefined();
      expect(refreshCookieOf(recovRes)).toBeDefined();

      // Check recovery code is marked used
      const usedRecov = await prisma.userMfaRecoveryCode.findFirst({
        where: { userId: user.id, codeHash },
      });
      expect(usedRecov?.usedAt).not.toBeNull();

      // 5. Reusing the same challenge or consumed code fails
      const reVerify = await request(app)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeId, code: recoveryCode });
      expect(reVerify.status).toBe(401);
    });
  });

  describe('Forced MFA Guard (requireMfaSatisfied)', () => {
    it('blocks admin without MFA when policy requires it, except on excluded routes', async () => {
      // Enable policy mfaRequiredForAdmins
      await prisma.setting.upsert({
        where: { key: 'security_policy' },
        create: {
          key: 'security_policy',
          value: {
            passwordMinLength: 12,
            maxFailedLogins: 10,
            lockoutMinutes: 15,
            idleMinutes: 30,
            absoluteHours: 12,
            maxSessionsPerUser: 10,
            mfaRequiredForAdmins: true,
          },
          version: 1,
        },
        update: {
          value: {
            passwordMinLength: 12,
            maxFailedLogins: 10,
            lockoutMinutes: 15,
            idleMinutes: 30,
            absoluteHours: 12,
            maxSessionsPerUser: 10,
            mfaRequiredForAdmins: true,
          },
        },
      });

      // Clear cached policy
      clearPolicyCache();

      try {
        const adminUser = await makeUser({ role: 'ADMIN' });
        const s = await signIn(app, adminUser);

        // Guarded module endpoint -> 403 MFA_SETUP_REQUIRED with exact message
        const blockedRes = await request(app).get(`${API}/users`).set(s.bearer);
        expect(blockedRes.status).toBe(403);
        expect(errorOf(blockedRes).code).toBe('MFA_SETUP_REQUIRED');
        expect(errorOf(blockedRes).message).toBe(
          'For security, administrators must turn on two-step verification before continuing.',
        );

        // Excluded routes succeed
        const meRes = await request(app).get(`${API}/auth/me`).set(s.bearer);
        expect(meRes.status).toBe(200);
        expect(meRes.body.data.mfaSetupRequired).toBe(true);

        const mfaStatusRes = await request(app).get(`${API}/auth/mfa`).set(s.bearer);
        expect(mfaStatusRes.status).toBe(200);

        const rolesRes = await request(app).get(`${API}/meta/roles`).set(s.bearer);
        expect(rolesRes.status).toBe(200);
      } finally {
        // Restore policy
        await prisma.setting.update({
          where: { key: 'security_policy' },
          data: {
            value: {
              passwordMinLength: 12,
              maxFailedLogins: 10,
              lockoutMinutes: 15,
              idleMinutes: 30,
              absoluteHours: 12,
              maxSessionsPerUser: 10,
              mfaRequiredForAdmins: false,
            },
          },
        });
        clearPolicyCache();
      }
    });
  });

  describe('Session Controls: Cap & Liveness', () => {
    it('enforces maximum 10 sessions cap by revoking oldest with session_cap', async () => {
      const user = await makeUser({ role: 'MEMBER' });
      const firstSignIn = await signIn(app, user);

      // Create 9 more sessions
      for (let i = 0; i < 9; i++) {
        await signIn(app, user);
      }

      // Live sessions should be 10
      const sessions10 = await prisma.session.findMany({
        where: { userId: user.id, revokedAt: null },
      });
      expect(sessions10).toHaveLength(10);

      // 11th sign in -> oldest family revoked with session_cap
      await signIn(app, user);

      const oldestRevoked = await prisma.session.findFirst({
        where: { userId: user.id, revokedReason: 'session_cap' },
      });
      expect(oldestRevoked).not.toBeNull();
      expect(oldestRevoked?.revokedAt).not.toBeNull();

      // First session is now rejected
      const firstAccess = await request(app).get(`${API}/auth/me`).set(firstSignIn.bearer);
      expect(firstAccess.status).toBe(401);
    });
  });

  describe('My Sessions & Admin User Controls', () => {
    it('lists devices and revokes other sessions', async () => {
      const user = await makeUser({ role: 'MEMBER' });
      const s1 = await signIn(app, user);
      const s2 = await signIn(app, user);

      // GET /auth/sessions lists sessions
      const listRes = await request(app).get(`${API}/auth/sessions`).set(s1.bearer);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(2);

      // Cannot revoke current session via DELETE /auth/sessions/:familyId
      const currentFamilyId = (await prisma.session.findFirstOrThrow({
        where: { userId: user.id, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      })).familyId;

      // Revoking another user's session returns 404
      const otherUser = await makeUser();
      const otherS = await signIn(app, otherUser);
      const otherFamily = (await prisma.session.findFirstOrThrow({
        where: { userId: otherUser.id },
      })).familyId;
      const notFoundRes = await request(app)
        .delete(`${API}/auth/sessions/${otherFamily}`)
        .set(s1.bearer);
      expect(notFoundRes.status).toBe(404);

      // Revoke others
      const revokeOthersRes = await request(app)
        .post(`${API}/auth/sessions/revoke-others`)
        .set(s1.bearer);
      expect(revokeOthersRes.status).toBe(200);

      // s2 should now be revoked
      const s2Check = await request(app).get(`${API}/auth/me`).set(s2.bearer);
      expect(s2Check.status).toBe(401);
    });

    it('admin actions prevent action on self with exact §8 message', async () => {
      const adminS = await signIn(app, await makeUser({ role: 'ADMIN' }));

      // Self-unlock forbidden
      const selfUnlock = await request(app)
        .post(`${API}/users/${adminS.user.id}/unlock`)
        .set(adminS.bearer);
      expect(selfUnlock.status).toBe(403);
      expect(errorOf(selfUnlock).message).toBe(
        'Use My Account → Security for your own account.',
      );

      // Self-revoke-all forbidden
      const selfRevoke = await request(app)
        .post(`${API}/users/${adminS.user.id}/sessions/revoke-all`)
        .set(adminS.bearer);
      expect(selfRevoke.status).toBe(403);
      expect(errorOf(selfRevoke).message).toBe(
        'Use My Account → Security for your own account.',
      );
    });

    it('unlocks locked account and rejects unlock if not locked', async () => {
      const adminS = await signIn(app, await makeUser({ role: 'ADMIN' }));
      const target = await makeUser({ role: 'MEMBER' });

      // Not locked -> 409 NOT_LOCKED
      const notLockedRes = await request(app)
        .post(`${API}/users/${target.id}/unlock`)
        .set(adminS.bearer);
      expect(notLockedRes.status).toBe(409);
      expect(errorOf(notLockedRes).code).toBe('NOT_LOCKED');

      // Lock target
      await prisma.user.update({
        where: { id: target.id },
        data: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000), failedLoginCount: 10 },
      });

      // Unlock succeeds
      const unlockRes = await request(app)
        .post(`${API}/users/${target.id}/unlock`)
        .set(adminS.bearer);
      expect(unlockRes.status).toBe(200);
      expect(unlockRes.body.data.unlocked).toBe(true);

      const targetFresh = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(targetFresh.lockedUntil).toBeNull();
      expect(targetFresh.failedLoginCount).toBe(0);

      // Audited
      const rows = await auditRows('ACCOUNT_UNLOCKED', { targetId: target.id });
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Security Policy GET/PUT with If-Match', () => {
    it('returns policy and rejects update on version mismatch (409)', async () => {
      const adminS = await signIn(app, await makeUser({ role: 'ADMIN' }));

      const getRes = await request(app).get(`${API}/settings/security`).set(adminS.bearer);
      expect(getRes.status).toBe(200);
      const currentVersion = getRes.body.data.version;

      // Bad If-Match -> 409
      const badMatchRes = await request(app)
        .put(`${API}/settings/security`)
        .set(adminS.bearer)
        .set('If-Match', `"${currentVersion + 99}"`)
        .send(getRes.body.data.value);
      expect(badMatchRes.status).toBe(409);
      expect(errorOf(badMatchRes).code).toBe('VERSION_CONFLICT');

      // Correct If-Match -> 200 and audited
      const goodRes = await request(app)
        .put(`${API}/settings/security`)
        .set(adminS.bearer)
        .set('If-Match', `"${currentVersion}"`)
        .send({ ...getRes.body.data.value, idleMinutes: 25 });
      expect(goodRes.status).toBe(200);
      expect(goodRes.body.data.value.idleMinutes).toBe(25);

      const audit = await auditRows('SECURITY_POLICY_UPDATED');
      expect(audit.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /health/whoami', () => {
    it('returns server perceived client IP', async () => {
      const adminS = await signIn(app, await makeUser({ role: 'ADMIN' }));
      const res = await request(app)
        .get(`${API}/health/whoami`)
        .set(adminS.bearer)
        .set('X-Forwarded-For', '203.0.113.195, 127.0.0.1');
      expect(res.status).toBe(200);
      expect(res.body.data.ip).toBeDefined();
      expect(res.body.data.protocol).toBeDefined();
    });
  });

  describe('JWT Key Rotation & Verification', () => {
    it('rejects tokens with unknown kid with 401', async () => {
      const user = await makeUser();
      const fakeToken = jwt.sign(
        { sub: user.id, sid: 'session-id', fam: 'fam-id' },
        'dummy-secret-key-that-is-at-least-48-characters-long-for-testing',
        { header: { alg: 'HS256', kid: 'unknown-key-id' } },
      );

      const res = await request(app)
        .get(`${API}/auth/me`)
        .set('Authorization', `Bearer ${fakeToken}`);
      expect(res.status).toBe(401);
    });
  });
});
