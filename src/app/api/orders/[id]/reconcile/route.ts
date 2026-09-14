import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { ORDER_CREATE_ROLES } from '@/lib/domain/orders/create-roles';
import { getReconcileState, reconcileFailedCreate } from '@/lib/domain/orders/reconcile-create';

// Finish a hub create that SoftPro accepted and the hub's own write did not.
// Pressable by the people who open orders — the open order team hits these
// failures, and the point is that they no longer need to message Gerard.
// See src/lib/domain/orders/reconcile-create.ts.

async function authorize(params: Promise<{ id: string }>) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!ORDER_CREATE_ROLES.includes(session.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return { error: NextResponse.json({ error: 'Invalid order ID' }, { status: 400 }) };
  if (!(await canAccessOrder(session, orderId))) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { session, orderId };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json(await getReconcileState(auth.orderId));
  } catch {
    return NextResponse.json({ error: 'Could not read reconcile state' }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params);
  if ('error' in auth) return auth.error;
  try {
    const result = await reconcileFailedCreate(auth.orderId, auth.session.id);
    if (result.ok) return NextResponse.json(result);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.code === 'NOT_NEEDED' ? 409 : 422 });
  } catch (err) {
    return NextResponse.json(
      { error: 'Finish saving failed', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
