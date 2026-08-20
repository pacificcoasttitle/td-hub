import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { orderConfirmationTemplate } from './confirmation-template';
import { parseTaxResultData } from './tax-result-data';

const REDESIGN = readFileSync(
  join(process.cwd(), 'docs/redesigned/order_confirmation.html'),
  'utf8',
);

const TAX = parseTaxResultData({
  TaxReport: {
    LandValue: null,
    ImprovementsValue: null,
    TaxRate: '1.1250',
    IssueDate: '2025-07-01',
    Installments: {
      Item: [
        { Number: '1st', Amount: '1000', DueDate: '2025-12-10', Status: 'Paid' },
        { Number: '2nd', Amount: '1000', DueDate: '2026-04-10', Status: 'Unpaid' },
      ],
    },
  },
});

function markers(html: string): string[] {
  const needles = [
    'Order confirmation',
    'ORDER OPENED SUCCESSFULLY',
    'Your title order is open.',
    'Your order details are below',
    'Property details',
    'Property tax details',
    '1ST INSTALLMENT',
    '2ND INSTALLMENT',
    'Seller / owner details',
    'Transaction details',
    'Escrow details',
    'Pacific Coast Title Company',
    'pct.com',
    'PACIFIC COAST TITLE COMPANY',
  ];
  return needles.filter((n) => html.includes(n));
}

describe('confirmation template matches PCT redesign', () => {
  it('includes every structural marker from the redesign HTML', () => {
    const expected = markers(REDESIGN);
    expect(expected.length).toBeGreaterThan(12);

    const { html } = orderConfirmationTemplate({
      fileNumber: '20020430-GLT',
      address: '123 Main St, Glendale, CA 91203',
      transactionType: 'Purchase',
      productType: 'Residential',
      salesPrice: '$750,000',
      hasDocuments: true,
      attachedDocLabels: ['Legal and Vesting', 'Tax Roll', 'Recent Grant Deed'],
      isTitlePointActive: true,
      opener: { name: 'Open Orders', email: 'openorders@pct.com', phone: null, company: null },
      titleOfficer: { name: 'Eddie LasMarias', email: 'eddie@pct.com', phone: '555-0100', company: null },
      property: {
        address: '123 Main St',
        city: 'Glendale',
        zip: '91203',
        county: 'Los Angeles',
        apn: '5641-001-002',
      },
      taxData: TAX,
      seller: { primary: 'Sam Seller', secondary: null },
    });

    for (const m of expected) {
      expect(html, `missing marker: ${m}`).toContain(m);
    }
    expect(html).toContain('linear-gradient(180deg,#2C3564 0%,#15193A 100%)');
    expect(html).toContain('Order opened');
    expect(html).toContain('Prelim delivered');
    expect(html).toContain('Title officer');
    expect(html).toContain('Eddie LasMarias');
  });

  it('renders installment cards when tax data is present', () => {
    const { html } = orderConfirmationTemplate({
      fileNumber: 'X',
      hasDocuments: false,
      attachedDocLabels: [],
      isTitlePointActive: true,
      taxData: TAX,
    });
    expect(html).toContain('1ST INSTALLMENT');
    expect(html).toContain('2ND INSTALLMENT');
    expect(html).toContain('1000');
  });
});
