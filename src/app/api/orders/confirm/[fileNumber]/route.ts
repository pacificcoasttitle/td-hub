import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadConfirmationData } from '@/lib/domain/orders/confirm-data';

const paramSchema = z.object({
  fileNumber: z.string().min(1),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileNumber: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = await params;
  const parsed = paramSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid file number' }, { status: 400 });
  }

  // SAME ORDER-ACCESS CHECK AS THE OTHER ORDER ROUTES. Until 2026-09-14 this
  // returned party names, emails and phones, the opener's email, the property and
  // the owners for any file number to any logged-in session — and file numbers
  // run in sequence. A file the session cannot open reads as not found.
  const [order] = await db.select({ id: orders.id }).from(orders)
    .where(eq(orders.fileNumber, parsed.data.fileNumber)).limit(1);
  if (!order || !(await canAccessOrder(session, order.id))) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  try {
    const data = await loadConfirmationData(parsed.data.fileNumber);
    if (!data) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
