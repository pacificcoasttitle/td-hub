import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, orderProperties } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

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
        dupOverride: orders.dupOverride,
      })
      .from(orderProperties)
      .innerJoin(orders, eq(orders.id, orderProperties.orderId))
      .where(eq(orderProperties.apn, parsed.data.apn))
      .limit(5);

    const blocking = rows.filter(r => !r.dupOverride);

    if (blocking.length > 0) {
      const first = blocking[0]!;
      return NextResponse.json({
        isDuplicate: true,
        existingFileNumber: first.fileNumber,
        existingOrderId: first.orderId,
        existingStatus: first.status,
        overriddenCount: rows.length - blocking.length,
      });
    }

    return NextResponse.json({
      isDuplicate: false,
      overriddenCount: rows.length,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
