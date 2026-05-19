import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import { getOrderContacts } from '@/lib/integrations/softpro';
import { resolveClientContactId } from '@/lib/domain/orders/client-resolver';
import { getSession } from '@/lib/security/auth';

export const maxDuration = 300;

const ALLOWED_ROLES = ['super_admin', 'admin', 'cs_admin'];
const TIME_BUDGET_MS = 240_000;

type BackfillError = {
  orderId: number;
  fileNumber: string;
  error: string;
};

function parseLimit(value: string | null): number {
  const requested = Number(value ?? 50);
  return Math.min(Math.max(Number.isFinite(requested) ? requested : 50, 1), 100);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = parseLimit(req.nextUrl.searchParams.get('limit'));
  const startTime = Date.now();

  const eligibleFilter = and(
    eq(orders.source, 'softpro_sync'),
    inArray(orders.operationalStatus, ['open', 'in_process', 'completed']),
    isNull(orders.clientContactId),
  );

  const [eligibleCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(eligibleFilter);

  const candidates = await db
    .select({
      id: orders.id,
      fileNumber: orders.fileNumber,
      orderType: orders.orderType,
    })
    .from(orders)
    .where(eligibleFilter)
    .orderBy(desc(orders.createdAt))
    .limit(limit);

  const errors: BackfillError[] = [];
  let attempted = 0;
  let resolved = 0;
  let unresolved = 0;
  let timedOut = false;

  for (const order of candidates) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    attempted++;

    try {
      const apiResult = await getOrderContacts(order.fileNumber);
      if (!apiResult.success || !apiResult.data) {
        errors.push({
          orderId: order.id,
          fileNumber: order.fileNumber,
          error: apiResult.error?.message ?? 'GetOrderContacts returned no data',
        });
        continue;
      }

      const clientContactId = await resolveClientContactId(order.orderType, apiResult.data);
      if (!clientContactId) {
        unresolved++;
        continue;
      }

      await db
        .update(orders)
        .set({
          clientContactId,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      resolved++;
    } catch (err) {
      errors.push({
        orderId: order.id,
        fileNumber: order.fileNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (attempted > 0 && resolved === 0 && errors.length === attempted) {
    throw new Error(`backfill clients: ${attempted} attempts, 0 successes`);
  }

  return NextResponse.json({
    eligible: eligibleCount?.count ?? 0,
    attempted,
    resolved,
    unresolved,
    errors,
    timedOut,
  });
}
