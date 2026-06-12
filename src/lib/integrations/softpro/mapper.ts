import {
  SoftProOrderItem,
  SoftProOrderContactsData,
  SoftProLookupItem,
  SoftProResolvedCompany,
  SoftProResolvedPerson,
  SoftProResolvedRole,
  TITLE_OFFICER_FIELDS,
  parseSoftProDate,
} from './types';

// ─── Mapped Order (from GetOrders — limited fields) ─────────────────────────

export interface MappedOrderData {
  fileNumber: string;
  softproStatus: string;
  operationalStatus: 'open' | 'in_process' | 'completed' | 'closed' | 'canceled' | 'duplicate';
  transactionType: string | null;
  productType: string | null;
  orderType: string | null;
  salesPrice: string | null;
  openedAt: Date | null;
  completedAt: Date | null;
  closedAt: Date | null;
  isImported: boolean;
  property: {
    address: string | null;
    city: string | null;
    state: string | null;
    county: string | null;
    fullAddress: string | null;
  };
  marketingRepName: string | null;
  titleOfficerName: string | null;
}

// ─── Mapped Order Contacts (from GetOrderContacts) ──────────────────────────

export interface MappedOrderContacts {
  primaryBuyer: string | null;
  secondaryBuyer: string | null;
  primarySeller: string | null;
  secondarySeller: string | null;
  escrowCompanyCode: string | null;
  escrowPersonCode: string | null;
  lenderCompanyCode: string | null;
  lenderCode: string | null;
  listingAgentCompanyCode: string | null;
  listingAgentPersonCode: string | null;
  mortgageBrokerCode: string | null;
  payoffLenderCode: string | null;
  titleCompanyCode: string | null;
  titleOfficerName: string | null;
  underwriterCompanyCode: string | null;
  underwriterPersonCode: string | null;
  parties: {
    buyer: MappedResolvedParty | null;
    secondaryBuyer: MappedResolvedParty | null;
    seller: MappedResolvedParty | null;
    secondarySeller: MappedResolvedParty | null;
    escrowCompany: MappedResolvedParty | null;
    lender: MappedResolvedParty | null;
    listingAgent: MappedResolvedParty | null;
    mortgageBroker: MappedResolvedParty | null;
    payoffLender: MappedResolvedParty | null;
    titleCompany: MappedResolvedParty | null;
    underwriter: MappedResolvedParty | null;
  };
}

export interface MappedResolvedParty {
  name: string | null;
  email: string | null;
  phone: string | null;
  lookupCode: string | null;
  companyName: string | null;
  companyLookupCode: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
}

// ─── Mapped Lookup Entry ────────────────────────────────────────────────────

export interface MappedLookupEntry {
  code: string | null;
  officeLookupCode: string | null;
  officerName: string | null;
  email: string | null;
  rowState: string | null;
  raw: Record<string, string>;
}

// ─── Status Mapping ─────────────────────────────────────────────────────────

function mapStatus(softproStatus: string): MappedOrderData['operationalStatus'] {
  const s = softproStatus.toLowerCase().trim();
  switch (s) {
    case 'open': return 'open';
    case 'in process':
    case 'inprocess':
    case 'in_process': return 'in_process';
    case 'completed':
    case 'clear for policy': return 'completed';
    case 'closed': return 'closed';
    case 'canceled':
    case 'cancelled': return 'canceled';
    case 'duplicate': return 'duplicate';
    default: return 'open';
  }
}

// ─── Order Mapper ───────────────────────────────────────────────────────────

/**
 * Map a SoftPro order from GetOrders to our domain format.
 * GetOrders only returns OrderNumber, OrderStatus, LastModifiedOn, CompletedDate.
 * All other fields (address, title officer, sales price, etc.) are not available
 * from this endpoint — they come from GetOrderContacts or not at all.
 */
export function mapSoftProOrder(item: SoftProOrderItem): MappedOrderData {
  const softproStatus = (item.OrderStatus ?? 'open').toLowerCase().trim();
  const operationalStatus = mapStatus(item.OrderStatus ?? 'open');

  const closedAt = operationalStatus === 'closed' ? parseSoftProDate(item.LastModifiedOn) : null;

  return {
    fileNumber: item.OrderNumber,
    softproStatus,
    operationalStatus,
    transactionType: null,
    productType: null,
    orderType: null,
    salesPrice: null,
    openedAt: null,
    completedAt: parseSoftProDate(item.CompletedDate),
    closedAt,
    isImported: true,
    property: {
      address: null,
      city: null,
      state: null,
      county: null,
      fullAddress: null,
    },
    marketingRepName: null,
    titleOfficerName: null,
  };
}

// ─── Contacts Mapper ────────────────────────────────────────────────────────

function nullableString(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  return value.trim();
}

function lookupCode(role: SoftProResolvedRole | null | undefined, field: 'CompanyLookUpCode' | 'PersonLookupCode'): string | null {
  return nullableString(role?.[field]);
}

function resolvedParty(
  person: SoftProResolvedPerson | null | undefined,
  company: SoftProResolvedCompany | null | undefined,
  fallbackName?: string | null,
): MappedResolvedParty | null {
  const mapped: MappedResolvedParty = {
    name: nullableString(person?.Name) ?? nullableString(fallbackName),
    email: nullableString(person?.Email),
    phone: nullableString(person?.Phone),
    lookupCode: nullableString(person?.LookupCode),
    companyName: nullableString(company?.Name),
    companyLookupCode: nullableString(company?.LookupCode),
    companyEmail: nullableString(company?.Email),
    companyPhone: nullableString(company?.Phone),
  };

  return Object.values(mapped).some((value) => value !== null) ? mapped : null;
}

function companyOnlyParty(company: SoftProResolvedCompany | null | undefined): MappedResolvedParty | null {
  return resolvedParty(null, company, null);
}

/**
 * Map GetOrderContacts response to a structured contacts object.
 */
export function mapOrderContacts(data: SoftProOrderContactsData): MappedOrderContacts {
  const primaryBuyer = nullableString(data.buyer?.Person?.PrimaryBorrower)
    ?? nullableString(data.buyer?.Company?.PrimaryBorrower)
    ?? nullableString(data.buyer?.PrimaryBorrower)
    ?? nullableString(data.buyer?.PreimaryBorrower);
  const secondaryBuyer = nullableString(data.buyer?.Person?.SecondaryBorrower)
    ?? nullableString(data.buyer?.Company?.SecondaryBorrower)
    ?? nullableString(data.buyer?.SecondaryBorrower);
  const primarySeller = nullableString(data.Sellers?.PrimarySeller)
    ?? nullableString(data.Sellers?.PreimarySeller);
  const secondarySeller = nullableString(data.Sellers?.SecondarySeller);
  const escrowCompanyCode = nullableString(data.EscrowCompanies?.Company?.LookupCode)
    ?? lookupCode(data.EscrowCompanies, 'CompanyLookUpCode');
  const escrowPersonCode = nullableString(data.EscrowCompanies?.Person?.LookupCode)
    ?? lookupCode(data.EscrowCompanies, 'PersonLookupCode');
  const lenderCompanyCode = nullableString(data.Lenders?.Company?.LookupCode)
    ?? lookupCode(data.Lenders, 'CompanyLookUpCode');
  const lenderCode = nullableString(data.Lenders?.Person?.LookupCode)
    ?? lookupCode(data.Lenders, 'PersonLookupCode');
  const listingAgentCompanyCode = nullableString(data.ListingAgentBrokers?.Company?.LookupCode)
    ?? lookupCode(data.ListingAgentBrokers, 'CompanyLookUpCode');
  const listingAgentPersonCode = nullableString(data.ListingAgentBrokers?.Person?.LookupCode)
    ?? lookupCode(data.ListingAgentBrokers, 'PersonLookupCode');
  const mortgageBrokerCode = nullableString(data.MortgageBrokers?.Person?.LookupCode)
    ?? lookupCode(data.MortgageBrokers, 'PersonLookupCode');
  const payoffLenderCode = nullableString(data.PayoffLenders?.Person?.LookupCode)
    ?? lookupCode(data.PayoffLenders, 'PersonLookupCode');
  const titleCompanyCode = nullableString(data.TitleCompanies?.Company?.LookupCode)
    ?? lookupCode(data.TitleCompanies, 'CompanyLookUpCode');
  const titleOfficerName = nullableString(data.TitleCompanies?.Person?.Name)
    ?? nullableString(data.TitleCompanies?.Person?.LookupCode)
    ?? lookupCode(data.TitleCompanies, 'PersonLookupCode');
  const underwriterCompanyCode = nullableString(data.Underwriters?.Company?.LookupCode)
    ?? lookupCode(data.Underwriters, 'CompanyLookUpCode');
  const underwriterPersonCode = nullableString(data.Underwriters?.Person?.LookupCode)
    ?? lookupCode(data.Underwriters, 'PersonLookupCode');

  return {
    primaryBuyer,
    secondaryBuyer,
    primarySeller,
    secondarySeller,
    escrowCompanyCode,
    escrowPersonCode,
    lenderCompanyCode,
    lenderCode,
    listingAgentCompanyCode,
    listingAgentPersonCode,
    mortgageBrokerCode,
    payoffLenderCode,
    titleCompanyCode,
    titleOfficerName,
    underwriterCompanyCode,
    underwriterPersonCode,
    parties: {
      buyer: resolvedParty(data.buyer?.Person, data.buyer?.Company, primaryBuyer),
      secondaryBuyer: primaryBuyer !== secondaryBuyer
        ? resolvedParty(null, data.buyer?.Company, secondaryBuyer)
        : null,
      seller: primarySeller ? resolvedParty(null, null, primarySeller) : null,
      secondarySeller: secondarySeller ? resolvedParty(null, null, secondarySeller) : null,
      escrowCompany: resolvedParty(data.EscrowCompanies?.Person, data.EscrowCompanies?.Company),
      lender: resolvedParty(data.Lenders?.Person, data.Lenders?.Company),
      listingAgent: resolvedParty(data.ListingAgentBrokers?.Person, data.ListingAgentBrokers?.Company),
      mortgageBroker: resolvedParty(data.MortgageBrokers?.Person, data.MortgageBrokers?.Company),
      payoffLender: resolvedParty(data.PayoffLenders?.Person, data.PayoffLenders?.Company),
      titleCompany: resolvedParty(data.TitleCompanies?.Person, data.TitleCompanies?.Company),
      underwriter: companyOnlyParty(data.Underwriters?.Company),
    },
  };
}

// ─── Lookup Table Mapper ────────────────────────────────────────────────────

/**
 * Map a lookup table entry with space/slash field names to normalized keys.
 * Extracts known Title Officer fields; preserves all raw fields for
 * other entity types whose field names we haven't discovered yet.
 */
export function mapLookupTableEntry(item: SoftProLookupItem): MappedLookupEntry {
  return {
    code: item[TITLE_OFFICER_FIELDS.code] ?? null,
    officeLookupCode: item[TITLE_OFFICER_FIELDS.officeLookupCode] ?? null,
    officerName: item[TITLE_OFFICER_FIELDS.officerName] ?? null,
    email: item[TITLE_OFFICER_FIELDS.email] ?? null,
    rowState: item[TITLE_OFFICER_FIELDS.rowState] ?? null,
    raw: item,
  };
}
