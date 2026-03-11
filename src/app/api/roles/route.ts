import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { roles } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rows = await db
      .select()
      .from(roles)
      .orderBy(asc(roles.name));

    return NextResponse.json({ roles: rows });
  } catch {
    return NextResponse.json({ error: 'Failed to load roles' }, { status: 500 });
  }
}
