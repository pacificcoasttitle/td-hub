import { describe, expect, it } from 'vitest';
import { orderConfirmationTemplate } from './confirmation-template';
import { parseTaxResultData } from './tax-result-data';
import { PCT_LIGHT_LOGO_URL } from './email-layout';

const SAMPLE = {
  fileNumber: '20019999-TEST',
  address: '123 Main St, Glendale, CA 91203',
  transactionType: 'Purchase',
  productType: 'Standard',
  salesPrice: '$500,000',
  hasDocuments: true,
  attachedDocLabels: ['Legal and Vesting', 'Tax Roll'],
  isTitlePointActive: true,
  opener: { name: 'Open Orders', email: 'openorders@pct.com', phone: null, company: 'PCT' },
  property: {
    address: '123 Main St',
    city: 'Glendale',
    zip: '91203',
    county: 'Los Angeles',
    apn: '5640-012-003',
    legalDescription: 'Lot 9 of Tract 1234',
  },
  taxData: parseTaxResultData({
    TaxReport: {
      TaxRateArea: '04-001',
      LandValue: '250000',
      ImprovementsValue: '180000',
      TaxRate: '1.1250',
      Installments: {
        Item: [
          { Number: '1st', Amount: '2412.50', Balance: '0.00', DueDate: '2025-12-10', Status: 'Paid' },
          { Number: '2nd', Amount: '2412.50', Balance: '2412.50', DueDate: '2026-04-10', Status: 'Unpaid' },
        ],
      },
    },
  }),
  seller: { primary: 'Jane Seller', secondary: null },
  assignments: { salesRep: 'Pat Rep', titleOfficer: 'Terry TO' },
};

describe('orderConfirmationTemplate OC-4 redesign (presentational)', () => {
  it('uses the shared branded shell (logo header + www.pct.com footer)', () => {
    const { html, subject } = orderConfirmationTemplate(SAMPLE);

    expect(subject).toBe('Open Order Confirmation - 20019999-TEST');
    expect(html).toContain(PCT_LIGHT_LOGO_URL);
    expect(html).toContain('alt="Pacific Coast Title"');
    expect(html).toContain('Order Confirmation');
    expect(html).toContain('www.pct.com');
    expect(html).toContain('Pacific Coast Title Company');
  });

  it('lays out order/property summary, tax details, and attached-doc list', () => {
    const { html } = orderConfirmationTemplate(SAMPLE);

    expect(html).toContain('Order &amp; property summary');
    expect(html).toContain('Order #');
    expect(html).toContain('20019999-TEST');
    expect(html).toContain('5640-012-003');
    expect(html).toContain('Property Tax Details');
    expect(html).toContain('Tax Rate Area');
    expect(html).toContain('Attached documents');
    expect(html).toContain('Legal and Vesting');
    expect(html).toContain('Tax Roll');
  });

  it('keeps OC-3 content/logic markers (markup/styling only)', () => {
    const { html, subject } = orderConfirmationTemplate({
      fileNumber: '20019999-TEST',
      hasDocuments: false,
      attachedDocLabels: [],
      isTitlePointActive: true,
      taxData: SAMPLE.taxData,
    });

    expect(subject).toBe('Open Order Confirmation - 20019999-TEST');
    expect(html).not.toContain('Documents are being generated and will be available shortly');
    expect(html).not.toContain('coming shortly');
    expect(html).toContain('1st Installment Amount');
    expect(html).toContain('2nd Installment Status');
    expect(html).toContain('Land Value');
    expect(html).toContain('Improvements Value');
  });
});
