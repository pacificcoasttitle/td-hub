import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { branches } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(branches)
      .orderBy(asc(branches.code));

    return NextResponse.json({ branches: rows });
  } catch {
    return NextResponse.json({ error: 'Failed to load branches' }, { status: 500 });
  }
}
