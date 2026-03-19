import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { orders, orderProperties } from '@/lib/db/schema';
import { eq, desc, sql, ilike, or, and, SQL } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';

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

    const conditions: SQL[] = [];

    // TODO: Builder agent — scope to orders this client has access to
    // For now, all authenticated users see all orders. Once party-based
    // scoping is implemented, filter by orders where user is a linked party.

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
          openedAt: orders.openedAt,
          address: orderProperties.address,
          city: orderProperties.city,
          state: orderProperties.state,
        })
        .from(orders)
        .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
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

    return NextResponse.json({
      orders: rows,
      total: Number(countResult[0]?.count ?? 0),
      page: params.page,
      pageSize: params.pageSize,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
