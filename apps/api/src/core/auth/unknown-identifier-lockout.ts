// Lockout for identifiers that match no user. Without it, a locked real account (423 after 10
// failures) would be distinguishable from a non-existent one (always 401). In memory, 15 min TTL,
// bounded LRU so a flood of random identifiers cannot grow memory without limit.

interface Entry {
  count: number;
  lockedUntil: number | null;
  expiresAt: number;
}

export interface FailureResult {
  locked: boolean;
  lockedUntil: Date | null;
}

export class FailureTracker {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxFailures = 10,
    private readonly lockMs = 15 * 60_000,
    private readonly ttlMs = 15 * 60_000,
    private readonly maxEntries = 10_000,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  private live(key: string, now: number): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Records one failure; once locked, further failures are not counted until the lock ends. */
  registerFailure(key: string, now: number = Date.now()): FailureResult {
    const entry = this.live(key, now) ?? { count: 0, lockedUntil: null, expiresAt: 0 };
    if (entry.lockedUntil !== null && entry.lockedUntil > now) {
      this.touch(key, entry);
      return { locked: true, lockedUntil: new Date(entry.lockedUntil) };
    }
    entry.count += 1;
    if (entry.count >= this.maxFailures) {
      entry.count = 0;
      entry.lockedUntil = now + this.lockMs;
      entry.expiresAt = entry.lockedUntil;
    } else {
      entry.lockedUntil = null;
      entry.expiresAt = now + this.ttlMs;
    }
    this.touch(key, entry);
    const locked = entry.lockedUntil !== null;
    return { locked, lockedUntil: locked ? new Date(entry.lockedUntil ?? now) : null };
  }

  /** Re-inserts to mark as most recently used, evicting the oldest entries past maxEntries. */
  private touch(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

export const unknownIdentifierFailures = new FailureTracker();
