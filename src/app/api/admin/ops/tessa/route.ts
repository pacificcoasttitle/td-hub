import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { prelimAnalyses, documents } from '@/lib/db/schema';
import { sql, eq, desc, and, isNull, gte, lt } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const month = Number(req.nextUrl.searchParams.get('month') || now.getMonth() + 1);
    const year = Number(req.nextUrl.searchParams.get('year') || now.getFullYear());
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);
    const monthFilter = and(gte(prelimAnalyses.createdAt, monthStart), lt(prelimAnalyses.createdAt, monthEnd));

    const [statsRows, recent, unanalyzedCount] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          complete: sql<number>`count(*) filter (where ${prelimAnalyses.status} = 'complete')::int`,
          failed: sql<number>`count(*) filter (where ${prelimAnalyses.status} = 'failed')::int`,
          pending: sql<number>`count(*) filter (where ${prelimAnalyses.status} not in ('complete','failed'))::int`,
          lastSuccessAt: sql<string>`max(case when ${prelimAnalyses.status} = 'complete' then ${prelimAnalyses.completedAt} end)`,
          lastFailureAt: sql<string>`max(case when ${prelimAnalyses.status} = 'failed' then ${prelimAnalyses.updatedAt} end)`,
        })
        .from(prelimAnalyses)
        .where(monthFilter),

      db
        .select({
          id: prelimAnalyses.id,
          orderId: prelimAnalyses.orderId,
          fileNumber: prelimAnalyses.fileNumber,
          status: prelimAnalyses.status,
          errorMessage: prelimAnalyses.errorMessage,
          errorStep: prelimAnalyses.errorStep,
          triggeredBy: prelimAnalyses.triggeredBy,
          createdAt: prelimAnalyses.createdAt,
          completedAt: prelimAnalyses.completedAt,
        })
        .from(prelimAnalyses)
        .where(monthFilter)
        .orderBy(desc(prelimAnalyses.createdAt))
        .limit(20),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(documents)
        .leftJoin(prelimAnalyses, eq(documents.id, prelimAnalyses.documentId))
        .where(and(
          eq(documents.category, 'prelim'),
          gte(documents.createdAt, monthStart),
          lt(documents.createdAt, monthEnd),
          isNull(prelimAnalyses.id),
        )),
    ]);

    const s = statsRows[0]!;

    const recentAnalyses = recent.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      fileNumber: r.fileNumber,
      status: r.status,
      errorMessage: r.errorMessage,
      errorStep: r.errorStep,
      triggeredBy: r.triggeredBy,
      createdAt: r.createdAt?.toISOString() ?? null,
      processingTimeMs:
        r.completedAt && r.createdAt
          ? r.completedAt.getTime() - r.createdAt.getTime()
          : null,
    }));

    const errorBreakdown: Record<string, number> = {};
    for (const a of recentAnalyses) {
      if (a.status === 'failed' && a.errorMessage) {
        errorBreakdown[a.errorMessage] = (errorBreakdown[a.errorMessage] ?? 0) + 1;
      }
    }

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
