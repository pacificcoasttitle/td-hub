import { formatOrderDate } from './date-format';
import { formatOrderAddress, type OrderAddressParts } from './order-format';
import { statusBadge } from './status-format';

export interface ListRowContact {
  fullName?: string | null;
  officerName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
}

export interface ListRowSource {
  id: number;
  fileNumber: string;
  operationalStatus: string | null;
  transactionType?: string | null;
  orderType?: string | null;
  productType?: string | null;
  openedAt?: Date | string | null;
  closedAt?: Date | string | null;
  salesPrice?: number | string | null;
  source?: string | null;
  emailStatus?: string | null;
  dupOverride?: boolean | null;
  property?: OrderAddressParts | null;
  salesRep?: ListRowContact | null;
  clientContact?: ListRowContact | null;
  clientContactId?: number | null;
  createdByName?: string | null;
  documents?: unknown;
  extras?: Record<string, unknown>;
}

export interface ListRow {
  id: number;
  fileNumber: string;
  operationalStatus: string | null;
  status: {
    value: string | null;
    label: string;
    color: string;
  };
  transactionType: string | null;
  orderType: string | null;
  productType: string | null;
  type: string;
  openedAt: string;
  /**
   * The raw instant, alongside the already-formatted `openedAt`.
   *
   * `openedAt` is a display string ("Aug 24, 2026") and cannot be re-parsed
   * into a time of day, which the split view's day dividers and 4:12p column
   * both need. Additive: no existing consumer changes.
   */
  openedAtIso: string | null;
  closedAt: string;
  address: string | null;
  city: string | null;
  state: string | null;
  propertyStreet: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  property: (OrderAddressParts & { address: string | null; city: string | null; state: string | null; zip: string | null }) | null;
  salesPrice?: number | string | null;
  salesRepName: string | null;
  clientContactId?: number | null;
  clientName: string | null;
  clientCompany: string | null;
  clientEmail?: string | null;
  createdByName?: string | null;
  source?: string | null;
  emailStatus?: string | null;
  dupOverride?: boolean | null;
  documents?: unknown;
  [key: string]: unknown;
}

export function contactName(contact: ListRowContact | null | undefined): string | null {
  if (!contact) return null;
  if (clean(contact.fullName)) return clean(contact.fullName);
  if (clean(contact.officerName)) return clean(contact.officerName);
  const nameParts = [clean(contact.firstName), clean(contact.lastName)].filter(Boolean);
  if (nameParts.length > 0) return nameParts.join(' ');
  return clean(contact.companyName);
}

export function clientName(contact: ListRowContact | null | undefined): string | null {
  return contactName(contact);
}

export function orderTypeLabel(order: Pick<ListRowSource, 'transactionType' | 'orderType' | 'productType'>): string {
  return clean(order.transactionType) ?? clean(order.orderType) ?? clean(order.productType) ?? '—';
}

export function projectListRow(source: ListRowSource): ListRow {
  const property = normalizeProperty(source.property);
  const status = source.operationalStatus ? statusBadge(source.operationalStatus) : statusBadge(null);
  const client = source.clientContact ?? null;

  return {
    ...(source.extras ?? {}),
    id: source.id,
    fileNumber: source.fileNumber,
    operationalStatus: source.operationalStatus,
    status: {
      value: source.operationalStatus,
      label: status.label,
      color: status.color,
    },
    transactionType: source.transactionType ?? null,
    orderType: source.orderType ?? null,
    productType: source.productType ?? null,
    type: orderTypeLabel(source),
    openedAt: formatOrderDate(source.openedAt),
    openedAtIso: toIsoInstant(source.openedAt),
    closedAt: formatOrderDate(source.closedAt),
    address: property?.address ?? null,
    city: property?.city ?? null,
    state: property?.state ?? null,
    propertyStreet: property?.address ?? null,
    propertyCity: property?.city ?? null,
    propertyState: property?.state ?? null,
    propertyZip: property?.zip ?? null,
    property,
    salesPrice: source.salesPrice,
    salesRepName: contactName(source.salesRep),
    clientContactId: source.clientContactId,
    clientName: clientName(client),
    clientCompany: clean(client?.companyName),
    clientEmail: clean(client?.email),
    createdByName: source.createdByName ?? undefined,
    source: source.source ?? undefined,
    emailStatus: source.emailStatus ?? undefined,
    dupOverride: source.dupOverride ?? undefined,
    documents: source.documents,
  };
}

function normalizeProperty(property: OrderAddressParts | null | undefined): ListRow['property'] {
  if (!property) return null;
  return {
    ...property,
    address: property.address ?? property.line1 ?? property.street ?? property.propertyStreet ?? null,
    city: property.city ?? property.propertyCity ?? null,
    state: property.state ?? property.propertyState ?? null,
    zip: property.zip ?? property.propertyZip ?? null,
    fullAddress: formatOrderAddress(property),
  };
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Null rather than a placeholder for a missing or unparseable date.
 *
 * `formatOrderDate` answers with an em-dash so a table cell always has
 * something to draw; this one is consumed by date arithmetic, where a string
 * that is not a date is worse than nothing.
 */
function toIsoInstant(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
