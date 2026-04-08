import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, orderProperties, jobs } from '@/lib/db/schema';
import { sql, eq, desc, isNotNull, or } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin'];

export async function GET() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [orderStats, lastSync, lastImport, recentSyncs, recentImports] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          withSalesRep: sql<number>`count(*) filter (where ${orders.salesRepId} is not null)::int`,
          withEscrow: sql<number>`count(*) filter (where ${orders.escrowOfficerId} is not null)::int`,
        })
        .from(orders),

      db
        .select({ at: sql<string>`max(${orders.softproLastSyncedAt})` })
        .from(orders),

      db
        .select({ at: sql<string>`max(${jobs.endedAt})` })
        .from(jobs)
        .where(eq(jobs.jobType, 'import-orders')),

      db
        .select({
          id: jobs.id,
          jobType: jobs.jobType,
          status: jobs.status,
          startedAt: jobs.startedAt,
          endedAt: jobs.endedAt,
          error: jobs.error,
        })
        .from(jobs)
        .where(
          or(
            eq(jobs.jobType, 'softpro.sync_recent_orders'),
            eq(jobs.jobType, 'softpro.enrich_orders'),
          ),
        )
        .orderBy(desc(jobs.createdAt))
        .limit(5),

      db
        .select({
          id: jobs.id,
          jobType: jobs.jobType,
          status: jobs.status,
          startedAt: jobs.startedAt,
          endedAt: jobs.endedAt,
          error: jobs.error,
        })
        .from(jobs)
        .where(eq(jobs.jobType, 'import-orders'))
        .orderBy(desc(jobs.createdAt))
        .limit(5),
    ]);

    const addressCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orderProperties)
      .where(isNotNull(orderProperties.fullAddress));

    const o = orderStats[0]!;
    const withAddress = addressCount[0]?.count ?? 0;
    const missingEnrichment = Math.max(0, o.total - withAddress);

    const formatJob = (j: typeof recentSyncs[number]) => ({
      id: j.id,
      jobType: j.jobType,
      status: j.status,
      startedAt: j.startedAt?.toISOString() ?? null,
      endedAt: j.endedAt?.toISOString() ?? null,
      error: j.error,
    });

    return NextResponse.json({
      orders: {
        total: o.total,
        withAddress,
        withSalesRep: o.withSalesRep,
        withEscrow: o.withEscrow,
        missingEnrichment,
        lastSyncAt: lastSync[0]?.at ?? null,
        lastImportAt: lastImport[0]?.at ?? null,
      },
      recentSyncJobs: recentSyncs.map(formatJob),
      recentImportJobs: recentImports.map(formatJob),
    });
  } catch (err) {
    console.error('[OPS] sync error:', err);
    return NextResponse.json(
      { error: 'Failed to load sync status', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
