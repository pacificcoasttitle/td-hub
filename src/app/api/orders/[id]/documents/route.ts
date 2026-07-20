import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrderDetailResource } from '@/lib/security/permissions';
import { getOrderDocuments } from '@/lib/domain/orders/documents';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    if (!(await canAccessOrderDetailResource(session, orderId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const result = await getOrderDocuments(orderId, 'staff', {
      category: req.nextUrl.searchParams.get('category'),
    });

    if (!result.ok) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }

    return NextResponse.json({ documents: result.documents });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load documents' },
      { status: 500 },
    );
  }
}
