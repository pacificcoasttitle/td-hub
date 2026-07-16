import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { eventOutbox, orders, vendorApiLogs, documents } from '@/lib/db/schema';
import { eq, and, desc, inArray, sql, or } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team', 'escrow_assistant'];
const paramSchema = z.object({ id: z.coerce.number().int().positive() });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = await params;
  const parsed = paramSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  const orderId = parsed.data.id;

  try {
    const [orderRow] = await db
      .select({ fileNumber: orders.fileNumber, emailStatus: orders.emailStatus })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!orderRow) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const outboxRows = await db
      .select()
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.orderId, orderId),
          eq(eventOutbox.eventType, 'order.confirmation'),
        ),
      )
      .orderBy(desc(eventOutbox.createdAt));

    const sgLogs = await db
      .select({
        id: vendorApiLogs.id,
        success: vendorApiLogs.success,
        requestMeta: vendorApiLogs.requestMeta,
        responseMeta: vendorApiLogs.responseMeta,
        createdAt: vendorApiLogs.createdAt,
      })
      .from(vendorApiLogs)
      .where(
        and(
          eq(vendorApiLogs.vendor, 'sendgrid'),
          or(
            eq(vendorApiLogs.operation, 'send_email'),
            eq(vendorApiLogs.operation, 'send_email_mock'),
          ),
          sql`${vendorApiLogs.requestMeta}->>'subject' LIKE ${`%${orderRow.fileNumber}%`}`,
        ),
      )
      .orderBy(desc(vendorApiLogs.createdAt));

    const docRows = await db
      .select({
        id: documents.id,
        category: documents.category,
        filename: documents.filename,
        sizeBytes: documents.sizeBytes,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.orderId, orderId),
          inArray(documents.category, ['legal_vesting', 'tax', 'grant_deed']),
          eq(documents.status, 'active'),
        ),
      );

    const confirmations = outboxRows.map((event) => {
      const isProcessed = !!event.publishedAt;
      const eventTime = event.publishedAt ?? event.createdAt;
      const matchedLog = findClosestLog(sgLogs, eventTime);

      let emailDetails: Record<string, unknown> | null = null;
      if (matchedLog) {
        const meta = matchedLog.requestMeta as Record<string, unknown> | null;
        emailDetails = {
          to: toStringArray(meta?.to),
          cc: toStringArray(meta?.cc),
          subject: (meta?.subject as string) ?? null,
          from: (meta?.from as string) ?? null,
          sentAt: matchedLog.createdAt?.toISOString() ?? null,
          deliveryStatus: matchedLog.success ? 'sent' : 'failed',
        };
      } else if (isProcessed) {
        emailDetails = {
          to: [], cc: [], subject: null, from: null,
          sentAt: event.publishedAt!.toISOString(),
          deliveryStatus: 'sent',
        };
      }

      // Bind docs that existed at/before this confirmation — do not share the
      // full current document set across every history row.
      const attachedDocuments = docRows
        .filter((d) => !d.createdAt || d.createdAt.getTime() <= eventTime.getTime())
        .map((d) => ({
          id: d.id,
          category: d.category,
          filename: d.filename,
          sizeBytes: d.sizeBytes ?? null,
        }));

      return {
        id: event.id,
        eventType: event.eventType,
        status: isProcessed ? 'processed' : (event.failCount >= 5 ? 'failed' : 'pending'),
        createdAt: event.createdAt.toISOString(),
        processedAt: event.publishedAt?.toISOString() ?? null,
        emailDetails,
        attachedDocuments,
      };
    });

    return NextResponse.json({
      confirmations,
      orderEmailStatus: orderRow.emailStatus,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load confirmation data', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}

function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
  if (typeof val === 'string') return [val];
  return [];
}

function findClosestLog(
  logs: Array<{ id: number; success: boolean | null; requestMeta: unknown; responseMeta: unknown; createdAt: Date }>,
  referenceTime: Date,
): (typeof logs)[number] | null {
  if (logs.length === 0) return null;
  if (logs.length === 1) return logs[0]!;

  const refMs = referenceTime.getTime();
  let best = logs[0]!;
  let bestDiff = Math.abs(best.createdAt.getTime() - refMs);

  for (let i = 1; i < logs.length; i++) {
    const diff = Math.abs(logs[i]!.createdAt.getTime() - refMs);
    if (diff < bestDiff) {
      best = logs[i]!;
      bestDiff = diff;
    }
  }

  return best;
}
