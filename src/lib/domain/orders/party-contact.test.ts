import { describe, expect, it } from 'vitest';
import { createOrderInputSchema } from './create-order';
import { buildSoftProPayload } from './softpro-payload';
import {
  applyContactSelection,
  EMPTY_PARTY,
  partyHasInput,
  partyReachesSoftPro,
  toCreateOrderContact,
  type CreateOrderContact,
  type PartyFormContact,
} from './party-contact';

/** Pre-fix handleSubmit mapping — name/company only, no lookup codes. */
function legacyContact(c: { name: string; email: string; phone: string; company: string }): CreateOrderContact | undefined {
  if (!(c.name || c.company)) return undefined;
  return {
    name: c.name,
    email: c.email || undefined,
    phone: c.phone || undefined,
    companyName: c.company || undefined,
  };
}

function purchase(contacts: {
  buyerAgent?: CreateOrderContact;
  listingAgent?: CreateOrderContact;
  lender?: CreateOrderContact;
  mortgageBroker?: CreateOrderContact;
  escrowCompany?: CreateOrderContact;
}) {
  return createOrderInputSchema.parse({
    orderType: 'Title only',
    isRushOrder: false,
    property: { address: '419 Calle Delicada', city: 'San Clemente', state: 'CA', zip: '92673' },
    seller: { firstName: 'SiteX', lastName: 'Owner', isOrganization: false },
    buyer: { firstName: 'Jordan', lastName: 'Reyes', isOrganization: false },
    transaction: {
      type: 'Purchase',
      product: 'Residential Resale',
      salesAmount: 850000,
      loanAmount: 680000,
      coverageAmount: 850000,
    },
    contacts,
  });
}

function softpro(contacts: Parameters<typeof purchase>[0]) {
  return buildSoftProPayload(
    purchase(contacts),
    { apn: '1', legal: 'Lot 1', county: 'Orange' },
    {},
  );
}

const MARJAN = applyContactSelection({
  id: 4821,
  firstName: 'Marjan',
  lastName: 'Rassibi',
  fullName: null,
  companyName: 'First Priority Escrow',
  email: 'escrow@firstpriorityescrow.com',
  phone: '(818)668-8222',
  lookupCode: 'MarRasFirs',
  flookupCode: 'First4768',
  address: '21031 Ventura Blvd',
  city: 'Woodland Hills',
});

const AGENT = applyContactSelection({
  id: 1201,
  fullName: 'Alex Chen',
  companyName: 'Coast Realty',
  email: 'alex@coastrealty.com',
  phone: '949-555-0100',
  lookupCode: 'AleCheCoas',
  companyLookupCode: 'Coast9912',
});

const LENDER = applyContactSelection({
  id: 3310,
  fullName: 'Pat Lopez',
  companyName: 'Harbor Lending',
  email: 'pat@harborlending.com',
  phone: '714-555-0199',
  lookupCode: 'PatLopHarb',
  companyLookupCode: 'Harbor2201',
});

const BROKER = applyContactSelection({
  id: 5504,
  fullName: 'Sam Ortiz',
  companyName: 'Pacific Mortgage',
  email: 'sam@pacmtg.com',
  phone: '818-555-0144',
  lookupCode: 'SamOrtPaci',
  companyLookupCode: 'Pacific88',
});

/** A company hit from /api/companies: negative synthetic id, no person. */
const COMPANY_PICK = applyContactSelection({
  id: -78,
  fullName: null,
  companyName: 'First Priority Escrow',
  email: 'info@firstpriorityescrow.com',
  phone: '818-668-8222',
  companyLookupCode: 'First4768',
  clientLookupCode: '',
});

describe('applyContactSelection', () => {
  it('builds a display name from first/last when fullName is null (First Priority shape)', () => {
    expect(MARJAN.name).toBe('Marjan Rassibi');
    expect(MARJAN.company).toBe('First Priority Escrow');
    expect(MARJAN.email).toBe('escrow@firstpriorityescrow.com');
    expect(MARJAN.clientLookupCode).toBe('MarRasFirs');
    expect(MARJAN.companyLookupCode).toBe('First4768');
    expect(MARJAN.contactId).toBe(4821);
  });

  it('carries street and city for the resolved card but keeps them off the wire', () => {
    expect(MARJAN.address).toBe('21031 Ventura Blvd');
    expect(MARJAN.city).toBe('Woodland Hills');
    expect(toCreateOrderContact(MARJAN)).not.toHaveProperty('address');
    expect(toCreateOrderContact(MARJAN)).not.toHaveProperty('city');
  });

  it('a company pick has a company lookup code and no contact id', () => {
    expect(COMPANY_PICK.contactId).toBeUndefined();
    expect(COMPANY_PICK.companyLookupCode).toBe('First4768');
    expect(COMPANY_PICK.name).toBe('');
  });
});

describe('an unselected party is cleanly absent, not an empty shell', () => {
  it('empty slot maps to undefined and omits the whole SoftPro section', () => {
    const empty: PartyFormContact = { ...EMPTY_PARTY };
    expect(partyHasInput(empty)).toBe(false);
    expect(toCreateOrderContact(empty)).toBeUndefined();

    const payload = softpro({
      buyerAgent: toCreateOrderContact(empty),
      listingAgent: toCreateOrderContact(empty),
      lender: toCreateOrderContact(empty),
      mortgageBroker: toCreateOrderContact(empty),
      escrowCompany: toCreateOrderContact(empty),
    });

    for (const key of ['buyersAgentDetails', 'listingAgentDetails', 'lenderDetails', 'mortgageDetails', 'escrowDetails']) {
      expect(payload).not.toHaveProperty(key);
    }
  });
});

describe('silent-drop gates', () => {
  it('BEFORE: email/phone only was omitted from createOrder', () => {
    const emailOnly = { name: '', email: 'escrow@firstpriorityescrow.com', phone: '(818)668-8222', company: '' };
    expect(legacyContact(emailOnly)).toBeUndefined();
  });

  it('BEFORE: name only was sent and then dropped by SoftPro hasContactData', () => {
    const nameOnly = { name: 'Marjan Rassibi', email: '', phone: '', company: '' };
    expect(legacyContact(nameOnly)).toEqual({ name: 'Marjan Rassibi' });
    expect(softpro({ escrowCompany: legacyContact(nameOnly) }).escrowDetails).toBeUndefined();
  });

  it('AFTER: the typeahead is the only way in, and every selection clears the gate', () => {
    for (const party of [MARJAN, AGENT, LENDER, BROKER, COMPANY_PICK]) {
      expect(partyReachesSoftPro(party)).toBe(true);
      expect(toCreateOrderContact(party)).toBeDefined();
    }
  });

  it('the gate still refuses a name-only party, so a data change cannot become a silent drop', () => {
    const nameOnly: PartyFormContact = { ...EMPTY_PARTY, name: 'Marjan Rassibi' };
    expect(partyReachesSoftPro(nameOnly)).toBe(false);
    expect(toCreateOrderContact(nameOnly)).toBeUndefined();
  });
});

describe('createOrder / SoftPro payload before vs after — selected contact', () => {
  it("Buyer's Agent: free-text before (no lookups) vs selected after", () => {
    const typed = { name: 'Alex Chen', email: '', phone: '', company: '' };
    expect(legacyContact(typed)).toEqual({ name: 'Alex Chen' });
    expect(softpro({ buyerAgent: legacyContact(typed) }).buyersAgentDetails).toBeUndefined();

    const after = toCreateOrderContact(AGENT);
    expect(after).toEqual({
      name: 'Alex Chen',
      email: 'alex@coastrealty.com',
      phone: '949-555-0100',
      companyName: 'Coast Realty',
      companyLookupCode: 'Coast9912',
      clientLookupCode: 'AleCheCoas',
      contactId: 1201,
    });
    expect(softpro({ buyerAgent: after }).buyersAgentDetails).toEqual({
      CompanyLookUpCode: 'Coast9912',
      ClientLookUpCode: 'AleCheCoas',
      Name: 'Alex Chen',
      Email: 'alex@coastrealty.com',
      Telephone: '949-555-0100',
      CompanyName: 'Coast Realty',
    });
  });

  it('Listing Agent: same mapping, listingAgentDetails', () => {
    expect(softpro({ listingAgent: toCreateOrderContact(AGENT) }).listingAgentDetails).toEqual({
      CompanyLookUpCode: 'Coast9912',
      ClientLookUpCode: 'AleCheCoas',
      Name: 'Alex Chen',
      Email: 'alex@coastrealty.com',
      Telephone: '949-555-0100',
      CompanyName: 'Coast Realty',
    });
  });

  it('Lender: selected contact writes lookups onto lenderDetails', () => {
    const beforeTyped = { name: '', email: '', phone: '', company: 'Harbor Lending' };
    const beforeDetails = softpro({ lender: legacyContact(beforeTyped) }).lenderDetails as Record<string, unknown>;
    expect(beforeDetails.CompanyLookUpCode).toBe('');
    expect(beforeDetails.CompanyName).toBe('Harbor Lending');

    expect(softpro({ lender: toCreateOrderContact(LENDER) }).lenderDetails).toEqual({
      CompanyLookUpCode: 'Harbor2201',
      ClientLookUpCode: 'PatLopHarb',
      Name: 'Pat Lopez',
      Email: 'pat@harborlending.com',
      Telephone: '714-555-0199',
      CompanyName: 'Harbor Lending',
    });
  });

  it('Mortgage Broker: BEFORE omitted from handleSubmit; AFTER writes mortgageDetails', () => {
    const legacyPayload = purchase({});
    expect(legacyPayload.contacts?.mortgageBroker).toBeUndefined();
    expect(softpro({}).mortgageDetails).toBeUndefined();

    expect(softpro({ mortgageBroker: toCreateOrderContact(BROKER) }).mortgageDetails).toEqual({
      CompanyLookUpCode: 'Pacific88',
      ClientLookUpCode: 'SamOrtPaci',
      Name: 'Sam Ortiz',
      Email: 'sam@pacmtg.com',
      Telephone: '818-555-0144',
      CompanyName: 'Pacific Mortgage',
    });
  });

  it('Escrow Company: the reported email-in-company row can no longer be produced', () => {
    // The defect: a browser autofilled an email into the free-text Company Name
    // box and it went out as CompanyName. There is no such box now, so the only
    // way to fill this section is a selection, which carries lookup codes.
    const screenshot = { name: '', email: '', phone: '', company: 'escrow@firstpriorityescrow.com' };
    const before = softpro({ escrowCompany: legacyContact(screenshot) }).escrowDetails as Record<string, unknown>;
    expect(before.CompanyName).toBe('escrow@firstpriorityescrow.com');
    expect(before.CompanyLookUpCode).toBe('');

    expect(softpro({ escrowCompany: toCreateOrderContact(MARJAN) }).escrowDetails).toEqual({
      CompanyLookUpCode: 'First4768',
      ClientLookUpCode: 'MarRasFirs',
      Name: 'Marjan Rassibi',
      Email: 'escrow@firstpriorityescrow.com',
      Telephone: '(818)668-8222',
      CompanyName: 'First Priority Escrow',
    });
  });

  it('a company pick still carries CompanyLookUpCode with no client code', () => {
    expect(softpro({ escrowCompany: toCreateOrderContact(COMPANY_PICK) }).escrowDetails).toEqual({
      CompanyLookUpCode: 'First4768',
      ClientLookUpCode: '',
      Name: '',
      Email: 'info@firstpriorityescrow.com',
      Telephone: '818-668-8222',
      CompanyName: 'First Priority Escrow',
    });
  });

  it('Escrow Officer is not this component — it stays a transaction string, not contacts.*', () => {
    const parsed = purchase({});
    expect(parsed.contacts?.escrowCompany).toBeUndefined();
    expect(parsed.transaction).not.toHaveProperty('escrowOfficerDetails');
  });
});
