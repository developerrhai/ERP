import { describe, expect, it } from 'vitest';
import { v40AliasFor } from './ModulePage';

describe('V40 page id aliases (Phase 36)', () => {
  it('the 12 department inboxes and work pages go to the shared screens', () => {
    for (const d of ['sales', 'purchase', 'hr', 'warehouse']) {
      expect(v40AliasFor(`dept-inbox-${d}`)).toBe('/m/dept-inbox');
      expect(v40AliasFor(`dept-work-${d}`)).toBe('/m/dept-work');
    }
  });
  it('masters and My Approvals go to the screens that serve them', () => {
    expect(v40AliasFor('master-customers')).toBe('/m/crm-customer360');
    expect(v40AliasFor('master-products')).toBe('/m/inv-items');
    expect(v40AliasFor('my-approvals')).toBe('/approvals');
  });
  it('the other V40-only ids (plant flow, contract labour, documents) go to the nearest real screen', () => {
    expect(v40AliasFor('plant-unit-routing')).toBe('/m/dept-movement-inbox');
    expect(v40AliasFor('cl-ppe')).toBe('/m/cl-compliance');
    expect(v40AliasFor('accounts-gst-invoice')).toBe('/m/sales-invoices');
    expect(v40AliasFor('dispatch-dc')).toBe('/m/sales-dispatch');
  });
  it('unknown ids stay unknown (a real 404)', () => {
    expect(v40AliasFor('no-such-page')).toBeNull();
  });
});
