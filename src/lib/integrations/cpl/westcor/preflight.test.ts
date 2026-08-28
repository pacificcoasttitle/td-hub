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
