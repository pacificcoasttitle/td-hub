import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, orderProperties, contacts, profiles } from '@/lib/db/schema';
import { eq, desc, and, gte, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getMonthRange } from '@/lib/utils/month-range';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

const salesRepContact = alias(contacts, 'sales_rep');
const createdByProfile = alias(profiles, 'created_by_profile');

function contactName(c: { fullName: string | null; officerName: string | null; firstName: string | null; lastName: string | null } | null): string | null {
  if (!c) return null;
  if (c.fullName) return c.fullName;
  if (c.officerName) return c.officerName;
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { start, end } = getMonthRange(
      req.nextUrl.searchParams.get('month'),
      req.nextUrl.searchParams.get('year'),
    );

    const rows = await db
      .select({
        id: orders.id,
        fileNumber: orders.fileNumber,
        status: orders.operationalStatus,
        productType: orders.productType,
        createdAt: orders.createdAt,
        address: orderProperties.address,
        city: orderProperties.city,
        state: orderProperties.state,
        salesRepFirstName: salesRepContact.firstName,
        salesRepLastName: salesRepContact.lastName,
        salesRepFullName: salesRepContact.fullName,
        salesRepOfficerName: salesRepContact.officerName,
        createdByName: createdByProfile.displayName,
      })
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .leftJoin(salesRepContact, eq(orders.salesRepId, salesRepContact.id))
      .leftJoin(createdByProfile, eq(orders.createdBy, createdByProfile.id))
      .where(and(gte(orders.createdAt, start), lt(orders.createdAt, end)))
      .orderBy(desc(orders.createdAt))
      .limit(10);

    const activity = rows.map((row) => {
      const addressParts = [row.address, row.city, row.state].filter(Boolean);
      return {
        id: row.id,
        fileNumber: row.fileNumber,
        address: addressParts.length > 0 ? addressParts.join(', ') : null,
        status: row.status,
        productType: row.productType,
        salesRep: contactName({
          fullName: row.salesRepFullName,
          officerName: row.salesRepOfficerName,
          firstName: row.salesRepFirstName,
          lastName: row.salesRepLastName,
        }),
        createdAt: row.createdAt.toISOString(),
        createdBy: row.createdByName ?? null,
      };
    });

    return NextResponse.json({ orders: activity });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load recent activity', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
