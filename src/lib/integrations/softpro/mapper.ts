import { SoftProOrderItem, parseSoftProDate } from './types';

/**
 * Maps a SoftPro order item to the shape needed for upserting into our orders table.
 * This is the critical translation layer between SoftPro's response format and our domain model.
 */
export interface MappedOrderData {
  fileNumber: string;
  softproStatus: string;
  operationalStatus: 'open' | 'in_process' | 'completed' | 'closed' | 'canceled' | 'duplicate';
  transactionType: string | null;
  productType: string | null;
  orderType: string | null;
  salesPrice: string | null;
  openedAt: Date | null;
  completedAt: Date | null;
  closedAt: Date | null;
  isImported: boolean;
  // Property data
  property: {
    address: string | null;
    city: string | null;
    state: string | null;
    county: string | null;   // From 'Country' field (legacy bug preserved)
    fullAddress: string | null;
  };
  // For lookup matching (not IDs — caller resolves these)
  marketingRepName: string | null;
  titleOfficerName: string | null;
}

/**
 * Map SoftPro status string to our operational status enum.
 * SoftPro statuses come mixed-case. We lowercase first, then map.
 */
function mapStatus(softproStatus: string): MappedOrderData['operationalStatus'] {
  const s = softproStatus.toLowerCase().trim();
  switch (s) {
    case 'open': return 'open';
    case 'in process':
    case 'inprocess':
    case 'in_process': return 'in_process';
    case 'completed':
    case 'clear for policy': return 'completed';
    case 'closed': return 'closed';
    case 'canceled':
    case 'cancelled': return 'canceled';
    case 'duplicate': return 'duplicate';
    default: return 'open';
  }
}

/**
 * Build a full address string from parts.
 */
function buildFullAddress(address: string | null, city: string | null, state: string | null): string | null {
  const parts = [address, city, state].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Map a single SoftPro order item to our domain format.
 */
export function mapSoftProOrder(item: SoftProOrderItem): MappedOrderData {
  const softproStatus = (item.OrderStatus ?? 'open').toLowerCase().trim();
  const operationalStatus = mapStatus(item.OrderStatus ?? 'open');

  // closedAt is only set when status is 'closed', using ModifiedDate
  const closedAt = operationalStatus === 'closed' ? parseSoftProDate(item.ModifiedDate) : null;

  return {
    fileNumber: item.OrderNumber,
    softproStatus,
    operationalStatus,
    transactionType: item.TransactionType ?? null,
    productType: item.ProductType ?? null,
    orderType: item.OrderType ?? null,
    salesPrice: item.SalesPrice ?? null,
    openedAt: parseSoftProDate(item.ReceivedDate),
    completedAt: parseSoftProDate(item.CompletedDate),
    closedAt,
    isImported: true,
    property: {
      address: item.Address ?? null,
      city: item.City ?? null,
      state: item.State ?? null,
      county: item.Country ?? null,  // 'Country' field = county (legacy bug)
      fullAddress: buildFullAddress(item.Address, item.City, item.State),
    },
    marketingRepName: item.MarketingRep ?? null,
    titleOfficerName: item.TitleOfficer ?? null,
  };
}
