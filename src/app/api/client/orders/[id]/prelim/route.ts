import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/client-scope';
import { db } from '@/lib/db/client';
import { documents, orders } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { addNotes } from '@/lib/integrations/softpro';
import { fetchPrelimsForOrder } from '@/lib/jobs/handlers/fetch-prelims';

const postSchema = z.object({
  action: z.enum(['fetch', 'note']).optional().default('note'),
  text: z.string().min(1).max(5000).optional(),
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
    const { id: rawId } = await params;
    const orderId = Number(rawId);
    if (Number.isNaN(orderId) || orderId <= 0) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const allowed = await canAccessOrder(session.id, orderId);
    if (!allowed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const prelims = await db
      .select({
        id: documents.id,
        filename: documents.filename,
        originalFilename: documents.originalFilename,
        description: documents.description,
        sizeBytes: documents.sizeBytes,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(and(
        eq(documents.orderId, orderId),
        eq(documents.category, 'prelim'),
        eq(documents.status, 'active'),
      ))
      .orderBy(desc(documents.createdAt));

    return NextResponse.json({
      prelims,
      analysis: null,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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
    const parsed = postSchema.safeParse(body);
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

    if (parsed.data.action === 'fetch') {
      const documentsStored = await fetchPrelimsForOrder(orderId, order.fileNumber);
      return NextResponse.json({
        success: true,
        documentsFound: documentsStored,
        documentsStored,
      });
    }

    // action === 'note'
    if (!parsed.data.text) {
      return NextResponse.json({ error: 'Text is required for notes' }, { status: 400 });
    }

    const result = await addNotes(order.fileNumber, parsed.data.text);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error?.message ?? 'Failed to add note' },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
