import { describe, expect, it } from 'vitest';
import { orderConfirmationTemplate } from './confirmation-template';
import { parseTaxResultData } from './tax-result-data';
import { HEADER_BG } from './email-layout';

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
      IssueDate: '2025-07-01',
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

describe('orderConfirmationTemplate redesign match (presentational)', () => {
  it('matches PCT redesign shell (navy header, hero, footer)', () => {
    const { html, subject } = orderConfirmationTemplate(SAMPLE);

    expect(subject).toBe('Open Order Confirmation - 20019999-TEST');
    expect(html).toContain(`background:${HEADER_BG}`);
    expect(html).toContain('Order confirmation');
    expect(html).toContain('ORDER OPENED SUCCESSFULLY');
    expect(html).toContain('Your title order is open.');
    expect(html).toContain('https://www.pct.com/logo2.png');
    expect(html).toContain('pct.com');
    expect(html).toContain('Pacific Coast Title Company');
  });

  it('lays out complete order details and installments without self-service actions', () => {
    const { html } = orderConfirmationTemplate(SAMPLE);

    expect(html).toContain('Your order details are below');
    expect(html).toContain('20019999-TEST');
    expect(html).toContain('5640-012-003');
    expect(html).toContain('1ST INSTALLMENT');
    expect(html).toContain('2412.50');
    expect(html).toContain('Property details');
    expect(html).toContain('Escrow details');
    expect(html).not.toContain('Generate CPL');
    expect(html).not.toContain('Generate Fees');
    expect(html).not.toContain('View Order in Portal');
  });

  it('keeps OC-3 logic markers (no coming-shortly; tax installments when present)', () => {
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
    expect(html).toContain('2412.50');
  });
});
