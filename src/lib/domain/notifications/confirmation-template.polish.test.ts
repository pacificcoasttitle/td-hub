import { describe, expect, it } from 'vitest';
import {
  isMeaningfulMoney,
  moneyRowForTransaction,
  orderConfirmationTemplate,
} from './confirmation-template';
import { parseTaxResultData } from './tax-result-data';
import { HEADER_BG, PCT_ORANGE } from './email-layout';

const TAX = parseTaxResultData({
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

describe('orderConfirmationTemplate polish + redesign', () => {
  it('Purchase: redesign actions, title officer in snapshot, Sales price (not Loan amount)', () => {
    const { html } = orderConfirmationTemplate({
      ...base,
      transactionType: 'Purchase',
      salesPrice: '$500,000',
      loanAmount: '$0',
    });

    expect(html).toContain('Order confirmation');
    expect(html).toContain('Title officer');
    expect(html).toContain('Terry Title');
    expect(html).toContain('Property details');
    expect(html).toContain('Transaction details');
    expect(html).toContain('Escrow details');
    expect(html).not.toContain('Generate Fees');
    expect(html).not.toContain('Generate CPL');
    expect(html).not.toContain('View Order in Portal');
    expect(html).toContain(`background:${HEADER_BG}`);
    expect(html).toContain(`background:${PCT_ORANGE}`);
    expect(html).toContain('Sales price');
    expect(html).toContain('$500,000');
    expect(html).not.toMatch(/Sales price[\s\S]{0,80}\$0/);
    expect(html).not.toContain('Loan amount');
  });

  it('Refinance: shows Loan amount, hides Sales price even if provided', () => {
    const { html } = orderConfirmationTemplate({
      ...base,
      transactionType: 'Refinance',
      salesPrice: '$500,000',
      loanAmount: '$425,000',
    });

    expect(html).toContain('Title officer');
    expect(html).toContain('Loan amount');
    expect(html).toContain('$425,000');
    expect(html).not.toContain('Sales price');
    expect(html).toContain('Transaction details');
  });

  it('never renders Sales price: 0 on purchase with zero amount', () => {
    const { html } = orderConfirmationTemplate({
      ...base,
      transactionType: 'Purchase',
      salesPrice: '$0',
      loanAmount: null,
    });

    expect(html).not.toMatch(/Sales price[\s\S]{0,80}\$0/);
  });
});
