import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { orderConfirmationTemplate } from './confirmation-template';
import { parseTaxResultData } from './tax-result-data';

const REDESIGN = readFileSync(
  join(process.cwd(), 'docs/PCT_Open_Order_Confirmation_Redesign.html'),
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
    'background:#10213A',
    'ORDER CONFIRMATION',
    'background:#FAF7F1',
    'ORDER OPENED SUCCESSFULLY',
    'Your title order is open',
    'View Order in Portal',
    'Order snapshot',
    'background:#DCEFF0',
    'Property tax summary',
    '1ST INSTALLMENT',
    '2ND INSTALLMENT',
    'Seller / owner',
    'Quick actions',
    'background:#0E5A63',
    'Generate Fees',
    'Generate Proposed',
    'Generate CPL',
    'Pacific Coast Title Company',
    'pct.com',
  ];
  return needles.filter((n) => html.includes(n));
}

describe('confirmation template matches PCT redesign', () => {
  it('includes every structural marker from the redesign HTML', () => {
    const expected = markers(REDESIGN);
    expect(expected.length).toBeGreaterThan(15);

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
    expect(html).toContain('Title officer');
    expect(html).toContain('Eddie LasMarias');
  });

  it('renders — for null land/improvement values without breaking the 2x2 grid', () => {
    const { html } = orderConfirmationTemplate({
      fileNumber: 'X',
      hasDocuments: false,
      attachedDocLabels: [],
      isTitlePointActive: true,
      taxData: TAX,
    });
    expect(html).toContain('Land value');
    expect(html).toContain('Improvement value');
    expect(html).toMatch(/Land value[\s\S]{0,120}—/);
    expect(html).toMatch(/Improvement value[\s\S]{0,120}—/);
  });

  it('omits absent doc pills and never links pills', () => {
    const { html } = orderConfirmationTemplate({
      fileNumber: 'X',
      hasDocuments: true,
      attachedDocLabels: ['Tax Roll'],
      isTitlePointActive: true,
    });
    expect(html).toContain('Tax Roll');
    expect(html).not.toContain('Legal &amp; Vesting');
    expect(html).not.toContain('Recent Grant Deed');
    expect(html).not.toMatch(/href="[^"]+"[^>]*>Tax Roll</);
  });
});
