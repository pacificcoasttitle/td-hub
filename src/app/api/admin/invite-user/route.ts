import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { inviteUser, INVITE_ROLES } from '@/lib/domain/users/invite-user';

const ALLOWED_ROLES = ['super_admin', 'admin'];

const bodySchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  role: z.enum(INVITE_ROLES),
  branchId: z.number().int().positive().optional(),
  contactId: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await inviteUser(parsed.data);
    if (result.status === 'exists') {
      return NextResponse.json({ error: 'User already has a profile' }, { status: 409 });
    }
    if (result.status === 'error') {
      return NextResponse.json({ error: `Failed to create user: ${result.error}` }, { status: 422 });
    }
    return NextResponse.json(
      { success: true, userId: result.userId, linked: result.status === 'linked' },
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
