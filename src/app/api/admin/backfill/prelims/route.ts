import { NextRequest, NextResponse } from 'next/server';
import { sql, and, or, isNull, asc, lt } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import { fetchPrelimsForOrder } from '@/lib/jobs/handlers/fetch-prelims';
import { getSession } from '@/lib/security/auth';

export const maxDuration = 300;

const ALLOWED_ROLES = ['super_admin', 'admin', 'cs_admin'];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = Math.min(
    Number(req.nextUrl.searchParams.get('limit') || 50),
    100,
  );
  const minAgeDays = Number(req.nextUrl.searchParams.get('minAge') || 7);

  const startTime = Date.now();
  const TIME_BUDGET_MS = 240_000;

  const cutoff = new Date(Date.now() - minAgeDays * 24 * 60 * 60 * 1000);

  const eligibleOrders = await db
    .select({
      id: orders.id,
      fileNumber: orders.fileNumber,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(and(
      sql`${orders.operationalStatus} in ('open', 'in_process', 'completed')`,
      sql`${orders.id} NOT IN (
        SELECT order_id FROM documents
        WHERE category = 'prelim' AND status = 'active'
      )`,
      lt(orders.createdAt, cutoff),
      or(
        isNull(orders.lastPrelimFetchAt),
        sql`${orders.lastPrelimFetchAt} < NOW() - INTERVAL '6 hours'`,
      ),
    ))
    .orderBy(asc(orders.createdAt))
    .limit(limit);

  const stats = {
    eligible: eligibleOrders.length,
    attempted: 0,
    documentsStored: 0,
    timedOut: false,
    errors: [] as Array<{ orderId: number; error: string }>,
  };

  for (const order of eligibleOrders) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.warn(`[backfill] Time budget exhausted after ${stats.attempted} orders`);
      stats.timedOut = true;
      break;
    }

    stats.attempted++;
    try {
      const stored = await fetchPrelimsForOrder(order.id, order.fileNumber);
      stats.documentsStored += stored;
    } catch (err) {
      stats.errors.push({
        orderId: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    minAgeDays,
    limit,
    durationSeconds: Math.round((Date.now() - startTime) / 1000),
    ...stats,
  });
}
