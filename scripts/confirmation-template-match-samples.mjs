/**
 * Render Purchase / Refinance / null-tax confirmation HTML samples for visual diff
 * against docs/PCT_Open_Order_Confirmation_Redesign.html
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load via vitest/tsx-compiled path — prefer dynamic import of built TS through vitest runner.
// Standalone: node --import tsx scripts/confirmation-template-match-samples.mjs
const { orderConfirmationTemplate } = await import('../src/lib/domain/notifications/confirmation-template.ts');
const { parseTaxResultData } = await import('../src/lib/domain/notifications/tax-result-data.ts');

const tax = parseTaxResultData({
  TaxReport: {
    TaxRateArea: '04-001',
    LandValue: '250000',
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
});

const shared = {
  fileNumber: '20020430-GLT',
  address: '123 Main St, Glendale, CA 91203',
  productType: 'Residential',
  hasDocuments: true,
  attachedDocLabels: ['Legal and Vesting', 'Tax Roll', 'Recent Grant Deed'],
  isTitlePointActive: true,
  opener: { name: 'Open Orders Desk', email: 'openorders@pct.com', phone: null, company: 'PCT' },
  titleOfficer: {
    name: 'Eddie LasMarias',
    email: 'eddie@pct.com',
    phone: '(818) 555-0199',
    company: null,
  },
  property: {
    address: '123 Main St',
    city: 'Glendale',
    zip: '91203',
    county: 'Los Angeles',
    apn: '5641-001-002',
    legalDescription: 'Lot 1',
  },
  seller: { primary: 'Sam Seller', secondary: 'Pat Partner' },
};

const purchase = orderConfirmationTemplate({
  ...shared,
  transactionType: 'Purchase',
  salesPrice: '$750,000',
  loanAmount: '$0',
  taxData: tax,
});

const refinance = orderConfirmationTemplate({
  ...shared,
  transactionType: 'Refinance',
  salesPrice: '$750,000',
  loanAmount: '$425,000',
  taxData: tax,
});

const nullTax = orderConfirmationTemplate({
  ...shared,
  transactionType: 'Purchase',
  salesPrice: '$750,000',
  taxData: null,
  attachedDocLabels: ['Legal and Vesting'],
});

for (const [name, rendered] of [
  ['purchase', purchase],
  ['refinance', refinance],
  ['null-tax', nullTax],
]) {
  const out = join(__dirname, `confirmation-template-match-${name}.html`);
  writeFileSync(out, rendered.html, 'utf8');
  console.log('Wrote', out);
}

void require;
