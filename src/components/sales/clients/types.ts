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
  /** Derived on read: prior business but no order in the quiet window. */
  isQuiet?: boolean;
  /** Triage signal from the metrics engine — gone-quiet / momentum / trend. */
  signal?: CrmSignal | null;
  lastOrderAt?: string | null;
}

export interface CrmSignal {
  kind: 'quiet' | 'momentum' | 'declining' | 'steady' | 'unknown';
  tone: 'success' | 'warning' | 'neutral' | 'muted';
  label: string;
  detail: string | null;
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
  /** Quiet clients across the whole scoped list, not just this page. */
  quietCount?: number;
  quietAfterMonths?: number;
}

/** Wire shape of ClientOrderMetrics — Dates arrive as ISO strings over JSON. */
export interface CrmClientMetrics {
  clientId: number;
  contactId: number | null;
  computedAt: string;
  unlinked: boolean;
  counts: {
    thisMonth: number;
    last90: number;
    prior90: number;
    same90LastYear: number;
    open: number;
    total: number;
  };
  recency: {
    lastOrderAt: string | null;
    daysSinceLastOrder: number | null;
    firstOrderAt: string | null;
  };
  rate: {
    avgMonthlyOrders: number | null;
    monthsObserved: number;
  };
  trend: {
    direction: 'up' | 'flat' | 'down' | 'not_enough_history';
    changePct: number | null;
    basis: string;
    confidence: 'high' | 'low' | 'none';
  };
  confidence: {
    attribution: 'high' | 'low' | 'none';
    clientIdentity: 'high' | 'low' | 'none';
    trend: 'high' | 'low' | 'none';
    openOrders: 'high' | 'low' | 'none';
  };
}

export interface MonthBucket {
  month: string;
  orders: number;
}

export interface CompanyContact {
  id: number;
  fullName: string | null;
  email: string | null;
  companyName: string | null;
  orderCount: number;
}

export interface ClientDetailResponse {
  client: CrmClient;
  notes: CrmNote[];
  business: CrmBusinessOrder[];
  metrics: CrmClientMetrics;
  signal: CrmSignal;
  ordersByMonth: MonthBucket[];
  companyContacts: CompanyContact[];
  suggestions: ContactSuggestion[];
}
