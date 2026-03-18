export const ALL_CONTACT_TYPES = [
  'escrow', 'lender', 'mortgage_broker', 'realtor',
  'title_officer', 'escrow_officer', 'sales_rep', 'agent',
] as const;

export const INTERNAL_TYPES = new Set(['title_officer', 'escrow_officer', 'sales_rep']);
