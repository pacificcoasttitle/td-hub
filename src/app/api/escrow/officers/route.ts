import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';
import { internalContactFilter } from '@/lib/domain/contacts/filters';
import { db } from '@/lib/db/client';
import { contacts, orders } from '@/lib/db/schema';

const ALLOWED_ROLES = [
  'escrow_assistant',
  'escrow_officer',
  'super_admin',
  'admin',
  'cs_admin',
] as const;

function isAllowedRole(role: string): boolean {
  return (ALLOWED_ROLES as readonly string[]).includes(role);
}

/** Display name: trimmed first+last, else full_name, else officer_name (matches legacy SQL). */
const officerDisplayName = sql<string>`coalesce(
  nullif(trim(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, '')), ''),
  ${contacts.fullName},
  ${contacts.officerName}
)`;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isAllowedRole(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await db
    .select({
      id: contacts.id,
      name: officerDisplayName,
      email: contacts.email,
      activeCount: sql<number>`(
        select count(*)::int
        from ${orders}
        where ${orders.escrowOfficerId} = ${contacts.id}
          and ${orders.operationalStatus} in ('open', 'in_process')
      )`,
    })
    .from(contacts)
    .where(and(eq(contacts.isEscrowOfficer, true), internalContactFilter()))
    .orderBy(officerDisplayName);

  const officers = rows.map((r) => ({
    id: r.id,
    name: String(r.name ?? '').trim() || '—',
    email: r.email ?? '',
    activeCount: Number(r.activeCount ?? 0),
  }));

  return NextResponse.json({ officers });
}
