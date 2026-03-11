import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/client-scope';
import { db } from '@/lib/db/client';
import { documents } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const orderId = Number(rawId);
  if (Number.isNaN(orderId) || orderId <= 0) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const allowed = await canAccessOrder(session.id, orderId);
    if (!allowed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const docs = await db
      .select({
        id: documents.id,
        category: documents.category,
        filename: documents.filename,
        originalFilename: documents.originalFilename,
        contentType: documents.contentType,
        sizeBytes: documents.sizeBytes,
        description: documents.description,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.orderId, orderId),
          eq(documents.status, 'active')
        )
      )
      .orderBy(desc(documents.createdAt));

    return NextResponse.json({ documents: docs });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
