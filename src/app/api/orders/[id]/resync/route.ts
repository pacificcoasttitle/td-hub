import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder, isStaff } from '@/lib/security/permissions';
import { resyncFromSoftPro } from '@/lib/domain/orders/resync-from-softpro';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isStaff(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const canAccess = await canAccessOrder(session, orderId);
    if (!canAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const result = await resyncFromSoftPro(orderId);
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error ?? 'Resync failed — SoftPro re-pull did not complete',
          orderId: result.orderId,
          fileNumber: result.fileNumber,
        },
        { status: result.error === 'Order not found' ? 404 : 502 },
      );
    }

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      fileNumber: result.fileNumber,
      updated: result.updated,
      changes: result.changes,
      partiesWritten: result.partiesWritten,
      message: result.updated
        ? `Resynced from SoftPro — ${result.changes.length} change${result.changes.length === 1 ? '' : 's'}`
        : 'SoftPro re-pulled — no changes',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Resync failed — please try again' },
      { status: 500 },
    );
  }
}
