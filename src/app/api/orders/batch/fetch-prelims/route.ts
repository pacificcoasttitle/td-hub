import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { fetchPrelimsForOrder } from '@/lib/jobs/handlers/fetch-prelims';

const bodySchema = z.object({
  orderIds: z.array(z.number().int().positive()).min(1).max(50),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  const { orderIds } = parsed.data;

  const results: Array<{
    orderId: number;
    success: boolean;
    documentsFound: number;
    error?: string;
  }> = [];

  for (const orderId of orderIds) {
    try {
      const [order] = await db
        .select({ fileNumber: orders.fileNumber })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) {
        results.push({ orderId, success: false, documentsFound: 0, error: 'Order not found' });
        continue;
      }

      const stored = await fetchPrelimsForOrder(orderId, order.fileNumber);
      results.push({ orderId, success: true, documentsFound: stored });
    } catch (err) {
      results.push({
        orderId,
        success: false,
        documentsFound: 0,
        error: err instanceof Error ? err.message : 'Unexpected error',
      });
    }
  }

  return NextResponse.json({ results });
}
