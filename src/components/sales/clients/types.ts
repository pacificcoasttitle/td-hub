export interface CrmBusinessSummary {
  orderCount: number;
  lastOpenedAt: string | null;
  lastClosedAt: string | null;
}

export interface CrmClient {
  id: number;
  ownerProfileId: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  /** agent | lender | escrow | title | other, or null when unclassified. */
  type: string | null;
  contactId: number | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  business?: CrmBusinessSummary | null;
  latestNote?: { body: string; createdAt: string } | null;
}

export interface CrmNote {
  id: number;
  body: string;
  createdAt: string;
  authorProfileId: string;
  authorName: string | null;
}

export interface CrmBusinessOrder {
  id: number;
  fileNumber: string;
  operationalStatus: string | null;
  transactionType: string | null;
  openedAt: string | null;
  closedAt: string | null;
  salesPrice: string | null;
}

export interface ContactSuggestion {
  id: number;
  fullName: string | null;
  companyName: string | null;
  email: string | null;
  matchedBy: 'email' | 'name';
}

export interface ClientListResponse {
  clients: CrmClient[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ClientDetailResponse {
  client: CrmClient;
  notes: CrmNote[];
  business: CrmBusinessOrder[];
  suggestions: ContactSuggestion[];
}
