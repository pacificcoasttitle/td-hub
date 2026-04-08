import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { prelimAnalyses, documents } from '@/lib/db/schema';
import { sql, eq, desc, and, isNull } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin'];

export async function GET() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [statsRows, recent, errorRows, unanalyzedCount] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          complete: sql<number>`count(*) filter (where ${prelimAnalyses.status} = 'complete')::int`,
          failed: sql<number>`count(*) filter (where ${prelimAnalyses.status} = 'failed')::int`,
          pending: sql<number>`count(*) filter (where ${prelimAnalyses.status} not in ('complete','failed'))::int`,
          lastSuccessAt: sql<string>`max(case when ${prelimAnalyses.status} = 'complete' then ${prelimAnalyses.completedAt} end)`,
          lastFailureAt: sql<string>`max(case when ${prelimAnalyses.status} = 'failed' then ${prelimAnalyses.updatedAt} end)`,
        })
        .from(prelimAnalyses),

      db
        .select({
          id: prelimAnalyses.id,
          orderId: prelimAnalyses.orderId,
          fileNumber: prelimAnalyses.fileNumber,
          status: prelimAnalyses.status,
          errorMessage: prelimAnalyses.errorMessage,
          errorStep: prelimAnalyses.errorStep,
          errorType: prelimAnalyses.errorType,
          triggeredBy: prelimAnalyses.triggeredBy,
          createdAt: prelimAnalyses.createdAt,
          completedAt: prelimAnalyses.completedAt,
        })
        .from(prelimAnalyses)
        .orderBy(desc(prelimAnalyses.createdAt))
        .limit(20),

      db
        .select({
          msg: prelimAnalyses.errorMessage,
          cnt: sql<number>`count(*)::int`,
        })
        .from(prelimAnalyses)
        .where(eq(prelimAnalyses.status, 'failed'))
        .groupBy(prelimAnalyses.errorMessage),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(documents)
        .leftJoin(prelimAnalyses, eq(documents.id, prelimAnalyses.documentId))
        .where(and(eq(documents.category, 'prelim'), isNull(prelimAnalyses.id))),
    ]);

    const s = statsRows[0]!;
    const errorBreakdown: Record<string, number> = {};
    for (const r of errorRows) {
      if (r.msg) errorBreakdown[r.msg] = r.cnt;
    }

    const recentAnalyses = recent.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      fileNumber: r.fileNumber,
      status: r.status,
      errorMessage: r.errorMessage,
      errorStep: r.errorStep,
      errorType: r.errorType,
      triggeredBy: r.triggeredBy,
      createdAt: r.createdAt?.toISOString() ?? null,
      processingTimeMs:
        r.completedAt && r.createdAt
          ? r.completedAt.getTime() - r.createdAt.getTime()
          : null,
    }));

    return NextResponse.json({
      stats: {
        total: s.total,
        complete: s.complete,
        failed: s.failed,
        pending: s.pending,
        documentsWithoutAnalysis: unanalyzedCount[0]?.count ?? 0,
        lastSuccessAt: s.lastSuccessAt ?? null,
        lastFailureAt: s.lastFailureAt ?? null,
      },
      recentAnalyses,
      errorBreakdown,
    });
  } catch (err) {
    console.error('[OPS] tessa error:', err);
    return NextResponse.json(
      { error: 'Failed to load TESSA status', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
