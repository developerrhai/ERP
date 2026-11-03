// apps/api/tests/kit-compat.test.ts
// Verifies deep backward-compatibility: inventory schemas match frozen fixture and kindOf unchanged (docs/plans/07-ENGINE-KIT.md §12 T-KIT-12)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { registry } from '../src/core/registry';
import { kindOf, TYPED_PAGES } from '../src/engine/kinds';
import { typedSchema } from '../src/modules/inventory/definitions';
import { newApp } from './helpers';

describe('T-KIT-12 — Kit Compatibility & Schema Freezing', () => {
  beforeAll(() => {
    newApp();
  });
  it('1. deep-equal of the 7 inventory schemas with stored fixture', () => {
    const fixturePath = resolve(__dirname, 'fixtures/inventory-schemas.json');
    const rawFixture = readFileSync(fixturePath, 'utf8');
    const fixture = JSON.parse(rawFixture);

    const inventoryPageIds = [
      'inv-items',
      'wms-warehouses',
      'inv-opening',
      'inv-transactions',
      'inv-adjustment',
      'inv-transfer',
      'inv-stock',
    ];

    for (const pageId of inventoryPageIds) {
      const activeSchema = typedSchema(pageId);
      expect(activeSchema, `Active schema for ${pageId} must exist`).toBeDefined();
      const expectedSchema = fixture[pageId];
      expect(expectedSchema, `Fixture schema for ${pageId} must exist`).toBeDefined();

      // Deep compare JSON serialization to ensure zero schema drift
      expect(
        JSON.parse(JSON.stringify(activeSchema)),
        `Schema for ${pageId} must deep-equal the frozen fixture`,
      ).toEqual(expectedSchema);
    }
  });

  it('2. kindOf returns unchanged kinds for all registry pages', () => {
    for (const page of Array.from(registry.pages.values())) {
      const kind = kindOf(page.id);
      expect(kind, `kindOf(${page.id}) must return a valid kind`).toBeDefined();

      if (TYPED_PAGES.has(page.id)) {
        expect(kind).toBe('typed');
      }
    }
  });
});
