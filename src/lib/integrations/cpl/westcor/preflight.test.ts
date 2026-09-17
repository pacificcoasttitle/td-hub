import { describe, expect, it } from 'vitest';
import { preflightValidate } from './payloads';
import type { CplOrderDetail, CplGenerateInput } from '../types';

const detail = (over: Partial<CplOrderDetail> = {}): CplOrderDetail => ({
  fileNumber: '20021570-GLT',
  transactionType: 'Refinance',
  property: { address: '1 Main St', city: 'Orange', state: 'CA', zip: '92867', county: 'Orange' },
  lender: { name: 'Provident CU', address: null, city: null, state: null, zip: null },
  buyers: ['Maria Delgado'],
  sellers: [],
  salesPrice: null,
  loanAmount: null,
  ...over,
} as CplOrderDetail);

const input = (over: Partial<CplGenerateInput> = {}): CplGenerateInput => ({
  orderId: 1, underwriter: 'westcor', branchId: 1, ...over,
} as CplGenerateInput);

const run = (d: Partial<CplOrderDetail>, i: Partial<CplGenerateInput> = {}, lenderId = 7) =>
  preflightValidate({ orderDetail: detail(d), input: input(i), westcorLenderId: lenderId });

describe('a zero amount blocks on EVERY transaction type', () => {
  it('refinance with no amount anywhere is blocked', () => {
    // This is the hole: 3,839 of 3,841 refinances have no loan_amount and no
    // sales_price, so with no operator entry the price resolved to 0 and the
    // old check exempted refinances entirely.
    const r = run({ transactionType: 'Refinance' });
    expect(r.errors.join(' ')).toContain('zero amount');
  });

  it('purchase with no amount is blocked, as before', () => {
    const r = run({ transactionType: 'Purchase', sellers: ['A Seller'] });
    expect(r.errors.join(' ')).toContain('sales amount greater than zero');
  });

  it('a refinance passes once the operator supplies a loan amount', () => {
    const r = run({ transactionType: 'Refinance' }, { loanAmountOverride: '450000' });
    expect(r.errors).toEqual([]);
  });

  it('a refinance passes on a stored loan amount', () => {
    const r = run({ transactionType: 'Refinance', loanAmount: '450000' });
    expect(r.errors).toEqual([]);
  });

  it('Other and null types are covered too — the check is unconditional', () => {
    for (const tx of ['Other', null] as const) {
      expect(run({ transactionType: tx }).errors.join(' '), String(tx)).toContain('zero amount');
    }
  });
});

describe('the borrower and seller checks warn, and do not block', () => {
  it('no borrower is a warning', () => {
    const r = run({ buyers: [] }, { loanAmountOverride: '450000' });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(' ')).toContain('No borrower');
  });

  it('no seller on a purchase is a warning', () => {
    const r = run({ transactionType: 'Purchase', sellers: [] }, { salesAmountOverride: '600000' });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(' ')).toContain('No seller');
  });

  it('both missing still issues the letter', () => {
    const r = run({ transactionType: 'Purchase', buyers: [], sellers: [] }, { salesAmountOverride: '600000' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(2);
  });
});

describe('what still blocks, and why each earns it', () => {
  it('no property address — Westcor rejects it outright', () => {
    expect(run({ property: null }, { loanAmountOverride: '1' }).errors.join(' '))
      .toContain('Property address is required');
  });

  it('no lender — there is nothing to protect and no LenderID to send', () => {
    expect(run({ lender: null }, { loanAmountOverride: '1' }).errors.join(' '))
      .toContain('Lender company name is required');
  });

  it('refinance with an unregistered lender', () => {
    expect(run({ transactionType: 'Refinance' }, { loanAmountOverride: '1' }, 0).errors.join(' '))
      .toContain('valid Westcor lender ID');
  });

  it('a clean order produces neither', () => {
    const r = run({}, { loanAmountOverride: '450000' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

// ─── Names land in the right Westcor fields ─────────────────────────────────

import { buildOrderBodyForTest } from './payloads';

describe('entity names do not go out as people with the surname "-"', () => {
  const namesOf = (n: string) => buildOrderBodyForTest([n]);

  it('a trust uses the Trust field AND CompanyName', () => {
    // CompanyName is not decoration. Spec §2.3.3.3: CompanyName is "Required if
    // first name and last name are not provided", and the Trust row grants no
    // exemption from it. Sending Trust alone is what Westcor rejected on order
    // 6142 with "Seller #2: Not Added."
    const b = namesOf('WERNER AND DONNA STEFFEN FAMILY TRUST');
    expect(b.Trust).toBe('WERNER AND DONNA STEFFEN FAMILY TRUST');
    expect(b.CompanyName).toBe('WERNER AND DONNA STEFFEN FAMILY TRUST');
    expect(b.First).toBe('');
    expect(b.Last).toBe('');
  });

  it('a company uses CompanyName', () => {
    const b = namesOf('V M G INVESTMENT LLC');
    expect(b.CompanyName).toBe('V M G INVESTMENT LLC');
    expect(b.First).toBe('');
    expect(b.Last).toBe('');
  });

  it('a person is split at the last space, so the letter prints no hyphen', () => {
    // This test used to assert Last === '-' on the grounds that "persons render
    // correctly on issued letters today". Nobody had read a letter. 65 of the
    // 69 issued between March and September print "<name> -" on the face,
    // because the form prints First then Last.
    const b = namesOf('Monica C Sarmiento');
    expect(b.Last).toBe('Sarmiento');
    expect(b.First).toBe('Monica C');
    expect(b.CompanyName).toBe('');
    expect(b.Trust).toBe('');
    // What the letter renders is First + ' ' + Last, so this is the check that
    // actually matters: the printed name is unchanged and the hyphen is gone.
    expect(`${b.First} ${b.Last}`).toBe('Monica C Sarmiento');
  });

  it('keeps the placeholder for a one-word name, the only shape Westcor takes', () => {
    // Measured: Last '' and Last ' ' are both rejected with "Please provide at
    // least a Company Name and/or First and Last Name of the individual."
    const b = namesOf('Cher');
    expect(b.First).toBe('Cher');
    expect(b.Last).toBe('-');
  });

  it('a trustee is still a person, and still round-trips to the same string', () => {
    const b = namesOf('DANNA MICHAEL A (TRUSTEE)');
    expect(b.First).toBe('DANNA MICHAEL A');
    expect(b.Last).toBe('(TRUSTEE)');
    expect(`${b.First} ${b.Last}`).toBe('DANNA MICHAEL A (TRUSTEE)');
  });

  it('never sends a name with no field populated at all', () => {
    for (const n of ['Kevin Dell', 'LUCHSHEYE CORP', 'SMITH FAMILY TRUST', 'TRUSTWORTHY REALTY']) {
      const b = namesOf(n);
      const filled = [b.First, b.Last, b.CompanyName, b.Trust].filter((v) => v !== '' && v !== null);
      expect(filled.length, n).toBeGreaterThan(0);
    }
  });
});

// ─── The seller the operator types must reach the payload ───────────────────

describe('a typed seller is not discarded', () => {
  it('reaches the letter on a purchase with no seller row', () => {
    // The exact borrowerNames bug, one field over: the modal collects a seller,
    // 1,359 purchases have no seller party, and the letter names the seller.
    const r = run(
      { transactionType: 'Purchase', sellers: ['Fiorella Angelica Pozo'] },
      { salesAmountOverride: '600000' },
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(' ')).not.toContain('No seller');
  });
});

// ─── The order 6142 regression ──────────────────────────────────────────────
//
// Live failure, 2026-09-01 03:58 UTC, order 6142 / 20020090-GLT:
//
//   "Seller #2: Not Added. Please provide at least a Company Name and/or First
//    and Last Name of the individual."
//
// A Purchase with no seller party, so the modal prefilled the seller field from
// the record owners as "MCCLENTON MARIE S; MARIE S MCCLENTON TRUST". The server
// split that on ";" and the second name classified as a trust — which, before
// this fix, meant Trust populated and CompanyName, First and Last all empty.

describe('order 6142: a trust seller reaches Westcor with an identity', () => {
  const OWNERS = ['MCCLENTON MARIE S', 'MARIE S MCCLENTON TRUST'];

  it('the exact name Westcor rejected now carries a CompanyName', () => {
    const b = buildOrderBodyForTest(['MARIE S MCCLENTON TRUST']);
    expect(b.CompanyName).toBe('MARIE S MCCLENTON TRUST');
    expect(b.Trust).toBe('MARIE S MCCLENTON TRUST');
  });

  it('the whole prefilled seller list passes preflight', () => {
    const r = run(
      { transactionType: 'Purchase', sellers: OWNERS, buyers: ['Iris Caceras'] },
      { salesAmountOverride: '1000000' },
    );
    expect(r.errors).toEqual([]);
  });

  it('and it is the SECOND seller that used to fail, not the first', () => {
    // Position matters: Westcor numbers positionally and said "#2".
    expect(buildOrderBodyForTest([OWNERS[0]!]).First).toBe('MCCLENTON MARIE');
    expect(buildOrderBodyForTest([OWNERS[0]!]).Last).toBe('S');
  });
});

describe('the identity rule blocks before the vendor does', () => {
  // A name that survives to the payload with nothing in it cannot come from
  // nameFields any more, so this drives the guard with the empty string that
  // still reaches it — the shape of any future regression in that function.
  it('an empty seller name blocks, and the message says what to supply', () => {
    const r = run(
      { transactionType: 'Purchase', sellers: ['A Real Seller', '   '], buyers: ['A Buyer'] },
      { salesAmountOverride: '1000000' },
    );
    const msg = r.errors.join(' ');
    expect(msg).toContain('Seller #2');
    expect(msg).toContain('first and a last name');
  });

  it('it blocks — it is not a warning the operator can click past', () => {
    const r = run(
      { transactionType: 'Purchase', sellers: ['Fine Seller', ''], buyers: ['A Buyer'] },
      { salesAmountOverride: '1000000' },
    );
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.warnings.join(' ')).not.toContain('#2');
  });

  it('borrowers are checked too, not just sellers', () => {
    const r = run({ transactionType: 'Refinance', buyers: [''] }, { loanAmountOverride: '450000' });
    expect(r.errors.join(' ')).toContain('Borrower #1');
  });

  it('a well-formed order is untouched by the new check', () => {
    const r = run(
      { transactionType: 'Purchase', buyers: ['Iris Caceras'], sellers: ['VNE GROUP LLC'] },
      { salesAmountOverride: '1000000' },
    );
    expect(r.errors).toEqual([]);
  });
});
