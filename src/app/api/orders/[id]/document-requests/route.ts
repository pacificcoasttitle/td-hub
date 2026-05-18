import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { documentRequests, eventOutbox } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';

const fulfillSchema = z.object({
  requestId: z.number().int().positive(),
  documentId: z.number().int().positive(),
});

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

    if (!(await canAccessOrder(session, orderId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(documentRequests)
      .where(eq(documentRequests.orderId, orderId));

    return NextResponse.json({ requests: rows });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
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

    if (!(await canAccessOrder(session, orderId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = fulfillSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(documentRequests)
      .where(and(
        eq(documentRequests.id, parsed.data.requestId),
        eq(documentRequests.orderId, orderId),
      ))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (existing.status !== 'pending') {
      return NextResponse.json({ error: `Request already ${existing.status}` }, { status: 409 });
    }

    await db.update(documentRequests).set({
      status: 'fulfilled',
      fulfilledDocumentId: parsed.data.documentId,
      updatedAt: new Date(),
    }).where(eq(documentRequests.id, parsed.data.requestId));

    await db.insert(eventOutbox).values({
      eventType: 'document_request.fulfilled',
      orderId,
      payload: {
        requestId: parsed.data.requestId,
        documentId: parsed.data.documentId,
        requestedBy: existing.requestedBy,
        requestType: existing.requestType,
      } as Record<string, unknown>,
    });

    return NextResponse.json({ success: true, requestId: parsed.data.requestId, status: 'fulfilled' });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
