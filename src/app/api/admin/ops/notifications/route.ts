import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { eventOutbox, notificationLogs } from '@/lib/db/schema';
import { sql, gte, desc, isNotNull, isNull } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin'];

export async function GET() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [outboxStats, outboxByType, deliveryStats, recentLogs, emailCount, smsCount] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          processed: sql<number>`count(*) filter (where ${eventOutbox.publishedAt} is not null)::int`,
          pending: sql<number>`count(*) filter (where ${eventOutbox.publishedAt} is null)::int`,
        })
        .from(eventOutbox),

      db
        .select({
          eventType: eventOutbox.eventType,
          total: sql<number>`count(*)::int`,
          processed: sql<number>`count(*) filter (where ${eventOutbox.publishedAt} is not null)::int`,
        })
        .from(eventOutbox)
        .groupBy(eventOutbox.eventType),

      db
        .select({
          total: sql<number>`count(*)::int`,
          sent: sql<number>`count(*) filter (where ${notificationLogs.status} = 'sent')::int`,
          failed: sql<number>`count(*) filter (where ${notificationLogs.status} = 'failed')::int`,
          skipped: sql<number>`count(*) filter (where ${notificationLogs.status} = 'skipped')::int`,
        })
        .from(notificationLogs),

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
        .orderBy(desc(notificationLogs.createdAt))
        .limit(20),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(notificationLogs)
        .where(sql`${notificationLogs.channel} = 'email' and ${notificationLogs.status} = 'sent' and ${notificationLogs.createdAt} >= ${cutoff}`),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(notificationLogs)
        .where(sql`${notificationLogs.channel} = 'sms' and ${notificationLogs.status} = 'sent' and ${notificationLogs.createdAt} >= ${cutoff}`),
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
      emailsSent24h: emailCount[0]?.count ?? 0,
      smsSent24h: smsCount[0]?.count ?? 0,
    });
  } catch (err) {
    console.error('[OPS] notifications error:', err);
    return NextResponse.json(
      { error: 'Failed to load notification status', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
