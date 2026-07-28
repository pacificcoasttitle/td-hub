import { describe, expect, it } from 'vitest';
import { orderConfirmationTemplate } from './confirmation-template';
import { parseTaxResultData } from './tax-result-data';

const LEGACY_TAX = parseTaxResultData({
  TaxReport: {
    TaxRateArea: '04-001',
    LandValue: '250000',
    ImprovementsValue: '180000',
    Installments: {
      Item: [
        { Number: '1st', Amount: '2412.50', Balance: '0.00', DueDate: '2025-12-10', Status: 'Paid' },
        { Number: '2nd', Amount: '2412.50', Balance: '2412.50', DueDate: '2026-04-10', Status: 'Unpaid' },
      ],
    },
  },
});

describe('orderConfirmationTemplate OC-3', () => {
  it('renders Property Tax Details from captured data (legacy parity labels)', () => {
    const { html } = orderConfirmationTemplate({
      fileNumber: '20019999-TEST',
      hasDocuments: true,
      attachedDocLabels: ['Legal and Vesting', 'Tax Roll'],
      isTitlePointActive: true,
      taxData: LEGACY_TAX,
      property: { address: '123 Main', city: 'Glendale', zip: '91203', apn: '1', county: 'Los Angeles' },
    });

    expect(html).toContain('Property Tax Details');
    expect(html).toContain('Tax Rate Area');
    expect(html).toContain('04-001');
    expect(html).toContain('Land Value');
    expect(html).toContain('250000');
    expect(html).toContain('Improvements Value');
    expect(html).toContain('180000');
    expect(html).toContain('1st Installment Amount');
    expect(html).toContain('2412.50');
    expect(html).toContain('1st Installment Balance');
    expect(html).toContain('1st Installment Due Date');
    expect(html).toContain('1st Installment Status');
    expect(html).toContain('2nd Installment Amount');
    expect(html).toContain('Attached:</strong> Legal and Vesting, Tax Roll');
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
    // Tax section still present without PDFs
    expect(html).toContain('Property Tax Details');
  });

  it('omits attach note when no docs exist (silent skip)', () => {
    const { html } = orderConfirmationTemplate({
      fileNumber: '20019999-TEST',
      hasDocuments: false,
      attachedDocLabels: [],
      isTitlePointActive: true,
    });

    expect(html).not.toContain('<strong>Attached:</strong>');
    expect(html).not.toContain('coming shortly');
  });
});
