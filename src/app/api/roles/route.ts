import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { roles } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';

export async function GET() {
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
