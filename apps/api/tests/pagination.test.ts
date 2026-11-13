/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
// Phase 22-A: cursor encode/decode/tamper, limit rules and the keyset walk property test
// (1,000 random rows with duplicate dates: every row exactly once, in order).
import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  paginateKeyset,
  paginatePage,
  parseLimit,
  parseSort,
} from '../src/core/pagination';
import { AppError } from '../src/core/http/errors';

const ID = '8f000000-0000-4000-8000-000000000001';

describe('cursor', () => {
  it('round-trips {k, v, id}', () => {
    const c = encodeCursor({ k: '-doc_date', v: '2026-11-09', id: ID });
    expect(decodeCursor(c, '-doc_date')).toEqual({ k: '-doc_date', v: '2026-11-09', id: ID });
  });

  it('rejects a cursor made for another sort', () => {
    const c = encodeCursor({ k: '-doc_date', v: '2026-11-09', id: ID });
    expect(() => decodeCursor(c, 'doc_no')).toThrowError(AppError);
    try {
      decodeCursor(c, 'doc_no');
    } catch (e) {
      expect((e as AppError).code).toBe('CURSOR_INVALID');
    }
  });

  it.each(['', 'not-base64!!', Buffer.from('{"k":1}').toString('base64url'), 'e30'])(
    'rejects tampered cursor %s',
    (bad) => {
      expect(() => decodeCursor(bad, '-doc_date')).toThrowError(/changed/);
    },
  );

  it('rejects a non-uuid id', () => {
    const c = Buffer.from(JSON.stringify({ k: 'a', v: 'b', id: "x'; drop table" })).toString(
      'base64url',
    );
    expect(() => decodeCursor(c, 'a')).toThrowError();
  });
});

describe('limit and sort', () => {
  it('defaults to 25, caps at 100', () => {
    expect(parseLimit(undefined)).toBe(25);
    expect(parseLimit('100')).toBe(100);
    try {
      parseLimit('1000');
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('PAGE_LIMIT_TOO_LARGE');
      expect((e as AppError).message).toBe('Maximum 100 rows per page.');
    }
    expect(() => parseLimit('0')).toThrowError();
    expect(() => parseLimit('abc')).toThrowError();
  });

  it('only sorts by whitelisted columns', () => {
    const cols = { doc_date: 't.doc_date' };
    expect(parseSort('-doc_date', cols, '-doc_date').spec).toEqual({
      column: 't.doc_date',
      desc: true,
    });
    expect(parseSort(undefined, cols, 'doc_date').spec.desc).toBe(false);
    expect(() => parseSort('id; drop', cols, 'doc_date')).toThrowError();
  });
});

describe('paginateKeyset walk', () => {
  interface Row {
    id: string;
    d: string;
  }
  function makeRows(n: number, seed: number): Row[] {
    let s = seed;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    return Array.from({ length: n }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      d: `2026-0${1 + Math.floor(rnd() * 3)}-${String(1 + Math.floor(rnd() * 5)).padStart(2, '0')}`,
    }));
  }

  it.each([1, 7, 99])(
    'returns each of 1,000 rows exactly once, desc order (seed %i)',
    async (seed) => {
      const all = makeRows(1000, seed);
      const sorted = [...all].sort((a, b) =>
        a.d === b.d ? (a.id < b.id ? 1 : -1) : a.d < b.d ? 1 : -1,
      );
      const fetch = async ({
        take,
        after,
      }: {
        take: number;
        after: { v: string; id: string } | null;
      }) => {
        const rest = after
          ? sorted.filter((r) => r.d < after.v || (r.d === after.v && r.id < after.id))
          : sorted;
        return rest.slice(0, take);
      };
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const page = await paginateKeyset<Row>({
          sortKey: '-d',
          limit: 37,
          cursor,
          fetch,
          valueOf: (r) => r.d,
          idOf: (r) => r.id,
        });
        pages += 1;
        seen.push(...page.data.map((r) => r.id));
        if (!page.meta.hasMore) {
          expect(page.meta.nextCursor).toBeNull();
          break;
        }
        expect(page.data).toHaveLength(37);
        cursor = page.meta.nextCursor ?? undefined;
      }
      expect(pages).toBe(Math.ceil(1000 / 37));
      expect(seen).toEqual(sorted.map((r) => r.id));
      expect(new Set(seen).size).toBe(1000);
    },
  );

  it('paginatePage clamps size to 100', async () => {
    const r = await paginatePage(
      { page: 2, size: 500 },
      async ({ skip, take }) => [skip, take],
      async () => 250,
    );
    expect(r.meta).toEqual({ page: 2, size: 100, total: 250 });
    expect(r.data).toEqual([100, 100]);
  });
});
