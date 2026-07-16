import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrderDetailResource } from '@/lib/security/permissions';
import { generateCpl } from '@/lib/domain/cpl/service';
import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const bodySchema = z.object({
  orderIds: z.array(z.number().int().positive()).min(1).max(50),
  underwriter: z.enum(['westcor', 'fnf', 'natic', 'doma']),
  cplMode: z.enum(['single', 'multiple']).optional(),
  lenderOverrides: z.object({
    name: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  }).optional(),
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

  const { orderIds, underwriter, cplMode, lenderOverrides } = parsed.data;

  const results: Array<{
    orderId: number;
    success: boolean;
    documentId?: number;
    error?: string;
  }> = [];

  for (const orderId of orderIds) {
    try {
      if (!(await canAccessOrderDetailResource(session, orderId))) {
        results.push({ orderId, success: false, error: 'Not found' });
        continue;
      }

      const branchId = await resolveOrderBranchId(orderId);
      if (!branchId) {
        results.push({
          orderId,
          success: false,
          error: 'Order has no branch assigned',
        });
        continue;
      }

      const result = await generateCpl(
        { orderId, underwriter, branchId, cplMode, lenderOverrides },
        session.id,
      );
      results.push({
        orderId,
        success: result.success,
        documentId: result.documentId,
        error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      });
    } catch (err) {
      results.push({
        orderId,
        success: false,
        error: err instanceof Error ? err.message : 'Unexpected error',
      });
    }
  }

  return NextResponse.json({ results });
}

async function resolveOrderBranchId(orderId: number): Promise<number | null> {
  const [row] = await db
    .select({ branchId: orders.branchId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  return row?.branchId ?? null;
}
