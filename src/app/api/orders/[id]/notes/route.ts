import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { db } from '@/lib/db/client';
import { orders, orderNotes } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { addNotes } from '@/lib/integrations/softpro';

const noteSchema = z.object({
  subject: z.string().max(255).optional(),
  text: z.string().min(1).max(5000),
});

export async function POST(
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

    const canAccess = await canAccessOrder(session, orderId);
    if (!canAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = noteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const [order] = await db
      .select({ fileNumber: orders.fileNumber })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const [note] = await db.insert(orderNotes).values({
      orderId,
      subject: parsed.data.subject ?? null,
      body: parsed.data.text,
      authorName: session.displayName ?? session.email,
      authorId: session.id,
    }).returning();

    let synced = false;
    try {
      const spResult = await addNotes(order.fileNumber, parsed.data.text);
      if (spResult.success) {
        synced = true;
        await db.update(orderNotes).set({ isSyncedToSoftpro: true }).where(eq(orderNotes.id, note!.id));
      }
    } catch { /* best effort */ }

    return NextResponse.json({
      success: true,
      note: { id: note!.id, subject: note!.subject, body: note!.body, authorName: note!.authorName, createdAt: note!.createdAt, isSyncedToSoftpro: synced },
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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

    const canAccess = await canAccessOrder(session, orderId);
    if (!canAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rows = await db
      .select({
        id: orderNotes.id,
        subject: orderNotes.subject,
        body: orderNotes.body,
        authorName: orderNotes.authorName,
        createdAt: orderNotes.createdAt,
        isSyncedToSoftpro: orderNotes.isSyncedToSoftpro,
      })
      .from(orderNotes)
      .where(eq(orderNotes.orderId, orderId))
      .orderBy(desc(orderNotes.createdAt));

    return NextResponse.json({ notes: rows });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
