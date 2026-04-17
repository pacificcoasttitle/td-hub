import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, documents, prelimAnalyses } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { analyzePrelim } from '@/lib/tessa';

const ALLOWED_ROLES = [
  'super_admin', 'admin', 'cs_admin',
  'title_officer', 'escrow_officer', 'title_production',
  'sales_rep', 'sales_manager', 'open_order_team', 'escrow_assistant',
];

export const maxDuration = 120;

export async function POST(
  req: NextRequest,
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

  const [order] = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const [doc] = await db
    .select({ id: documents.id, storageKey: documents.storageKey })
    .from(documents)
    .where(and(eq(documents.orderId, orderId), eq(documents.category, 'prelim')))
    .orderBy(desc(documents.createdAt))
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: 'No prelim document found for this order' }, { status: 404 });
  }

  const force = req.nextUrl.searchParams.get('force') === 'true';

  if (!force) {
    const [existing] = await db
      .select({ id: prelimAnalyses.id, status: prelimAnalyses.status })
      .from(prelimAnalyses)
      .where(and(eq(prelimAnalyses.orderId, orderId), eq(prelimAnalyses.status, 'complete')))
      .orderBy(desc(prelimAnalyses.createdAt))
      .limit(1);

    if (existing) {
      return NextResponse.json({ analysisId: existing.id, status: 'complete', cached: true });
    }
  }

  try {
    const result = await analyzePrelim({
      orderId: order.id,
      documentId: doc.id,
      fileNumber: order.fileNumber,
      storageKey: doc.storageKey,
      triggeredBy: 'manual',
    });

    if (result.status === 'failed') {
      console.error('[TESSA] Manual route returning failed result', result);

      let errorMessage = result.error ?? 'Analysis failed';
      let errorStep: string | null = result.errorStep ?? 'creating_row';

      if (result.analysisId > 0) {
        const [row] = await db
          .select({
            id: prelimAnalyses.id,
            errorMessage: prelimAnalyses.errorMessage,
            errorStep: prelimAnalyses.errorStep,
          })
          .from(prelimAnalyses)
          .where(eq(prelimAnalyses.id, result.analysisId))
          .limit(1);

        if (row) {
          errorMessage = row.errorMessage ?? errorMessage;
          errorStep = row.errorStep ?? null;
        }
      }

      return NextResponse.json({
        analysisId: result.analysisId,
        status: 'failed',
        error: errorMessage,
        errorStep,
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[TESSA] Manual analysis failed:', { message, stack });
    return NextResponse.json(
      { error: 'Analysis failed', detail: message },
      { status: 500 },
    );
  }
}
