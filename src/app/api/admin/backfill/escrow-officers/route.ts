import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import { getOrderDetails } from '@/lib/integrations/softpro';
import { loadEscrowOfficers, resolveEscrowOfficerId } from '@/lib/jobs/handlers/import-orders';
import { getSession } from '@/lib/security/auth';
import { expectsPctEscrowOfficerSql } from '@/lib/domain/orders/escrow-officer-expectation';

export const maxDuration = 300;

const ALLOWED_ROLES = ['super_admin', 'admin', 'cs_admin'];
const TIME_BUDGET_MS = 240_000;

type BackfillError = {
  orderId: number;
  fileNumber: string;
  error: string;
  escrowOfficer?: string;
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 50);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 100);
  const startTime = Date.now();

  const eligibleFilter = and(
    expectsPctEscrowOfficerSql(sql`${orders.orderType}`),
    inArray(orders.operationalStatus, ['open', 'in_process', 'completed']),
    isNull(orders.escrowOfficerId),
  );

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
    .orderBy(desc(orders.createdAt))
    .limit(limit);

  const escrowOfficers = await loadEscrowOfficers();
  const errors: BackfillError[] = [];

  let attempted = 0;
  let resolved = 0;
  let unmatched = 0;
  let notInSoftpro = 0;
  let timedOut = false;

  for (const order of eligibleOrders) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    attempted++;

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
    const escrowOfficer = detail?.EscrowOfficer?.trim();

    if (!escrowOfficer) {
      notInSoftpro++;
      errors.push({
        orderId: order.id,
        fileNumber: order.fileNumber,
        error: 'SoftPro GetOrderDetails did not return EscrowOfficer',
      });
      continue;
    }

    const escrowOfficerId = resolveEscrowOfficerId(escrowOfficer, escrowOfficers);
    if (!escrowOfficerId) {
      unmatched++;
      errors.push({
        orderId: order.id,
        fileNumber: order.fileNumber,
        escrowOfficer,
        error: `No escrow officer contact matched SoftPro EscrowOfficer "${escrowOfficer}"`,
      });
      continue;
    }

    await db
      .update(orders)
      .set({
        escrowOfficerId,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    resolved++;
  }

  return NextResponse.json({
    eligible: eligibleCount?.count ?? 0,
    attempted,
    resolved,
    unmatched,
    notInSoftpro,
    timedOut,
    errors,
  });
}
