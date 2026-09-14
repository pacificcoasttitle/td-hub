import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { orderProperties } from './orders';

// property_type holds SiteX's free-text UseCodeDescription. As varchar(50) it
// threw 22001 on 54–57 character descriptions after SoftPro had already created
// the file, half-creating the hub order. The overflow was identified on
// 2026-09-01 and the column was never changed; it came back as eight failures
// between 2026-09-09 and 2026-09-14.
//
// This asserts the invariant rather than a length: no limit at all. A bigger
// number is a guess, and the next description past the guess fails the same
// way. The database side is migration 0047.
describe('order_properties.property_type', () => {
  it('has no length limit', () => {
    const column = getTableConfig(orderProperties).columns.find((c) => c.name === 'property_type');
    expect(column?.getSQLType()).toBe('text');
  });
});
