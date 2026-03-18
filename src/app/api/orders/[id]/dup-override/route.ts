import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

const bodySchema = z.object({
  enabled: z.boolean(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const [existing] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    await db.update(orders).set({
      dupOverride: parsed.data.enabled,
      updatedAt: new Date(),
    }).where(eq(orders.id, orderId));

    return NextResponse.json({ id: orderId, dupOverride: parsed.data.enabled });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
