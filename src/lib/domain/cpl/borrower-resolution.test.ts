import { describe, expect, it } from 'vitest';
import { renderBorrowerName, resolveBorrowers, type BorrowerInputs } from './borrower-resolution';

const base = (over: Partial<BorrowerInputs> = {}): BorrowerInputs => ({
  override: null,
  buyerParties: [],
  primaryOwner: null,
  secondaryOwner: null,
  transactionType: 'Refinance',
  ...over,
});

describe('the operator\'s entry always wins', () => {
  it('takes what they typed, verbatim, over every stored source', () => {
    const r = resolveBorrowers(base({
      override: '  Maria Delgado  ',
      buyerParties: ['SOMEBODY ELSE'],
      primaryOwner: 'ANOTHER PERSON',
    }));
    expect(r.names).toEqual(['Maria Delgado']);
    expect(r.source).toBe('operator');
    // Nothing to explain — they can see what they typed.
    expect(r.note).toBeNull();
  });

  it('this is the value that used to be collected and discarded', () => {
    // Before the fix, an order with no buyer party was rejected outright even
    // though the operator had typed a borrower. This is that exact case.
    const r = resolveBorrowers(base({ override: 'Kevin Dell', buyerParties: [] }));
    expect(r.names).toEqual(['Kevin Dell']);
  });

  it('whitespace-only is not an entry', () => {
    const r = resolveBorrowers(base({ override: '   ', primaryOwner: 'SMITH JOHN' }));
    expect(r.source).toBe('record_owner');
  });
});

describe('buyer parties come next', () => {
  it('uses them when the operator typed nothing', () => {
    const r = resolveBorrowers(base({ buyerParties: ['Maria Delgado', 'Luis Delgado'] }));
    expect(r.names).toEqual(['Maria Delgado', 'Luis Delgado']);
    expect(r.source).toBe('party');
  });
});

// ─── The measured departure from legacy ─────────────────────────────────────

describe('the owner of record is NOT used on a purchase', () => {
  // Measured: on Purchase, primary_owner matches the SELLER 39% and the BUYER
  // 21% (2,298 comparable orders). On Refinance it matches the seller 0% and
  // the buyer 74%. Legacy fell back regardless of type.
  it('refuses to substitute, and says why', () => {
    const r = resolveBorrowers(base({
      transactionType: 'Purchase',
      primaryOwner: 'DELL KEVIN',
    }));
    expect(r.names).toEqual([]);
    expect(r.source).toBe('none');
    expect(r.note).toContain('the owner of record is the seller');
  });

  it('order 8051 — the real case that started this', () => {
    // Seller "Kevin Dell", primary_owner "DELL KEVIN", no buyer party.
    // Legacy's chain would have named the seller as borrower.
    const r = resolveBorrowers(base({
      transactionType: 'Purchase',
      primaryOwner: 'DELL KEVIN',
      buyerParties: [],
    }));
    expect(r.names).not.toContain('Kevin Dell');
    expect(r.names).toHaveLength(0);
  });

  it('but the operator\'s own entry still works on a purchase', () => {
    const r = resolveBorrowers(base({
      transactionType: 'Purchase',
      override: 'Maria Delgado',
      primaryOwner: 'DELL KEVIN',
    }));
    expect(r.names).toEqual(['Maria Delgado']);
  });
});

describe('the owner of record IS used on everything else', () => {
  it('refinance — the owner of record is the borrower', () => {
    const r = resolveBorrowers(base({ transactionType: 'Refinance', primaryOwner: 'SANCHEZ SERGIO T' }));
    expect(r.names).toEqual(['Sergio T Sanchez']);
    expect(r.source).toBe('record_owner');
    expect(r.note).toContain('owner of record');
  });

  it('picks up the secondary owner too', () => {
    const r = resolveBorrowers(base({
      primaryOwner: 'CHRISTENSEN ELWOOD N',
      secondaryOwner: 'NODEL JUDITH K',
    }));
    expect(r.names).toEqual(['Elwood N Christensen', 'Judith K Nodel']);
  });

  it('splits the multi-owner forms the column actually stores', () => {
    const r = resolveBorrowers(base({ primaryOwner: 'GARCIA CARLOS A; ARCHUNDIA LETICIA' }));
    expect(r.names).toHaveLength(2);
    expect(r.names[0]).toBe('Carlos A Garcia');
  });

  it('says so when there is nothing at all', () => {
    const r = resolveBorrowers(base({}));
    expect(r.names).toEqual([]);
    expect(r.note).toContain('no owner of record');
  });
});

// ─── Entities pass through whole ────────────────────────────────────────────

describe('an entity is never run through the person parser', () => {
  // parseSiteXOwners is a PERSON parser: unguarded it turns "LUCHSHEYE CORP"
  // into "Corp Luchsheye" and "PACIFIC COAST HOLDINGS LLC" into "Coast
  // Holdings Llc Pacific".
  it.each([
    'V M G INVESTMENT LLC',
    'WERNER AND DONNA STEFFEN FAMILY TRUST',
    'LUCHSHEYE CORP',
    'PACIFIC COAST HOLDINGS LLC',
    'FIRST NATIONAL BANK',
  ])('passes %s through unchanged', (name) => {
    expect(renderBorrowerName(name)).toBe(name);
  });

  it('a person is still reordered', () => {
    expect(renderBorrowerName('SANCHEZ SERGIO T')).toBe('Sergio T Sanchez');
  });

  it('the marker list only ABSTAINS — it never picks a name or a field', () => {
    // CO inside CONNOR must not trip the CO marker. Word boundaries, not
    // substring matching.
    expect(renderBorrowerName('CONNOR JAMES')).toBe('James Connor');
    // And a real marker abstains rather than choosing which token is a surname.
    expect(renderBorrowerName('CONNOR AND CO')).toBe('CONNOR AND CO');
  });

  it('does not split a trust on & — that ampersand is the name', () => {
    const r = resolveBorrowers(base({
      primaryOwner: '2026 HOI NHU LE & MY LINH THI PHAM REV T,',
    }));
    expect(r.names).toEqual(['2026 HOI NHU LE & MY LINH THI PHAM REV T,']);
    expect(r.names).toHaveLength(1);
  });

  it('never returns empty for a name that had content', () => {
    for (const n of ['X', 'A B', 'ESTATE OF SOMEONE', '  PADDED  ']) {
      expect(renderBorrowerName(n).trim()).not.toBe('');
    }
  });
});

// ─── A note on the price check, which is the OPPOSITE kind of check ─────────
//
// The tests for it are in
// src/lib/integrations/cpl/westcor/preflight.test.ts. The pointer is here
// because the two changes only make sense read together: the borrower check
// was RELAXED and the price check was TIGHTENED, in the same change, for
// opposite reasons.
//
//   Borrower — we were REFUSING TO SEND over a value we could resolve
//              ourselves. The letter was fine; we were withholding it.
//              -> warning
//
//   Price    — zero is a WRONG VALUE on a legal instrument. The CPL is the
//              underwriter's indemnity to the lender and the amount is what is
//              indemnified. Westcor accepts zero, so nothing downstream
//              catches it.
//              -> blocking, on every transaction type
