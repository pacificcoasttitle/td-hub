import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrderDetailResource } from '@/lib/security/permissions';
import { db } from '@/lib/db/client';
import { docCategoryEnum, documents } from '@/lib/db/schema';
import { eq, desc, and, SQL } from 'drizzle-orm';

const DOC_CATEGORIES = docCategoryEnum.enumValues;
type DocCategory = (typeof DOC_CATEGORIES)[number];

function isDocCategory(value: string): value is DocCategory {
  return (DOC_CATEGORIES as readonly string[]).includes(value);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    if (!(await canAccessOrderDetailResource(session, orderId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rawCategory = req.nextUrl.searchParams.get('category');
    let category: DocCategory | null = null;
    if (rawCategory) {
      if (!isDocCategory(rawCategory)) {
        return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
      }
      category = rawCategory;
    }

    const conditions: SQL[] = [
      eq(documents.orderId, orderId),
      eq(documents.status, 'active'),
    ];
    if (category) {
      conditions.push(eq(documents.category, category));
    }

    const rows = await db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.createdAt));

    return NextResponse.json({ documents: rows });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load documents' },
      { status: 500 },
    );
  }
}
