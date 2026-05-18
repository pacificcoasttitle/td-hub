import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { documentAudit, documents, orders } from '@/lib/db/schema';

const ALLOWED_ROLES = ['escrow_officer'];
const LIMIT = 20;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!session.contactId) {
    return NextResponse.json(
      { error: 'Profile not linked to a contact' },
      { status: 422 },
    );
  }

  const rows = await db
    .select({
      id: documentAudit.id,
      action: documentAudit.action,
      performedAt: documentAudit.performedAt,
      documentId: documents.id,
      filename: documents.filename,
      category: documents.category,
      orderId: orders.id,
      fileNumber: orders.fileNumber,
    })
    .from(documentAudit)
    .innerJoin(documents, eq(documents.id, documentAudit.documentId))
    .innerJoin(orders, eq(orders.id, documents.orderId))
    .where(eq(orders.escrowOfficerId, session.contactId))
    .orderBy(desc(documentAudit.performedAt))
    .limit(LIMIT);

  const activity = rows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    fileNumber: r.fileNumber,
    action: r.action,
    filename: r.filename,
    category: r.category,
    performedAt: r.performedAt.toISOString(),
  }));

  return NextResponse.json({ activity });
}
