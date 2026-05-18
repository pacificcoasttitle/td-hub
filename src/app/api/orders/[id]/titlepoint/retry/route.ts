import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { retryFailedSearches } from '@/lib/domain/titlepoint/service';

export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const canAccess = await canAccessOrder(session, orderId);
    if (!canAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const result = await retryFailedSearches(orderId, session.id ?? 'admin');

    if (result.retried === 0 && result.failed === 0) {
      return NextResponse.json(
        { message: 'No failed TitlePoint searches to retry', ...result },
        { status: 200 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Retry failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
