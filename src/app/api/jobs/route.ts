import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { eq, desc, and, sql, SQL } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  status: z.string().optional(),
  jobType: z.string().optional(),
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

    if (params.status) {
      conditions.push(eq(jobs.status, params.status as (typeof jobs.status.enumValues)[number]));
    }
    if (params.jobType) {
      conditions.push(eq(jobs.jobType, params.jobType));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db.select({
        id: jobs.id,
        jobType: jobs.jobType,
        orderId: jobs.orderId,
        status: jobs.status,
        attempts: jobs.attempts,
        maxAttempts: jobs.maxAttempts,
        error: jobs.error,
        startedAt: jobs.startedAt,
        endedAt: jobs.endedAt,
        createdAt: jobs.createdAt,
      }).from(jobs).where(where)
        .orderBy(desc(jobs.createdAt))
        .limit(pageSize).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(jobs).where(where),
    ]);

    return NextResponse.json({
      jobs: rows,
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
