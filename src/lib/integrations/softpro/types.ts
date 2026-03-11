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
// GetOrders returns only these four fields. GetOrderDetails returns 404.

export interface SoftProOrderItem {
  OrderNumber: string;
  OrderStatus: string;
  LastModifiedOn: string;
  CompletedDate: string;
}

// ─── Order Contacts (from GetOrderContacts) ──────────────────────────────────
// NOTE: "PreimaryBorrower" is a typo in the real API — preserved exactly.

export interface SoftProOrderContactsData {
  buyer: {
    PreimaryBorrower: string;
    SecondaryBorrower: string;
  };
  EscrowCompanies: {
    CompanyLookUpCode: string;
  };
  Lenders: {
    PersonLookupCode: string;
  };
  MortgageBrokers: {
    PersonLookupCode: string;
  };
  PayoffLenders: {
    PersonLookupCode: string;
  };
  TitleCompanies: {
    CompanyLookUpCode: string;
    PersonLookupCode: string;
  };
  Underwriters: {
    CompanyLookUpCode: string;
    PersonLookupCode: string;
  };
}

// ─── Lookup Item (from GetLookuptable) ──────────────────────────────────────
// Real field names have spaces and slashes (e.g. "Title officer/Examiner").
// Shape varies by entity type — use a flexible record.

export type SoftProLookupItem = Record<string, string>;

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

// ─── Endpoints ───────────────────────────────────────────────────────────────

export const SOFTPRO_ENDPOINTS = {
  createOrder: 'ordercreation/create',
  updateOrder: 'ordercreation/updateOrder',
  getOrderContacts: 'ordercreation/GetOrderContacts',
  uploadDocument: 'ordercreation/AddDocuments',
  getLookupTable: 'lookup/GetLookuptable',
  getSalesReps: 'ordercreation/GetOrderMarketingRep',
  getOrders: 'ordercreation/GetOrders',
  createUser: 'ordercreation/CreateUser',
  updateUser: 'ordercreation/UpdateUser',
  addNote: 'ordercreation/AddNotes',
  addCompany: 'ordercreation/AddCompany',
  updateCompany: 'ordercreation/UpdateCompany',
  getAttachedDocuments: 'ordercreation/GetAttachedDocuments',
  updateTask: 'ordercreation/AddTask',
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
