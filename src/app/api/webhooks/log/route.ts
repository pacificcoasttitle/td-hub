import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import { eq, desc, and, sql, SQL } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];
const WEBHOOK_VENDOR = 'softpro_webhook';

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  type: z.string().optional(),
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

    const conditions: SQL[] = [eq(vendorApiLogs.vendor, WEBHOOK_VENDOR)];

    if (params.type) {
      conditions.push(eq(vendorApiLogs.operation, params.type));
    }
    if (params.success === 'true' || params.success === 'false') {
      conditions.push(eq(vendorApiLogs.success, params.success === 'true'));
    }

    const where = and(...conditions);

    const [rows, countResult, typeResult] = await Promise.all([
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
        requestMeta: vendorApiLogs.requestMeta,
        responseMeta: vendorApiLogs.responseMeta,
        createdAt: vendorApiLogs.createdAt,
      }).from(vendorApiLogs).where(where)
        .orderBy(desc(vendorApiLogs.createdAt))
        .limit(pageSize).offset(offset),

      db.select({ count: sql<number>`count(*)` }).from(vendorApiLogs).where(where),

      db.selectDistinct({ operation: vendorApiLogs.operation })
        .from(vendorApiLogs)
        .where(eq(vendorApiLogs.vendor, WEBHOOK_VENDOR))
        .orderBy(vendorApiLogs.operation),
    ]);

    return NextResponse.json({
      logs: rows,
      total: Number(countResult[0]?.count ?? 0),
      types: typeResult.map((r) => r.operation),
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
