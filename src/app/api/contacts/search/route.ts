import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';

const ALLOWED_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const pattern = `%${q}%`;
    const rows = await db
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
        phone: contacts.phone,
        companyName: contacts.companyName,
      })
      .from(contacts)
      .where(sql`(
        ${contacts.fullName} ILIKE ${pattern}
        OR ${contacts.email} ILIKE ${pattern}
        OR ${contacts.companyName} ILIKE ${pattern}
      )`)
      .limit(10);

    return NextResponse.json({ results: rows });
  } catch {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
