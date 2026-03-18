import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { handleSyncContacts } from '@/lib/jobs/handlers/sync-contacts';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

const VALID_USER_TYPES = [
  'Escrow Officer',
  'Lender',
  'Mortgage Broker',
  'Selling Agent/Broker',
  'Title Officer',
  'Order Contact - Person',
  'Escrow Company',
  'Underwriter',
] as const;

const bodySchema = z.object({
  userType: z.enum(VALID_USER_TYPES),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues, validTypes: VALID_USER_TYPES },
      { status: 400 },
    );
  }

  try {
    const result = await handleSyncContacts({ entityType: parsed.data.userType });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
