import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { orders } from '@/lib/db/schema';
import { getScopedOrders } from '@/lib/domain/orders/scoped-queries';
import type { TaskPriority } from '@/lib/domain/escrow/tasks';
import {
  loadEscrowTaskOrderRows,
  orderIdsMatchingTaskPriority,
} from '@/lib/domain/escrow/escrow-tasks-derivation';

const ALLOWED_ROLES = ['escrow_officer', 'super_admin', 'admin', 'cs_admin'];

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  status: z.string().optional(),
  search: z.string().optional(),
  priority: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().min(1).max(3).optional(),
  ),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.contactId) return NextResponse.json({ error: 'Profile not linked to a contact' }, { status: 422 });

  let parsed: z.infer<typeof querySchema>;
  try {
    parsed = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: e.issues }, { status: 400 });
    }
    throw e;
  }

  let restrictToOrderIds: number[] | undefined;
  if (parsed.priority !== undefined) {
    const ordersData = await loadEscrowTaskOrderRows('escrow_officer', session.contactId);
    const now = Date.now();
    restrictToOrderIds = orderIdsMatchingTaskPriority(
      ordersData,
      'escrow_officer',
      now,
      parsed.priority as TaskPriority,
    );
  }

  const result = await getScopedOrders({
    scopeColumn: orders.escrowOfficerId,
    contactId: session.contactId,
    page: parsed.page,
    pageSize: parsed.pageSize,
    status: parsed.status,
    search: parsed.search,
    restrictToOrderIds,
  });

  return NextResponse.json(result);
}
