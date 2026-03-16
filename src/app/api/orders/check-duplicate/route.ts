import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, orderProperties } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const bodySchema = z.object({
  apn: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  try {
    const rows = await db
      .select({
        orderId: orderProperties.orderId,
        fileNumber: orders.fileNumber,
        status: orders.operationalStatus,
      })
      .from(orderProperties)
      .innerJoin(orders, eq(orders.id, orderProperties.orderId))
      .where(eq(orderProperties.apn, parsed.data.apn))
      .limit(1);

    if (rows.length > 0) {
      const existing = rows[0]!;
      return NextResponse.json({
        isDuplicate: true,
        existingFileNumber: existing.fileNumber,
        existingOrderId: existing.orderId,
        existingStatus: existing.status,
      });
    }

    return NextResponse.json({ isDuplicate: false });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
