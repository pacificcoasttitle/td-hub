import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { attachToSoftPro } from '@/lib/domain/documents/service';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const docId = parseInt(id, 10);
    if (isNaN(docId)) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
    }

    const result = await attachToSoftPro(docId);

    if (!result.success) {
      const status = result.error === 'Document not found' ? 404
        : result.error === 'Document is deleted' ? 410
        : result.error === 'Order not found' ? 404
        : 502;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Failed to attach document to SoftPro' },
      { status: 500 },
    );
  }
}
