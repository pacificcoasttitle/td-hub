import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { eventOutbox, notificationLogs } from '@/lib/db/schema';
import { sql, gte, desc, and, lt } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const month = Number(req.nextUrl.searchParams.get('month') || now.getMonth() + 1);
    const year = Number(req.nextUrl.searchParams.get('year') || now.getFullYear());
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);
    const outboxMonth = and(gte(eventOutbox.createdAt, monthStart), lt(eventOutbox.createdAt, monthEnd));
    const logsMonth = and(gte(notificationLogs.createdAt, monthStart), lt(notificationLogs.createdAt, monthEnd));
    // Raw `sql` gets strings: a Date interpolated there is rejected by the driver
    // (src/lib/db/driver-bind.ts). The builder calls above map Dates themselves.
    const monthStartIso = monthStart.toISOString();
    const monthEndIso = monthEnd.toISOString();

    const [outboxStats, outboxByType, deliveryStats, recentLogs, emailCount, smsCount] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          processed: sql<number>`count(*) filter (where ${eventOutbox.publishedAt} is not null)::int`,
          pending: sql<number>`count(*) filter (where ${eventOutbox.publishedAt} is null)::int`,
        })
        .from(eventOutbox)
        .where(outboxMonth),

      db
        .select({
          eventType: eventOutbox.eventType,
          total: sql<number>`count(*)::int`,
          processed: sql<number>`count(*) filter (where ${eventOutbox.publishedAt} is not null)::int`,
        })
        .from(eventOutbox)
        .where(outboxMonth)
        .groupBy(eventOutbox.eventType),

      db
        .select({
          total: sql<number>`count(*)::int`,
          sent: sql<number>`count(*) filter (where ${notificationLogs.status} = 'sent')::int`,
          failed: sql<number>`count(*) filter (where ${notificationLogs.status} = 'failed')::int`,
          skipped: sql<number>`count(*) filter (where ${notificationLogs.status} = 'skipped')::int`,
        })
        .from(notificationLogs)
        .where(logsMonth),

      db
        .select({
          id: notificationLogs.id,
          eventType: notificationLogs.eventType,
          channel: notificationLogs.channel,
          recipientEmail: notificationLogs.recipientEmail,
          status: notificationLogs.status,
          errorMessage: notificationLogs.errorMessage,
          createdAt: notificationLogs.createdAt,
          sentAt: notificationLogs.sentAt,
        })
        .from(notificationLogs)
        .where(logsMonth)
        .orderBy(desc(notificationLogs.createdAt))
        .limit(20),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(notificationLogs)
        .where(sql`${notificationLogs.channel} = 'email' and ${notificationLogs.status} = 'sent' and ${notificationLogs.createdAt} >= ${monthStartIso} and ${notificationLogs.createdAt} < ${monthEndIso}`),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(notificationLogs)
        .where(sql`${notificationLogs.channel} = 'sms' and ${notificationLogs.status} = 'sent' and ${notificationLogs.createdAt} >= ${monthStartIso} and ${notificationLogs.createdAt} < ${monthEndIso}`),
    ]);

    const o = outboxStats[0]!;
    const byType: Record<string, { total: number; processed: number }> = {};
    for (const r of outboxByType) {
      byType[r.eventType] = { total: r.total, processed: r.processed };
    }

    const d = deliveryStats[0]!;

    return NextResponse.json({
      outbox: {
        total: o.total,
        processed: o.processed,
        pending: o.pending,
        byType,
      },
      deliveries: {
        total: d.total,
        sent: d.sent,
        failed: d.failed,
        skipped: d.skipped,
        recentLogs: recentLogs.map((l) => ({
          id: l.id,
          eventType: l.eventType,
          channel: l.channel,
          recipientEmail: l.recipientEmail,
          status: l.status,
          errorMessage: l.errorMessage,
          createdAt: l.createdAt?.toISOString() ?? null,
          sentAt: l.sentAt?.toISOString() ?? null,
        })),
      },
      emailsSent: emailCount[0]?.count ?? 0,
      smsSent: smsCount[0]?.count ?? 0,
    });
  } catch (err) {
    console.error('[OPS] notifications error:', err);
    return NextResponse.json(
      { error: 'Failed to load notification status', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
