import { db } from '@/lib/db/client';
import {
  contacts,
  documents,
  orderParties,
  orderProperties,
  orderStatusHistory,
  orders,
  profiles,
  titlePointData,
} from '@/lib/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { formatOrderDate } from './date-format';
import { formatCounty, formatOrderAddress, formatOrderMoney } from './order-format';
import { statusBadge } from './status-format';
import { contactDisplayName } from './detail-helpers';

const salesRepContact = alias(contacts, 'read_model_sales_rep');
const titleOfficerContact = alias(contacts, 'read_model_title_officer');
const escrowOfficerContact = alias(contacts, 'read_model_escrow_officer');
const createdByProfile = alias(profiles, 'read_model_created_by_profile');

const PARTY_ROLE_ORDER = [
  'buyer',
  'seller',
  'borrower',
  'lender',
  'lender_contact',
  'buyer_agent',
  'listing_agent',
  'escrow_company',
  'other',
] as const;

export type OrderReadModelVisibilityPolicy = 'internal' | 'staff' | 'client';
export type OrderMilestoneKey = 'opened' | 'prelim' | 'recording' | 'disbursement' | 'closed';
export type OrderMilestoneState = 'complete' | 'in_progress' | 'pending';

/**
 * Canonical, formatted order read model for Phase 3 consumers.
 *
 * Raw order facts are loaded once, then status, dates, money, address, county,
 * documents, parties, assignments, and milestones are derived here. Consumers
 * should call applyVisibility() for layer-specific redaction instead of
 * re-querying or re-formatting fields locally.
 */
export interface OrderReadModelStatusHistoryEntry {
  id: number;
  status: string;
  source: string;
  notes: string | null;
  /** ISO timestamp for wire consumers that re-format (full page History tab). */
  changedAt: string;
}

export interface OrderReadModel {
  id: number;
  fileNumber: string;
  escrowNumber: string | null;
  source: string | null;
  marketingSource: string | null;
  status: { value: string; label: string; color: string };
  /** SoftPro operational mirror — staff surfaces (full page). */
  softproStatus: string | null;
  softproLastSyncedAt: string | null;
  isImported: boolean;
  branchId: number | null;
  lenderId: number | null;
  underwriterId: number | null;
  escrowOfficerId: number | null;
  listingAgentId: number | null;
  transactionType: string | null;
  productType: string | null;
  orderType: string | null;
  property: {
    addressFormatted: string;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    county: string;
    apn: string | null;
    legalDescription: string | null;
    propertyType: string | null;
    primaryOwner: string | null;
    secondaryOwner: string | null;
  };
  financials: {
    salesPriceFormatted: string;
    loanAmountFormatted: string;
    premiumFormatted: string;
    /** Raw DB values for forms / CPL (not display-formatted). */
    salesPrice: string | null;
    loanAmount: string | null;
  };
  dates: {
    openedAt: string;
    closedAt: string;
    completedAt: string;
    receivedAt: string;
    /** ISO timestamps for consumers that call formatOrderDate themselves. */
    openedAtIso: string | null;
    closedAtIso: string | null;
    completedAtIso: string | null;
    createdAtIso: string | null;
    updatedAtIso: string | null;
  };
  parties: OrderReadModelParty[];
  relatedParties: {
    titleCompany: OrderReadModelParty | null;
    underwriter: OrderReadModelParty | null;
  };
  assignments: {
    escrowOfficer: OrderReadModelAssignment | null;
    titleOfficer: OrderReadModelAssignment | null;
    salesRep: OrderReadModelAssignment | null;
    createdBy: OrderReadModelAssignment | null;
  };
  documents: OrderReadModelDocuments;
  milestones: OrderReadModelMilestone[];
  /** Real order_status_history (not milestones). Newest-first for timeline UIs. */
  statusHistory: OrderReadModelStatusHistoryEntry[];
}

export interface OrderReadModelParty {
  role: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface OrderReadModelAssignment {
  id?: string | number | null;
  name: string | null;
  email: string | null;
  phone?: string | null;
}

export interface OrderReadModelDocuments {
  active: Array<{
    id: number;
    filename: string;
    category: string;
    sizeBytes: number | null;
    createdAt: string;
  }>;
  activeByCategory: Record<string, {
    count: number;
    latestId: number | null;
    latestFilename: string | null;
    latestCreatedAt: string;
  }>;
  prelimAvailable: boolean;
  activeCount: number;
}

export interface OrderReadModelMilestone {
  key: OrderMilestoneKey;
  label: string;
  state: OrderMilestoneState;
  date: string;
  documentId: number | null;
}

export interface OrderReadModelData {
  order: {
    id: number;
    fileNumber: string;
    escrowNumber: string | null;
    source: string | null;
    marketingSource: string | null;
    operationalStatus: string;
    softproStatus?: string | null;
    softproLastSyncedAt?: Date | string | null;
    isImported?: boolean | null;
    branchId?: number | null;
    lenderId?: number | null;
    underwriterId?: number | null;
    escrowOfficerId?: number | null;
    listingAgentId?: number | null;
    transactionType: string | null;
    productType: string | null;
    orderType: string | null;
    salesPrice: number | string | null;
    loanAmount: number | string | null;
    premium: number | string | null;
    openedAt: Date | string | null;
    closedAt: Date | string | null;
    completedAt: Date | string | null;
    receivedAt: Date | string | null;
    updatedAt?: Date | string | null;
  };
  property: {
    address: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    county: string | null;
    apn: string | null;
    legalDescription: string | null;
    propertyType: string | null;
    fullAddress: string | null;
    primaryOwner?: string | null;
    secondaryOwner?: string | null;
  } | null;
  parties: OrderReadModelPartySource[];
  assignments: {
    escrowOfficer: OrderReadModelAssignment | null;
    titleOfficer: OrderReadModelAssignment | null;
    salesRep: OrderReadModelAssignment | null;
    createdBy: OrderReadModelAssignment | null;
  };
  documents: OrderReadModelDocumentSource[];
  statusHistory: OrderReadModelStatusSource[];
  titleSearchCompletedAt: Date | string | null;
}

export interface OrderReadModelPartySource {
  role: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean | null;
  createdAt?: Date | string | null;
  id?: number | null;
}

export interface OrderReadModelDocumentSource {
  id: number;
  category: string;
  filename: string;
  sizeBytes?: number | null;
  createdAt: Date | string | null;
}

export interface OrderReadModelStatusSource {
  id?: number | null;
  status: string;
  source?: string | null;
  notes: string | null;
  changedAt: Date | string | null;
}

export async function getOrderReadModel(orderId: number): Promise<OrderReadModel | null> {
  const data = await loadOrderReadModelData(orderId);
  return data ? buildOrderReadModel(data) : null;
}

export function buildOrderReadModel(data: OrderReadModelData): OrderReadModel {
  const status = statusBadge(data.order.operationalStatus);

  return {
    id: data.order.id,
    fileNumber: data.order.fileNumber,
    escrowNumber: data.order.escrowNumber,
    source: data.order.source,
    marketingSource: data.order.marketingSource,
    status: {
      value: data.order.operationalStatus,
      label: status.label,
      color: status.color,
    },
    softproStatus: data.order.softproStatus ?? null,
    softproLastSyncedAt: toIso(data.order.softproLastSyncedAt),
    isImported: Boolean(data.order.isImported),
    branchId: data.order.branchId ?? null,
    lenderId: data.order.lenderId ?? null,
    underwriterId: data.order.underwriterId ?? null,
    escrowOfficerId: data.order.escrowOfficerId ?? null,
    listingAgentId: data.order.listingAgentId ?? null,
    transactionType: data.order.transactionType,
    productType: data.order.productType,
    orderType: data.order.orderType,
    property: {
      addressFormatted: formatOrderAddress(data.property),
      line1: data.property?.address ?? null,
      line2: data.property?.line2 ?? null,
      city: data.property?.city ?? null,
      state: data.property?.state ?? null,
      zip: data.property?.zip ?? null,
      county: formatCounty(data.property?.county),
      apn: data.property?.apn ?? null,
      legalDescription: data.property?.legalDescription ?? null,
      propertyType: data.property?.propertyType ?? null,
      primaryOwner: data.property?.primaryOwner ?? null,
      secondaryOwner: data.property?.secondaryOwner ?? null,
    },
    financials: {
      salesPriceFormatted: formatOrderMoney(data.order.salesPrice),
      loanAmountFormatted: formatOrderMoney(data.order.loanAmount),
      premiumFormatted: formatOrderMoney(data.order.premium),
      salesPrice: rawMoney(data.order.salesPrice),
      loanAmount: rawMoney(data.order.loanAmount),
    },
    dates: {
      openedAt: formatOrderDate(data.order.openedAt),
      closedAt: formatOrderDate(data.order.closedAt),
      completedAt: formatOrderDate(data.order.completedAt),
      receivedAt: formatOrderDate(data.order.receivedAt),
      openedAtIso: toIso(data.order.openedAt),
      closedAtIso: toIso(data.order.closedAt),
      completedAtIso: toIso(data.order.completedAt),
      createdAtIso: toIso(data.order.receivedAt),
      updatedAtIso: toIso(data.order.updatedAt ?? data.order.receivedAt),
    },
    parties: orderPartiesCanonically(data.parties),
    relatedParties: {
      titleCompany: explicitOtherParty(data.parties, true),
      underwriter: explicitOtherParty(data.parties, false),
    },
    assignments: data.assignments,
    documents: summarizeActiveDocuments(data.documents),
    milestones: deriveOrderMilestones(data),
    statusHistory: [...data.statusHistory]
      .map((entry, index) => ({
        id: entry.id ?? index + 1,
        status: entry.status,
        source: entry.source ?? 'system',
        notes: entry.notes,
        changedAt: toIso(entry.changedAt) ?? '',
      }))
      .filter((entry) => entry.changedAt)
      .sort((a, b) => toTime(b.changedAt) - toTime(a.changedAt)),
  };
}

function redactPartyContact(party: OrderReadModelParty): OrderReadModelParty {
  return {
    ...party,
    email: null,
    phone: null,
  };
}

export function applyVisibility(
  model: OrderReadModel,
  policy: OrderReadModelVisibilityPolicy,
): OrderReadModel {
  if (policy === 'internal' || policy === 'staff') return model;

  // Client policy: keep party names/roles/company; redact contact + staff fields.
  return {
    ...model,
    source: null,
    marketingSource: null,
    softproStatus: null,
    softproLastSyncedAt: null,
    branchId: null,
    lenderId: null,
    underwriterId: null,
    escrowOfficerId: null,
    listingAgentId: null,
    property: {
      ...model.property,
      apn: null,
      legalDescription: null,
      primaryOwner: null,
      secondaryOwner: null,
    },
    financials: {
      salesPriceFormatted: '—',
      loanAmountFormatted: '—',
      premiumFormatted: '—',
      salesPrice: null,
      loanAmount: null,
    },
    parties: model.parties.map(redactPartyContact),
    relatedParties: {
      titleCompany: model.relatedParties.titleCompany
        ? redactPartyContact(model.relatedParties.titleCompany)
        : null,
      underwriter: model.relatedParties.underwriter
        ? redactPartyContact(model.relatedParties.underwriter)
        : null,
    },
    assignments: {
      escrowOfficer: null,
      titleOfficer: null,
      salesRep: null,
      createdBy: null,
    },
    statusHistory: [],
  };
}

export function summarizeActiveDocuments(docs: OrderReadModelDocumentSource[]): OrderReadModelDocuments {
  const activeByCategory: OrderReadModelDocuments['activeByCategory'] = {};
  for (const doc of docs) {
    const existing = activeByCategory[doc.category];
    const createdAt = formatOrderDate(doc.createdAt);
    const currentTime = toTime(doc.createdAt);
    const existingSource = existing
      ? docs.find((candidate) => candidate.id === existing.latestId)
      : null;
    const existingTime = toTime(existingSource?.createdAt ?? null);

    if (!existing) {
      activeByCategory[doc.category] = {
        count: 1,
        latestId: doc.id,
        latestFilename: doc.filename,
        latestCreatedAt: createdAt,
      };
      continue;
    }

    existing.count += 1;
    if (currentTime >= existingTime) {
      existing.latestId = doc.id;
      existing.latestFilename = doc.filename;
      existing.latestCreatedAt = createdAt;
    }
  }

  return {
    active: docs.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      category: doc.category,
      sizeBytes: doc.sizeBytes ?? null,
      createdAt: formatOrderDate(doc.createdAt),
    })),
    activeByCategory,
    prelimAvailable: Boolean(activeByCategory.prelim?.count),
    activeCount: docs.length,
  };
}

export function deriveOrderMilestones(data: OrderReadModelData): OrderReadModelMilestone[] {
  const firstPrelim = firstDocument(data.documents, 'prelim');
  const recordingDate = firstStatusDate(data.statusHistory, /recording/i);
  const disbursementDate = firstStatusDate(data.statusHistory, /disbursement|funds?\s+disbursed/i);
  const closedDate = data.order.closedAt;

  const completion: Record<OrderMilestoneKey, Date | string | null> = {
    opened: data.order.openedAt,
    prelim: firstPrelim?.createdAt ?? null,
    recording: recordingDate,
    disbursement: disbursementDate,
    closed: closedDate,
  };

  const closed = Boolean(closedDate) || data.order.operationalStatus === 'closed';

  return [
    {
      key: 'opened',
      label: 'Order Opened',
      state: milestoneState('opened', completion, closed),
      date: formatOrderDate(completion.opened),
      documentId: null,
    },
    {
      key: 'prelim',
      label: 'Prelim Received',
      state: milestoneState('prelim', completion, closed),
      date: formatOrderDate(completion.prelim),
      documentId: firstPrelim?.id ?? null,
    },
    {
      key: 'recording',
      label: 'Recording Confirmation',
      state: milestoneState('recording', completion, closed),
      date: formatOrderDate(completion.recording),
      documentId: null,
    },
    {
      key: 'disbursement',
      label: 'Funds Disbursed',
      state: milestoneState('disbursement', completion, closed),
      date: formatOrderDate(completion.disbursement),
      documentId: null,
    },
    {
      key: 'closed',
      label: 'Order Closed',
      state: milestoneState('closed', completion, closed),
      date: formatOrderDate(completion.closed),
      documentId: null,
    },
  ] satisfies OrderReadModelMilestone[];
}

async function loadOrderReadModelData(orderId: number): Promise<OrderReadModelData | null> {
  const [row] = await db
    .select({
      id: orders.id,
      fileNumber: orders.fileNumber,
      source: orders.source,
      marketingSource: orders.marketingSource,
      operationalStatus: orders.operationalStatus,
      softproStatus: orders.softproStatus,
      softproLastSyncedAt: orders.softproLastSyncedAt,
      isImported: orders.isImported,
      branchId: orders.branchId,
      lenderId: orders.lenderId,
      underwriterId: orders.underwriterId,
      escrowOfficerId: orders.escrowOfficerId,
      listingAgentId: orders.listingAgentId,
      transactionType: orders.transactionType,
      productType: orders.productType,
      orderType: orders.orderType,
      salesPrice: orders.salesPrice,
      loanAmount: orders.loanAmount,
      openedAt: orders.openedAt,
      closedAt: orders.closedAt,
      completedAt: orders.completedAt,
      receivedAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      propAddress: orderProperties.address,
      propCity: orderProperties.city,
      propState: orderProperties.state,
      propZip: orderProperties.zip,
      propCounty: orderProperties.county,
      propApn: orderProperties.apn,
      propLegalDescription: orderProperties.legalDescription,
      propPropertyType: orderProperties.propertyType,
      propFullAddress: orderProperties.fullAddress,
      propPrimaryOwner: orderProperties.primaryOwner,
      propSecondaryOwner: orderProperties.secondaryOwner,
      eoFullName: escrowOfficerContact.fullName,
      eoOfficerName: escrowOfficerContact.officerName,
      eoFirstName: escrowOfficerContact.firstName,
      eoLastName: escrowOfficerContact.lastName,
      eoCompanyName: escrowOfficerContact.companyName,
      eoEmail: escrowOfficerContact.email,
      eoPhone: escrowOfficerContact.phone,
      toFullName: titleOfficerContact.fullName,
      toOfficerName: titleOfficerContact.officerName,
      toFirstName: titleOfficerContact.firstName,
      toLastName: titleOfficerContact.lastName,
      toCompanyName: titleOfficerContact.companyName,
      toEmail: titleOfficerContact.email,
      toPhone: titleOfficerContact.phone,
      toCell: titleOfficerContact.cell,
      srFullName: salesRepContact.fullName,
      srOfficerName: salesRepContact.officerName,
      srFirstName: salesRepContact.firstName,
      srLastName: salesRepContact.lastName,
      srCompanyName: salesRepContact.companyName,
      srEmail: salesRepContact.email,
      srPhone: salesRepContact.phone,
      createdById: createdByProfile.id,
      createdByName: createdByProfile.displayName,
      createdByEmail: createdByProfile.email,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
    .leftJoin(escrowOfficerContact, eq(orders.escrowOfficerId, escrowOfficerContact.id))
    .leftJoin(titleOfficerContact, eq(orders.titleOfficerId, titleOfficerContact.id))
    .leftJoin(salesRepContact, eq(orders.salesRepId, salesRepContact.id))
    .leftJoin(createdByProfile, eq(orders.createdBy, createdByProfile.id))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) return null;

  const [partyRows, documentRows, historyRows, titleSearchRows] = await Promise.all([
    db
      .select({
        id: orderParties.id,
        role: orderParties.role,
        name: orderParties.externalName,
        company: orderParties.externalCompany,
        email: orderParties.externalEmail,
        phone: orderParties.externalPhone,
        isPrimary: orderParties.isPrimary,
        createdAt: orderParties.createdAt,
      })
      .from(orderParties)
      .where(eq(orderParties.orderId, orderId))
      .orderBy(asc(orderParties.createdAt), asc(orderParties.id)),
    db
      .select({
        id: documents.id,
        category: documents.category,
        filename: documents.filename,
        sizeBytes: documents.sizeBytes,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(and(eq(documents.orderId, orderId), eq(documents.status, 'active')))
      .orderBy(asc(documents.createdAt), asc(documents.id)),
    db
      .select({
        id: orderStatusHistory.id,
        status: orderStatusHistory.status,
        source: orderStatusHistory.source,
        notes: orderStatusHistory.notes,
        changedAt: orderStatusHistory.changedAt,
      })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(asc(orderStatusHistory.changedAt), asc(orderStatusHistory.id)),
    db
      .select({ updatedAt: titlePointData.updatedAt })
      .from(titlePointData)
      .where(and(eq(titlePointData.orderId, orderId), eq(titlePointData.status, 'completed')))
      .orderBy(asc(titlePointData.updatedAt))
      .limit(1),
  ]);

  return {
    order: {
      id: row.id,
      fileNumber: row.fileNumber,
      escrowNumber: null,
      source: row.source,
      marketingSource: row.marketingSource,
      operationalStatus: row.operationalStatus,
      softproStatus: row.softproStatus,
      softproLastSyncedAt: row.softproLastSyncedAt,
      isImported: row.isImported,
      branchId: row.branchId,
      lenderId: row.lenderId,
      underwriterId: row.underwriterId,
      escrowOfficerId: row.escrowOfficerId,
      listingAgentId: row.listingAgentId,
      transactionType: row.transactionType,
      productType: row.productType,
      orderType: row.orderType,
      salesPrice: row.salesPrice,
      loanAmount: row.loanAmount,
      premium: null,
      openedAt: row.openedAt,
      closedAt: row.closedAt,
      completedAt: row.completedAt,
      receivedAt: row.receivedAt,
      updatedAt: row.updatedAt,
    },
    property: {
      address: row.propAddress,
      line2: null,
      city: row.propCity,
      state: row.propState,
      zip: row.propZip,
      county: row.propCounty,
      apn: row.propApn,
      legalDescription: row.propLegalDescription,
      propertyType: row.propPropertyType,
      fullAddress: row.propFullAddress,
      primaryOwner: row.propPrimaryOwner,
      secondaryOwner: row.propSecondaryOwner,
    },
    parties: partyRows,
    assignments: {
      escrowOfficer: assignment({
        fullName: row.eoFullName,
        officerName: row.eoOfficerName,
        firstName: row.eoFirstName,
        lastName: row.eoLastName,
        companyName: row.eoCompanyName,
        email: row.eoEmail,
        phone: row.eoPhone,
      }),
      titleOfficer: assignment({
        fullName: row.toFullName,
        officerName: row.toOfficerName,
        firstName: row.toFirstName,
        lastName: row.toLastName,
        companyName: row.toCompanyName,
        email: row.toEmail,
        phone: row.toPhone ?? row.toCell,
      }),
      salesRep: assignment({
        fullName: row.srFullName,
        officerName: row.srOfficerName,
        firstName: row.srFirstName,
        lastName: row.srLastName,
        companyName: row.srCompanyName,
        email: row.srEmail,
        phone: row.srPhone,
      }),
      createdBy: row.createdById ? {
        id: row.createdById,
        name: row.createdByName,
        email: row.createdByEmail,
      } : null,
    },
    documents: documentRows,
    statusHistory: historyRows,
    titleSearchCompletedAt: titleSearchRows[0]?.updatedAt ?? null,
  };
}

function orderPartiesCanonically(parties: OrderReadModelPartySource[]): OrderReadModelParty[] {
  return [...parties]
    .sort((a, b) => {
      const roleDelta = roleRank(a.role) - roleRank(b.role);
      if (roleDelta !== 0) return roleDelta;
      if (Boolean(a.isPrimary) !== Boolean(b.isPrimary)) return a.isPrimary ? -1 : 1;
      return toTime(a.createdAt ?? null) - toTime(b.createdAt ?? null)
        || Number(a.id ?? 0) - Number(b.id ?? 0);
    })
    .map((party) => ({
      role: party.role,
      name: party.name,
      company: party.company,
      email: party.email,
      phone: party.phone,
      isPrimary: Boolean(party.isPrimary),
    }));
}

function explicitOtherParty(parties: OrderReadModelPartySource[], isPrimary: boolean): OrderReadModelParty | null {
  const party = orderPartiesCanonically(parties).find((candidate) => (
    candidate.role === 'other' && candidate.isPrimary === isPrimary
  ));
  return party ?? null;
}

function roleRank(role: string): number {
  const index = PARTY_ROLE_ORDER.indexOf(role as typeof PARTY_ROLE_ORDER[number]);
  return index === -1 ? PARTY_ROLE_ORDER.length : index;
}

function assignment(contact: {
  fullName: string | null;
  officerName: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone?: string | null;
}): OrderReadModelAssignment | null {
  const name = contactDisplayName(contact);
  if (!name && !contact.email) return null;
  return { name, email: contact.email, phone: contact.phone ?? null };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rawMoney(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

/**
 * Complete only with a real signal (openedAt, prelim doc, status_history
 * recording/disbursement, closedAt/closed). No auto-advance "in_progress"
 * for the next incomplete step — that fabricated progress on fresh orders.
 */
function milestoneState(
  key: OrderMilestoneKey,
  completion: Record<OrderMilestoneKey, Date | string | null>,
  closed: boolean,
): OrderMilestoneState {
  if (completion[key] || (closed && key === 'closed')) return 'complete';
  return 'pending';
}

function firstDocument(docs: OrderReadModelDocumentSource[], category: string): OrderReadModelDocumentSource | null {
  return docs
    .filter((doc) => doc.category === category)
    .sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt) || a.id - b.id)[0] ?? null;
}

function firstStatusDate(history: OrderReadModelStatusSource[], pattern: RegExp): Date | string | null {
  return history.find((entry) => pattern.test(`${entry.status} ${entry.notes ?? ''}`))?.changedAt ?? null;
}

function toTime(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
