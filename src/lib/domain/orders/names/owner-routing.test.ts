import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  borrowerNoun, borrowerSectionLabel, ownerTarget, showsBorrowerFields, showsSellerFields,
} from './owner-routing';

const ALL_TYPES = ['Purchase', 'Refinance', 'Equity', 'Other', '', null, undefined] as const;

describe('owner routing follows legacy', () => {
  it('Purchase puts the record owners in the seller', () => {
    expect(ownerTarget('Purchase')).toBe('seller');
  });

  it('every other transaction type overwrites the borrower', () => {
    for (const t of ['Refinance', 'Equity', 'Other', '', null, undefined]) {
      expect(ownerTarget(t)).toBe('borrower');
    }
  });

  it('tolerates whitespace rather than silently routing to the borrower', () => {
    expect(ownerTarget('  Purchase  ')).toBe('seller');
  });
});

describe('a name can never be sent from a field nobody can see', () => {
  // This is the invariant the bug violated. Owners were routed to the borrower
  // on type "Other" while the borrower fields rendered only for Purchase,
  // Refinance and Equity — so the name went to SoftPro unread.
  it.each(ALL_TYPES)('borrower fields render for %s', (t) => {
    expect(showsBorrowerFields(t)).toBe(true);
  });

  it('wherever the owners land, that section is visible — for every type', () => {
    for (const t of ALL_TYPES) {
      const target = ownerTarget(t);
      const visible = target === 'seller' ? showsSellerFields(t) : showsBorrowerFields(t);
      expect(visible, `owners route to ${target} on "${t}" but that section is hidden`).toBe(true);
    }
  });

  it('seller fields show exactly when the owners go there', () => {
    for (const t of ALL_TYPES) {
      expect(showsSellerFields(t)).toBe(ownerTarget(t) === 'seller');
    }
  });
});

describe('labels tell the operator where the value came from', () => {
  it('Purchase asks for a buyer; everything else says the value is from records', () => {
    expect(borrowerSectionLabel('Purchase')).toBe('Buyer');
    expect(borrowerNoun('Purchase')).toBe('buyer');
    for (const t of ['Refinance', 'Other', '', null]) {
      expect(borrowerSectionLabel(t)).toBe('Borrower (from property records)');
      expect(borrowerNoun(t)).toBe('borrower');
    }
  });
});

describe('the view and the hook share one definition', () => {
  const dir = join(__dirname, '../../../../components/admin/quick-entry');

  it('the form no longer decides visibility for itself', () => {
    const view = readFileSync(join(dir, 'sections.tsx'), 'utf8');
    expect(view).toContain('owner-routing');
    // The early return that hid the fields on Other/unset.
    expect(view).not.toContain("if (!isPurchase && !isRefiLike) return null;");
    // The local re-derivation that could drift from the routing.
    expect(view).not.toContain("const isRefiLike = s.txType === 'Refinance'");
  });

  it('the hook routes through the same function', () => {
    const hook = readFileSync(join(dir, 'use-quick-entry.ts'), 'utf8');
    expect(hook).toContain('ownerTarget(txType)');
    expect(hook).not.toContain("txType === 'Purchase'");
  });

  it('the warning is rendered inside the owner section, which now always renders', () => {
    const view = readFileSync(join(dir, 'sections.tsx'), 'utf8');
    const warnAt = view.indexOf('ownerWarnings');
    const fnAt = view.indexOf('function OwnerFields');
    expect(warnAt).toBeGreaterThan(fnAt);
  });
});
