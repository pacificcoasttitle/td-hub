/**
 * Lender search for the CPL and Proposed Insured modals — companies AND contacts.
 *
 * Both modals used to search `/api/contacts/search?type=lender` alone, which
 * returns contact rows. A lender company with nobody attached could never be
 * found. MEASURED 2026-09-12: one of 1,477 active lender companies — Private
 * Money Solutions (Priv1503), created on its own from the Lender Companies page
 * — and every company created that way from now on.
 *
 * A company row carries everything either modal keeps from a pick: name,
 * street address, city, state and zip, plus its own lookup code and
 * assignment clause. Contact rows stay, because a person's name is how some
 * lenders are remembered, but a contact whose company is already in the list
 * is dropped rather than shown twice.
 */

export interface LenderSearchResult {
  /** Unique across both sources — company and contact ids overlap. */
  key: string;
  kind: 'company' | 'contact';
  /**
   * companies.id, for company rows only. A contact row's id is a CONTACTS id
   * and must never be sent anywhere as a company id.
   */
  companyId: number | null;
  companyName: string;
  /** The company's lookup code, for both kinds. */
  lookupCode?: string;
  assignmentClause?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface CompanyRow {
  id: number;
  name: string;
  lookupCode: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  assignmentClause?: string | null;
}

interface ContactRow {
  id: number;
  companyName: string | null;
  companyLookupCode?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

const present = (v: string | null | undefined): string | undefined => (v && v.trim() ? v : undefined);
const identity = (name: string | null | undefined, address: string | null | undefined) =>
  `${(name ?? '').trim().toLowerCase()}|${(address ?? '').trim().toLowerCase()}`;

export async function searchLenders(
  query: string,
  options: { includeCompanies: boolean },
): Promise<LenderSearchResult[]> {
  const q = encodeURIComponent(query.trim());

  const companiesP: Promise<CompanyRow[]> = options.includeCompanies
    ? fetch(`/api/companies?search=${q}&type=lender&active=true&pageSize=6`)
      .then((r) => (r.ok ? r.json() : { companies: [] }))
      .then((d: { companies?: CompanyRow[] }) => d.companies ?? [])
      .catch(() => [])
    : Promise.resolve([]);

  const contactsP: Promise<ContactRow[]> = fetch(`/api/contacts/search?q=${q}&type=lender`)
    .then((r) => (r.ok ? r.json() : { results: [] }))
    .then((d: { results?: ContactRow[]; contacts?: ContactRow[] }) => d.results ?? d.contacts ?? [])
    .catch(() => []);

  const [companyRows, contactRows] = await Promise.all([companiesP, contactsP]);

  const companies: LenderSearchResult[] = companyRows.map((co) => ({
    key: `company-${co.id}`,
    kind: 'company',
    companyId: co.id,
    companyName: co.name,
    lookupCode: present(co.lookupCode),
    assignmentClause: present(co.assignmentClause),
    address: present(co.address1),
    city: present(co.city),
    state: present(co.state),
    zip: present(co.zip),
  }));

  const listedCodes = new Set(companies.map((c) => c.lookupCode?.toLowerCase()).filter(Boolean));
  const listedIdentities = new Set(companies.map((c) => identity(c.companyName, c.address)));

  const contacts: LenderSearchResult[] = contactRows
    .filter((ct) => present(ct.companyName))
    .filter((ct) => {
      const code = ct.companyLookupCode?.trim().toLowerCase();
      if (code && listedCodes.has(code)) return false;
      return !listedIdentities.has(identity(ct.companyName, ct.address));
    })
    .map((ct) => ({
      key: `contact-${ct.id}`,
      kind: 'contact',
      companyId: null,
      companyName: ct.companyName!,
      lookupCode: present(ct.companyLookupCode),
      address: present(ct.address),
      city: present(ct.city),
      state: present(ct.state),
      zip: present(ct.zip),
    }));

  return [...companies, ...contacts].slice(0, 10);
}
