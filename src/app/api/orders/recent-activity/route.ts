import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { documentAudit, documents } from '@/lib/db/schema';
import { eq, gte, sql } from 'drizzle-orm';

let cached: { data: Record<number, string>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ activity: cached.data });
  }

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        orderId: documents.orderId,
        lastActivity: sql<string>`max(${documentAudit.performedAt})`.as('last_activity'),
      })
      .from(documentAudit)
      .innerJoin(documents, eq(documentAudit.documentId, documents.id))
      .where(gte(documentAudit.performedAt, cutoff))
      .groupBy(documents.orderId)
      .limit(500);

    const activity: Record<number, string> = {};
    for (const r of rows) {
      activity[r.orderId] = r.lastActivity;
    }

    cached = { data: activity, expiresAt: Date.now() + CACHE_TTL_MS };

    return NextResponse.json({ activity });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
