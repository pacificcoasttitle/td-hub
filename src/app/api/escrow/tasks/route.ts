import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  contacts,
  orders,
  orderProperties,
  orderStatusHistory,
  documents,
  prelimAnalyses,
} from '@/lib/db/schema';
import { getSession } from '@/lib/security/auth';
import type { EscrowTasksResponse, Task, TaskPriority } from '@/lib/domain/escrow/tasks';

const ALL_SCOPE_ROLES = ['escrow_assistant', 'super_admin', 'admin', 'cs_admin'];
const TASK_LIMIT_PER_PRIORITY = 100;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

type EscrowTaskRole = 'escrow_assistant' | 'escrow_officer' | 'super_admin' | 'admin' | 'cs_admin';

type OrderData = {
  id: number;
  fileNumber: string;
  escrowOfficerId: number | null;
  operationalStatus: 'open' | 'in_process' | 'completed';
  openedAt: Date;
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

function isEscrowTaskRole(role: string): role is EscrowTaskRole {
  return role === 'escrow_officer' || ALL_SCOPE_ROLES.includes(role);
}

function orderBase(order: OrderData): Omit<Task, 'priority' | 'label' | 'daysAgo'> {
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
  tasks: Task[],
  order: OrderData,
  priority: TaskPriority,
  label: string,
  daysAgo: number | null,
) {
  tasks.push({
    ...orderBase(order),
    priority,
    label,
    daysAgo,
  });
}

function computeTasks(order: OrderData, role: EscrowTaskRole, now: number): Task[] {
  const tasks: Task[] = [];

  if (
    role !== 'escrow_officer'
    && order.escrowOfficerId === null
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

function sortAndCap(tasks: Task[]): Task[] {
  return [...tasks]
    .sort((a, b) => (b.daysAgo ?? -1) - (a.daysAgo ?? -1))
    .slice(0, TASK_LIMIT_PER_PRIORITY);
}

export async function GET() {
  const session = await getSession();

  if (!session || !isEscrowTaskRole(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const role = session.role;
  let assignedContactId: number | null = null;

  if (role === 'escrow_officer') {
    if (!session.contactId) {
      return NextResponse.json(
        { error: 'Escrow officer session is missing contactId' },
        { status: 422 },
      );
    }
    assignedContactId = session.contactId;
  }

  const scope = role === 'escrow_officer' ? 'assigned' : 'all';
  const officerFilter = assignedContactId === null
    ? undefined
    : eq(orders.escrowOfficerId, assignedContactId);
  const scopeConditions = [
    inArray(orders.orderType, ['Title & Escrow', 'Escrow only']),
    inArray(orders.operationalStatus, ['open', 'in_process', 'completed']),
  ];
  if (officerFilter) scopeConditions.push(officerFilter);
  const scopeFilter = and(...scopeConditions);

  const orderRows = await db
    .select({
      id: orders.id,
      fileNumber: orders.fileNumber,
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
      lastDocActivity: sql<Date | null>`(
        select max(${documents.updatedAt}) from ${documents}
        where ${documents.orderId} = ${orders.id}
          and ${documents.status} = 'active'
      )`,
      lastStatusChange: sql<Date | null>`(
        select max(${orderStatusHistory.changedAt}) from ${orderStatusHistory}
        where ${orderStatusHistory.orderId} = ${orders.id}
      )`,
      latestTessaStatus: sql<string | null>`(
        select ${prelimAnalyses.status} from ${prelimAnalyses}
        where ${prelimAnalyses.orderId} = ${orders.id}
        order by ${prelimAnalyses.createdAt} desc
        limit 1
      )`,
      latestTessaCompleteAt: sql<Date | null>`(
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

  const now = Date.now();
  const ordersData: OrderData[] = orderRows.map((row) => ({
    ...row,
    operationalStatus: row.operationalStatus as OrderData['operationalStatus'],
  }));
  const tasks = ordersData.flatMap((order) => computeTasks(order, role, now));
  const priority1 = tasks.filter((task) => task.priority === 1);
  const priority2 = tasks.filter((task) => task.priority === 2);
  const priority3 = tasks.filter((task) => task.priority === 3);
  const unassignedCount = scope === 'assigned'
    ? null
    : ordersData.filter((order) => (
      order.escrowOfficerId === null
      && ['open', 'in_process'].includes(order.operationalStatus)
    )).length;

  const response: EscrowTasksResponse = {
    generatedAt: new Date(now).toISOString(),
    scope,
    totalOrders: ordersData.length,
    summary: {
      priority1Count: priority1.length,
      priority2Count: priority2.length,
      priority3Count: priority3.length,
      unassignedCount,
    },
    tasksByPriority: {
      '1': sortAndCap(priority1),
      '2': sortAndCap(priority2),
      '3': sortAndCap(priority3),
    },
  };

  return NextResponse.json(response);
}
