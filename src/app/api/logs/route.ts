import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import { eq, desc, and, lt, gte, lte, SQL } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];
const PAGE_LIMIT = 50;

const querySchema = z.object({
  cursor: z.coerce.number().optional(),
  vendor: z.string().optional(),
  success: z.string().optional(),
  orderId: z.coerce.number().optional(),
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

    const conditions: SQL[] = [];

    if (params.cursor) {
      conditions.push(lt(vendorApiLogs.id, params.cursor));
    }

    if (params.vendor) {
      conditions.push(eq(vendorApiLogs.vendor, params.vendor));
    }

    if (params.orderId) {
      conditions.push(eq(vendorApiLogs.orderId, params.orderId));
    }

    if (params.success === 'true' || params.success === 'false') {
      conditions.push(eq(vendorApiLogs.success, params.success === 'true'));
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

    const rows = await db.select({
      id: vendorApiLogs.id,
      vendor: vendorApiLogs.vendor,
      operation: vendorApiLogs.operation,
      orderId: vendorApiLogs.orderId,
      requestId: vendorApiLogs.requestId,
      success: vendorApiLogs.success,
      httpStatus: vendorApiLogs.httpStatus,
      errorCategory: vendorApiLogs.errorCategory,
      startedAt: vendorApiLogs.startedAt,
      endedAt: vendorApiLogs.endedAt,
      createdAt: vendorApiLogs.createdAt,
    })
      .from(vendorApiLogs)
      .where(where)
      .orderBy(desc(vendorApiLogs.id))
      .limit(PAGE_LIMIT);

    const nextCursor = rows.length === PAGE_LIMIT ? rows[rows.length - 1]!.id : null;

    return NextResponse.json({
      logs: rows,
      nextCursor,
      hasMore: rows.length === PAGE_LIMIT,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
