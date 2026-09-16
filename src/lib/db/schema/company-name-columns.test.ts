import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { companies, contacts } from './contacts';

// SoftPro's lookup-table Name is copied into both columns by the company syncs.
// As varchar(200) they refused lender PLML5446 (235 characters) on every run
// from 2026-08-27, and the lender never reached the book. Migration 0049.
//
// Asserts the invariant, not a length: no limit. A bigger number is a guess.
describe('SoftPro company name columns', () => {
  it.each([
    ['contacts.company_name', getTableConfig(contacts), 'company_name'],
    ['companies.name', getTableConfig(companies), 'name'],
    // Not a name, same class: SoftPro stores a template expression here, not a
    // ledger code. Underwriter CW is 204 characters and failed every sweep.
    // Migration 0051.
    ['companies.fee_transfer_ledger', getTableConfig(companies), 'fee_transfer_ledger'],
  ])('%s has no length limit', (_label, table, column) => {
    expect(table.columns.find((c) => c.name === column)?.getSQLType()).toBe('text');
  });
});
