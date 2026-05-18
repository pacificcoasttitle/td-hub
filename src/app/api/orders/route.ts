import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, inArray, isNull, SQL } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';
import { getOrders } from '@/lib/domain/orders/service';
import { db } from '@/lib/db/client';
import { orders, contacts } from '@/lib/db/schema';
import { getManagedRepIds } from '@/lib/domain/contacts/managed-reps';
import type { TaskPriority } from '@/lib/domain/escrow/tasks';
import {
  loadEscrowTaskOrderRows,
  orderIdsMatchingTaskPriority,
} from '@/lib/domain/escrow/escrow-tasks-derivation';

const FULL_ACCESS_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  status: z.string().optional(),
  search: z.string().optional(),
  branchId: z.coerce.number().optional(),
  sortBy: z.enum(['openedAt', 'fileNumber', 'operationalStatus', 'salesRep', 'productType', 'createdBy']).default('openedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  escrowOfficerId: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  priority: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().min(1).max(3).optional(),
  ),
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

async function buildHubExtraFilter(
  session: { role: string },
  escrowOfficerIdParam: string | undefined,
  priorityParam: number | undefined,
): Promise<{ filter: SQL | null; error: NextResponse | null }> {
  const parts: SQL[] = [];

  if (escrowOfficerIdParam !== undefined && escrowOfficerIdParam !== '') {
    if (escrowOfficerIdParam.toLowerCase() === 'null') {
      parts.push(isNull(orders.escrowOfficerId));
    } else {
      const id = parseInt(escrowOfficerIdParam, 10);
      if (!Number.isFinite(id)) {
        return {
          filter: null,
          error: NextResponse.json({ error: 'Invalid escrowOfficerId' }, { status: 400 }),
        };
      }
      parts.push(eq(orders.escrowOfficerId, id));
    }
  }

  if (priorityParam !== undefined) {
    if (session.role !== 'escrow_assistant') {
      return {
        filter: null,
        error: NextResponse.json(
          { error: 'priority filter is only available for escrow_assistant' },
          { status: 400 },
        ),
      };
    }
    const ordersData = await loadEscrowTaskOrderRows('escrow_assistant', null);
    const now = Date.now();
    const ids = orderIdsMatchingTaskPriority(
      ordersData,
      'escrow_assistant',
      now,
      priorityParam as TaskPriority,
    );
    if (ids.length === 0) {
      parts.push(eq(orders.id, -1));
    } else {
      parts.push(inArray(orders.id, ids));
    }
  }

  if (parts.length === 0) return { filter: null, error: null };
  const filter = parts.length === 1 ? parts[0]! : and(...parts)!;
  return { filter, error: null };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rawParams = Object.fromEntries(req.nextUrl.searchParams);
    const params = querySchema.parse(rawParams);
    const scopeFilter = await buildScopeFilter(session);

    const { filter: hubExtra, error } = await buildHubExtraFilter(
      session,
      params.escrowOfficerId,
      params.priority,
    );
    if (error) return error;

    const result = await getOrders(
      {
        page: params.page,
        pageSize: params.pageSize,
        status: params.status,
        search: params.search,
        branchId: params.branchId,
        sortBy: params.sortBy,
        sortDir: params.sortDir,
      },
      scopeFilter,
      hubExtra,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
