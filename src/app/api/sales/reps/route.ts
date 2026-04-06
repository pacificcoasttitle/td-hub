import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'sales_manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.contactId) return NextResponse.json({ error: 'Profile not linked to a contact' }, { status: 422 });

  try {
    const [own] = await db
      .select({ id: contacts.id, fullName: contacts.fullName, email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.id, session.contactId), eq(contacts.isSalesRep, true)))
      .limit(1);

    if (!own) return NextResponse.json({ error: 'No sales rep contact found' }, { status: 404 });

    const managed = await db
      .select({ id: contacts.id, fullName: contacts.fullName, email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.managerId, session.contactId), eq(contacts.isSalesRep, true)))
      .orderBy(asc(contacts.fullName));

    const reps = [
      { id: own.id, fullName: own.fullName ?? '', email: own.email ?? '' },
      ...managed.map((r) => ({ id: r.id, fullName: r.fullName ?? '', email: r.email ?? '' })),
    ];

    return NextResponse.json({ reps });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', ...(process.env.NODE_ENV === 'development' && { detail: err instanceof Error ? err.message : 'Unknown' }) },
      { status: 500 },
    );
  }
}
