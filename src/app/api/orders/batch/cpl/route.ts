import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { generateCpl } from '@/lib/domain/cpl/service';

const ALLOWED_ROLES = [
  'super_admin', 'admin', 'cs_admin', 'open_order_team', 'escrow_assistant',
];

const bodySchema = z.object({
  orderIds: z.array(z.number().int().positive()).min(1).max(50),
  underwriter: z.enum(['westcor', 'fnf', 'natic', 'doma']),
  branchId: z.number().int().positive(),
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
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  const { orderIds, underwriter, branchId, cplMode, lenderOverrides } = parsed.data;

  const results: Array<{
    orderId: number;
    success: boolean;
    documentId?: number;
    error?: string;
  }> = [];

  for (const orderId of orderIds) {
    try {
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
