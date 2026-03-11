import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { attachToSoftPro } from '@/lib/domain/documents/service';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const docId = parseInt(id, 10);
  if (isNaN(docId)) {
    return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
  }

  try {
    const result = await attachToSoftPro(docId);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
