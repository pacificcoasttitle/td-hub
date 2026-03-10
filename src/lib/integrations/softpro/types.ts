/**
 * SoftPro API response types.
 * Derived from legacy Cron.php::fetchSoftproOrders() and constants.php SOFTPRO_API_END.
 */

// ─── API Response Envelope ───────────────────────────────────────────────────

export interface SoftProResponse<T = unknown> {
  Status: number;
  Message: string;
  data?: T;
  OrderNumber?: string;
}

// ─── Order Item (from GetOrderDetails) ───────────────────────────────────────

export interface SoftProOrderItem {
  OrderNumber: string;
  OrderStatus: string;
  MarketingSource: string | null;
  OrderType: string | null;
  Address: string | null;
  City: string | null;
  State: string | null;
  Country: string | null;       // NOTE: Actually contains county name (legacy bug, preserved)
  TitleOfficer: string | null;
  SalesPrice: string | null;
  TransactionType: string | null;
  ProductType: string | null;
  ReceivedDate: string | null;
  CompletedDate: string | null;  // Format: 'n/j/Y g:i:s A' e.g. '3/26/2025 2:30:00 PM'
  ModifiedDate: string | null;   // Same format
  MarketingRep: string | null;
  LastModifiedOn: string | null;
}

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
  createUser: 'ordercreation/CreateUser',
  updateUser: 'ordercreation/UpdateUser',
  addNote: 'ordercreation/AddNotes',
  addCompany: 'ordercreation/AddCompany',
  updateCompany: 'ordercreation/UpdateCompany',
  getPrelimDocuments: 'ordercreation/GetAttachedDocuments',
  updateTask: 'ordercreation/AddTask',
} as const;

// ─── Date Parsing ────────────────────────────────────────────────────────────

/**
 * Parse SoftPro date string to JS Date.
 * Handles: 'n/j/Y g:i:s A' (e.g. '3/26/2025 2:30:00 PM')
 *          'm/d/Y h:i:s A' (e.g. '03/26/2025 02:30:00 PM')
 *          Standard ISO strings
 */
export function parseSoftProDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || !dateStr.trim()) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}
