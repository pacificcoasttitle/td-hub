import { VendorResult, VendorHealthResult, vendorSuccess } from '../types';
import { SoftProOrderItem } from './types';

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

export async function healthCheck(): Promise<VendorHealthResult> {
  return { healthy: true, vendor: 'softpro-mock', latencyMs: 1 };
}
