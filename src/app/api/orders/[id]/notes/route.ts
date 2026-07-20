import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrderDetailResource } from '@/lib/security/permissions';
import { createOrderNote, getOrderNotes } from '@/lib/domain/orders/notes';

const noteSchema = z.object({
  subject: z.string().max(255).optional(),
  text: z.string().min(1).max(5000),
  /** When true, note is visible to clients (`is_internal = false`). Default: staff-internal. */
  shareWithClient: z.boolean().optional(),
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

    if (!(await canAccessOrderDetailResource(session, orderId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = noteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const result = await createOrderNote({
      orderId,
      visibility: 'staff',
      text: parsed.data.text,
      subject: parsed.data.subject,
      shareWithClient: parsed.data.shareWithClient,
      authorName: session.displayName ?? session.email,
      authorId: session.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      note: result.note,
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

    if (!(await canAccessOrderDetailResource(session, orderId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { notes } = await getOrderNotes(orderId, 'staff');
    return NextResponse.json({ notes });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
