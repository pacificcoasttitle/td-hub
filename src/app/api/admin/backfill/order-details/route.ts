import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import { getOrderDetails } from '@/lib/integrations/softpro';
import {
  loadEscrowOfficers,
  loadSalesReps,
  loadTitleOfficers,
  processOrderDetail,
} from '@/lib/domain/orders/process-detail';
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

function parseMinAgeDays(value: string | null): number {
  const requested = Number(value ?? 0);
  return Math.max(Number.isFinite(requested) ? requested : 0, 0);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = parseLimit(req.nextUrl.searchParams.get('limit'));
  const minAgeDays = parseMinAgeDays(req.nextUrl.searchParams.get('minAge'));
  const startTime = Date.now();

  const conditions = [
    eq(orders.source, 'softpro_sync'),
    inArray(orders.operationalStatus, ['open', 'in_process', 'completed']),
    or(
      sql`NOT EXISTS (
        SELECT 1 FROM order_properties
        WHERE order_properties.order_id = ${orders.id}
          AND order_properties.address IS NOT NULL
      )`,
      sql`${orders.salesRepId} IS NULL`,
      sql`${orders.titleOfficerId} IS NULL`,
    )!,
  ];

  if (minAgeDays > 0) {
    conditions.push(lt(orders.createdAt, new Date(Date.now() - minAgeDays * 24 * 60 * 60 * 1000)));
  }

  const eligibleFilter = and(...conditions);

  const [eligibleCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(eligibleFilter);

  const eligibleOrders = await db
    .select({
      id: orders.id,
      fileNumber: orders.fileNumber,
    })
    .from(orders)
    .where(eligibleFilter)
    .orderBy(asc(orders.createdAt))
    .limit(limit);

  const [salesReps, titleOfficers, escrowOfficers] = await Promise.all([
    loadSalesReps(),
    loadTitleOfficers(),
    loadEscrowOfficers(),
  ]);

  const errors: BackfillError[] = [];
  let attempted = 0;
  let enriched = 0;
  let timedOut = false;

  for (const order of eligibleOrders) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    attempted++;

    try {
      const apiResult = await getOrderDetails({
        dateFrom: '',
        orderNumber: order.fileNumber,
        orderId: order.id,
      });

      if (!apiResult.success || !apiResult.data) {
        errors.push({
          orderId: order.id,
          fileNumber: order.fileNumber,
          error: apiResult.error?.message ?? 'GetOrderDetails returned no data',
        });
        continue;
      }

      const detail = apiResult.data.find((item) => item.OrderNumber === order.fileNumber) ?? apiResult.data[0];
      if (!detail) {
        errors.push({
          orderId: order.id,
          fileNumber: order.fileNumber,
          error: 'GetOrderDetails returned an empty detail list',
        });
        continue;
      }

      await processOrderDetail(detail, { salesReps, titleOfficers, escrowOfficers });
      enriched++;
    } catch (err) {
      errors.push({
        orderId: order.id,
        fileNumber: order.fileNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    eligible: eligibleCount?.count ?? 0,
    attempted,
    enriched,
    errors,
    timedOut,
  });
}
