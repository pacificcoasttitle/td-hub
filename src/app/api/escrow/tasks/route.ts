import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import type { EscrowTasksResponse } from '@/lib/domain/escrow/tasks';
import {
  computeTasksForOrder,
  isEscrowTaskRole,
  loadEscrowTaskOrderRows,
  sortAndCapTasks,
  type EscrowTaskRole,
} from '@/lib/domain/escrow/escrow-tasks-derivation';

export async function GET() {
  const session = await getSession();

  if (!session || !isEscrowTaskRole(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const role = session.role as EscrowTaskRole;
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
  const ordersData = await loadEscrowTaskOrderRows(role, assignedContactId);
  const now = Date.now();

  const tasks = ordersData.flatMap((order) => computeTasksForOrder(order, role, now));
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
      '1': sortAndCapTasks(priority1),
      '2': sortAndCapTasks(priority2),
      '3': sortAndCapTasks(priority3),
    },
  };

  return NextResponse.json(response);
}
