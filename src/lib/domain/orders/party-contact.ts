/**
 * Hub open-order party mapping.
 *
 * SoftPro keeps a contact section only when hasContactData is true:
 * lookup code, email, or companyName. A name (or phone) alone is dropped
 * after a 200 — the silent write this module exists to stop.
 *
 * Parties are chosen from the contact typeahead and nowhere else. There is no
 * free-text path into these fields, so every value here came from a `contacts`
 * or `companies` row.
 */

export interface PartyFormContact {
  name: string;
  email: string;
  phone: string;
  company: string;
  companyLookupCode?: string;
  clientLookupCode?: string;
  /**
   * The `contacts` row the operator picked. Absent when the pick was a company
   * rather than a person — the company-inclusive typeahead mixes both and only
   * a person has a contact id.
   */
  contactId?: number;
  /**
   * Street and city, carried for the resolved card only. Deliberately not read
   * by toCreateOrderContact: SoftPro takes the party address from the lookup
   * code, so sending ours would be a second source of truth for one field.
   */
  address?: string;
  city?: string;
}

export const EMPTY_PARTY: PartyFormContact = {
  name: '',
  email: '',
  phone: '',
  company: '',
  companyLookupCode: '',
  clientLookupCode: '',
  contactId: undefined,
  address: '',
  city: '',
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
  /** Positive for a contact row. The company-inclusive search puts companies in
   *  the same list under a negative synthetic id, which is not a contact id. */
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
  address?: string | null;
  city?: string | null;
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
    address: hit.address?.trim() ?? '',
    city: hit.city?.trim() ?? '',
  };
}

/** A party slot holds a selection. Empty means the operator picked nobody. */
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

/**
 * Same gate as softpro-payload hasContactData.
 *
 * Kept as a gate even though the typeahead can no longer produce a party that
 * fails it — every one of the 21,702 active contacts carries an email, a
 * company or a lookup code. It mirrors the vendor's real rule, so it stays as
 * the thing that stops a future data change becoming a silent drop.
 */
export function partyReachesSoftPro(c: PartyFormContact): boolean {
  return !!(
    c.companyLookupCode?.trim()
    || c.clientLookupCode?.trim()
    || c.email.trim()
    || c.company.trim()
  );
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
