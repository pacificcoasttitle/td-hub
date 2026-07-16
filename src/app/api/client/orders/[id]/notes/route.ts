import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/client-scope';
import { db } from '@/lib/db/client';
import { orders, orderNotes } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { addNotes } from '@/lib/integrations/softpro';

const noteSchema = z.object({
  subject: z.string().max(255).optional(),
  text: z.string().min(1).max(5000).optional(),
  note: z.string().min(1).max(5000).optional(),
}).refine((d) => d.text || d.note, { message: 'text or note is required' });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: rawId } = await params;
    const orderId = Number(rawId);
    if (Number.isNaN(orderId) || orderId <= 0) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const allowed = await canAccessOrder(session.id, orderId);
    if (!allowed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = noteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const noteText = parsed.data.text ?? parsed.data.note!;

    const [order] = await db
      .select({ fileNumber: orders.fileNumber })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Client-authored notes are shared with the client portal (not staff-internal).
    const [note] = await db.insert(orderNotes).values({
      orderId,
      subject: parsed.data.subject ?? null,
      body: noteText,
      authorName: session.displayName ?? session.email,
      authorId: session.id,
      isInternal: false,
    }).returning();

    let synced = false;
    try {
      const spResult = await addNotes(order.fileNumber, noteText);
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
    const { id: rawId } = await params;
    const orderId = Number(rawId);
    if (Number.isNaN(orderId) || orderId <= 0) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const allowed = await canAccessOrder(session.id, orderId);
    if (!allowed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Clients only see non-internal notes. Staff-internal / SoftPro-internal stay hidden.
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
      .where(and(eq(orderNotes.orderId, orderId), eq(orderNotes.isInternal, false)))
      .orderBy(desc(orderNotes.createdAt));

    return NextResponse.json({ notes: rows });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
