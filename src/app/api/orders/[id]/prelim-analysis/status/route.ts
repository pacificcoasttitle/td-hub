import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrderDetailResource } from '@/lib/security/permissions';
import { db } from '@/lib/db/client';
import { prelimAnalyses } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

const ALLOWED_ROLES = [
  'super_admin', 'admin', 'cs_admin',
  'title_officer', 'escrow_officer', 'title_production',
  'sales_rep', 'sales_manager', 'open_order_team', 'escrow_assistant',
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

  if (!(await canAccessOrderDetailResource(session, orderId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const [row] = await db
      .select({
        id: prelimAnalyses.id,
        status: prelimAnalyses.status,
        errorMessage: prelimAnalyses.errorMessage,
      })
      .from(prelimAnalyses)
      .where(eq(prelimAnalyses.orderId, orderId))
      .orderBy(desc(prelimAnalyses.createdAt))
      .limit(1);

    if (!row) {
      return NextResponse.json({ analysisId: null, status: 'not_started', error: null });
    }

    return NextResponse.json({
      analysisId: row.id,
      status: row.status,
      error: row.errorMessage,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
