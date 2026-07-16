import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { contacts, orders, orderProperties, profiles } from '@/lib/db/schema';
import { eq, desc, sql, ilike, or, and, inArray, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getSession } from '@/lib/security/auth';
import { getAccessibleOrderIds } from '@/lib/security/client-scope';
import { projectListRow } from '@/lib/domain/orders/list-row';

const createdByProfile = alias(profiles, 'created_by_profile');
const clientContact = alias(contacts, 'client_contact');
const salesRepContact = alias(contacts, 'sales_rep_contact');

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  search: z.string().optional(),
  status: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawParams = Object.fromEntries(req.nextUrl.searchParams);
    const params = querySchema.parse(rawParams);
    const offset = (params.page - 1) * params.pageSize;

    const accessibleIds = await getAccessibleOrderIds(session.id);
    if (Array.isArray(accessibleIds) && accessibleIds.length === 0) {
      return NextResponse.json({ orders: [], total: 0, page: params.page, pageSize: params.pageSize, totalPages: 0 });
    }

    const conditions: SQL[] = [];

    if (Array.isArray(accessibleIds)) {
      conditions.push(inArray(orders.id, accessibleIds));
    }

    if (params.status) {
      conditions.push(eq(orders.operationalStatus, params.status as typeof orders.operationalStatus.enumValues[number]));
    }

    if (params.search) {
      const term = `%${params.search}%`;
      conditions.push(
        or(
          ilike(orders.fileNumber, term),
          ilike(orderProperties.address, term),
          ilike(orderProperties.city, term),
        )!,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: orders.id,
          fileNumber: orders.fileNumber,
          operationalStatus: orders.operationalStatus,
          transactionType: orders.transactionType,
          orderType: orders.orderType,
          productType: orders.productType,
          openedAt: orders.openedAt,
          closedAt: orders.closedAt,
          address: orderProperties.address,
          city: orderProperties.city,
          state: orderProperties.state,
          zip: orderProperties.zip,
          fullAddress: orderProperties.fullAddress,
          clientContactId: orders.clientContactId,
          clientFullName: clientContact.fullName,
          clientOfficerName: clientContact.officerName,
          clientFirstName: clientContact.firstName,
          clientLastName: clientContact.lastName,
          clientCompanyName: clientContact.companyName,
          clientEmail: clientContact.email,
          salesRepFullName: salesRepContact.fullName,
          salesRepOfficerName: salesRepContact.officerName,
          salesRepFirstName: salesRepContact.firstName,
          salesRepLastName: salesRepContact.lastName,
          salesRepCompanyName: salesRepContact.companyName,
          createdByName: createdByProfile.displayName,
        })
        .from(orders)
        .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
        .leftJoin(clientContact, eq(orders.clientContactId, clientContact.id))
        .leftJoin(salesRepContact, eq(orders.salesRepId, salesRepContact.id))
        .leftJoin(createdByProfile, eq(orders.createdBy, createdByProfile.id))
        .where(where)
        .orderBy(desc(orders.openedAt))
        .limit(params.pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(orders)
        .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
        .where(where),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    return NextResponse.json({
      orders: rows.map((row) => projectListRow({
        id: row.id,
        fileNumber: row.fileNumber,
        operationalStatus: row.operationalStatus,
        transactionType: row.transactionType,
        orderType: row.orderType,
        productType: row.productType,
        openedAt: row.openedAt,
        closedAt: row.closedAt,
        property: {
          address: row.address,
          city: row.city,
          state: row.state,
          zip: row.zip,
          fullAddress: row.fullAddress,
        },
        clientContactId: row.clientContactId,
        clientContact: {
          fullName: row.clientFullName,
          officerName: row.clientOfficerName,
          firstName: row.clientFirstName,
          lastName: row.clientLastName,
          companyName: row.clientCompanyName,
          email: row.clientEmail,
        },
        salesRep: {
          fullName: row.salesRepFullName,
          officerName: row.salesRepOfficerName,
          firstName: row.salesRepFirstName,
          lastName: row.salesRepLastName,
          companyName: row.salesRepCompanyName,
        },
        createdByName: row.createdByName,
      })),
      total,
      page: params.page,
      pageSize: params.pageSize,
      totalPages: Math.ceil(total / params.pageSize),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
