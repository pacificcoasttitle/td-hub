import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { prelimAnalyses } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

const ALLOWED_ROLES = [
  'super_admin', 'admin', 'cs_admin',
  'title_officer', 'escrow_officer', 'title_production',
  'sales_rep', 'sales_manager', 'open_order_team',
];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  try {
    const [analysis] = await db
      .select({
        id: prelimAnalyses.id,
        status: prelimAnalyses.status,
        triggeredBy: prelimAnalyses.triggeredBy,
        complexityScore: prelimAnalyses.complexityScore,
        complexityLevel: prelimAnalyses.complexityLevel,
        complexityReasons: prelimAnalyses.complexityReasons,
        summaryText: prelimAnalyses.summaryText,
        extractionJson: prelimAnalyses.extractionJson,
        requirementCount: prelimAnalyses.requirementCount,
        blockerCount: prelimAnalyses.blockerCount,
        lienCount: prelimAnalyses.lienCount,
        taxCount: prelimAnalyses.taxCount,
        taxDefaultCount: prelimAnalyses.taxDefaultCount,
        otherFindingCount: prelimAnalyses.otherFindingCount,
        foreclosureDetected: prelimAnalyses.foreclosureDetected,
        errorMessage: prelimAnalyses.errorMessage,
        errorStep: prelimAnalyses.errorStep,
        createdAt: prelimAnalyses.createdAt,
        completedAt: prelimAnalyses.completedAt,
      })
      .from(prelimAnalyses)
      .where(eq(prelimAnalyses.orderId, orderId))
      .orderBy(desc(prelimAnalyses.createdAt))
      .limit(1);

    if (!analysis) {
      return NextResponse.json({ error: 'No analysis found for this order' }, { status: 404 });
    }

    const processingTimeMs =
      analysis.completedAt && analysis.createdAt
        ? analysis.completedAt.getTime() - analysis.createdAt.getTime()
        : null;

    return NextResponse.json({
      id: analysis.id,
      status: analysis.status,
      triggeredBy: analysis.triggeredBy,
      complexityScore: analysis.complexityScore,
      complexityLevel: analysis.complexityLevel,
      complexityReasons: analysis.complexityReasons,
      summaryText: analysis.summaryText,
      extractionJson: analysis.extractionJson,
      requirementCount: analysis.requirementCount,
      blockerCount: analysis.blockerCount,
      lienCount: analysis.lienCount,
      taxParcelCount: analysis.taxCount,
      findingCount: analysis.otherFindingCount,
      foreclosureDetected: analysis.foreclosureDetected,
      errorMessage: analysis.errorMessage,
      errorStep: analysis.errorStep,
      createdAt: analysis.createdAt,
      completedAt: analysis.completedAt,
      processingTimeMs,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
