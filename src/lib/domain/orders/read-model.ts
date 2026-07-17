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

const MILESTONE_KEYS = ['opened', 'prelim', 'recording', 'disbursement', 'closed'] as const;

export type OrderReadModelVisibilityPolicy = 'internal' | 'staff' | 'client';
export type OrderMilestoneKey = typeof MILESTONE_KEYS[number];
export type OrderMilestoneState = 'complete' | 'in_progress' | 'pending';

/**
 * Canonical, formatted order read model for Phase 3 consumers.
 *
 * Raw order facts are loaded once, then status, dates, money, address, county,
 * documents, parties, assignments, and milestones are derived here. Consumers
 * should call applyVisibility() for layer-specific redaction instead of
 * re-querying or re-formatting fields locally.
 */
export interface OrderReadModel {
  id: number;
  fileNumber: string;
  escrowNumber: string | null;
  source: string | null;
  marketingSource: string | null;
  status: { value: string; label: string; color: string };
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
  };
  financials: {
    salesPriceFormatted: string;
    loanAmountFormatted: string;
    premiumFormatted: string;
  };
  dates: {
    openedAt: string;
    closedAt: string;
    completedAt: string;
    receivedAt: string;
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
  status: string;
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
    },
    financials: {
      salesPriceFormatted: formatOrderMoney(data.order.salesPrice),
      loanAmountFormatted: formatOrderMoney(data.order.loanAmount),
      premiumFormatted: formatOrderMoney(data.order.premium),
    },
    dates: {
      openedAt: formatOrderDate(data.order.openedAt),
      closedAt: formatOrderDate(data.order.closedAt),
      completedAt: formatOrderDate(data.order.completedAt),
      receivedAt: formatOrderDate(data.order.receivedAt),
    },
    parties: orderPartiesCanonically(data.parties),
    relatedParties: {
      titleCompany: explicitOtherParty(data.parties, true),
      underwriter: explicitOtherParty(data.parties, false),
    },
    assignments: data.assignments,
    documents: summarizeActiveDocuments(data.documents),
    milestones: deriveOrderMilestones(data),
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

  // Client policy: keep party names/roles/company; redact direct contact details.
  return {
    ...model,
    property: {
      ...model.property,
      apn: null,
      legalDescription: null,
    },
    financials: {
      salesPriceFormatted: '—',
      loanAmountFormatted: '—',
      premiumFormatted: '—',
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
  const firstIncomplete = MILESTONE_KEYS.find((key) => !completion[key]);

  return [
    {
      key: 'opened',
      label: 'Order Opened',
      state: completion.opened ? 'complete' : 'in_progress',
      date: formatOrderDate(completion.opened),
      documentId: null,
    },
    {
      key: 'prelim',
      label: 'Prelim Received',
      state: milestoneState('prelim', completion, firstIncomplete, closed),
      date: formatOrderDate(completion.prelim),
      documentId: firstPrelim?.id ?? null,
    },
    {
      key: 'recording',
      label: 'Recording Confirmation',
      state: milestoneState('recording', completion, firstIncomplete, closed),
      date: formatOrderDate(completion.recording),
      documentId: null,
    },
    {
      key: 'disbursement',
      label: 'Funds Disbursed',
      state: milestoneState('disbursement', completion, firstIncomplete, closed),
      date: formatOrderDate(completion.disbursement),
      documentId: null,
    },
    {
      key: 'closed',
      label: 'Order Closed',
      state: completion.closed || closed ? 'complete' : milestoneState('closed', completion, firstIncomplete, closed),
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
      transactionType: orders.transactionType,
      productType: orders.productType,
      orderType: orders.orderType,
      salesPrice: orders.salesPrice,
      loanAmount: orders.loanAmount,
      openedAt: orders.openedAt,
      closedAt: orders.closedAt,
      completedAt: orders.completedAt,
      receivedAt: orders.createdAt,
      propAddress: orderProperties.address,
      propCity: orderProperties.city,
      propState: orderProperties.state,
      propZip: orderProperties.zip,
      propCounty: orderProperties.county,
      propApn: orderProperties.apn,
      propLegalDescription: orderProperties.legalDescription,
      propPropertyType: orderProperties.propertyType,
      propFullAddress: orderProperties.fullAddress,
      eoFullName: escrowOfficerContact.fullName,
      eoOfficerName: escrowOfficerContact.officerName,
      eoFirstName: escrowOfficerContact.firstName,
      eoLastName: escrowOfficerContact.lastName,
      eoCompanyName: escrowOfficerContact.companyName,
      eoEmail: escrowOfficerContact.email,
      toFullName: titleOfficerContact.fullName,
      toOfficerName: titleOfficerContact.officerName,
      toFirstName: titleOfficerContact.firstName,
      toLastName: titleOfficerContact.lastName,
      toCompanyName: titleOfficerContact.companyName,
      toEmail: titleOfficerContact.email,
      srFullName: salesRepContact.fullName,
      srOfficerName: salesRepContact.officerName,
      srFirstName: salesRepContact.firstName,
      srLastName: salesRepContact.lastName,
      srCompanyName: salesRepContact.companyName,
      srEmail: salesRepContact.email,
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
        status: orderStatusHistory.status,
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
      }),
      titleOfficer: assignment({
        fullName: row.toFullName,
        officerName: row.toOfficerName,
        firstName: row.toFirstName,
        lastName: row.toLastName,
        companyName: row.toCompanyName,
        email: row.toEmail,
      }),
      salesRep: assignment({
        fullName: row.srFullName,
        officerName: row.srOfficerName,
        firstName: row.srFirstName,
        lastName: row.srLastName,
        companyName: row.srCompanyName,
        email: row.srEmail,
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
}): OrderReadModelAssignment | null {
  const name = contactDisplayName(contact);
  if (!name && !contact.email) return null;
  return { name, email: contact.email };
}

function milestoneState(
  key: OrderMilestoneKey,
  completion: Record<OrderMilestoneKey, Date | string | null>,
  firstIncomplete: OrderMilestoneKey | undefined,
  closed: boolean,
): OrderMilestoneState {
  if (completion[key] || (closed && key === 'closed')) return 'complete';
  if (closed) return 'pending';
  return firstIncomplete === key ? 'in_progress' : 'pending';
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
