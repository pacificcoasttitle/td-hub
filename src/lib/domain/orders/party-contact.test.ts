import { describe, expect, it } from 'vitest';
import { createOrderInputSchema } from './create-order';
import { buildSoftProPayload } from './softpro-payload';
import {
  applyContactSelection,
  firstPartySubmitBlocker,
  partyReachesSoftPro,
  partySubmitBlocker,
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
      branchCode: 'PCT',
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
  firstName: 'Marjan',
  lastName: 'Rassibi',
  fullName: null,
  companyName: 'First Priority Escrow',
  email: 'escrow@firstpriorityescrow.com',
  phone: '(818)668-8222',
  lookupCode: 'MarRasFirs',
  flookupCode: 'First4768',
});

const AGENT = applyContactSelection({
  fullName: 'Alex Chen',
  companyName: 'Coast Realty',
  email: 'alex@coastrealty.com',
  phone: '949-555-0100',
  lookupCode: 'AleCheCoas',
  companyLookupCode: 'Coast9912',
});

const LENDER = applyContactSelection({
  fullName: 'Pat Lopez',
  companyName: 'Harbor Lending',
  email: 'pat@harborlending.com',
  phone: '714-555-0199',
  lookupCode: 'PatLopHarb',
  companyLookupCode: 'Harbor2201',
});

const BROKER = applyContactSelection({
  fullName: 'Sam Ortiz',
  companyName: 'Pacific Mortgage',
  email: 'sam@pacmtg.com',
  phone: '818-555-0144',
  lookupCode: 'SamOrtPaci',
  companyLookupCode: 'Pacific88',
});

function emptyParty(): PartyFormContact {
  return { name: '', email: '', phone: '', company: '', companyLookupCode: '', clientLookupCode: '' };
}

describe('applyContactSelection', () => {
  it('builds a display name from first/last when fullName is null (First Priority shape)', () => {
    expect(MARJAN.name).toBe('Marjan Rassibi');
    expect(MARJAN.company).toBe('First Priority Escrow');
    expect(MARJAN.email).toBe('escrow@firstpriorityescrow.com');
    expect(MARJAN.clientLookupCode).toBe('MarRasFirs');
    expect(MARJAN.companyLookupCode).toBe('First4768');
  });
});

describe('silent-drop gates', () => {
  it('BEFORE: email/phone only was omitted from createOrder', () => {
    const emailOnly = { name: '', email: 'escrow@firstpriorityescrow.com', phone: '(818)668-8222', company: '' };
    expect(legacyContact(emailOnly)).toBeUndefined();
  });

  it('AFTER: email/phone only reaches SoftPro Email (no company required)', () => {
    const emailOnly: PartyFormContact = {
      name: '', email: 'escrow@firstpriorityescrow.com', phone: '(818)668-8222',
      company: '', companyLookupCode: '', clientLookupCode: '',
    };
    expect(toCreateOrderContact(emailOnly)).toEqual({
      email: 'escrow@firstpriorityescrow.com',
      phone: '(818)668-8222',
    });
    const details = softpro({ escrowCompany: toCreateOrderContact(emailOnly) }).escrowDetails as Record<string, unknown>;
    expect(details.Email).toBe('escrow@firstpriorityescrow.com');
  });

  it('BEFORE: name only was sent and then dropped by SoftPro hasContactData', () => {
    const nameOnly = { name: 'Marjan Rassibi', email: '', phone: '', company: '' };
    expect(legacyContact(nameOnly)).toEqual({ name: 'Marjan Rassibi' });
    expect(softpro({ escrowCompany: legacyContact(nameOnly) }).escrowDetails).toBeUndefined();
  });

  it('AFTER: name only is blocked before submit and never sent', () => {
    const nameOnly: PartyFormContact = {
      name: 'Marjan Rassibi', email: '', phone: '', company: '',
      companyLookupCode: '', clientLookupCode: '',
    };
    expect(partyReachesSoftPro(nameOnly)).toBe(false);
    expect(toCreateOrderContact(nameOnly)).toBeUndefined();
    expect(partySubmitBlocker(nameOnly, 'Escrow Company')).toBe(
      "Escrow Company: a name alone won't save this party; add an email or company",
    );
    expect(firstPartySubmitBlocker({
      buyerAgent: emptyParty(),
      listingAgent: emptyParty(),
      lender: emptyParty(),
      mortgageBroker: emptyParty(),
      escrowCompany: nameOnly,
    })).toMatch(/Escrow Company/);
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
    const after = toCreateOrderContact(AGENT);
    expect(softpro({ listingAgent: after }).listingAgentDetails).toEqual({
      CompanyLookUpCode: 'Coast9912',
      ClientLookUpCode: 'AleCheCoas',
      Name: 'Alex Chen',
      Email: 'alex@coastrealty.com',
      Telephone: '949-555-0100',
      CompanyName: 'Coast Realty',
    });
  });

  it('Lender (companyFirst): selected contact writes lookups onto lenderDetails', () => {
    const beforeTyped = { name: '', email: '', phone: '', company: 'Harbor Lending' };
    expect(legacyContact(beforeTyped)).toEqual({
      name: '',
      email: undefined,
      phone: undefined,
      companyName: 'Harbor Lending',
    });
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
    const legacyPayload = purchase({
      escrowCompany: undefined,
      // mortgageBroker was never passed
    });
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

  it('Escrow Company: screenshot email-in-company still writes as company; selected contact writes lookups', () => {
    const screenshot = { name: '', email: '', phone: '', company: 'escrow@firstpriorityescrow.com' };
    const before = softpro({ escrowCompany: legacyContact(screenshot) }).escrowDetails as Record<string, unknown>;
    expect(before).toEqual({
      CompanyLookUpCode: '',
      ClientLookUpCode: '',
      Name: '',
      Email: '',
      Telephone: '',
      CompanyName: 'escrow@firstpriorityescrow.com',
    });

    expect(softpro({ escrowCompany: toCreateOrderContact(MARJAN) }).escrowDetails).toEqual({
      CompanyLookUpCode: 'First4768',
      ClientLookUpCode: 'MarRasFirs',
      Name: 'Marjan Rassibi',
      Email: 'escrow@firstpriorityescrow.com',
      Telephone: '(818)668-8222',
      CompanyName: 'First Priority Escrow',
    });
  });

  it('free-text company without a selection still reaches SoftPro (no lookup required)', () => {
    const typed: PartyFormContact = {
      name: 'Guest Officer',
      email: '',
      phone: '',
      company: 'New Escrow Shop',
      companyLookupCode: '',
      clientLookupCode: '',
    };
    expect(partySubmitBlocker(typed, 'Escrow Company')).toBeNull();
    expect(softpro({ escrowCompany: toCreateOrderContact(typed) }).escrowDetails).toEqual({
      CompanyLookUpCode: '',
      ClientLookUpCode: '',
      Name: 'Guest Officer',
      Email: '',
      Telephone: '',
      CompanyName: 'New Escrow Shop',
    });
  });

  it('Escrow Officer is not this component — it stays a transaction string, not contacts.*', () => {
    const parsed = purchase({});
    expect(parsed.contacts?.escrowCompany).toBeUndefined();
    expect(parsed.transaction).not.toHaveProperty('escrowOfficerDetails');
  });
});
