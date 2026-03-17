import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { documentAudit, documents, vendorApiLogs, titlePointData } from '@/lib/db/schema';
import { orderStatusHistory } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';

interface ActivityItem {
  type: 'document' | 'status_change' | 'vendor_call' | 'titlepoint';
  timestamp: Date;
  summary: string;
  meta: Record<string, unknown>;
}

const cache = new Map<number, { data: ActivityItem[]; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

export async function GET(
  req: NextRequest,
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

    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get('limit') ?? '30', 10) || 30,
      100,
    );

    const cached = cache.get(orderId);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ activity: cached.data.slice(0, limit) });
    }

    const [docAuditRows, statusRows, vendorRows, tpRows] = await Promise.all([
      db.select({
        action: documentAudit.action,
        performedAt: documentAudit.performedAt,
        byUserId: documentAudit.byUserId,
        meta: documentAudit.meta,
        filename: documents.filename,
        category: documents.category,
      })
        .from(documentAudit)
        .innerJoin(documents, and(
          eq(documentAudit.documentId, documents.id),
          eq(documents.orderId, orderId),
        ))
        .orderBy(desc(documentAudit.performedAt))
        .limit(20),

      db.select({
        status: orderStatusHistory.status,
        source: orderStatusHistory.source,
        notes: orderStatusHistory.notes,
        changedAt: orderStatusHistory.changedAt,
      })
        .from(orderStatusHistory)
        .where(eq(orderStatusHistory.orderId, orderId))
        .orderBy(desc(orderStatusHistory.changedAt))
        .limit(10),

      db.select({
        vendor: vendorApiLogs.vendor,
        operation: vendorApiLogs.operation,
        success: vendorApiLogs.success,
        httpStatus: vendorApiLogs.httpStatus,
        createdAt: vendorApiLogs.createdAt,
      })
        .from(vendorApiLogs)
        .where(eq(vendorApiLogs.orderId, orderId))
        .orderBy(desc(vendorApiLogs.createdAt))
        .limit(10),

      db.select({
        searchType: titlePointData.searchType,
        status: titlePointData.status,
        message: titlePointData.message,
        createdAt: titlePointData.createdAt,
      })
        .from(titlePointData)
        .where(eq(titlePointData.orderId, orderId))
        .orderBy(desc(titlePointData.createdAt))
        .limit(5),
    ]);

    const items: ActivityItem[] = [];

    for (const r of docAuditRows) {
      items.push({
        type: 'document',
        timestamp: r.performedAt,
        summary: `${r.action}: ${r.filename ?? 'unknown'} (${r.category})`,
        meta: { action: r.action, filename: r.filename, category: r.category, byUserId: r.byUserId },
      });
    }

    for (const r of statusRows) {
      items.push({
        type: 'status_change',
        timestamp: r.changedAt,
        summary: `Status → ${r.status} (via ${r.source})`,
        meta: { status: r.status, source: r.source, notes: r.notes },
      });
    }

    for (const r of vendorRows) {
      const label = r.success ? 'success' : `error (${r.httpStatus ?? 'N/A'})`;
      items.push({
        type: 'vendor_call',
        timestamp: r.createdAt,
        summary: `${r.vendor}.${r.operation} — ${label}`,
        meta: { vendor: r.vendor, operation: r.operation, success: r.success, httpStatus: r.httpStatus },
      });
    }

    for (const r of tpRows) {
      items.push({
        type: 'titlepoint',
        timestamp: r.createdAt,
        summary: `TitlePoint ${r.searchType ?? 'search'}: ${r.status ?? 'unknown'}`,
        meta: { searchType: r.searchType, status: r.status, message: r.message },
      });
    }

    items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    cache.set(orderId, { data: items, expiresAt: Date.now() + CACHE_TTL_MS });

    return NextResponse.json({ activity: items.slice(0, limit) });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
