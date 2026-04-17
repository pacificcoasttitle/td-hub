import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { importOrdersFromSoftPro } from '@/lib/jobs/handlers/import-orders';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team', 'escrow_assistant'];

const bodySchema = z.object({
  dateFrom: z.string().min(1, 'dateFrom is required'),
  dateTo: z.string().min(1, 'dateTo is required'),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await importOrdersFromSoftPro(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'Import failed', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
