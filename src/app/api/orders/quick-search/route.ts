import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, orderProperties } from '@/lib/db/schema';
import { and, or, ilike, desc, eq } from 'drizzle-orm';
import { buildScopeFilter } from '@/lib/domain/orders/scope';

// SCOPED LIKE THE ORDERS LIST. Until 2026-09-14 this searched every order's file
// number and address for any logged-in session — a client, a sales rep or
// title_production could find orders the list would never show them. It now
// applies the same row-level predicate as /api/orders, so the typeahead can
// only suggest what the list would return.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const pattern = `%${q}%`;
    const scopeFilter = await buildScopeFilter(session);
    const rows = await db
      .select({
        id: orders.id,
        fileNumber: orders.fileNumber,
        propertyStreet: orderProperties.address,
        propertyCity: orderProperties.city,
        propertyState: orderProperties.state,
        operationalStatus: orders.operationalStatus,
      })
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .where(
        and(
          scopeFilter ?? undefined,
          or(
            ilike(orders.fileNumber, pattern),
            ilike(orderProperties.address, pattern),
            ilike(orderProperties.city, pattern),
          ),
        ),
      )
      .orderBy(desc(orders.openedAt))
      .limit(10);

    return NextResponse.json({ results: rows });
  } catch {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
