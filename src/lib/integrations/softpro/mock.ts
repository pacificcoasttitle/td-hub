import { VendorResult, VendorHealthResult, vendorSuccess } from '../types';
import {
  SoftProOrderItem,
  SoftProOrderContactsData,
  SoftProLookupItem,
  SoftProAttachedDocument,
  SoftProFeeResponse,
} from './types';

// ─── Mock Orders (matches real GetOrders response shape) ────────────────────

const MOCK_ORDERS: SoftProOrderItem[] = [
  {
    OrderNumber: '20003483-GLT',
    OrderStatus: 'Open',
    LastModifiedOn: '2024-03-05',
    CompletedDate: '',
  },
  {
    OrderNumber: '20003484-OCT',
    OrderStatus: 'Closed',
    LastModifiedOn: '2024-05-25',
    CompletedDate: '2024-05-20',
  },
  {
    OrderNumber: '20003485-PRV',
    OrderStatus: 'Completed',
    LastModifiedOn: '2024-06-28',
    CompletedDate: '2024-06-28',
  },
];

// ─── Mock Order Contacts (matches real GetOrderContacts shape) ──────────────

const MOCK_ORDER_CONTACTS: Record<string, SoftProOrderContactsData> = {
  '20003483-GLT': {
    buyer: { PreimaryBorrower: 'Joel S Cruz Pablo', SecondaryBorrower: 'Maria Sebastian' },
    Sellers: { PreimarySeller: 'Gerardo J Hernandez', SecondarySeller: 'Yessica S Mendoza' },
    EscrowCompanies: { CompanyLookUpCode: 'TheE2327', PersonLookupCode: 'FayMazCen1' },
    Lenders: { CompanyLookUpCode: '', PersonLookupCode: '' },
    ListingAgentBrokers: { CompanyLookUpCode: 'C&C1475', PersonLookupCode: 'LilPinC&C1' },
    BuyersAgentBrokers: {
      Person: { Name: 'Leonard Bustos' },
      Company: { Name: 'Moving Results Realty' },
    },
    MortgageBrokers: { PersonLookupCode: '' },
    PayoffLenders: { PersonLookupCode: '' },
    TitleCompanies: { CompanyLookUpCode: 'OCT', PersonLookupCode: 'Angeline Wu' },
    Underwriters: { CompanyLookUpCode: 'WC', PersonLookupCode: '' },
  },
  '20003484-OCT': {
    buyer: { PreimaryBorrower: 'Jane Smith', SecondaryBorrower: '' },
    Sellers: { PreimarySeller: 'John Doe', SecondarySeller: '' },
    EscrowCompanies: { CompanyLookUpCode: 'PinE1234', PersonLookupCode: '' },
    Lenders: { CompanyLookUpCode: 'WF', PersonLookupCode: 'WF-001' },
    ListingAgentBrokers: { CompanyLookUpCode: '', PersonLookupCode: '' },
    BuyersAgentBrokers: { CompanyLookUpCode: '', PersonLookupCode: '' },
    MortgageBrokers: { PersonLookupCode: '' },
    PayoffLenders: { PersonLookupCode: '' },
    TitleCompanies: { CompanyLookUpCode: 'GLT', PersonLookupCode: 'Jim Jean' },
    Underwriters: { CompanyLookUpCode: 'WC', PersonLookupCode: '' },
  },
};

const EMPTY_CONTACTS: SoftProOrderContactsData = {
  buyer: { PreimaryBorrower: '', SecondaryBorrower: '' },
  Sellers: { PreimarySeller: '', SecondarySeller: '' },
  EscrowCompanies: { CompanyLookUpCode: '', PersonLookupCode: '' },
  Lenders: { CompanyLookUpCode: '', PersonLookupCode: '' },
  ListingAgentBrokers: { CompanyLookUpCode: '', PersonLookupCode: '' },
  BuyersAgentBrokers: { CompanyLookUpCode: '', PersonLookupCode: '' },
  MortgageBrokers: { PersonLookupCode: '' },
  PayoffLenders: { PersonLookupCode: '' },
  TitleCompanies: { CompanyLookUpCode: '', PersonLookupCode: '' },
  Underwriters: { CompanyLookUpCode: '', PersonLookupCode: '' },
};

// ─── Mock Lookup Items (real field names with spaces/slashes) ───────────────

const MOCK_LOOKUP_ITEMS: Record<string, SoftProLookupItem[]> = {
  'Title Officer': [
    {
      'Title officer/Examiner': 'PCT\\cvirata',
      'Office LookupCode': 'OCT',
      'Officer Name': 'Clive Virata',
      'Email': 'unit66@pct.com',
      'Row State': 'Unchanged',
    },
    {
      'Title officer/Examiner': 'PCT\\jjean',
      'Office LookupCode': 'GLT',
      'Officer Name': 'Jim Jean',
      'Email': 'jjean@pctitle.com',
      'Row State': 'Unchanged',
    },
  ],
};

// ─── Mock Attached Documents ────────────────────────────────────────────────

const MOCK_ATTACHED_DOCUMENTS: Record<string, SoftProAttachedDocument[]> = {
  '20003483-GLT': [
    { DocumentName: 'Preliminary Title Report', FileName: 'prelim_20003483.pdf', FolderName: 'Title' },
  ],
};

// ─── Public Mock API ────────────────────────────────────────────────────────

export async function getOrders(params: {
  dateFrom: string;
  dateTo: string;
}): Promise<VendorResult<SoftProOrderItem[]>> {
  void params;
  await new Promise((r) => setTimeout(r, 50));
  return vendorSuccess(MOCK_ORDERS, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 50 });
}

export async function getOrderContacts(
  orderNumber: string
): Promise<VendorResult<SoftProOrderContactsData>> {
  await new Promise((r) => setTimeout(r, 50));
  const contacts = MOCK_ORDER_CONTACTS[orderNumber] ?? EMPTY_CONTACTS;
  return vendorSuccess(contacts, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 50 });
}

export async function getAttachedDocuments(
  orderNumber: string
): Promise<VendorResult<SoftProAttachedDocument[]>> {
  await new Promise((r) => setTimeout(r, 50));
  const docs = MOCK_ATTACHED_DOCUMENTS[orderNumber] ?? [];
  return vendorSuccess(docs, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 50 });
}

export async function getLookupTable(
  userType: string
): Promise<VendorResult<SoftProLookupItem[]>>;
export async function getLookupTable(
  params: import('./types').SoftProLookupTableRequest
): Promise<VendorResult<import('./types').SoftProLookupTablePage>>;
export async function getLookupTable(
  input: string | import('./types').SoftProLookupTableRequest
): Promise<VendorResult<SoftProLookupItem[] | import('./types').SoftProLookupTablePage>> {
  await new Promise((r) => setTimeout(r, 50));
  const userType = typeof input === 'string' ? input : input.userType;
  const items = MOCK_LOOKUP_ITEMS[userType] ?? [];
  if (typeof input === 'string') {
    return vendorSuccess(items, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 50 });
  }

  const page = input.Page ?? 1;
  const pageSize = input.pageSize ?? 1000;
  const start = (page - 1) * pageSize;
  const pagedItems = items.slice(start, start + pageSize);
  return vendorSuccess({
    items: pagedItems,
    hasMore: start + pageSize < items.length,
    page,
    pageSize,
    modifiedSince: input.modifiedSince ?? null,
  }, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 50 });
}

export async function addNotes(
  _orderNumber: string,
  _text: string,
  noteId?: string,
): Promise<VendorResult<Array<{ Status: number; Message: string; Id?: string }>>> {
  await new Promise((r) => setTimeout(r, 30));
  return vendorSuccess([{
    Status: 200,
    Message: 'Note added successfully to the file',
    Id: noteId,
  }], { requestId: 'mock-' + crypto.randomUUID(), durationMs: 30 });
}

export async function getFees(
  _orderNumber: string,
): Promise<VendorResult<SoftProFeeResponse>> {
  void _orderNumber;
  await new Promise((r) => setTimeout(r, 40));
  const mockFees: SoftProFeeResponse = [
    {
      InvoiceNumber: 'INV-MOCK-001',
      Fees: [
        { Description: 'Title Search Fee', Amount: 250.00 },
        { Description: 'Recording Fee', Amount: 150.00 },
        { Description: 'Escrow Fee', Amount: 475.00 },
        { Description: 'Notary Fee', Amount: 50.00 },
      ],
      Total: { Amount: 925.00 },
    },
  ];
  return vendorSuccess(mockFees, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 40 });
}

export async function healthCheck(): Promise<VendorHealthResult> {
  return { healthy: true, vendor: 'softpro-mock', latencyMs: 1 };
}
