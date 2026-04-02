import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { notificationTypes } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';

const ALLOWED_ROLES = ['super_admin', 'admin'];

export async function GET() {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const types = await db
    .select()
    .from(notificationTypes)
    .orderBy(asc(notificationTypes.displayName));

  return NextResponse.json({ types });
}
