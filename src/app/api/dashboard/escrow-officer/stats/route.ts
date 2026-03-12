import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { orders } from '@/lib/db/schema';
import { getScopedStats, getDocumentStats } from '@/lib/domain/orders/scoped-queries';

const ALLOWED_ROLES = ['escrow_officer', 'super_admin', 'admin', 'cs_admin'];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.contactId) return NextResponse.json({ error: 'Profile not linked to a contact' }, { status: 422 });

  const [stats, docStats] = await Promise.all([
    getScopedStats(orders.escrowOfficerId, session.contactId),
    getDocumentStats(session.contactId),
  ]);

  return NextResponse.json({
    assignedOrders: stats.assigned,
    openOrders: stats.open,
    pendingDocuments: docStats.pendingDocuments,
    cplGenerated: docStats.cplGenerated,
  });
}
