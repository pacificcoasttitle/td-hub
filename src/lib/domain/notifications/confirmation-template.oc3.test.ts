import { describe, expect, it } from 'vitest';
import { orderConfirmationTemplate } from './confirmation-template';
import { parseTaxResultData } from './tax-result-data';

const LEGACY_TAX = parseTaxResultData({
  TaxReport: {
    TaxRateArea: '04-001',
    LandValue: '250000',
    ImprovementsValue: '180000',
    TaxRate: '1.1250',
    IssueDate: '2025-07-01',
    Installments: {
      Item: [
        { Number: '1st', Amount: '2412.50', Balance: '0.00', DueDate: '2025-12-10', Status: 'Paid' },
        { Number: '2nd', Amount: '2412.50', Balance: '2412.50', DueDate: '2026-04-10', Status: 'Unpaid' },
      ],
    },
  },
});

describe('orderConfirmationTemplate OC-3', () => {
  it('renders installment tax amounts from parseTaxResultData', () => {
    const { html } = orderConfirmationTemplate({
      fileNumber: '20019999-TEST',
      hasDocuments: true,
      attachedDocLabels: ['Legal and Vesting', 'Tax Roll'],
      isTitlePointActive: true,
      taxData: LEGACY_TAX,
      property: { address: '123 Main', city: 'Glendale', zip: '91203', apn: '1', county: 'Los Angeles' },
    });

    expect(html).toContain('1ST INSTALLMENT');
    expect(html).toContain('2412.50');
    expect(html).toContain('Dec 10, 2025');
    expect(html).toContain('Paid');
    expect(html).toContain('ORDER OPENED SUCCESSFULLY');
  });

  it('kills the "documents coming shortly" placeholder', () => {
    const { html } = orderConfirmationTemplate({
      fileNumber: '20019999-TEST',
      hasDocuments: false,
      attachedDocLabels: [],
      isTitlePointActive: true,
      taxData: LEGACY_TAX,
    });

    expect(html).not.toContain('Documents are being generated and will be available shortly');
    expect(html).not.toContain('coming shortly');
    expect(html).toContain('1ST INSTALLMENT');
  });

  it('omits installment cards when no tax data exists', () => {
    const { html } = orderConfirmationTemplate({
      fileNumber: '20019999-TEST',
      hasDocuments: false,
      attachedDocLabels: [],
      isTitlePointActive: true,
    });

    expect(html).not.toContain('1ST INSTALLMENT');
    expect(html).not.toContain('coming shortly');
  });
});
