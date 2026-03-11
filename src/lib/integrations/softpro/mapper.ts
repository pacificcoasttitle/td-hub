import {
  SoftProOrderItem,
  SoftProOrderContactsData,
  SoftProLookupItem,
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
  escrowCompanyCode: string | null;
  lenderCode: string | null;
  mortgageBrokerCode: string | null;
  payoffLenderCode: string | null;
  titleCompanyCode: string | null;
  titleOfficerName: string | null;
  underwriterCompanyCode: string | null;
  underwriterPersonCode: string | null;
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

function emptyToNull(value: string | undefined): string | null {
  if (!value || !value.trim()) return null;
  return value;
}

/**
 * Map GetOrderContacts response to a structured contacts object.
 */
export function mapOrderContacts(data: SoftProOrderContactsData): MappedOrderContacts {
  return {
    primaryBuyer: emptyToNull(data.buyer?.PreimaryBorrower),
    secondaryBuyer: emptyToNull(data.buyer?.SecondaryBorrower),
    escrowCompanyCode: emptyToNull(data.EscrowCompanies?.CompanyLookUpCode),
    lenderCode: emptyToNull(data.Lenders?.PersonLookupCode),
    mortgageBrokerCode: emptyToNull(data.MortgageBrokers?.PersonLookupCode),
    payoffLenderCode: emptyToNull(data.PayoffLenders?.PersonLookupCode),
    titleCompanyCode: emptyToNull(data.TitleCompanies?.CompanyLookUpCode),
    titleOfficerName: emptyToNull(data.TitleCompanies?.PersonLookupCode),
    underwriterCompanyCode: emptyToNull(data.Underwriters?.CompanyLookUpCode),
    underwriterPersonCode: emptyToNull(data.Underwriters?.PersonLookupCode),
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
