/**
 * SoftPro API response types.
 * Matched to real production API responses (not documentation).
 */

// ─── API Response Envelope ───────────────────────────────────────────────────

export interface SoftProResponse<T = unknown> {
  Status: number;
  Message: string;
  FileUploadedStatus: boolean;
  data?: T;
}

// ─── Order Item (from GetOrders) ─────────────────────────────────────────────
// GetOrders returns only these four fields — lightweight status polling.

export interface SoftProOrderItem {
  OrderNumber: string;
  OrderStatus: string;
  LastModifiedOn: string;
  CompletedDate: string;
}

// ─── Order Detail Item (from GetOrderDetails) ───────────────────────────────
// GetOrderDetails returns the full order payload including address, pricing,
// transaction type, and officer assignments.

export interface SoftProOrderDetailItem {
  OrderNumber: string;
  OrderStatus: string;
  MarketingSource: string;
  OrderType: string;
  Address: string;
  City: string;
  State: string;
  Country: string;
  /** Postal ZIP from GetOrderDetails — maps to order_properties.zip (not ProductType). */
  Zip?: string;
  TitleOfficer: string;
  EscrowOfficer?: string;
  SalesPrice: string;
  TransactionType: string;
  ProductType: string;
  ReceivedDate: string;
  CompletedDate: string;
  ModifiedDate: string;
  MarketingRep: string;
  EscrowOfficerContact?: SoftProResolvedPerson | null;
  TitleOfficerContact?: SoftProResolvedPerson | null;
}

// ─── Order Contacts (from GetOrderContacts) ──────────────────────────────────
// Sprint 1 adapter responses resolve lookup-code roles into nested objects.
// Some buyer/seller name fields remain role-specific instead of generic Name.

export interface SoftProResolvedPerson {
  LookupCode?: string | null;
  Name?: string | null;
  Email?: string | null;
  Phone?: string | null;
}

export interface SoftProResolvedCompany {
  LookupCode?: string | null;
  Name?: string | null;
  Address?: string | null;
  City?: string | null;
  State?: string | null;
  Zip?: string | null;
  Email?: string | null;
  Phone?: string | null;
}

export interface SoftProBuyerRole {
  Person?: (SoftProResolvedPerson & {
    PrimaryBorrower?: string | null;
    SecondaryBorrower?: string | null;
  }) | null;
  Company?: (SoftProResolvedCompany & {
    PrimaryBorrower?: string | null;
    SecondaryBorrower?: string | null;
  }) | null;
  PrimaryBorrower?: string | null;
  SecondaryBorrower?: string | null;
  PreimaryBorrower?: string | null;
}

export interface SoftProSellerRole {
  PrimarySeller?: string | null;
  SecondarySeller?: string | null;
  PreimarySeller?: string | null;
}

export interface SoftProResolvedRole {
  Company?: SoftProResolvedCompany | null;
  Person?: SoftProResolvedPerson | null;
  CompanyLookUpCode?: string | null;
  PersonLookupCode?: string | null;
}

export interface SoftProOrderContactsData {
  buyer: SoftProBuyerRole | null;
  Sellers: SoftProSellerRole | null;
  EscrowCompanies: SoftProResolvedRole | null;
  Lenders: SoftProResolvedRole | null;
  ListingAgentBrokers: SoftProResolvedRole | null;
  MortgageBrokers: SoftProResolvedRole | null;
  PayoffLenders: SoftProResolvedRole | null;
  TitleCompanies: SoftProResolvedRole | null;
  Underwriters: SoftProResolvedRole | null;
}

// ─── Lookup Item (from GetLookuptable) ──────────────────────────────────────
// Real field names have spaces and slashes (e.g. "Title officer/Examiner").
// Shape varies by entity type — use a flexible record.

export type SoftProLookupItem = Record<string, string>;

export interface SoftProLookupTableRequest {
  userType: string;
  modifiedSince?: string;
  Page?: number;
  pageSize?: number;
}

export interface SoftProLookupTablePage {
  items: SoftProLookupItem[];
  hasMore: boolean;
  page: number;
  pageSize: number;
  modifiedSince: string | null;
}

// Known field names for the Title Officer entity type
export const TITLE_OFFICER_FIELDS = {
  code: 'Title officer/Examiner',
  officeLookupCode: 'Office LookupCode',
  officerName: 'Officer Name',
  email: 'Email',
  rowState: 'Row State',
} as const;

// ─── Attached Document (from GetAttachedDocuments) ──────────────────────────

export type SoftProAttachedDocument = Record<string, string>;

// ─── Fee Types (from GetFees) ────────────────────────────────────────────────

export interface SoftProFeeItem {
  Description: string;
  Amount: number;
}

export interface SoftProInvoice {
  InvoiceNumber: string;
  Fees: SoftProFeeItem[];
  Total: { Amount: number };
}

export type SoftProFeeResponse = SoftProInvoice[];

// ─── Endpoints ───────────────────────────────────────────────────────────────

export const SOFTPRO_ENDPOINTS = {
  createOrder: 'ordercreation/create',
  updateOrder: 'ordercreation/updateOrder',
  getOrderContacts: 'ordercreation/GetOrderContacts',
  uploadDocument: 'ordercreation/AddDocuments',
  getLookupTable: 'lookup/GetLookuptable',
  getSalesReps: 'ordercreation/GetOrderMarketingRep',
  getOrders: 'ordercreation/GetOrders',
  getOrderDetails: 'ordercreation/GetOrderDetails',
  createUserToken: 'authentication/CreateUserToken',
  createUser: 'ordercreation/CreateUser',
  updateUser: 'ordercreation/UpdateUser',
  addNote: 'ordercreation/AddNotes',
  addCompany: 'ordercreation/AddCompany',
  updateCompany: 'ordercreation/UpdateCompany',
  getAttachedDocuments: 'ordercreation/GetAttachedDocuments',
  getFees: 'ordercreation/GetFees',
  updateTask: 'ordercreation/AddTask',
  getOrderStatus: 'ordercreation/GetOrderStatus',
} as const;

// ─── Date Parsing ────────────────────────────────────────────────────────────

/**
 * Parse SoftPro date string to JS Date.
 * Handles: 'YYYY-MM-DD' (e.g. '2024-03-05')
 *          'n/j/Y g:i:s A' (e.g. '3/26/2025 2:30:00 PM')
 *          Standard ISO strings
 *          Empty strings (returns null)
 */
export function parseSoftProDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || !dateStr.trim()) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}
