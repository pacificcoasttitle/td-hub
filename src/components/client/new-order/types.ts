export type Step = 1 | 2 | 3 | 4 | 5 | 6;

export interface Person { firstName: string; middleName: string; lastName: string; }
export interface Contact { id: number; fullName: string | null; companyName: string | null; email: string | null; phone: string | null; }
export interface Profile { displayName: string; email: string; phone: string | null; company: string | null; }

export const EMPTY: Person = { firstName: '', middleName: '', lastName: '' };

export const STEPS = [
  { n: 1 as Step, label: 'Your Details' },
  { n: 2 as Step, label: 'Property' },
  { n: 3 as Step, label: 'Seller' },
  { n: 4 as Step, label: 'Transaction' },
  { n: 5 as Step, label: 'Parties' },
  { n: 6 as Step, label: 'Review' },
];

export const ORDER_TYPES = [
  { value: 'title_only', label: 'Title Only', sub: 'Title search & insurance' },
  { value: 'title_escrow', label: 'Title & Escrow', sub: 'Full title and escrow' },
  { value: 'escrow_only', label: 'Escrow Only', sub: 'Escrow services only' },
] as const;

export const UNDERWRITERS = [
  { value: '', label: 'Select…' },
  { value: 'westcor', label: 'Westcor' },
  { value: 'fnf', label: 'FNF / Commonwealth' },
  { value: 'natic', label: 'NATIC' },
];

export const ORG_TYPES = ['LLC', 'Corporation', 'Partnership', 'Trust', 'Other'];

export const CLIENT_TYPES = [
  { value: '', label: 'Select your role…' },
  { value: 'escrow_company', label: 'Escrow Company' },
  { value: 'lender', label: 'Lender' },
  { value: 'listing_agent', label: 'Listing Agent / Broker' },
  { value: 'mortgage_broker', label: 'Mortgage Broker' },
];

export const TRANSACTION_TYPES = [
  { value: '', label: 'Select…' },
  { value: 'Purchase', label: 'Purchase' },
  { value: 'Refinance', label: 'Refinance' },
  { value: 'Equity', label: 'Equity' },
  { value: 'Other', label: 'Other' },
];

export interface FormOption { value: string; label: string; }

export interface FormOptions {
  productTypes: FormOption[];
  orderTypes: FormOption[];
  salesReps: FormOption[];
  titleOfficers: FormOption[];
  escrowOfficers: FormOption[];
}

export interface ClientDetails {
  clientType: string;
  emailNotifications: boolean;
}

export interface PropertyData {
  street: string;
  city: string;
  state: string;
  zip: string;
  placeId: string;
  apn: string;
  county: string;
  legalDescription: string;
  propertyType: string;
  unitNumber: string;
  siteXFilled: boolean;
  searchMode: 'address' | 'apn';
}

export interface SellerData {
  primary: Person;
  secondary: Person;
  hasSecondary: boolean;
  isOrg: boolean;
  orgType: string;
  siteXFilled: boolean;
}

export interface PartyContact {
  name: string;
  email: string;
  phone: string;
  company: string;
}

export interface TransactionData {
  transactionType: string;
  productType: string;
  orderType: string;
  salesRep: string;
  titleOfficer: string;
  escrowNumber: string;
  salesAmount: string;
  loanNumber: string;
  loanAmount: string;
  coverageAmount: string;
  primaryBorrower: Person;
  secondaryBorrower: Person;
  hasSecondaryBorrower: boolean;
  borrowerIsOrg: boolean;
  borrowerOrgType: string;
}

export interface PartiesData {
  showAgents: boolean;
  buyerAgent: PartyContact;
  listingAgent: PartyContact;
  showLender: boolean;
  lender: PartyContact;
  showEscrow: boolean;
  escrow: PartyContact;
  showEscrowOfficer: boolean;
  escrowOfficer: string;
  deliverableEmails: string[];
}

export const EMPTY_PARTY: PartyContact = { name: '', email: '', phone: '', company: '' };

export const IN = 'w-full h-12 px-3 border border-[#E5E7EB] rounded-lg text-sm text-[#1B2A4A] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/20 focus:border-[#F26B2B] bg-white';
export const SEL = IN;
