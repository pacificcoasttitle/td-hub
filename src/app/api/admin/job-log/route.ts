import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { vendorApiLogs, orders } from '@/lib/db/schema';
import { eq, and, desc, sql, ilike, or, gte, lte, SQL } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team', 'escrow_assistant'];

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  vendor: z.string().optional(),
  status: z.enum(['success', 'error']).optional(),
  orderId: z.coerce.number().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawParams = Object.fromEntries(req.nextUrl.searchParams);
    const params = querySchema.parse(rawParams);
    const offset = (params.page - 1) * params.limit;

    const conditions: SQL[] = [];

    if (params.vendor) {
      conditions.push(eq(vendorApiLogs.vendor, params.vendor));
    }

    if (params.status === 'success') {
      conditions.push(eq(vendorApiLogs.success, true));
    } else if (params.status === 'error') {
      conditions.push(
        or(
          eq(vendorApiLogs.success, false),
          sql`${vendorApiLogs.success} IS NULL`,
        )!
      );
    }

    if (params.orderId) {
      conditions.push(eq(vendorApiLogs.orderId, params.orderId));
    }

    if (params.search) {
      const term = `%${params.search}%`;
      conditions.push(
        or(
          ilike(vendorApiLogs.operation, term),
          ilike(vendorApiLogs.vendor, term),
          ilike(orders.fileNumber, term),
        )!
      );
    }

    if (params.dateFrom) {
      const from = new Date(params.dateFrom);
      if (!isNaN(from.getTime())) {
        conditions.push(gte(vendorApiLogs.createdAt, from));
      }
    }

    if (params.dateTo) {
      const to = new Date(params.dateTo);
      if (!isNaN(to.getTime())) {
        conditions.push(lte(vendorApiLogs.createdAt, to));
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: vendorApiLogs.id,
          vendor: vendorApiLogs.vendor,
          operation: vendorApiLogs.operation,
          orderId: vendorApiLogs.orderId,
          orderFileNumber: orders.fileNumber,
          success: vendorApiLogs.success,
          httpStatus: vendorApiLogs.httpStatus,
          errorCategory: vendorApiLogs.errorCategory,
          startedAt: vendorApiLogs.startedAt,
          endedAt: vendorApiLogs.endedAt,
          requestMeta: vendorApiLogs.requestMeta,
          responseMeta: vendorApiLogs.responseMeta,
          createdAt: vendorApiLogs.createdAt,
        })
        .from(vendorApiLogs)
        .leftJoin(orders, eq(vendorApiLogs.orderId, orders.id))
        .where(where)
        .orderBy(desc(vendorApiLogs.createdAt))
        .limit(params.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(vendorApiLogs)
        .leftJoin(orders, eq(vendorApiLogs.orderId, orders.id))
        .where(where),
    ]);

    const logs = rows.map((row) => {
      const durationMs =
        row.startedAt && row.endedAt
          ? row.endedAt.getTime() - row.startedAt.getTime()
          : null;

      const responseMeta = row.responseMeta as Record<string, unknown> | null;
      const errorMessage =
        row.errorCategory ??
        (responseMeta?.error as string | undefined) ??
        (responseMeta?.message as string | undefined) ??
        null;

      return {
        id: row.id,
        vendor: row.vendor,
        operation: row.operation,
        orderId: row.orderId,
        orderFileNumber: row.orderFileNumber ?? null,
        success: row.success,
        httpStatus: row.httpStatus,
        errorMessage: row.success === false ? errorMessage : null,
        durationMs,
        requestMeta: row.requestMeta,
        responseMeta: row.responseMeta,
        createdAt: row.createdAt.toISOString(),
      };
    });

    return NextResponse.json({
      logs,
      total: Number(countResult[0]?.count ?? 0),
      page: params.page,
      limit: params.limit,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: 'Failed to load job logs', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
