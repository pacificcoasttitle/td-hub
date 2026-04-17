import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { getOrders } from '@/lib/domain/orders/service';
import { db } from '@/lib/db/client';
import { orders, contacts } from '@/lib/db/schema';
import { eq, and, inArray, SQL } from 'drizzle-orm';
import { getManagedRepIds } from '@/lib/domain/contacts/managed-reps';

const FULL_ACCESS_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  status: z.string().optional(),
  search: z.string().optional(),
  branchId: z.coerce.number().optional(),
  sortBy: z.enum(['openedAt', 'fileNumber', 'operationalStatus', 'salesRep', 'productType', 'createdBy']).default('openedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

async function resolveContactId(session: { contactId: number | null; email: string }): Promise<number | null> {
  if (session.contactId) return session.contactId;
  const [row] = await db.select({ id: contacts.id }).from(contacts)
    .where(eq(contacts.email, session.email)).limit(1);
  return row?.id ?? null;
}

async function buildScopeFilter(session: { id: string; role: string; contactId: number | null; email: string }): Promise<SQL | null> {
  if (FULL_ACCESS_ROLES.includes(session.role)) return null;

  if (session.role === 'sales_rep') {
    const cid = await resolveContactId(session);
    if (!cid) return eq(orders.id, -1);
    return eq(orders.salesRepId, cid);
  }

  if (session.role === 'sales_manager') {
    const cid = await resolveContactId(session);
    if (!cid) return eq(orders.id, -1);
    const managedIds = await getManagedRepIds(cid);
    const allIds = [cid, ...managedIds];
    return inArray(orders.salesRepId, allIds);
  }

  if (session.role === 'title_officer') {
    const cid = await resolveContactId(session);
    if (!cid) return eq(orders.id, -1);
    return eq(orders.titleOfficerId, cid);
  }

  if (session.role === 'escrow_officer') {
    const cid = await resolveContactId(session);
    if (!cid) return eq(orders.id, -1);
    return eq(orders.escrowOfficerId, cid);
  }

  if (session.role === 'escrow_assistant') {
    return inArray(orders.orderType, ['Title & Escrow', 'Escrow only']);
  }

  if (session.role === 'client') {
    return eq(orders.createdBy, session.id);
  }

  return eq(orders.id, -1);
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rawParams = Object.fromEntries(req.nextUrl.searchParams);
    const params = querySchema.parse(rawParams);
    const scopeFilter = await buildScopeFilter(session);
    const result = await getOrders(params, scopeFilter);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
