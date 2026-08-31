import { describe, expect, it } from 'vitest';
import { parseMoney, parseSalesPrice } from './process-detail';
import { diffOrder, type LookbackOrderRow } from './lookback-diff';
import type { SoftProOrderDetailItem } from '@/lib/integrations/softpro/types';

// ─── The shapes SoftPro actually sends ──────────────────────────────────────
//
// Confirmed by a live GetOrderDetails call on 2026-08-28 against refinance
// 20021587-OCT. The 23 keys on the wire include LoanAmount, and the two money
// fields DO NOT share a type:
//
//   LoanAmount = 950000     <- number
//   SalesPrice = "0"        <- string
//
// Passing the number to the old string-only parseSalesPrice threw on .trim().

describe('parseMoney takes both wire shapes', () => {
  it('LoanAmount arrives as a number', () => {
    expect(parseMoney(950000)).toBe('950000.00');
  });

  it('SalesPrice arrives as a string', () => {
    expect(parseMoney('0')).toBe('0.00');
    expect(parseMoney('430000.00')).toBe('430000.00');
  });

  it('strips the formatting SoftPro sometimes includes', () => {
    expect(parseMoney('$1,250,000.00')).toBe('1250000.00');
  });

  it('absent stays absent — a missing key must not become a value', () => {
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('   ')).toBeNull();
    expect(parseMoney('not a number')).toBeNull();
  });

  it('the old string-only entry point still works for its callers', () => {
    expect(parseSalesPrice('430000')).toBe('430000.00');
  });
});

// ─── The detector now reads a modelled field, not a cast ────────────────────

const row = (over: Partial<LookbackOrderRow> = {}): LookbackOrderRow => ({
  id: 1, fileNumber: '20021587-OCT', operationalStatus: 'open',
  salesPrice: null, loanAmount: null, band: '30-90d', ...over,
});

const item = (over: Partial<SoftProOrderDetailItem> = {}): SoftProOrderDetailItem => ({
  OrderNumber: '20021587-OCT', OrderStatus: 'Open',
  SalesPrice: '0', TransactionType: 'Refinance', ProductType: 'Title only',
  ...over,
} as SoftProOrderDetailItem);

describe('a loan amount difference is detected', () => {
  it('an incoming number against an empty column', () => {
    const d = diffOrder(row({ loanAmount: null }), item({ LoanAmount: 950000 }));
    expect(d.fieldChanges).toContain('loanAmount');
  });

  it('no difference when they already agree, whatever the types', () => {
    const d = diffOrder(row({ loanAmount: '950000.00' }), item({ LoanAmount: 950000 }));
    expect(d.fieldChanges).not.toContain('loanAmount');
  });

  it('an absent LoanAmount is not a change', () => {
    // 0 normalises to null, so a zero from the vendor never overwrites.
    const d = diffOrder(row({ loanAmount: '950000.00' }), item({ LoanAmount: 0 }));
    expect(d.fieldChanges).not.toContain('loanAmount');
    expect(diffOrder(row(), item()).fieldChanges).not.toContain('loanAmount');
  });
});
