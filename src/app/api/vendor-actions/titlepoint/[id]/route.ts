import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getTitlePointRecord } from '@/lib/domain/titlepoint/service';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const record = await getTitlePointRecord(id);

    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const meta = (record.metadata as Record<string, unknown>) ?? {};

    return NextResponse.json({
      id: record.id,
      orderId: record.orderId,
      fileNumber: record.fileNumber,
      searchType: record.searchType,
      status: record.status,
      message: record.message,
      serviceId: record.serviceId,
      fips: record.fips,
      documentId: meta.documentId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
