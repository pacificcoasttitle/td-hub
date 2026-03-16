import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/client-scope';
import { generateCpl } from '@/lib/domain/cpl/service';
import { db } from '@/lib/db/client';
import { documents } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

const bodySchema = z.object({
  underwriter: z.enum(['westcor', 'fnf', 'natic', 'doma']),
  branchId: z.number().int().positive(),
  cplMode: z.enum(['single', 'multiple']).optional(),
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
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const result = await generateCpl(
      { orderId, ...parsed.data },
      session.id,
    );

    if (!result.success) {
      return NextResponse.json(
        { error: 'CPL generation failed', details: result.errors },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      warnings: result.errors.length > 0 ? result.errors : undefined,
    });
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

    const cpls = await db
      .select({
        id: documents.id,
        filename: documents.filename,
        description: documents.description,
        sizeBytes: documents.sizeBytes,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(and(
        eq(documents.orderId, orderId),
        eq(documents.category, 'cpl'),
        eq(documents.status, 'active'),
      ))
      .orderBy(desc(documents.createdAt));

    return NextResponse.json({ documents: cpls });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
