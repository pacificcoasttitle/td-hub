import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { documents } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(documents)
      .where(and(eq(documents.orderId, orderId), eq(documents.status, 'active')))
      .orderBy(desc(documents.createdAt));

    return NextResponse.json({ documents: rows });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load documents' },
      { status: 500 },
    );
  }
}
