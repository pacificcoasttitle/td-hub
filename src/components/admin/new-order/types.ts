export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export interface Branch {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
}

export interface ContactResult {
  id: number;
  fullName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
}

export interface OrderTypeData {
  orderType: 'title_only' | 'title_escrow' | 'escrow_only';
  rushOrder: boolean;
  branchId: number | null;
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
  siteXLoading: boolean;
}

export interface PartyPerson {
  firstName: string;
  middleName: string;
  lastName: string;
}

export interface PartiesData {
  seller: PartyPerson;
  secondarySeller: PartyPerson;
  hasSecondarySeller: boolean;
  buyer: PartyPerson;
  secondaryBuyer: PartyPerson;
  hasSecondaryBuyer: boolean;
  buyerIsOrg: boolean;
  orgType: string;
}

export interface TransactionData {
  transactionType: 'Purchase' | 'Refinance' | 'Equity' | 'Other' | '';
  productType: string;
  escrowNumber: string;
  salesAmount: string;
  loanNumber: string;
  loanAmount: string;
  coverageAmount: string;
  underwriter: string;
}

export interface ContactsData {
  escrowCompany: ContactResult | null;
  lender: ContactResult | null;
  buyerAgent: ContactResult | null;
  listingAgent: ContactResult | null;
  titleOfficer: ContactResult | null;
}

export interface SubmitResult {
  type: 'success' | 'error';
  message: string;
  fileNumber?: string;
  orderId?: number;
  titlePointTriggered?: boolean;
}
