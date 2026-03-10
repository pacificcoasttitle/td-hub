import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getOrders } from '@/lib/domain/orders/service';

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  status: z.string().optional(),
  search: z.string().optional(),
  branchId: z.coerce.number().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const rawParams = Object.fromEntries(req.nextUrl.searchParams);
    const params = querySchema.parse(rawParams);
    const result = await getOrders(params);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
