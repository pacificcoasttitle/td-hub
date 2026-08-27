/**
 * Hub open-order party mapping.
 *
 * SoftPro keeps a contact section only when hasContactData is true:
 * lookup code, email, or companyName. A name (or phone) alone is dropped
 * after a 200 — the silent write this module exists to stop.
 */

export interface PartyFormContact {
  name: string;
  email: string;
  phone: string;
  company: string;
  companyLookupCode?: string;
  clientLookupCode?: string;
  /**
   * The `contacts` row the operator picked. Absent on free text, and absent when
   * the pick was a company rather than a person — the company-first typeahead
   * mixes both and only a person has a contact id.
   */
  contactId?: number;
}

export const EMPTY_PARTY: PartyFormContact = {
  name: '',
  email: '',
  phone: '',
  company: '',
  companyLookupCode: '',
  clientLookupCode: '',
  contactId: undefined,
};

export interface CreateOrderContact {
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  companyLookupCode?: string;
  clientLookupCode?: string;
  contactId?: number;
}

export interface ContactSearchHit {
  /** Positive for a contact row. The company-first search puts companies in the
   *  same list under a negative synthetic id, which is not a contact id. */
  id?: number | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  lookupCode?: string | null;
  clientLookupCode?: string | null;
  companyLookupCode?: string | null;
  flookupCode?: string | null;
}

export function partyDisplayName(hit: ContactSearchHit): string {
  const full = hit.fullName?.trim();
  if (full) return full;
  return [hit.firstName, hit.lastName].filter((p) => !!p?.trim()).join(' ').trim();
}

export function applyContactSelection(hit: ContactSearchHit): PartyFormContact {
  return {
    name: partyDisplayName(hit),
    company: hit.companyName?.trim() ?? '',
    email: hit.email?.trim() ?? '',
    phone: hit.phone?.trim() ?? '',
    clientLookupCode: (hit.clientLookupCode ?? hit.lookupCode ?? '').trim(),
    companyLookupCode: (hit.companyLookupCode ?? hit.flookupCode ?? '').trim(),
    contactId: typeof hit.id === 'number' && hit.id > 0 ? hit.id : undefined,
  };
}

export function partyHasInput(c: PartyFormContact): boolean {
  return !!(
    c.name.trim()
    || c.email.trim()
    || c.phone.trim()
    || c.company.trim()
    || c.companyLookupCode?.trim()
    || c.clientLookupCode?.trim()
  );
}

/** Same gate as softpro-payload hasContactData. */
export function partyReachesSoftPro(c: PartyFormContact): boolean {
  return !!(
    c.companyLookupCode?.trim()
    || c.clientLookupCode?.trim()
    || c.email.trim()
    || c.company.trim()
  );
}

export function partySubmitBlocker(c: PartyFormContact, label: string): string | null {
  if (!partyHasInput(c)) return null;
  if (partyReachesSoftPro(c)) return null;
  return `${label}: a name alone won't save this party; add an email or company`;
}

export function toCreateOrderContact(c: PartyFormContact): CreateOrderContact | undefined {
  if (!partyHasInput(c)) return undefined;
  if (!partyReachesSoftPro(c)) return undefined;
  return {
    name: c.name.trim() || undefined,
    email: c.email.trim() || undefined,
    phone: c.phone.trim() || undefined,
    companyName: c.company.trim() || undefined,
    companyLookupCode: c.companyLookupCode?.trim() || undefined,
    clientLookupCode: c.clientLookupCode?.trim() || undefined,
    contactId: c.contactId,
  };
}

export const PARTY_SUBMIT_LABELS = {
  buyerAgent: "Buyer's Agent",
  listingAgent: 'Listing Agent',
  lender: 'Lender',
  mortgageBroker: 'Mortgage Broker',
  escrowCompany: 'Escrow Company',
} as const;

export function firstPartySubmitBlocker(parties: {
  buyerAgent: PartyFormContact;
  listingAgent: PartyFormContact;
  lender: PartyFormContact;
  mortgageBroker: PartyFormContact;
  escrowCompany: PartyFormContact;
}): string | null {
  for (const key of Object.keys(PARTY_SUBMIT_LABELS) as Array<keyof typeof PARTY_SUBMIT_LABELS>) {
    const msg = partySubmitBlocker(parties[key], PARTY_SUBMIT_LABELS[key]);
    if (msg) return msg;
  }
  return null;
}
