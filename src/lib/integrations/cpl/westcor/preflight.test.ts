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

  it('a trust uses the Trust field', () => {
    const b = namesOf('WERNER AND DONNA STEFFEN FAMILY TRUST');
    expect(b.Trust).toBe('WERNER AND DONNA STEFFEN FAMILY TRUST');
    expect(b.First).toBe('');
    expect(b.Last).toBe('');
    expect(b.CompanyName).toBe('');
  });

  it('a company uses CompanyName', () => {
    const b = namesOf('V M G INVESTMENT LLC');
    expect(b.CompanyName).toBe('V M G INVESTMENT LLC');
    expect(b.First).toBe('');
    expect(b.Last).toBe('');
  });

  it('a person is BYTE-FOR-BYTE what we sent before', () => {
    // The classifier only adds a route. Persons render correctly on issued
    // letters today and that behaviour must not move on a marker list.
    const b = namesOf('Monica C Sarmiento');
    expect(b.Last).toBe('-');
    expect(b.First).toBe('Monica C Sarmiento');
    expect(b.CompanyName).toBe('');
    expect(b.Trust).toBe('');
  });

  it('a trustee is a person, so the old shape is kept', () => {
    const b = namesOf('DANNA MICHAEL A (TRUSTEE)');
    expect(b.Last).toBe('-');
    expect(b.First).toBe('DANNA MICHAEL A (TRUSTEE)');
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
