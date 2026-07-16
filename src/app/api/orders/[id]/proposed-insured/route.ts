import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { generateProposedInsured, proposedInsuredInputSchema } from '@/lib/domain/documents/proposed-insured';
import { db } from '@/lib/db/client';
import { documents } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

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

    if (!(await canAccessOrder(session, orderId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = proposedInsuredInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const result = await generateProposedInsured(orderId, session.id, parsed.data);

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? 'Generation failed' }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      downloadUrl: result.downloadUrl ?? null,
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

    if (!(await canAccessOrder(session, orderId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const docs = await db
      .select({
        id: documents.id,
        filename: documents.filename,
        description: documents.description,
        storageKey: documents.storageKey,
        sizeBytes: documents.sizeBytes,
        createdAt: documents.createdAt,
        createdBy: documents.createdBy,
        isSyncedToSoftpro: documents.isSyncedToSoftpro,
      })
      .from(documents)
      .where(and(
        eq(documents.orderId, orderId),
        eq(documents.category, 'proposed_insured'),
        eq(documents.status, 'active'),
      ))
      .orderBy(desc(documents.createdAt));

    return NextResponse.json({ documents: docs });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
