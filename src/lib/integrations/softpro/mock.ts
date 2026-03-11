import { VendorResult, VendorHealthResult, vendorSuccess } from '../types';
import { SoftProOrderItem, SoftProLookupItem } from './types';

const MOCK_ORDERS: SoftProOrderItem[] = [
  {
    OrderNumber: '24050001GLT',
    OrderStatus: 'Open',
    MarketingSource: null,
    OrderType: 'Standard',
    Address: '123 Main St',
    City: 'Glendale',
    State: 'CA',
    Country: 'Los Angeles',
    TitleOfficer: 'Jean, Jim',
    SalesPrice: '750000',
    TransactionType: 'Purchase',
    ProductType: 'Residential',
    ReceivedDate: '5/1/2024 9:00:00 AM',
    CompletedDate: null,
    ModifiedDate: '5/1/2024 9:00:00 AM',
    MarketingRep: 'Hernandez, Jerry',
    LastModifiedOn: '05/01/2024 09:00:00 AM',
  },
  {
    OrderNumber: '24050002OCT',
    OrderStatus: 'Closed',
    MarketingSource: null,
    OrderType: 'Standard',
    Address: '456 Oak Ave',
    City: 'Orange',
    State: 'CA',
    Country: 'Orange',
    TitleOfficer: 'Smith, Rachel',
    SalesPrice: '1200000',
    TransactionType: 'Purchase',
    ProductType: 'Residential',
    ReceivedDate: '4/15/2024 10:30:00 AM',
    CompletedDate: '5/20/2024 3:15:00 PM',
    ModifiedDate: '5/25/2024 11:00:00 AM',
    MarketingRep: 'Johnson, Mike',
    LastModifiedOn: '05/25/2024 11:00:00 AM',
  },
  {
    OrderNumber: '24060001PRV',
    OrderStatus: 'Completed',
    MarketingSource: null,
    OrderType: 'Standard',
    Address: '789 Palm Dr',
    City: 'Oxnard',
    State: 'CA',
    Country: 'Ventura',
    TitleOfficer: 'Jean, Jim',
    SalesPrice: '0',
    TransactionType: 'Refinance',
    ProductType: 'Residential',
    ReceivedDate: '6/1/2024 8:00:00 AM',
    CompletedDate: '6/28/2024 2:00:00 PM',
    ModifiedDate: '6/28/2024 2:00:00 PM',
    MarketingRep: 'Hernandez, Jerry',
    LastModifiedOn: '06/28/2024 02:00:00 PM',
  },
];

export async function getOrderDetails(params: {
  dateFrom?: string;
  dateTo?: string;
  orderNumber?: string;
}): Promise<VendorResult<SoftProOrderItem[]>> {
  // Simulate network delay
  await new Promise((r) => setTimeout(r, 100));

  let filtered = [...MOCK_ORDERS];
  if (params.orderNumber) {
    filtered = filtered.filter((o) => o.OrderNumber === params.orderNumber);
  }

  return vendorSuccess(filtered, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 100 });
}

export async function getOrderStatuses(params: {
  dateFrom: string;
  dateTo: string;
}): Promise<VendorResult<SoftProOrderItem[]>> {
  await new Promise((r) => setTimeout(r, 50));
  return vendorSuccess(MOCK_ORDERS, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 50 });
}

const MOCK_LOOKUP_ITEMS: SoftProLookupItem[] = [
  {
    LookupCode: 'TO-001', FlookupCode: 'FTO-001',
    FullName: 'Jean, Jim', FirstName: 'Jim', LastName: 'Jean',
    CompanyName: 'Pacific Coast Title', OfficerName: 'Jean, Jim',
    Email: 'jjean@pctitle.com', Phone: '818-555-0101', Cell: null, Fax: null,
    Address1: '100 N Brand Blvd', Address2: null, City: 'Glendale', State: 'CA', Zip: '91203',
    AssignmentClause: null, LicenseNo: null, UserType: 'Title Officer',
  },
  {
    LookupCode: 'TO-002', FlookupCode: 'FTO-002',
    FullName: 'Smith, Rachel', FirstName: 'Rachel', LastName: 'Smith',
    CompanyName: 'Pacific Coast Title', OfficerName: 'Smith, Rachel',
    Email: 'rsmith@pctitle.com', Phone: '714-555-0202', Cell: null, Fax: null,
    Address1: '200 W Main St', Address2: null, City: 'Orange', State: 'CA', Zip: '92868',
    AssignmentClause: null, LicenseNo: null, UserType: 'Title Officer',
  },
  {
    LookupCode: 'SR-001', FlookupCode: 'FSR-001',
    FullName: 'Hernandez, Jerry', FirstName: 'Jerry', LastName: 'Hernandez',
    CompanyName: 'Pacific Coast Title', OfficerName: 'Hernandez, Jerry',
    Email: 'jhernandez@pctitle.com', Phone: '818-555-0301', Cell: '818-555-0302', Fax: null,
    Address1: '100 N Brand Blvd', Address2: null, City: 'Glendale', State: 'CA', Zip: '91203',
    AssignmentClause: null, LicenseNo: null, UserType: 'Sales Rep',
  },
  {
    LookupCode: 'SR-002', FlookupCode: 'FSR-002',
    FullName: 'Johnson, Mike', FirstName: 'Mike', LastName: 'Johnson',
    CompanyName: 'Pacific Coast Title', OfficerName: 'Johnson, Mike',
    Email: 'mjohnson@pctitle.com', Phone: '714-555-0401', Cell: null, Fax: null,
    Address1: '200 W Main St', Address2: null, City: 'Orange', State: 'CA', Zip: '92868',
    AssignmentClause: null, LicenseNo: null, UserType: 'Sales Rep',
  },
  {
    LookupCode: 'EC-001', FlookupCode: 'FEC-001',
    FullName: 'Pinnacle Escrow', FirstName: null, LastName: null,
    CompanyName: 'Pinnacle Escrow Inc', OfficerName: null,
    Email: 'info@pinnacleescrow.com', Phone: '310-555-0501', Cell: null, Fax: '310-555-0502',
    Address1: '500 Wilshire Blvd', Address2: 'Suite 300', City: 'Los Angeles', State: 'CA', Zip: '90036',
    AssignmentClause: null, LicenseNo: null, UserType: 'Escrow Company',
  },
  {
    LookupCode: 'EO-001', FlookupCode: 'FEO-001',
    FullName: 'Park, Susan', FirstName: 'Susan', LastName: 'Park',
    CompanyName: 'Pinnacle Escrow Inc', OfficerName: 'Park, Susan',
    Email: 'spark@pinnacleescrow.com', Phone: '310-555-0503', Cell: null, Fax: null,
    Address1: '500 Wilshire Blvd', Address2: 'Suite 300', City: 'Los Angeles', State: 'CA', Zip: '90036',
    AssignmentClause: null, LicenseNo: null, UserType: 'Escrow Officer',
  },
];

export async function getLookupTable(
  userType: string
): Promise<VendorResult<SoftProLookupItem[]>> {
  await new Promise((r) => setTimeout(r, 50));
  const filtered = MOCK_LOOKUP_ITEMS.filter((item) => item.UserType === userType);
  return vendorSuccess(filtered, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 50 });
}

export async function healthCheck(): Promise<VendorHealthResult> {
  return { healthy: true, vendor: 'softpro-mock', latencyMs: 1 };
}
