import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';

const ALLOWED_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team',
  'sales_rep', 'title_officer', 'escrow_officer'];

const querySchema = z.object({
  q: z.string().min(2).max(100),
  pageSize: z.coerce.number().min(1).max(50).default(10),
  type: z.enum(['all', 'person', 'company']).default('all'),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawParams = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ results: [] });
  }

  const { q, pageSize, type } = parsed.data;

  try {
    const isEmailSearch = q.includes('@');
    const pattern = `%${q}%`;

    const typeFilter = type === 'all'
      ? sql`true`
      : sql`${contacts.type} = ${type}`;

    const searchCondition = isEmailSearch
      ? sql`${contacts.email} ILIKE ${pattern}`
      : sql`(
          ${contacts.fullName} ILIKE ${pattern}
          OR ${contacts.email} ILIKE ${pattern}
          OR ${contacts.companyName} ILIKE ${pattern}
        )`;

    const rows = await db
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
        phone: contacts.phone,
        cell: contacts.cell,
        companyName: contacts.companyName,
        type: contacts.type,
        softproLookupCode: contacts.softproLookupCode,
        address1: contacts.address1,
        city: contacts.city,
        state: contacts.state,
        zip: contacts.zip,
      })
      .from(contacts)
      .where(sql`${searchCondition} AND ${typeFilter} AND ${contacts.isActive} = true`)
      .orderBy(
        isEmailSearch
          ? sql`CASE WHEN ${contacts.email} ILIKE ${q} THEN 0 ELSE 1 END`
          : sql`CASE WHEN ${contacts.fullName} ILIKE ${`${q}%`} THEN 0 ELSE 1 END`,
      )
      .limit(pageSize);

    const results = rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone ?? r.cell ?? null,
      companyName: r.companyName,
      type: r.type,
      contactType: r.type,
      lookupCode: r.softproLookupCode,
      address: r.address1,
      city: r.city,
      state: r.state,
      zip: r.zip,
    }));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
