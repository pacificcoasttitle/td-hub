import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

const PRODUCT_TYPES = [
  { value: 'residential_resale', label: 'Residential Resale' },
  { value: 'residential_refinance', label: 'Residential Refinance' },
  { value: 'short_form', label: 'Short Form' },
  { value: 'full_alta', label: 'Full ALTA' },
  { value: 'commercial', label: 'Commercial' },
];

const ORDER_TYPES = [
  { value: 'Title only', label: 'Title Only' },
  { value: 'Title & Escrow', label: 'Title & Escrow' },
  { value: 'Escrow only', label: 'Escrow Only' },
];

const TRANSACTION_TYPES = [
  { value: 'Purchase', label: 'Purchase' },
  { value: 'Refinance', label: 'Refinance' },
  { value: 'Equity', label: 'Equity' },
  { value: 'Other', label: 'Other' },
];

const UNDERWRITERS = [
  { code: 'WC', name: 'Westcor' },
  { code: 'FNF', name: 'FNF / Commonwealth' },
  { code: 'NATIC', name: 'NATIC' },
];

let cachedResult: { data: Record<string, unknown>; timestamp: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cachedResult.data);
  }

  try {
    const [salesReps, titleOfficers, escrowOfficers] = await Promise.all([
      db.select({
        id: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
      })
        .from(contacts)
        .where(sql`${contacts.roles}::jsonb @> '["sales_rep"]'::jsonb`)
        .limit(200),

      db.select({
        id: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
      })
        .from(contacts)
        .where(sql`${contacts.roles}::jsonb @> '["title_officer"]'::jsonb`)
        .limit(200),

      db.select({
        id: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
      })
        .from(contacts)
        .where(sql`${contacts.roles}::jsonb @> '["escrow_officer"]'::jsonb`)
        .limit(200),
    ]);

    const data = {
      productTypes: PRODUCT_TYPES,
      orderTypes: ORDER_TYPES,
      transactionTypes: TRANSACTION_TYPES,
      underwriters: UNDERWRITERS,
      salesReps: salesReps.map((r) => ({ id: r.id, name: r.fullName, email: r.email })),
      titleOfficers: titleOfficers.map((r) => ({ id: r.id, name: r.fullName, email: r.email })),
      escrowOfficers: escrowOfficers.map((r) => ({ id: r.id, name: r.fullName, email: r.email })),
    };

    cachedResult = { data, timestamp: Date.now() };

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
