import { describe, expect, it } from 'vitest';
import {
  isMeaningfulMoney,
  moneyRowForTransaction,
  orderConfirmationTemplate,
} from './confirmation-template';
import { parseTaxResultData } from './tax-result-data';
import { PCT_LIGHT_LOGO_URL } from './email-layout';

const TAX = parseTaxResultData({
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

const base = {
  fileNumber: '20019999-TEST',
  address: '123 Main St, Glendale, CA 91203',
  productType: 'Standard',
  hasDocuments: true,
  attachedDocLabels: ['Legal and Vesting', 'Tax Roll'],
  isTitlePointActive: true,
  titleOfficer: {
    name: 'Terry Title',
    email: 'terry.to@pct.com',
    phone: '(626) 555-0100',
    company: null,
  },
  property: {
    address: '123 Main St',
    city: 'Glendale',
    zip: '91203',
    county: 'Los Angeles',
    apn: '5640-012-003',
    legalDescription: 'Lot 9',
  },
  taxData: TAX,
};

describe('isMeaningfulMoney / moneyRowForTransaction', () => {
  it('rejects zero and empty money strings', () => {
    expect(isMeaningfulMoney('$0')).toBe(false);
    expect(isMeaningfulMoney('0')).toBe(false);
    expect(isMeaningfulMoney('$0.00')).toBe(false);
    expect(isMeaningfulMoney('—')).toBe(false);
    expect(isMeaningfulMoney(null)).toBe(false);
    expect(isMeaningfulMoney('$500,000')).toBe(true);
  });

  it('purchase shows Sales Price; refinance shows Loan Amount; never Sales Price: 0', () => {
    expect(moneyRowForTransaction('Purchase', '$500,000', '$0')).toContain('Sales Price');
    expect(moneyRowForTransaction('Purchase', '$500,000', '$0')).not.toContain('Loan Amount');
    expect(moneyRowForTransaction('Purchase', '$0', '$400,000')).toBe('');
    expect(moneyRowForTransaction('Refinance', '$500,000', '$400,000')).toContain('Loan Amount');
    expect(moneyRowForTransaction('Refinance', '$500,000', '$400,000')).not.toContain('Sales Price');
    expect(moneyRowForTransaction('Refinance', '$500,000', null)).toBe('');
  });
});

describe('orderConfirmationTemplate polish', () => {
  it('Purchase: inline action pills near top, title officer, Sales Price (not Loan Amount)', () => {
    const { html } = orderConfirmationTemplate({
      ...base,
      transactionType: 'Purchase',
      salesPrice: '$500,000',
      loanAmount: '$0',
    });

    expect(html).toContain(PCT_LIGHT_LOGO_URL);
    expect(html).toContain('Your Title Officer');
    expect(html).toContain('Terry Title');
    expect(html).toContain('terry.to@pct.com');
    expect(html).toContain('(626) 555-0100');
    expect(html).toContain('Quick actions');
    expect(html).toContain('Generate Fees');
    expect(html).toContain('Generate CPL');
    expect(html).toContain('View Order in Portal');
    // Pills use the same ▣ chrome as attached docs
    expect(html).toMatch(/▣<\/span>Generate Fees/);
    expect(html).toContain('Sales Price');
    expect(html).toContain('$500,000');
    expect(html).not.toMatch(/Sales Price[\s\S]{0,80}\$0/);
    expect(html).not.toContain('>Loan Amount<');
    // Actions appear before tax section (prominent)
    const actionsIdx = html.indexOf('Quick actions');
    const taxIdx = html.indexOf('Property Tax Details');
    expect(actionsIdx).toBeGreaterThan(-1);
    expect(taxIdx).toBeGreaterThan(actionsIdx);
  });

  it('Refinance: shows Loan Amount, hides Sales Price even if provided', () => {
    const { html } = orderConfirmationTemplate({
      ...base,
      transactionType: 'Refinance',
      salesPrice: '$500,000',
      loanAmount: '$425,000',
    });

    expect(html).toContain('Your Title Officer');
    expect(html).toContain('Loan Amount');
    expect(html).toContain('$425,000');
    expect(html).not.toContain('>Sales Price<');
    expect(html).toContain('Quick actions');
    expect(html).toMatch(/border-radius:999px/);
  });

  it('never renders Sales Price: 0 on purchase with zero amount', () => {
    const { html } = orderConfirmationTemplate({
      ...base,
      transactionType: 'Purchase',
      salesPrice: '$0',
      loanAmount: null,
    });

    expect(html).not.toMatch(/Sales Price[^]*\$0/);
    expect(html).not.toContain('>Sales Price<');
  });
});
