import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder, canAccessSalesScopedOrder, isSalesScopedRole } from '@/lib/security/permissions';
import { applyVisibility, getOrderReadModel, type OrderReadModel, type OrderReadModelParty } from '@/lib/domain/orders/read-model';

const ORDER_DETAIL_ROLES = [
  'super_admin',
  'admin',
  'cs_admin',
  'open_order_team',
  'escrow_assistant',
  'escrow_officer',
  'title_officer',
  'sales_rep',
  'sales_manager',
];

const paramSchema = z.object({ id: z.coerce.number().int().positive() });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !ORDER_DETAIL_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const resolved = await params;
  const parsed = paramSchema.safeParse({ id: resolved.id });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }
  const orderId = parsed.data.id;

  const canAccess = isSalesScopedRole(session.role)
    ? await canAccessSalesScopedOrder(session, orderId)
    : await canAccessOrder(session, orderId);

  if (!canAccess) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const model = await getOrderReadModel(orderId);
    if (!model) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    return NextResponse.json(mapStaffDetailResponse(applyVisibility(model, 'staff')));
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load order detail', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}

function mapStaffDetailResponse(model: OrderReadModel) {
  const buyerParty = primaryParty(model.parties, 'buyer') ?? primaryParty(model.parties, 'borrower');
  const sellerParty = primaryParty(model.parties, 'seller');
  const lenderParty = primaryParty(model.parties, 'lender');
  const listingAgentParty = primaryParty(model.parties, 'listing_agent');

  return {
    order: {
      id: model.id,
      fileNumber: model.fileNumber,
      status: model.status.value,
      source: model.source,
      productType: model.productType,
      transactionType: model.transactionType,
      salesPrice: model.financials.salesPriceFormatted,
      loanAmount: model.financials.loanAmountFormatted,
      openedAt: model.dates.openedAt,
      closedAt: model.dates.closedAt,
      createdAt: model.dates.receivedAt,
      updatedAt: model.dates.receivedAt,
      emailStatus: null,
      dupOverride: false,
      marketingSource: model.marketingSource,
    },
    property: {
      address: model.property.line1,
      city: model.property.city,
      state: model.property.state,
      zip: model.property.zip,
      county: model.property.county === '—' ? null : model.property.county,
      apn: model.property.apn,
      legalDescription: model.property.legalDescription,
      propertyType: model.property.propertyType,
    },
    parties: {
      items: model.parties.map(toLegacyParty),
      buyer: splitPartyName(buyerParty),
      seller: splitPartyName(sellerParty),
      escrowOfficer: model.assignments.escrowOfficer,
      lender: partyName(lenderParty),
      listingAgent: partyName(listingAgentParty),
      titleCompany: partyName(model.relatedParties.titleCompany),
      underwriter: partyName(model.relatedParties.underwriter),
    },
    assignments: {
      salesRep: model.assignments.salesRep,
      titleOfficer: model.assignments.titleOfficer,
      createdBy: model.assignments.createdBy,
    },
    documents: {
      count: model.documents.activeCount,
      categories: Object.keys(model.documents.activeByCategory),
    },
    statusHistory: model.milestones.map((milestone) => ({
      status: milestone.key,
      source: 'system',
      note: milestone.label,
      createdAt: milestone.date,
    })),
    milestones: model.milestones.map((milestone, index) => ({
      id: index + 1,
      status: milestone.state,
      label: milestone.label,
      notes: null,
      occurredAt: milestone.date,
    })),
  };
}

function primaryParty(parties: OrderReadModelParty[], role: string): OrderReadModelParty | null {
  return parties.find((party) => party.role === role && party.isPrimary)
    ?? parties.find((party) => party.role === role)
    ?? null;
}

function toLegacyParty(party: OrderReadModelParty) {
  return {
    role: party.role,
    isPrimary: party.isPrimary,
    externalName: party.name,
    externalCompany: party.company,
    externalEmail: party.email,
    externalPhone: party.phone,
  };
}

function splitPartyName(party: OrderReadModelParty | null) {
  if (!party?.name) return null;
  const parts = party.name.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
    email: party.email,
    phone: party.phone,
    company: party.company,
  };
}

function partyName(party: OrderReadModelParty | null) {
  if (!party) return null;
  return {
    name: party.name,
    email: party.email,
    phone: party.phone,
    company: party.company,
  };
}
