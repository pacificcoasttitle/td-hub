import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, orderStatusHistory } from '@/lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { LOOKBACK_NOTE_PREFIX } from '@/lib/domain/orders/lookback-diff';

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
      // Exclude the look-back sync. It corrects hundreds of stale orders in a
      // single pass, and this feed is an unfiltered "most recent N" — without
      // this, one backfill run buries days of genuine activity behind a wall of
      // identical bulk corrections. The corrections are still visible on each
      // order's own milestone history; they just do not claim the feed.
      // coalesce, because notes is nullable and `NULL not like ...` is NULL,
      // which would silently drop every row without a note.
      .where(sql`coalesce(${orderStatusHistory.notes}, '') not like ${LOOKBACK_NOTE_PREFIX + '%'}`)
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
