import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, orderStatusHistory } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(50).default(10),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawParams = Object.fromEntries(req.nextUrl.searchParams);
    const { limit } = querySchema.parse(rawParams);

    const rows = await db
      .select({
        id: orderStatusHistory.id,
        orderId: orderStatusHistory.orderId,
        fileNumber: orders.fileNumber,
        status: orderStatusHistory.status,
        source: orderStatusHistory.source,
        notes: orderStatusHistory.notes,
        changedAt: orderStatusHistory.changedAt,
      })
      .from(orderStatusHistory)
      .innerJoin(orders, eq(orderStatusHistory.orderId, orders.id))
      .orderBy(desc(orderStatusHistory.changedAt))
      .limit(limit);

    return NextResponse.json({
      activity: rows.map((r) => ({
        ...r,
        changedAt: r.changedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 });
    }
    console.error('Dashboard activity error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
