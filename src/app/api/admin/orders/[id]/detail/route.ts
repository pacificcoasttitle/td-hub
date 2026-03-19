import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import {
  orders, orderProperties, orderParties, orderStatusHistory,
  documents,
} from '@/lib/db/schema';
import { eq, and, sql, asc } from 'drizzle-orm';
import {
  escrowOfficerContact, lenderContact, listingAgentContact,
  salesRepContact, titleOfficerContact, titleCompanyAlias,
  underwriterAlias, createdByProfile,
  contactDisplayName, formatParty,
} from '@/lib/domain/orders/detail-helpers';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

const paramSchema = z.object({ id: z.coerce.number().int().positive() });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const resolved = await params;
  const parsed = paramSchema.safeParse({ id: resolved.id });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }
  const orderId = parsed.data.id;

  try {
    const [row] = await db
      .select({
        // order
        id: orders.id,
        fileNumber: orders.fileNumber,
        operationalStatus: orders.operationalStatus,
        source: orders.source,
        productType: orders.productType,
        transactionType: orders.transactionType,
        salesPrice: orders.salesPrice,
        marketingSource: orders.marketingSource,
        emailStatus: orders.emailStatus,
        dupOverride: orders.dupOverride,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        // property
        propAddress: orderProperties.address,
        propCity: orderProperties.city,
        propState: orderProperties.state,
        propZip: orderProperties.zip,
        propCounty: orderProperties.county,
        propApn: orderProperties.apn,
        propLegalDesc: orderProperties.legalDescription,
        propType: orderProperties.propertyType,
        // escrow officer
        eoId: escrowOfficerContact.id,
        eoFirstName: escrowOfficerContact.firstName,
        eoLastName: escrowOfficerContact.lastName,
        eoFullName: escrowOfficerContact.fullName,
        eoOfficerName: escrowOfficerContact.officerName,
        eoCompanyName: escrowOfficerContact.companyName,
        eoEmail: escrowOfficerContact.email,
        eoPhone: escrowOfficerContact.phone,
        // lender
        lnId: lenderContact.id,
        lnFirstName: lenderContact.firstName,
        lnLastName: lenderContact.lastName,
        lnFullName: lenderContact.fullName,
        lnOfficerName: lenderContact.officerName,
        lnCompanyName: lenderContact.companyName,
        lnEmail: lenderContact.email,
        lnPhone: lenderContact.phone,
        // listing agent
        laId: listingAgentContact.id,
        laFirstName: listingAgentContact.firstName,
        laLastName: listingAgentContact.lastName,
        laFullName: listingAgentContact.fullName,
        laOfficerName: listingAgentContact.officerName,
        laCompanyName: listingAgentContact.companyName,
        laEmail: listingAgentContact.email,
        laPhone: listingAgentContact.phone,
        // title company
        tcId: titleCompanyAlias.id,
        tcName: titleCompanyAlias.name,
        // underwriter
        uwId: underwriterAlias.id,
        uwName: underwriterAlias.name,
        // sales rep
        srId: salesRepContact.id,
        srFirstName: salesRepContact.firstName,
        srLastName: salesRepContact.lastName,
        srFullName: salesRepContact.fullName,
        srOfficerName: salesRepContact.officerName,
        srCompanyName: salesRepContact.companyName,
        srEmail: salesRepContact.email,
        // title officer
        toId: titleOfficerContact.id,
        toFirstName: titleOfficerContact.firstName,
        toLastName: titleOfficerContact.lastName,
        toFullName: titleOfficerContact.fullName,
        toOfficerName: titleOfficerContact.officerName,
        toCompanyName: titleOfficerContact.companyName,
        toEmail: titleOfficerContact.email,
        // created by
        cbId: createdByProfile.id,
        cbName: createdByProfile.displayName,
        cbEmail: createdByProfile.email,
      })
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .leftJoin(escrowOfficerContact, eq(orders.escrowOfficerId, escrowOfficerContact.id))
      .leftJoin(lenderContact, eq(orders.lenderId, lenderContact.id))
      .leftJoin(listingAgentContact, eq(orders.listingAgentId, listingAgentContact.id))
      .leftJoin(titleCompanyAlias, eq(orders.titleCompanyId, titleCompanyAlias.id))
      .leftJoin(underwriterAlias, eq(orders.underwriterId, underwriterAlias.id))
      .leftJoin(salesRepContact, eq(orders.salesRepId, salesRepContact.id))
      .leftJoin(titleOfficerContact, eq(orders.titleOfficerId, titleOfficerContact.id))
      .leftJoin(createdByProfile, eq(orders.createdBy, createdByProfile.id))
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Buyer / seller from order_parties
    const parties = await db
      .select({
        role: orderParties.role,
        isPrimary: orderParties.isPrimary,
        externalName: orderParties.externalName,
        externalCompany: orderParties.externalCompany,
        externalEmail: orderParties.externalEmail,
        externalPhone: orderParties.externalPhone,
      })
      .from(orderParties)
      .where(eq(orderParties.orderId, orderId));

    const buyerParty = parties.find((p) => p.role === 'buyer' && p.isPrimary)
      ?? parties.find((p) => p.role === 'buyer')
      ?? null;
    const sellerParty = parties.find((p) => p.role === 'seller' && p.isPrimary)
      ?? parties.find((p) => p.role === 'seller')
      ?? null;

    // Documents summary
    const docRows = await db
      .select({
        category: documents.category,
        count: sql<number>`count(*)`,
      })
      .from(documents)
      .where(and(eq(documents.orderId, orderId), eq(documents.status, 'active')))
      .groupBy(documents.category);

    const docCount = docRows.reduce((sum, r) => sum + Number(r.count), 0);
    const docCategories = docRows.map((r) => r.category);

    // Status history
    const history = await db
      .select({
        status: orderStatusHistory.status,
        source: orderStatusHistory.source,
        notes: orderStatusHistory.notes,
        changedAt: orderStatusHistory.changedAt,
      })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(asc(orderStatusHistory.changedAt));

    return NextResponse.json({
      order: {
        id: row.id,
        fileNumber: row.fileNumber,
        status: row.operationalStatus,
        source: row.source,
        productType: row.productType,
        transactionType: row.transactionType,
        salesPrice: row.salesPrice,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        emailStatus: row.emailStatus,
        dupOverride: row.dupOverride,
        marketingSource: row.marketingSource,
      },
      property: {
        address: row.propAddress,
        city: row.propCity,
        state: row.propState,
        zip: row.propZip,
        county: row.propCounty,
        apn: row.propApn,
        legalDescription: row.propLegalDesc,
        propertyType: row.propType,
      },
      parties: {
        buyer: formatParty(buyerParty),
        seller: formatParty(sellerParty),
        escrowOfficer: row.eoId ? {
          id: row.eoId,
          name: contactDisplayName({ fullName: row.eoFullName, officerName: row.eoOfficerName, firstName: row.eoFirstName, lastName: row.eoLastName, companyName: row.eoCompanyName }),
          email: row.eoEmail,
          phone: row.eoPhone,
        } : null,
        lender: row.lnId ? {
          id: row.lnId,
          name: contactDisplayName({ fullName: row.lnFullName, officerName: row.lnOfficerName, firstName: row.lnFirstName, lastName: row.lnLastName, companyName: row.lnCompanyName }),
          email: row.lnEmail,
          phone: row.lnPhone,
        } : null,
        listingAgent: row.laId ? {
          id: row.laId,
          name: contactDisplayName({ fullName: row.laFullName, officerName: row.laOfficerName, firstName: row.laFirstName, lastName: row.laLastName, companyName: row.laCompanyName }),
          email: row.laEmail,
          phone: row.laPhone,
          company: row.laCompanyName,
        } : null,
        titleCompany: row.tcId ? { id: row.tcId, name: row.tcName } : null,
        underwriter: row.uwId ? { id: row.uwId, name: row.uwName } : null,
      },
      assignments: {
        salesRep: row.srId ? {
          id: row.srId,
          name: contactDisplayName({ fullName: row.srFullName, officerName: row.srOfficerName, firstName: row.srFirstName, lastName: row.srLastName, companyName: row.srCompanyName }),
          email: row.srEmail,
        } : null,
        titleOfficer: row.toId ? {
          id: row.toId,
          name: contactDisplayName({ fullName: row.toFullName, officerName: row.toOfficerName, firstName: row.toFirstName, lastName: row.toLastName, companyName: row.toCompanyName }),
          email: row.toEmail,
        } : null,
        createdBy: row.cbId ? {
          id: row.cbId,
          name: row.cbName,
          email: row.cbEmail,
        } : null,
      },
      documents: {
        count: docCount,
        categories: docCategories,
      },
      statusHistory: history.map((h) => ({
        status: h.status,
        source: h.source,
        note: h.notes,
        createdAt: h.changedAt.toISOString(),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load order detail', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
