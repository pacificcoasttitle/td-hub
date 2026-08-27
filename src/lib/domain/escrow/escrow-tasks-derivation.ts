import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  contacts,
  documents,
  orderProperties,
  orderStatusHistory,
  orders,
  prelimAnalyses,
} from '@/lib/db/schema';
import type { Task, TaskPriority } from '@/lib/domain/escrow/tasks';
import { expectsPctEscrowOfficer, expectsPctEscrowOfficerSql } from '@/lib/domain/orders/escrow-officer-expectation';

/**
 * Coerce a value that may be Date | string | null into Date | null.
 * Raw SQL subqueries can return ISO strings even when TypeScript declares them as Date.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const ALL_SCOPE_ROLES = ['escrow_assistant', 'super_admin', 'admin', 'cs_admin'] as const;

export type EscrowTaskRole = 'escrow_assistant' | 'escrow_officer' | 'super_admin' | 'admin' | 'cs_admin';

export function isEscrowTaskRole(role: string): role is EscrowTaskRole {
  if (role === 'escrow_officer') return true;
  return (ALL_SCOPE_ROLES as readonly string[]).includes(role);
}

export type EscrowTaskOrderData = {
  id: number;
  fileNumber: string;
  orderType: string | null;
  escrowOfficerId: number | null;
  operationalStatus: 'open' | 'in_process' | 'completed';
  /** Null when SoftPro has given us no open date — see orders.openedAt. */
  openedAt: Date | null;
  completedAt: Date | null;
  orderUpdatedAt: Date;
  address: string | null;
  escrowOfficerName: string | null;
  prelimCount: number;
  cplCount: number;
  policyCount: number;
  lastDocActivity: Date | null;
  lastStatusChange: Date | null;
  latestTessaStatus: string | null;
  latestTessaCompleteAt: Date | null;
};

function orderBase(order: EscrowTaskOrderData): Omit<Task, 'priority' | 'label' | 'daysAgo'> {
  return {
    orderId: order.id,
    fileNumber: order.fileNumber,
    propertyAddress: order.address,
    escrowOfficerName: order.escrowOfficerName,
  };
}

function daysSince(now: number, value: Date): number {
  return Math.floor((now - value.getTime()) / DAY_MS);
}

function hoursSince(now: number, value: Date): number {
  return (now - value.getTime()) / HOUR_MS;
}

function addTask(
  acc: Task[],
  order: EscrowTaskOrderData,
  priority: TaskPriority,
  label: string,
  daysAgo: number | null,
) {
  acc.push({
    ...orderBase(order),
    priority,
    label,
    daysAgo,
  });
}

/**
 * Derives task rows for one order — must stay in sync with product rules in EW-2.
 */
export function computeTasksForOrder(
  order: EscrowTaskOrderData,
  role: EscrowTaskRole,
  now: number,
): Task[] {
  const tasks: Task[] = [];

  if (
    role !== 'escrow_officer'
    && order.escrowOfficerId === null
    && expectsPctEscrowOfficer(order.orderType)
    && ['open', 'in_process'].includes(order.operationalStatus)
  ) {
    addTask(tasks, order, 1, 'Unassigned', null);
  }

  if (order.operationalStatus === 'in_process' && order.lastDocActivity) {
    const daysSinceActivity = daysSince(now, order.lastDocActivity);
    if (daysSinceActivity >= 14) {
      addTask(tasks, order, 1, 'Stale - no activity 14+ days', daysSinceActivity);
    }
  }

  if (order.latestTessaStatus === 'failed') {
    addTask(tasks, order, 1, 'TESSA analysis failed', null);
  }

  if (order.operationalStatus === 'completed' && order.completedAt) {
    const daysSinceCompleted = daysSince(now, order.completedAt);
    if (daysSinceCompleted >= 30) {
      addTask(tasks, order, 1, 'Completed 30+ days, not closed', daysSinceCompleted);
    }
  }

  if (
    order.prelimCount > 0
    && order.cplCount === 0
    && ['open', 'in_process'].includes(order.operationalStatus)
  ) {
    addTask(tasks, order, 2, 'Has prelim, no CPL', null);
  }

  if (order.operationalStatus === 'completed' && order.policyCount === 0) {
    addTask(tasks, order, 2, 'Completed, no policy', null);
  }

  if (order.prelimCount > 0 && order.latestTessaStatus === null) {
    addTask(tasks, order, 2, 'Prelim not analyzed', null);
  }

  if (order.lastDocActivity && hoursSince(now, order.lastDocActivity) <= 24) {
    addTask(tasks, order, 3, 'New document uploaded', 0);
  }

  if (order.latestTessaCompleteAt && hoursSince(now, order.latestTessaCompleteAt) <= 24) {
    addTask(tasks, order, 3, 'TESSA analysis completed', 0);
  }

  if (order.lastStatusChange && hoursSince(now, order.lastStatusChange) <= 24) {
    addTask(tasks, order, 3, 'Status updated', 0);
  }

  return tasks;
}

/**
 * Same row set as GET /api/escrow/tasks uses for task derivation.
 */
export async function loadEscrowTaskOrderRows(
  role: EscrowTaskRole,
  assignedContactId: number | null,
): Promise<EscrowTaskOrderData[]> {
  const officerFilter = assignedContactId === null
    ? undefined
    : eq(orders.escrowOfficerId, assignedContactId);
  const scopeConditions = [
    expectsPctEscrowOfficerSql(sql`${orders.orderType}`),
    inArray(orders.operationalStatus, ['open', 'in_process', 'completed']),
  ];
  if (officerFilter) scopeConditions.push(officerFilter);
  const scopeFilter = and(...scopeConditions);

  const orderRows = await db
    .select({
      id: orders.id,
      fileNumber: orders.fileNumber,
      orderType: orders.orderType,
      escrowOfficerId: orders.escrowOfficerId,
      operationalStatus: orders.operationalStatus,
      openedAt: orders.openedAt,
      completedAt: orders.completedAt,
      orderUpdatedAt: orders.updatedAt,
      address: orderProperties.address,
      escrowOfficerName: sql<string | null>`nullif(concat_ws(' ', ${contacts.firstName}, ${contacts.lastName}), '')`,
      prelimCount: sql<number>`(
        select count(*)::int from ${documents}
        where ${documents.orderId} = ${orders.id}
          and ${documents.category} = 'prelim'
          and ${documents.status} = 'active'
      )`,
      cplCount: sql<number>`(
        select count(*)::int from ${documents}
        where ${documents.orderId} = ${orders.id}
          and ${documents.category} = 'cpl'
          and ${documents.status} = 'active'
      )`,
      policyCount: sql<number>`(
        select count(*)::int from ${documents}
        where ${documents.orderId} = ${orders.id}
          and ${documents.category} = 'policy'
          and ${documents.status} = 'active'
      )`,
      lastDocActivity: sql<Date | string | null>`(
        select max(${documents.updatedAt}) from ${documents}
        where ${documents.orderId} = ${orders.id}
          and ${documents.status} = 'active'
      )`,
      lastStatusChange: sql<Date | string | null>`(
        select max(${orderStatusHistory.changedAt}) from ${orderStatusHistory}
        where ${orderStatusHistory.orderId} = ${orders.id}
      )`,
      latestTessaStatus: sql<string | null>`(
        select ${prelimAnalyses.status} from ${prelimAnalyses}
        where ${prelimAnalyses.orderId} = ${orders.id}
        order by ${prelimAnalyses.createdAt} desc
        limit 1
      )`,
      latestTessaCompleteAt: sql<Date | string | null>`(
        select ${prelimAnalyses.completedAt} from ${prelimAnalyses}
        where ${prelimAnalyses.orderId} = ${orders.id}
          and ${prelimAnalyses.status} = 'complete'
        order by ${prelimAnalyses.completedAt} desc nulls last
        limit 1
      )`,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orderProperties.orderId, orders.id))
    .leftJoin(contacts, eq(contacts.id, orders.escrowOfficerId))
    .where(scopeFilter);

  return orderRows.map((row) => ({
    ...row,
    operationalStatus: row.operationalStatus as EscrowTaskOrderData['operationalStatus'],
    lastDocActivity: toDate(row.lastDocActivity),
    lastStatusChange: toDate(row.lastStatusChange),
    latestTessaCompleteAt: toDate(row.latestTessaCompleteAt),
  }));
}

/**
 * Order IDs that have at least one derived task in `priority` for `role` (EW-2 rules).
 * Used by GET /api/orders ?priority= for escrow_assistant — same scope as task cards.
 */
export function orderIdsMatchingTaskPriority(
  ordersData: EscrowTaskOrderData[],
  role: EscrowTaskRole,
  now: number,
  priority: TaskPriority,
): number[] {
  const out: number[] = [];
  for (const order of ordersData) {
    const tasks = computeTasksForOrder(order, role, now);
    if (tasks.some((t) => t.priority === priority)) {
      out.push(order.id);
    }
  }
  return out;
}

export const TASK_LIMIT_PER_PRIORITY = 100;

export function sortAndCapTasks(tasks: Task[]): Task[] {
  return [...tasks]
    .sort((a, b) => (b.daysAgo ?? -1) - (a.daysAgo ?? -1))
    .slice(0, TASK_LIMIT_PER_PRIORITY);
}
