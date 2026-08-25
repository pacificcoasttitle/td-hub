import { describe, expect, it } from 'vitest';
import { isCreateOrderShaped, normalizeClientCreateBody } from './client-wizard-to-create';
import { createOrderInputSchema } from './create-order';

const wizardBody = {
  clientDetails: { clientType: 'escrow_company', emailNotifications: true },
  property: {
    street: '123 Main St',
    city: 'Glendale',
    state: 'CA',
    zip: '91203',
    apn: '1234-567-890',
    county: 'Los Angeles',
    legalDescription: 'Lot 1 Tract 99',
    propertyType: 'SFR',
    unitNumber: '',
    siteXFilled: true,
    searchMode: 'address',
  },
  seller: {
    primary: { firstName: 'Ann', middleName: '', lastName: 'Owner' },
    secondary: { firstName: '', middleName: '', lastName: '' },
    hasSecondary: false,
    isOrg: false,
    orgType: '',
  },
  transaction: {
    transactionType: 'Purchase',
    productType: 'Residential Resale',
    orderType: 'title_only',
    salesRep: '10',
    titleOfficer: '20',
    escrowNumber: '',
    salesAmount: '500000',
    loanNumber: '',
    loanAmount: '0',
    coverageAmount: '0',
    primaryBorrower: { firstName: 'Bob', middleName: '', lastName: 'Buyer' },
    secondaryBorrower: { firstName: '', middleName: '', lastName: '' },
    hasSecondaryBorrower: false,
    borrowerIsOrg: false,
    borrowerOrgType: '',
  },
  parties: {
    showAgents: false,
    showLender: false,
    showEscrow: false,
  },
  titlePointSessionId: 'tp_api_id_999',
  siteXSnapshot: {
    matchCode: 'S' as const,
    apn: '1234-567-890',
    county: 'Los Angeles',
    legalDescription: 'Lot 1 Tract 99',
  },
};

describe('normalizeClientCreateBody (OC-1 client path)', () => {
  it('forwards titlePointSessionId + siteXSnapshot from wizard submit', () => {
    const normalized = normalizeClientCreateBody(wizardBody);
    expect(normalized.titlePointSessionId).toBe('tp_api_id_999');
    expect(normalized.siteXSnapshot).toEqual(wizardBody.siteXSnapshot);
    expect((normalized.property as { address: string }).address).toBe('123 Main St');
    expect((normalized.transaction as { type: string }).type).toBe('Purchase');
    expect(normalized.orderType).toBe('Title only');
  });

  it('preserves OC-1 fields when body is already create-order shaped', () => {
    const hubShaped = {
      orderType: 'Title only',
      property: { address: '9 Oak', city: 'Orange', state: 'CA', zip: '92866' },
      transaction: { type: 'Purchase', product: 'Residential Resale' },
      titlePointSessionId: 'tp_api_id_1',
      siteXSnapshot: { matchCode: 'S' as const, apn: '1', county: 'Orange', legalDescription: 'Lot 9' },
    };
    expect(isCreateOrderShaped(hubShaped)).toBe(true);
    const normalized = normalizeClientCreateBody(hubShaped);
    expect(normalized.titlePointSessionId).toBe('tp_api_id_1');
    expect(normalized.siteXSnapshot).toEqual(hubShaped.siteXSnapshot);
  });

  // A cached browser bundle can still post deliverableEmails after this ships.
  // It must not reappear in the create input: the form no longer collects it and
  // nothing reads it, so carrying it forward would only re-create the illusion
  // that those addresses get mail. See docs/tickets/DELIVERABLE_EMAILS.md.
  it('drops deliverableEmails posted by a stale client bundle', () => {
    const stale = {
      ...wizardBody,
      deliverableEmails: ['ops@example.com'],
      parties: { ...wizardBody.parties, deliverableEmails: ['ops@example.com'] },
    };
    const normalized = normalizeClientCreateBody(stale) as Record<string, unknown>;
    expect(normalized.deliverableEmails).toBeUndefined();
    expect(createOrderInputSchema.parse(normalized)).not.toHaveProperty('deliverableEmails');
  });

  it('omits session/snapshot when absent (no-match grace — ungated submit)', () => {
    const { titlePointSessionId: _s, siteXSnapshot: _x, ...noSession } = wizardBody;
    const normalized = normalizeClientCreateBody(noSession);
    expect(normalized.titlePointSessionId).toBeUndefined();
    expect(normalized.siteXSnapshot).toBeUndefined();
  });
});
