import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/client-scope';
import { db } from '@/lib/db/client';
import { documentAudit, documents } from '@/lib/db/schema';
import { orderStatusHistory } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';

interface ActivityItem {
  type: 'document' | 'status_change';
  timestamp: Date;
  summary: string;
  meta: Record<string, unknown>;
}

const cache = new Map<number, { data: ActivityItem[]; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const allowed = await canAccessOrder(session.id, orderId);
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const cached = cache.get(orderId);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ activity: cached.data });
    }

    const [docAuditRows, statusRows] = await Promise.all([
      db.select({
        action: documentAudit.action,
        performedAt: documentAudit.performedAt,
        filename: documents.filename,
        category: documents.category,
      })
        .from(documentAudit)
        .innerJoin(documents, and(
          eq(documentAudit.documentId, documents.id),
          eq(documents.orderId, orderId),
        ))
        .orderBy(desc(documentAudit.performedAt))
        .limit(15),

      db.select({
        status: orderStatusHistory.status,
        changedAt: orderStatusHistory.changedAt,
      })
        .from(orderStatusHistory)
        .where(eq(orderStatusHistory.orderId, orderId))
        .orderBy(desc(orderStatusHistory.changedAt))
        .limit(10),
    ]);

    const items: ActivityItem[] = [];

    for (const r of docAuditRows) {
      items.push({
        type: 'document',
        timestamp: r.performedAt,
        summary: `${r.action}: ${r.filename ?? 'document'} (${r.category})`,
        meta: { action: r.action, filename: r.filename, category: r.category },
      });
    }

    for (const r of statusRows) {
      items.push({
        type: 'status_change',
        timestamp: r.changedAt,
        summary: `Status updated to ${r.status}`,
        meta: { status: r.status },
      });
    }

    items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const result = items.slice(0, 20);

    cache.set(orderId, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });

    return NextResponse.json({ activity: result });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
