// A concurrency cap on Argon2 work (each verify uses 64 MB and real CPU). When the cap is reached the
// request fails fast with 503 SERVER_BUSY + Retry-After: 1 instead of queueing, so a flood of logins
// cannot exhaust memory or starve the event loop's thread pool.
import { Errors } from '../http/errors';

let limit = 8;
let active = 0;

/** Set from env.ARGON2_MAX_CONCURRENCY by createApp (tests may lower it). */
export function configureArgon2Concurrency(max: number): void {
  limit = Math.max(1, Math.floor(max));
}

export function argon2InFlight(): number {
  return active;
}

export async function withArgon2Slot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= limit) throw Errors.serverBusy();
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
  }
}
