import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, documents, prelimAnalyses } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getSignedUrl } from '@/lib/integrations/s3/client';
import { analyzePrelim } from '@/lib/tessa';

const ALLOWED_ROLES = [
  'super_admin', 'admin', 'cs_admin',
  'title_officer', 'escrow_officer', 'title_production',
  'sales_rep', 'sales_manager', 'open_order_team',
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

  const signedUrlResult = await getSignedUrl(doc.storageKey, 3600);
  if (!signedUrlResult.success || !signedUrlResult.data) {
    return NextResponse.json({ error: 'Failed to generate PDF access URL' }, { status: 500 });
  }

  try {
    const result = await analyzePrelim({
      orderId: order.id,
      documentId: doc.id,
      fileNumber: order.fileNumber,
      pdfUrl: signedUrlResult.data,
      triggeredBy: 'manual',
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[TESSA] Manual analysis failed:', err);
    return NextResponse.json(
      { error: 'Analysis failed', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
