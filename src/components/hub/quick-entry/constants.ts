export const CARD = 'bg-white border border-gray-200 rounded-xl shadow-sm';

export const STEPS = ['client', 'property', 'seller', 'transaction', 'parties', 'submit'] as const;
export type Step = (typeof STEPS)[number];
export const STEP_LABELS: Record<Step, string> = {
  client: 'Client', property: 'Property', seller: 'Seller',
  transaction: 'Transaction', parties: 'Parties & Deliverables', submit: 'Review & Submit',
};

export const PARTY_MATRIX: Record<string, string[]> = {
  escrow_company:  ['buyerAgent', 'listingAgent', 'lender'],
  lender:          ['buyerAgent', 'listingAgent', 'escrow'],
  listing_agent:   ['buyerAgent', 'lender', 'escrow'],
  buyer_agent:     ['listingAgent', 'lender', 'escrow'],
  mortgage_broker: ['buyerAgent', 'listingAgent', 'escrow'],
};

export const PARTY_DEFS = [
  { key: 'buyerAgent', label: "Buyer's Agent" },
  { key: 'listingAgent', label: 'Listing Agent' },
  { key: 'lender', label: 'Lender' },
  { key: 'escrow', label: 'Escrow Company' },
] as const;

export const ROLE_SP_TYPE: Record<string, string> = {
  lender: 'Lender',
  escrow_officer: 'EscrowCompany',
  buyer_agent: 'BuyersAgent',
  listing_agent: 'ListingAgentBroker',
};

export const ALLOWED_TYPES = [
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/tiff',
];
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

export interface UploadFile { file: File; error?: string; }

export const fmtCurrency = (v: string) => {
  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n === 0) return '';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
};
