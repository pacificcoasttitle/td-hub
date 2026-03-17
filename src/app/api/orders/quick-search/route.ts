import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import { or, ilike, desc } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const pattern = `%${q}%`;
    const rows = await db
      .select({
        id: orders.id,
        fileNumber: orders.fileNumber,
        propertyStreet: orders.propertyStreet,
        propertyCity: orders.propertyCity,
        propertyState: orders.propertyState,
        operationalStatus: orders.operationalStatus,
      })
      .from(orders)
      .where(
        or(
          ilike(orders.fileNumber, pattern),
          ilike(orders.propertyStreet, pattern),
          ilike(orders.propertyCity, pattern),
        ),
      )
      .orderBy(desc(orders.openedAt))
      .limit(10);

    return NextResponse.json({ results: rows });
  } catch {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
