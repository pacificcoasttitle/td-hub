import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { externalEscrowPersonFilter } from './filters';

const render = (q: Parameters<PgDialect['sqlToQuery']>[0]) => new PgDialect().sqlToQuery(q).sql;

describe('externalEscrowPersonFilter', () => {
  // REGRESSION 2026-09-11. The Escrow Employees page filtered is_escrow_officer
  // alone and showed 721 of 4,230 outside escrow people. Every contact the hub
  // creates carries is_escrow instead, so none of them ever appeared.
  it('matches either escrow flag', () => {
    const text = render(externalEscrowPersonFilter());
    expect(text).toMatch(/"is_escrow" = true OR "contacts"\."is_escrow_officer" = true|"is_escrow" = true OR .*"is_escrow_officer" = true/);
  });

  // PCT's own escrow officers carry is_escrow_officer too. Widening the flag
  // without the external clause would put them on a page of outside firms.
  it('keeps PCT staff out', () => {
    const text = render(externalEscrowPersonFilter());
    expect(text).toContain("NOT ILIKE '%@pct.com'");
    expect(text).toContain('NOT EXISTS');
  });
});
