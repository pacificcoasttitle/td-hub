import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { loadConfirmationData } from '@/lib/domain/orders/confirm-data';

const paramSchema = z.object({
  fileNumber: z.string().min(1),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileNumber: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = await params;
  const parsed = paramSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid file number' }, { status: 400 });
  }

  try {
    const data = await loadConfirmationData(parsed.data.fileNumber);
    if (!data) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
