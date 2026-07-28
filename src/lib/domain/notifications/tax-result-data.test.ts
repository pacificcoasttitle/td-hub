import { describe, expect, it } from 'vitest';
import { parseTaxResultData } from './tax-result-data';

/** Shape matching TitlePoint GetResultByID3 tax Result (PascalCase), as stored in metadata.resultData. */
const LEGACY_STYLE_TAX_RESULT = {
  TaxReport: {
    TaxRateArea: '04-001',
    UseCode: '0100',
    TaxRate: '1.1250',
    LandValue: '250000',
    ImprovementsValue: '180000',
    IssueDate: '2025-07-01',
    Installments: {
      Item: [
        {
          Number: '1st',
          Amount: '2412.50',
          Balance: '0.00',
          DueDate: '2025-12-10',
          Status: 'Paid',
        },
        {
          Number: '2nd',
          Amount: '2412.50',
          Balance: '2412.50',
          DueDate: '2026-04-10',
          Status: 'Unpaid',
        },
      ],
    },
  },
};

describe('parseTaxResultData (OC-3 / legacy Property Tax Details)', () => {
  it('extracts rate area, land/improvements, and both installments from captured resultData', () => {
    const parsed = parseTaxResultData(LEGACY_STYLE_TAX_RESULT);
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      taxRateArea: '04-001',
      landValue: '250000',
      improvementsValue: '180000',
      taxRate: '1.1250',
      firstInstallment: {
        amount: '2412.50',
        balance: '0.00',
        dueDate: '2025-12-10',
        status: 'Paid',
      },
      secondInstallment: {
        amount: '2412.50',
        balance: '2412.50',
        dueDate: '2026-04-10',
        status: 'Unpaid',
      },
    });
  });

  it('works when TaxReport fields are at the result root (no wrapper)', () => {
    const parsed = parseTaxResultData({
      TaxRateArea: '12-345',
      LandValue: '100',
      ImprovementsValue: '200',
    });
    expect(parsed?.taxRateArea).toBe('12-345');
    expect(parsed?.landValue).toBe('100');
    expect(parsed?.improvementsValue).toBe('200');
  });

  it('returns null when resultData has no tax fields', () => {
    expect(parseTaxResultData({})).toBeNull();
    expect(parseTaxResultData(null)).toBeNull();
  });
});
