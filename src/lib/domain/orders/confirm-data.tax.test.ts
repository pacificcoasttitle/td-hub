import { describe, expect, it } from 'vitest';
import { parseTaxResultData } from '@/lib/domain/notifications/tax-result-data';
import { confirmationPageTaxFromResultData } from './confirm-data';

/** PascalCase SoftPro/TitlePoint shape that previously left page installment cards blank. */
const PASCAL_TAX_RESULT = {
  TaxReport: {
    TaxRateArea: '04-001',
    UseCode: '0100',
    LandValue: null,
    ImprovementsValue: null,
    TaxRate: '1.1250',
    IssueDate: '2025-07-01',
    Installments: {
      Item: [
        { Number: '1st', Amount: '2412.50', Balance: '0.00', DueDate: '2025-12-10', Status: 'Paid' },
        { Number: '2nd', Amount: '2412.50', Balance: '2412.50', DueDate: '2026-04-10', Status: 'Unpaid' },
      ],
    },
  },
};

describe('confirmation PAGE tax via parseTaxResultData (same as OC-3 email)', () => {
  it('reuses parseTaxResultData (not a separate reader)', () => {
    expect(confirmationPageTaxFromResultData).toBe(parseTaxResultData);
  });

  it('populates installment amount/dueDate from PascalCase Amount/DueDate', () => {
    const tax = confirmationPageTaxFromResultData(PASCAL_TAX_RESULT);
    expect(tax).not.toBeNull();
    expect(tax!.taxRateArea).toBe('04-001');
    expect(tax!.firstInstallment).toMatchObject({
      amount: '2412.50',
      dueDate: '2025-12-10',
      status: 'Paid',
    });
    expect(tax!.secondInstallment).toMatchObject({
      amount: '2412.50',
      dueDate: '2026-04-10',
      status: 'Unpaid',
    });
  });

  it('keeps null LandValue / ImprovementsValue as null (UI shows —)', () => {
    const tax = confirmationPageTaxFromResultData(PASCAL_TAX_RESULT);
    expect(tax!.landValue).toBeNull();
    expect(tax!.improvementsValue).toBeNull();
  });
});
