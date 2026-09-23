import { describe, expect, it } from 'vitest';
import { twinLabel, warningFor } from './rep-visibility';

// The wording an operator reads, tested without a database. The two cases are
// deliberately different sentences: "no login at all" is a mild fact, and
// "their login is on the OTHER row" is the one that silently loses work.

describe('a rep whose own list will show the report', () => {
  it('says nothing at all', () => {
    expect(warningFor('Mark Neveu', true, [])).toBeNull();
  });

  it('says nothing even when a twin row exists, because this row is the right one', () => {
    // Kevin Cameron branded to #8 — the row his login points at. Correct, and
    // the operator should not be nagged about a duplicate that does not bite.
    expect(warningFor('Kevin Cameron', true, [{ id: 22265, hasLogin: false, orders: 0 }])).toBeNull();
  });
});

describe('a rep whose login points at the OTHER record — the Kevin Cameron case', () => {
  const w = warningFor('Kevin Cameron', false, [{ id: 8, hasLogin: true, orders: 76 }])!;

  it('warns', () => {
    expect(w).not.toBeNull();
  });

  it('states the consequence in plain words, not jargon', () => {
    expect(w).toContain('will NOT appear in their own Reports list');
  });

  it('names the record they should have picked, so the fix is obvious', () => {
    expect(w).toContain('#8');
    expect(w).toContain('76 orders');
  });

  it('offers the way out — the PDF is still good', () => {
    expect(w).toMatch(/send them the PDF directly/i);
  });

  it('omits the order count when the other record has none', () => {
    const q = warningFor('Kevin Cameron', false, [{ id: 8, hasLogin: true, orders: 0 }])!;
    expect(q).toContain('#8');
    expect(q).not.toMatch(/carries 0 orders/);
  });
});

describe('a rep with no login anywhere', () => {
  const w = warningFor('Glendale House Account', false, [])!;

  it('warns, but as a milder fact', () => {
    expect(w).toContain('has no login');
    expect(w).toContain('will not appear in a Reports list');
  });

  it('does not tell them to pick another record, because there is none', () => {
    expect(w).not.toContain('#');
    expect(w).not.toMatch(/choose the other record/i);
  });

  it('still says the report itself is fine — this warns, it does not block', () => {
    expect(w).toMatch(/still correct/i);
  });
});

describe('the wording holds up on awkward input', () => {
  it('falls back to a neutral subject when the name is missing', () => {
    expect(warningFor(null, false, [])).toMatch(/^This representative has no login/);
  });

  it('treats a blank name the same as a missing one', () => {
    expect(warningFor('   ', false, [])).toMatch(/^This representative/);
  });

  it('prefers the twin that HAS the login when several exist', () => {
    const w = warningFor('Someone', false, [
      { id: 100, hasLogin: false, orders: 0 },
      { id: 200, hasLogin: true, orders: 5 },
    ])!;
    expect(w).toContain('#200');
    expect(w).not.toContain('#100');
  });
});

describe('the label under an ambiguous picker entry', () => {
  it('says nothing for a rep with no twin — no noise on the normal case', () => {
    expect(twinLabel({ id: 1, hasLogin: true, orders: 40, ambiguous: false })).toBeNull();
  });

  it('separates the two Kevin Camerons by the facts that differ', () => {
    // #8 — his login, 76 orders.
    expect(twinLabel({ id: 8, hasLogin: true, orders: 76, ambiguous: true }))
      .toBe('Duplicate record — has login · 76 orders');
    // #22265 — the trap.
    expect(twinLabel({ id: 22265, hasLogin: false, orders: 0, ambiguous: true }))
      .toBe('Duplicate record — NO login · 0 orders');
  });

  it('gets the singular right, because "1 orders" reads as a bug', () => {
    expect(twinLabel({ id: 3, hasLogin: false, orders: 1, ambiguous: true })).toContain('1 order');
    expect(twinLabel({ id: 3, hasLogin: false, orders: 1, ambiguous: true })).not.toContain('1 orders');
  });
});
