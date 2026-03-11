import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import { eq, desc, and, sql, SQL } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  vendor: z.string().optional(),
  operation: z.string().optional(),
  orderId: z.coerce.number().optional(),
  success: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawParams = Object.fromEntries(req.nextUrl.searchParams);
    const params = querySchema.parse(rawParams);
    const { page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [];

    if (params.vendor) {
      conditions.push(eq(vendorApiLogs.vendor, params.vendor));
    }
    if (params.operation) {
      conditions.push(eq(vendorApiLogs.operation, params.operation));
    }
    if (params.orderId) {
      conditions.push(eq(vendorApiLogs.orderId, params.orderId));
    }
    if (params.success === 'true' || params.success === 'false') {
      conditions.push(eq(vendorApiLogs.success, params.success === 'true'));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db.select({
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
      }).from(vendorApiLogs).where(where)
        .orderBy(desc(vendorApiLogs.createdAt))
        .limit(pageSize).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(vendorApiLogs).where(where),
    ]);

    return NextResponse.json({
      logs: rows,
      total: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
