// Phase 22-A: the unbounded-list gate itself, and a live run over the source tree (0 findings).
import { describe, expect, it } from 'vitest';
import { scanAll, scanSource } from '../../../tools/check-unbounded';

describe('check-unbounded', () => {
  it('flags findMany without take and raw SELECT without LIMIT', () => {
    const src = [
      'async function a() {',
      '  return prisma.item.findMany({ where: { status: "x" } });',
      '}',
      'async function b() {',
      '  return prisma.$queryRaw`SELECT id FROM items WHERE status = ${s}`;',
      '}',
    ].join('\n');
    expect(scanSource('x.ts', src).map((f) => f.kind)).toEqual(['findMany', 'queryRaw']);
  });

  it('accepts take, LIMIT, paging spread, id lists, aggregates, FOR UPDATE and the annotation', () => {
    const src = [
      'prisma.item.findMany({ where, take: 25 });',
      'prisma.item.findMany({ where, ...page });',
      'prisma.item.findMany({ where: { id: { in: ids } } });',
      'prisma.$queryRaw`SELECT id FROM items LIMIT 10`;',
      'prisma.$queryRaw`SELECT count(*) FROM items`;',
      'prisma.$queryRaw`SELECT COALESCE(SUM(a), 0)::text AS v FROM t WHERE x = ${y}`;',
      'tx.$queryRaw`SELECT id FROM items WHERE id = ${i} FOR UPDATE`;',
      '// unpaginated: lines of one document',
      'prisma.line.findMany({ where: { docId } });',
    ].join('\n');
    expect(scanSource('x.ts', src)).toEqual([]);
  });

  it('the source tree has no unbounded list reads', () => {
    expect(scanAll()).toEqual([]);
  });
});
