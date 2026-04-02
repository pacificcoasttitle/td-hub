import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { notificationLogs, orders } from '@/lib/db/schema';
import { desc, eq, gte, lte, and, count, sql, SQL } from 'drizzle-orm';

const ALLOWED_ROLES = ['super_admin', 'admin'];

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  eventType: z.string().optional(),
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  orderId: z.coerce.number().int().positive().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!params.success) {
    return NextResponse.json({ error: 'Invalid query params', details: params.error.flatten() }, { status: 400 });
  }

  const { page, pageSize, eventType, status, dateFrom, dateTo, orderId } = params.data;
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];
  if (eventType) conditions.push(eq(notificationLogs.eventType, eventType));
  if (status) conditions.push(eq(notificationLogs.status, status));
  if (dateFrom) conditions.push(gte(notificationLogs.createdAt, new Date(dateFrom).toISOString()));
  if (dateTo) conditions.push(lte(notificationLogs.createdAt, new Date(dateTo).toISOString()));
  if (orderId) conditions.push(eq(notificationLogs.orderId, orderId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [logs, totalResult] = await Promise.all([
    db
      .select({
        id: notificationLogs.id,
        eventType: notificationLogs.eventType,
        orderId: notificationLogs.orderId,
        fileNumber: orders.fileNumber,
        channel: notificationLogs.channel,
        recipientEmail: notificationLogs.recipientEmail,
        recipientName: notificationLogs.recipientName,
        recipientRole: notificationLogs.recipientRole,
        subject: notificationLogs.subject,
        templateUsed: notificationLogs.templateUsed,
        status: notificationLogs.status,
        provider: notificationLogs.provider,
        providerId: notificationLogs.providerId,
        errorMessage: notificationLogs.errorMessage,
        metadata: notificationLogs.metadata,
        createdAt: notificationLogs.createdAt,
        sentAt: notificationLogs.sentAt,
      })
      .from(notificationLogs)
      .leftJoin(orders, eq(notificationLogs.orderId, orders.id))
      .where(where)
      .orderBy(desc(notificationLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(notificationLogs)
      .where(where),
  ]);

  const total = totalResult[0]?.total ?? 0;

  return NextResponse.json({
    logs,
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
  });
}
