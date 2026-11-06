// Password hashing (Argon2id via @node-rs/argon2) and the password policy (CONTRACT §6 Passwords).
// Also provides a dummy verify so "unknown user" takes as long as "wrong password".
import { randomBytes } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { withArgon2Slot } from './argon2-gate';

// PLAN §5.1: Argon2id, m=64 MB, t=3, p=1.
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

import {
  checkPasswordPolicy as checkPolicy,
  warmUpPasswordBlocklist,
  type UserIdentityContext,
} from './password-policy';

export const PASSWORD_MIN_LENGTH = 12;
/** Upper bound so a huge password cannot be used to burn CPU in Argon2. */
export const PASSWORD_MAX_LENGTH = 128;

/** Throws 503 SERVER_BUSY when too many Argon2 operations are already running. */
export function hashPassword(password: string): Promise<string> {
  return withArgon2Slot(() => hash(password, ARGON2_OPTIONS));
}

/** False for a wrong password or a malformed hash; throws 503 SERVER_BUSY when saturated. */
export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return withArgon2Slot(async () => {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  });
}

let dummyHash: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

/** Computes the dummy hash and preloads password blocklist at boot. */
export async function warmUpDummyHash(): Promise<void> {
  warmUpPasswordBlocklist();
  await getDummyHash();
}

/** Burns the same Argon2 cost as a real verify, for users that do not exist. */
export async function dummyVerify(password: string): Promise<void> {
  await verifyPassword(await getDummyHash(), password);
}

/**
 * Returns null when the password is acceptable, otherwise the exact human message from §8.
 */
export function checkPasswordPolicy(
  password: string,
  identity?: UserIdentityContext | null,
): string | null {
  return checkPolicy(password, identity);
}

