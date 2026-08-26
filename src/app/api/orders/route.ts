import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';
import { getOrders } from '@/lib/domain/orders/service';
import { orders } from '@/lib/db/schema';
import { buildScopeFilter } from '@/lib/domain/orders/scope';
import { HUB_QUEUES, type HubQueueId } from '@/lib/domain/orders/hub-queues';
import { queueFilter } from '@/lib/domain/orders/hub-queue-filters';
import type { TaskPriority } from '@/lib/domain/escrow/tasks';
import {
  loadEscrowTaskOrderRows,
  orderIdsMatchingTaskPriority,
} from '@/lib/domain/escrow/escrow-tasks-derivation';
import { missingExpectedEscrowOfficerSql } from '@/lib/domain/orders/escrow-officer-expectation';

const HUB_QUEUE_IDS = HUB_QUEUES.map((q) => q.id) as [HubQueueId, ...HubQueueId[]];

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  status: z.string().optional(),
  search: z.string().optional(),
  branchId: z.coerce.number().optional(),
  sortBy: z.enum(['openedAt', 'fileNumber', 'operationalStatus', 'salesRep', 'productType', 'createdBy']).default('openedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  /** Hub split-view queue rail. Absent means no queue filter at all. */
  queue: z.enum(HUB_QUEUE_IDS).optional(),
  escrowOfficerId: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  priority: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().min(1).max(3).optional(),
  ),
});

async function buildHubExtraFilter(
  session: { role: string },
  escrowOfficerIdParam: string | undefined,
  priorityParam: number | undefined,
  queue: HubQueueId | undefined,
  now: Date,
): Promise<{ filter: SQL | null; error: NextResponse | null }> {
  const parts: SQL[] = [];

  if (queue) {
    const q = queueFilter(queue, now);
    if (q) parts.push(q);
  }

  if (escrowOfficerIdParam !== undefined && escrowOfficerIdParam !== '') {
    if (escrowOfficerIdParam.toLowerCase() === 'null') {
      parts.push(missingExpectedEscrowOfficerSql(sql`${orders.orderType}`, sql`${orders.escrowOfficerId}`));
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
      params.queue,
      new Date(),
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
