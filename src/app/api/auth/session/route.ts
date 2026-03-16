import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    id: session.id,
    email: session.email,
    role: session.role,
    displayName: session.displayName,
    branchId: session.branchId,
    contactId: session.contactId,
  });
}
