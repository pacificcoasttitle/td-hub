import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

let cached: { data: unknown; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  try {
    const selectFields = {
      id: contacts.id,
      fullName: contacts.fullName,
      email: contacts.email,
      phone: contacts.phone,
      softproLookupCode: contacts.softproLookupCode,
    };

    const [salesReps, titleOfficers, escrowOfficers] = await Promise.all([
      db.select(selectFields)
        .from(contacts)
        .where(sql`${contacts.roles}::jsonb @> '["sales_rep"]'::jsonb AND ${contacts.isActive} = true`)
        .limit(200),
      db.select(selectFields)
        .from(contacts)
        .where(sql`${contacts.roles}::jsonb @> '["title_officer"]'::jsonb AND ${contacts.isActive} = true`)
        .limit(200),
      db.select(selectFields)
        .from(contacts)
        .where(sql`${contacts.roles}::jsonb @> '["escrow_officer"]'::jsonb AND ${contacts.isActive} = true`)
        .limit(200),
    ]);

    const mapRow = (r: typeof salesReps[number]) => ({
      id: r.id,
      name: r.fullName,
      email: r.email,
      phone: r.phone,
      lookupCode: r.softproLookupCode,
    });

    const data = {
      salesReps: salesReps.map(mapRow),
      titleOfficers: titleOfficers.map(mapRow),
      escrowOfficers: escrowOfficers.map(mapRow),
    };

    cached = { data, expiresAt: Date.now() + CACHE_TTL_MS };

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
