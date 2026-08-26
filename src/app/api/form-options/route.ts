import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { internalOfficerFilter } from '@/lib/domain/contacts/filters';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

const PRODUCT_TYPES = [
  { value: 'Residential Resale', label: 'Residential Resale' },
  { value: 'Full ALTA', label: 'Full ALTA' },
  { value: 'Short Form', label: 'Short Form' },
  { value: 'Junior Loan', label: 'Junior Loan' },
  { value: 'Prelim', label: 'Prelim' },
  { value: 'Hard Money', label: 'Hard Money' },
  { value: 'Shortsale', label: 'Shortsale' },
  { value: 'Mobile Home', label: 'Mobile Home' },
  { value: 'Title Report', label: 'Title Report' },
];

const ORDER_TYPES = [
  { value: 'Title only', label: 'Title Only' },
  { value: 'Title & Escrow', label: 'Title & Escrow' },
  { value: 'Escrow only', label: 'Escrow Only' },
  { value: 'Sub Escrow', label: 'Sub Escrow' },
  { value: 'Title Search', label: 'Title Search' },
];

const TRANSACTION_TYPES = [
  { value: 'Purchase', label: 'Purchase' },
  { value: 'Refinance', label: 'Refinance' },
  { value: 'Equity', label: 'Equity' },
  { value: 'Other', label: 'Other' },
];

const UNDERWRITERS = [
  { code: 'WC', name: 'Westcor' },
  { code: 'CW', name: 'Commonwealth' },
];

function dedupeByName<T extends { id: number; name: string | null }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const key = (item.name ?? '').toLowerCase().trim();
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing || item.id < existing.id) seen.set(key, item);
  }
  return [...seen.values()];
}

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
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        fullName: contacts.fullName,
        email: contacts.email,
      })
        .from(contacts)
        .where(sql`${contacts.isSalesRep} = true`)
        .orderBy(contacts.lastName, contacts.firstName)
        .limit(200),

      db.select({
        id: contacts.id,
        officerName: contacts.officerName,
        fullName: contacts.fullName,
        email: contacts.email,
      })
        .from(contacts)
        .where(internalOfficerFilter('title_officer'))
        .orderBy(contacts.officerName)
        .limit(200),

      db.select({
        id: contacts.id,
        officerName: contacts.officerName,
        fullName: contacts.fullName,
        email: contacts.email,
      })
        .from(contacts)
        .where(internalOfficerFilter('escrow_officer'))
        .orderBy(contacts.officerName)
        .limit(200),
    ]);

    const data = {
      productTypes: PRODUCT_TYPES,
      orderTypes: ORDER_TYPES,
      transactionTypes: TRANSACTION_TYPES,
      underwriters: UNDERWRITERS,
      salesReps: salesReps.map((r) => ({ id: r.id, name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.fullName, email: r.email })),
      titleOfficers: dedupeByName(titleOfficers.map((r) => ({ id: r.id, name: r.officerName ?? r.fullName, email: r.email }))),
      escrowOfficers: dedupeByName(escrowOfficers.map((r) => ({ id: r.id, name: r.officerName ?? r.fullName, email: r.email }))),
    };

    cachedResult = { data, timestamp: Date.now() };

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
